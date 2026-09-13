import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../../server/app.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createPool } from '../../server/db/pool.js';

const config = {
  nodeEnv: 'test',
  sessionCookieName: 'rr_session',
  appOrigin: 'https://example.test',
};

test('健康检查公开且当前用户接口要求登录', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const app = await buildApp({ config, pool, clock: () => new Date('2026-09-13T04:00:00Z') });

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(me.statusCode, 401);
  assert.equal(me.json().error.code, 'AUTH_REQUIRED');
  await app.close();
});

test('创建会话只向数据库写入令牌摘要', async () => {
  const queries = [];
  const pool = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [] };
    },
  };
  const service = createSessionService(pool, config);
  const session = await service.createSession('user-1', new Date('2026-09-13T04:00:00Z'));

  assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(queries[0].values[2], session.token);
  assert.match(queries[0].values[2], /^[a-f0-9]{64}$/);
  assert.equal(session.expiresAt.toISOString(), '2026-10-13T04:00:00.000Z');
});

test('有效会话返回最小用户信息', async () => {
  const pool = {
    query: async () => ({ rows: [{
      id: 'user-1', email: 'owner@example.com', email_verified_at: new Date('2026-09-13T03:00:00Z'),
    }] }),
  };
  const app = await buildApp({ config, pool, clock: () => new Date('2026-09-13T04:00:00Z') });
  const response = await app.inject({
    method: 'GET', url: '/api/auth/me', headers: { cookie: 'rr_session=valid-session-token' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    user: { id: 'user-1', email: 'owner@example.com', emailVerified: true },
  });
  await app.close();
});

test('退出登录删除服务端会话并清除 Cookie', async () => {
  const queries = [];
  const pool = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [] };
    },
  };
  const app = await buildApp({ config, pool, clock: () => new Date('2026-09-13T04:00:00Z') });
  const response = await app.inject({
    method: 'POST', url: '/api/auth/logout', headers: { cookie: 'rr_session=session-to-delete' },
  });

  assert.equal(response.statusCode, 204);
  assert.match(queries.at(-1).sql, /DELETE FROM sessions/);
  assert.match(response.headers['set-cookie'], /rr_session=;/);
  await app.close();
});

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('安全会话 PostgreSQL 集成', { skip: !databaseUrl }, () => {
  let pool;

  before(async () => {
    pool = createPool(databaseUrl);
    await runMigrations(pool);
    await pool.query('DELETE FROM users');
  });

  after(async () => {
    await pool?.end();
  });

  test('注销后原始会话令牌立即失效', async () => {
    const accounts = createAccountRepository(pool);
    const sessions = createSessionService(pool, config);
    const now = new Date('2026-09-13T04:00:00Z');
    const user = await accounts.createUser({ email: 'session@example.com', passwordHash: 'hash' });
    await accounts.markEmailVerified(user.id, now);
    const session = await sessions.createSession(user.id, now);

    assert.equal((await sessions.findUserByToken(session.token, now)).id, user.id);
    await sessions.destroySession(session.token);
    assert.equal(await sessions.findUserByToken(session.token, now), null);
  });
});
