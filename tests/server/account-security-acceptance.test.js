import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/app.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';

test('authenticated HTTP routes isolate accounts, revoke logout sessions and reject expired sessions', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL);
  let app;
  try {
    await runMigrations(pool);
    const accounts = createAccountRepository(pool);
    const now = new Date('2026-10-14T12:00:00Z');
    const config = { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'https://example.test', adminEmail: 'admin@example.test' };
    const sessions = createSessionService(pool, config);
    const users = await Promise.all(['a', 'b'].map(async suffix => {
      const user = await accounts.createUser({ email: `security-${suffix}-${crypto.randomUUID()}@example.test`, passwordHash: 'isolated-test-placeholder' });
      await accounts.markEmailVerified(user.id, now);
      return user;
    }));
    const [a, b] = await Promise.all(users.map(user => sessions.createSession(user.id, now)));
    app = await buildApp({ config, pool, clock: () => new Date(now) });
    const request = (session, method, url, payload) => app.inject({ method, url, payload, headers: session ? { cookie: `rr=${session.token}` } : {} });
    for (const url of ['/api/auth/me', '/api/receivables', '/api/admin/summary']) {
      assert.equal((await request(null, 'GET', url)).statusCode, 401);
    }
    const createdResponse = await request(a, 'POST', '/api/receivables', { clientName: '安全验收', projectName: '合成示例', totalAmount: 100, invoiceSent: true, dueDate: '2026-12-01', notes: 'A端私有示例', paused: false });
    assert.equal(createdResponse.statusCode, 201);
    const record = createdResponse.json().record;
    const ownerList = await request(a, 'GET', '/api/receivables');
    assert.equal(ownerList.headers['cache-control'], 'no-store');
    assert.equal(ownerList.json().records.length, 1);
    assert.deepEqual((await request(b, 'GET', '/api/receivables')).json().records, []);
    for (const [method, suffix, payload] of [
      ['PUT', '', { ...record, notes: '越权修改' }],
      ['POST', '/payments', { version: 1, amount: 1, paidAt: '2026-10-14', method: '转账' }],
      ['POST', '/follow-ups', { version: 1, followedAt: '2026-10-14', result: '越权跟进' }],
      ['DELETE', '', { version: 1 }],
    ]) {
      assert.equal((await request(b, method, `/api/receivables/${record.id}${suffix}`, payload)).statusCode, 404);
    }
    assert.deepEqual((await request(a, 'GET', '/api/receivables')).json().records, ownerList.json().records);
    assert.equal((await request(a, 'GET', '/api/admin/summary')).statusCode, 403);
    const expired = await sessions.createSession(users[0].id, new Date('2026-01-01T00:00:00Z'));
    assert.equal((await request(expired, 'GET', '/api/auth/me')).statusCode, 401);
    const logout = await request(a, 'POST', '/api/auth/logout');
    assert.equal(logout.statusCode, 204);
    assert.match(logout.headers['set-cookie'], /HttpOnly/);
    assert.match(logout.headers['set-cookie'], /Secure/);
    assert.match(logout.headers['set-cookie'], /SameSite=Lax/i);
    assert.equal((await request(a, 'GET', '/api/receivables')).statusCode, 401);
    assert.equal((await request(b, 'GET', '/api/auth/me')).statusCode, 200);
  } finally {
    await app?.close();
    await pool.end();
  }
});
