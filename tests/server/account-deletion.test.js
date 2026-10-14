import test, { before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { buildApp } from '../../server/app.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';
import { createReceivableRepository } from '../../server/receivables/repository.js';
import { createReceivable } from '../../src/domain.js';

describe('self-service account deletion in isolated PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, () => {
  let pool; let app; let accounts; let sessions; let owner; let other; let admin; let ownerSession; let ownerSecondSession; let adminSession; let passwordHash;
  const password = 'isolated account deletion test password';
  const config = { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'https://example.test', adminEmail: 'deletion-admin@example.test' };
  const payload = { password, confirmation: '注销', acknowledged: true };
  before(async () => {
    pool = createPool(process.env.TEST_DATABASE_URL);
    await runMigrations(pool);
    passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    accounts = createAccountRepository(pool);
    sessions = createSessionService(pool, config);
  });
  beforeEach(async () => {
    await app?.close();
    await pool.query('DELETE FROM admin_actions');
    await pool.query('DELETE FROM users');
    app = await buildApp({ config, pool });
    [owner, other, admin] = await Promise.all(['owner', 'other', 'admin'].map(async role => {
      const user = await accounts.createUser({ email: `deletion-${role}@example.test`, passwordHash });
      await accounts.markEmailVerified(user.id, new Date());
      return user;
    }));
    [ownerSession, ownerSecondSession, adminSession] = await Promise.all([sessions.createSession(owner.id), sessions.createSession(owner.id), sessions.createSession(admin.id)]);
    const repository = createReceivableRepository(pool);
    for (const user of [owner, other]) {
      const record = await repository.create(user.id, createReceivable({ clientName: '注销测试', projectName: '合成示例', totalAmount: 100, invoiceSent: true, dueDate: '2026-12-01' }));
      await repository.addPayment(user.id, record.id, 1, { id: crypto.randomUUID(), amount: 10, paidAt: '2026-10-14', method: '转账', notes: '' });
      const paid = (await repository.list(user.id))[0];
      await repository.removePayment(user.id, record.id, paid.paymentRecords[0].id, 2);
      await repository.addFollowUp(user.id, record.id, 3, { id: crypto.randomUUID(), followedAt: '2026-10-14', result: '合成跟进', promiseAction: 'keep', promiseDate: null, nextFollowUpDate: null });
      await accounts.createEmailToken({ userId: user.id, purpose: 'reset_password', tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60000) });
    }
    await pool.query("INSERT INTO admin_actions(actor_user_id,target_user_id,action) VALUES ($1,$2,'enable_user')", [admin.id, owner.id]);
  });
  after(async () => { await app?.close(); await pool?.end(); });
  const remove = (session, body = payload, headers = {}) => app.inject({ method: 'DELETE', url: '/api/account', headers: { ...(session ? { cookie: `rr=${session.token}` } : {}), ...headers }, payload: body });
  async function assertOwnerExists() {
    assert.ok(await accounts.findUserById(owner.id));
    assert.ok(await sessions.findUserByToken(ownerSession.token));
  }
  test('unauthenticated deletion is rejected without changing data', async () => {
    assert.equal((await remove(null)).statusCode, 401);
    await assertOwnerExists();
  });
  test('wrong password, missing acknowledgement and wrong confirmation cannot delete', async () => {
    for (const body of [{ ...payload, password: 'wrong' }, { ...payload, acknowledged: false }, { ...payload, confirmation: '删除' }, { ...payload, userId: other.id }]) {
      const result = await remove(ownerSession, body);
      assert.ok([400, 403].includes(result.statusCode));
      await assertOwnerExists();
    }
  });
  test('administrator cannot self-delete even with correct password', async () => {
    const result = await remove(adminSession);
    assert.equal(result.statusCode, 403);
    assert.equal(result.json().error.code, 'ADMIN_DELETION_BLOCKED');
    assert.ok(await accounts.findUserById(admin.id));
  });
  test('cross-origin deletion is rejected', async () => {
    assert.equal((await remove(ownerSession, payload, { origin: 'https://attacker.example' })).statusCode, 403);
    await assertOwnerExists();
  });
  test('successful deletion removes only current online data and all sessions, anonymizing admin audit reference', async () => {
    const result = await remove(ownerSession, payload, { origin: config.appOrigin });
    assert.equal(result.statusCode, 204);
    assert.match(result.headers['set-cookie'], /rr=;/);
    assert.equal(await accounts.findUserById(owner.id), null);
    assert.equal(await sessions.findUserByToken(ownerSession.token), null);
    assert.equal(await sessions.findUserByToken(ownerSecondSession.token), null);
    for (const table of ['receivables', 'payments', 'follow_ups', 'payment_correction_events', 'email_tokens', 'sessions']) {
      assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table} WHERE user_id=$1`, [owner.id])).rows[0].count), 0, table);
    }
    assert.ok(await accounts.findUserById(other.id));
    assert.equal(Number((await pool.query('SELECT count(*) FROM receivables WHERE user_id=$1', [other.id])).rows[0].count), 1);
    const audit = await pool.query('SELECT actor_user_id,target_user_id,action FROM admin_actions');
    assert.deepEqual(audit.rows, [{ actor_user_id: admin.id, target_user_id: null, action: 'enable_user' }]);
    assert.equal((await remove(ownerSecondSession)).statusCode, 401);
  });
  test('wrong-password attempts are rate limited', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await remove(ownerSession, { ...payload, password: 'wrong' })).statusCode, 403);
    assert.equal((await remove(ownerSession, { ...payload, password: 'wrong' })).statusCode, 429);
    await assertOwnerExists();
  });
});
