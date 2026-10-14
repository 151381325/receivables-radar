import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/app.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createReceivable, addPayment, addFollowUp } from '../../src/domain.js';
import { parseBackup, serializeBackup } from '../../src/backup.js';

test('backup restore preserves full history, skips existing data and rejects invalid batches atomically', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL);
  let app;
  try {
    await runMigrations(pool);
    const accounts = createAccountRepository(pool);
    const user = await accounts.createUser({ email: `backup-${crypto.randomUUID()}@example.test`, passwordHash: 'isolated-test-placeholder' });
    const config = { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'http://test' };
    const session = await createSessionService(pool, config).createSession(user.id);
    app = await buildApp({ config, pool });
    const request = async (method, url, payload) => app.inject({ method, url, payload, headers: { cookie: `rr=${session.token}` } });
    const list = async () => {
      const result = await request('GET', '/api/receivables');
      assert.equal(result.statusCode, 200);
      return result.json().records;
    };
    const timestamp = '2026-10-14T01:00:00.000Z';
    let original = createReceivable({ clientName: '备份验收', projectName: '合成示例', totalAmount: 1234.56, dueDate: '2026-10-21', invoiceSent: true, nextFollowUpDate: '2026-10-29', notes: '测试备注' }, timestamp);
    original = addPayment(original, { amount: 234.56, paidAt: '2026-10-14', method: '转账', notes: '合成到账' }, timestamp);
    original = addFollowUp(original, { followedAt: '2026-10-14', result: '合成跟进', promiseAction: 'set', promiseDate: '2026-10-28', nextFollowUpDate: '2026-10-29' }, timestamp);
    const text = serializeBackup([original], timestamp);
    const parsed = parseBackup(text);
    assert.deepEqual(await list(), []);
    const first = await request('POST', '/api/receivables/import', { records: parsed.records });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().importedCount, 1);
    const restored = first.json().records[0];
    for (const field of ['id', 'clientName', 'projectName', 'totalAmount', 'dueDate', 'nextFollowUpDate', 'notes', 'invoiceSent', 'paused', 'createdAt', 'updatedAt', 'paymentRecords', 'followUpRecords']) {
      assert.deepEqual(restored[field], original[field], `Restore must preserve ${field}`);
    }
    const updated = await request('PUT', `/api/receivables/${restored.id}`, { ...restored, notes: '云端较新的备注', nextFollowUpDate: '2026-11-02' });
    assert.equal(updated.statusCode, 200);
    const before = await list();
    const repeated = await request('POST', '/api/receivables/import', { records: parsed.records });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.json().importedCount, 0);
    assert.equal(repeated.json().skippedCount, 1);
    assert.deepEqual(await list(), before, 'Old backup must not overwrite newer cloud data');
    assert.deepEqual(parseBackup(serializeBackup(before)).records, before);

    const validNew = createReceivable({ clientName: '不应部分导入', projectName: '合成示例', totalAmount: 1, invoiceSent: false, dueDate: '2026-12-01' }, timestamp);
    const invalid = { ...validNew, id: `invalid-${crypto.randomUUID()}`, dueDate: '2026-02-30' };
    const rejected = await request('POST', '/api/receivables/import', { records: [validNew, invalid] });
    assert.equal(rejected.statusCode, 400);
    assert.deepEqual(await list(), before, 'Invalid batch must not partially import its valid first record');
    for (const broken of ['{broken', JSON.stringify({ version: 999, records: [original] }), serializeBackup([{ ...original, paymentRecords: [{ ...original.paymentRecords[0], amount: 9999 }] }])]) {
      assert.throws(() => parseBackup(broken));
      assert.deepEqual(await list(), before);
    }
    assert.deepEqual(parseBackup(serializeBackup([])).records, []);
  } finally {
    await app?.close();
    await pool.end();
  }
});
