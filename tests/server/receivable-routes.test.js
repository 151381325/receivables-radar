import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/app.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';

test('应收接口要求登录', async () => {
  const app = await buildApp({ config: { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'http://test' }, pool: { query: async () => ({ rows: [] }) } });
  const response = await app.inject({ method: 'GET', url: '/api/receivables' });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('新建应收接口要求登录', async () => {
  const app = await buildApp({ config: { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'http://test' }, pool: { query: async () => ({ rows: [] }) } });
  const response = await app.inject({ method: 'POST', url: '/api/receivables', payload: {} });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('编辑应收接口要求登录', async () => {
  const app = await buildApp({ config: { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'http://test' }, pool: { query: async () => ({ rows: [] }) } });
  const response = await app.inject({ method: 'PUT', url: '/api/receivables/rec-1', payload: {} });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('到账、跟进、删除和导入接口均要求登录', async () => {
  const app = await buildApp({ config: { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'http://test' }, pool: { query: async () => ({ rows: [] }) } });
  for (const [method, url] of [
    ['POST', '/api/receivables/rec-1/payments'], ['POST', '/api/receivables/rec-1/follow-ups'],
    ['DELETE', '/api/receivables/rec-1'], ['POST', '/api/receivables/import'],
  ]) assert.equal((await app.inject({ method, url, payload: {} })).statusCode, 401, `${method} ${url}`);
  await app.close();
});

const databaseUrl = process.env.TEST_DATABASE_URL;
test('登录用户可以创建并读取自己的应收记录', { skip: !databaseUrl }, async () => {
  const pool = createPool(databaseUrl);
  await runMigrations(pool);
  await pool.query('DELETE FROM users');
  const accounts = createAccountRepository(pool);
  const user = await accounts.createUser({ email: 'route-owner@example.com', passwordHash: 'hash' });
  const config = { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'http://test', sessionSecret: 'test-secret' };
  const session = await createSessionService(pool, config).createSession(user.id);
  const app = await buildApp({ config, pool });
  const headers = { cookie: `rr=${session.token}` };
  const created = await app.inject({ method: 'POST', url: '/api/receivables', headers, payload: {
    clientName: '路由甲方', projectName: '路由项目', totalAmount: 800, invoiceSent: true, dueDate: '2026-10-01', notes: '', paused: false,
  } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().record.clientName, '路由甲方');
  const listed = await app.inject({ method: 'GET', url: '/api/receivables', headers });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().records.length, 1);
  await app.close();
  await pool.end();
});
