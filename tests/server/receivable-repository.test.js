import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createReceivableRepository } from '../../server/receivables/repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const record = {
  id: 'rec-cloud-1', clientName: '甲方', projectName: '官网项目', totalAmount: 1200,
  invoiceSent: true, dueDate: '2026-10-01', nextFollowUpDate: null, paused: false,
  notes: '', paymentRecords: [], followUpRecords: [], createdAt: '2026-09-13T00:00:00.000Z',
};

describe('应收仓库 PostgreSQL 集成', { skip: !databaseUrl }, () => {
  let pool; let accounts; let repository; let owner; let other;

  before(async () => {
    pool = createPool(databaseUrl);
    await runMigrations(pool);
    accounts = createAccountRepository(pool);
    repository = createReceivableRepository(pool);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    owner = await accounts.createUser({ email: 'owner@example.com', passwordHash: 'hash' });
    other = await accounts.createUser({ email: 'other@example.com', passwordHash: 'hash' });
  });
  after(async () => pool?.end());

  test('其他账号无法读取或修改应收', async () => {
    const created = await repository.create(owner.id, record);
    assert.equal(created.version, 1);
    assert.deepEqual(await repository.list(other.id), []);
    assert.equal(await repository.update(other.id, created.id, 1, { ...record, clientName: '篡改' }), null);
    assert.equal((await repository.list(owner.id))[0].clientName, '甲方');
  });

  test('旧版本不能覆盖最新记录', async () => {
    const created = await repository.create(owner.id, record);
    const updated = await repository.update(owner.id, created.id, 1, { ...record, clientName: '新名称' });
    assert.equal(updated.version, 2);
    await assert.rejects(
      repository.update(owner.id, created.id, 1, { ...record, clientName: '旧名称' }),
      (error) => error.code === 'STALE_VERSION',
    );
    assert.equal((await repository.list(owner.id))[0].clientName, '新名称');
  });

  test('到账、跟进和软删除均受账号与版本保护', async () => {
    const created = await repository.create(owner.id, record);
    const paid = await repository.addPayment(owner.id, created.id, 1, {
      id: 'pay-1', amount: 200, paidAt: '2026-09-14', method: '转账', notes: '',
    });
    assert.equal(paid.paymentRecords[0].amount, 200);
    const followed = await repository.addFollowUp(owner.id, created.id, 2, {
      id: 'follow-1', followedAt: '2026-09-15', result: '已沟通', promiseDate: null, nextFollowUpDate: '2026-09-20',
    });
    assert.equal(followed.followUpRecords[0].result, '已沟通');
    assert.equal(await repository.softDelete(other.id, created.id, 3), null);
    await repository.softDelete(owner.id, created.id, 3);
    assert.deepEqual(await repository.list(owner.id), []);
  });

  test('导入会保留付款和跟进时间线，已有云端记录优先', async () => {
    const localRecord = {
      ...record,
      id: 'rec-import-1',
      paymentRecords: [{ id: 'pay-import-1', amount: 300, paidAt: '2026-09-10', method: '转账', notes: '首款' }],
      followUpRecords: [{ id: 'follow-import-1', followedAt: '2026-09-11', result: '确认回款', promiseDate: '2026-09-20', nextFollowUpDate: '2026-09-18' }],
    };
    const first = await repository.importRecords(owner.id, [localRecord]);
    assert.equal(first.importedCount, 1);
    assert.equal(first.records[0].paymentRecords[0].amount, 300);
    assert.equal(first.records[0].followUpRecords[0].result, '确认回款');

    const repeat = await repository.importRecords(owner.id, [localRecord]);
    assert.equal(repeat.importedCount, 0);
    assert.equal(repeat.skippedCount, 1);
  });

  test('同版本并发登记到账只允许一次提交，余额不会超收', async () => {
    await repository.create(owner.id, record);
    const responses = await Promise.allSettled([
      repository.addPayment(owner.id, record.id, 1, { id: 'concurrent-1', amount: 800, paidAt: '2026-09-14', method: '转账', notes: '' }),
      repository.addPayment(owner.id, record.id, 1, { id: 'concurrent-2', amount: 800, paidAt: '2026-09-14', method: '转账', notes: '' }),
    ]);
    assert.equal(responses.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(responses.find(item => item.status === 'rejected').reason.code, 'STALE_VERSION');
    const stored = (await repository.list(owner.id))[0];
    assert.equal(stored.paymentRecords.reduce((sum, payment) => sum + payment.amount, 0), 800);
    assert.equal(stored.version, 2);
  });

  test('到账纠错保留原始事件且其他账号无法查看', async () => {
    await repository.create(owner.id, record);
    await repository.addPayment(owner.id, record.id, 1, { id: 'wrong-1', amount: 100, paidAt: '2026-09-14', method: '转账', notes: '误录' });
    assert.equal(await repository.removePayment(other.id, record.id, 'wrong-1', 2), null);
    const corrected = await repository.removePayment(owner.id, record.id, 'wrong-1', 2);
    assert.deepEqual(corrected.paymentRecords, []);
    const audit = await pool.query('SELECT original_payment FROM payment_correction_events WHERE user_id=$1', [owner.id]);
    assert.equal(audit.rows.length, 1);
    assert.equal(Number(audit.rows[0].original_payment.amount_fen), 10000);
  });

  test('批量导入同一时间戳的承诺历史保留撤销顺序', async () => {
    const imported = await repository.importRecords(owner.id, [{ ...record, followUpRecords: [
      { id: 'promise-set', followedAt: '2026-09-01', result: '承诺付款', promiseDate: '2026-09-10', promiseAction: 'set' },
      { id: 'promise-clear', followedAt: '2026-09-11', result: '撤销旧承诺', promiseDate: null, promiseAction: 'clear' },
    ] }]);
    assert.deepEqual(imported.records[0].followUpRecords.map(item => item.promiseAction), ['set', 'clear']);
  });
});
