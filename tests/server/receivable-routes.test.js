import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { buildApp } from '../../server/app.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';
import { registerReceivableRoutes } from '../../server/routes/receivables.js';

function createReceivableRoutePool() {
  const row = {
    id: 'rec-1',
    client_name: '测试客户',
    project_name: '测试项目',
    total_amount_fen: 10000,
    invoice_sent: true,
    due_date: new Date('2026-09-30T00:00:00.000Z'),
    next_follow_up_date: null,
    paused: false,
    notes: '',
    version: 1,
    created_at: new Date('2026-09-26T00:00:00.000Z'),
    updated_at: new Date('2026-09-26T00:00:00.000Z'),
  };
  const payments = [];
  const followUps = [];

  const pool = {
    async connect() {
      return { query: pool.query, release() {} };
    },
    async query(sql, params = []) {
      const text = String(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
      if (text.includes('FROM receivables') && text.includes('ORDER BY updated_at')) return { rows: [row] };
      if (text.includes('FROM receivables') && text.includes('id = $2')) return { rows: [row] };
      if (text.includes('FROM payments') && text.includes('ORDER BY created_at')) return { rows: payments };
      if (text.includes('FROM follow_ups') && text.includes('ORDER BY created_at')) return { rows: followUps };
      if (text.includes('COALESCE(SUM(amount_fen)')) {
        return { rows: [{ amount: payments.reduce((sum, item) => sum + item.amount_fen, 0) }] };
      }
      if (text.startsWith('INSERT INTO payments')) {
        payments.push({
          id: params[0], amount_fen: params[3], paid_at: new Date(`${params[4]}T00:00:00.000Z`),
          method: params[5], notes: params[6],
        });
        return { rows: [] };
      }
      if (text.startsWith('UPDATE receivables SET version=version+1')) {
        row.version += 1;
        row.updated_at = new Date('2026-09-26T01:00:00.000Z');
        return { rows: [row] };
      }
      if (text.startsWith('INSERT INTO follow_ups')) {
        followUps.push({
          id: params[0], followed_at: new Date(`${params[3]}T00:00:00.000Z`), result: params[4],
          promise_date: params[5] ? new Date(`${params[5]}T00:00:00.000Z`) : null,
          next_follow_up_date: params[6] ? new Date(`${params[6]}T00:00:00.000Z`) : null,
        });
        return { rows: [] };
      }
      if (text.startsWith('UPDATE receivables SET next_follow_up_date')) {
        row.next_follow_up_date = params[2] ? new Date(`${params[2]}T00:00:00.000Z`) : null;
        row.version += 1;
        row.updated_at = new Date('2026-09-26T01:00:00.000Z');
        return { rows: [row] };
      }
      throw new Error(`未处理的测试 SQL: ${text}`);
    },
  };

  return pool;
}

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

test('到账接口接受整数金额并保存本次到账记录', async () => {
  const app = Fastify();
  app.decorateRequest('user', null);
  await registerReceivableRoutes(app, {
    pool: createReceivableRoutePool(),
    authenticate: async (request) => { request.user = { id: 'user-1' }; },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/receivables/rec-1/payments',
    payload: { version: 1, amount: '2', paidAt: '2026-09-26', method: '银行转账', notes: '' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().record.paymentRecords[0].amount, 2);
  await app.close();
});

test('跟进接口保存本次跟进记录', async () => {
  const app = Fastify();
  app.decorateRequest('user', null);
  await registerReceivableRoutes(app, {
    pool: createReceivableRoutePool(),
    authenticate: async (request) => { request.user = { id: 'user-1' }; },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/receivables/rec-1/follow-ups',
    payload: {
      version: 1, followedAt: '2026-09-26', result: '客户承诺下周付款',
      promiseDate: '2026-10-02', nextFollowUpDate: '2026-10-03',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().record.followUpRecords[0].result, '客户承诺下周付款');
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
