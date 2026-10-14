import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/app.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createApiClient } from '../../src/api-client.js';
import { createCloudRepository } from '../../src/cloud-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
let pool;
let app;
let deviceA;
let deviceB;
before(async () => {
  if (!databaseUrl) return;
  pool = createPool(databaseUrl);
  await runMigrations(pool);
  const accounts = createAccountRepository(pool);
  const owner = await accounts.createUser({ email: `multi-${crypto.randomUUID()}@example.test`, passwordHash: 'isolated-test-placeholder' });
  const config = { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'http://test', sessionSecret: 'isolated-test-only' };
  const sessions = createSessionService(pool, config);
  app = await buildApp({ config, pool });
  async function device() {
    const session = await sessions.createSession(owner.id);
    return createCloudRepository(createApiClient(async (url, options) => {
      const result = await app.inject({ method: options.method || 'GET', url, headers: { ...options.headers, cookie: `rr=${session.token}` }, payload: options.body });
      return new Response(result.body || null, { status: result.statusCode, headers: { 'content-type': result.headers['content-type'] || '' } });
    }));
  }
  deviceA = await device();
  deviceB = await device();
});
after(async () => { await app?.close(); await pool?.end(); });

test('two authenticated sessions synchronize and reject stale edits and concurrent payments', { skip: !databaseUrl }, async () => {
  const created = await deviceA.create({ clientName: '双会话验收', projectName: '隔离示例', totalAmount: 1000, invoiceSent: true, dueDate: '2026-12-01', notes: '', paused: false });
  assert.equal(created.dueDate, '2026-12-01');
  assert.equal(created.nextFollowUpDate, null);
  await deviceB.load();
  assert.deepEqual(deviceB.get(created.id), deviceA.get(created.id));
  const stale = deviceB.get(created.id);
  await deviceA.update(created.id, { ...created, notes: 'A端最新修改' });
  await assert.rejects(deviceB.update(created.id, { ...stale, notes: 'B端旧稿' }), error => error.status === 409 && error.code === 'STALE_VERSION');
  await deviceB.load();
  assert.equal(deviceB.get(created.id).notes, 'A端最新修改');
  assert.equal(deviceB.get(created.id).version, 2);

  await deviceA.load();
  const results = await Promise.allSettled([
    deviceA.addPayment(created.id, { version: 2, amount: 600, paidAt: '2026-10-14', method: '转账', notes: '' }),
    deviceB.addPayment(created.id, { version: 2, amount: 600, paidAt: '2026-10-14', method: '转账', notes: '' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'STALE_VERSION');
  await Promise.all([deviceA.load(), deviceB.load()]);
  assert.deepEqual(deviceA.get(created.id), deviceB.get(created.id));
  assert.equal(deviceB.get(created.id).paymentRecords.length, 1);
  assert.equal(deviceB.get(created.id).paymentRecords[0].amount, 600);
  assert.equal(deviceB.get(created.id).paymentRecords[0].paidAt, '2026-10-14');
  assert.equal(deviceB.get(created.id).version, 3);

  await deviceA.addFollowUp(created.id, { version: 3, followedAt: '2026-10-14', result: 'A端跟进', promiseAction: 'set', promiseDate: '2026-10-25', nextFollowUpDate: '2026-10-20' });
  await assert.rejects(deviceB.update(created.id, { ...deviceB.get(created.id), notes: '跟进前的旧稿' }), error => error.code === 'STALE_VERSION');
  await deviceB.load();
  assert.equal(deviceB.get(created.id).followUpRecords.length, 1);
  assert.equal(deviceB.get(created.id).nextFollowUpDate, '2026-10-20');
  assert.equal(deviceB.get(created.id).dueDate, '2026-12-01');
  assert.equal(deviceB.get(created.id).followUpRecords[0].followedAt, '2026-10-14');
  assert.equal(deviceB.get(created.id).followUpRecords[0].promiseDate, '2026-10-25');
  assert.equal(deviceB.get(created.id).followUpRecords[0].nextFollowUpDate, '2026-10-20');
  const rawDates = await pool.query('SELECT due_date::text, next_follow_up_date::text FROM receivables WHERE id=$1', [created.id]);
  assert.equal(rawDates.rows[0].due_date, '2026-12-01');
  assert.equal(rawDates.rows[0].next_follow_up_date, '2026-10-20');
});

test('calendar dates keep four-digit years accepted by domain validation', { skip: !databaseUrl }, async () => {
  for (const dueDate of ['0100-01-01', '0999-12-01']) {
    const created = await deviceA.create({ clientName: '日期边界验收', projectName: '隔离示例', totalAmount: 1, invoiceSent: true, dueDate, notes: '', paused: false });
    assert.equal(created.dueDate, dueDate);
    await deviceB.load();
    assert.equal(deviceB.get(created.id).dueDate, dueDate);
  }
});
