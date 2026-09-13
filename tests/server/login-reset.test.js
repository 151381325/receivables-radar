import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';

import { buildApp } from '../../server/app.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createSessionService } from '../../server/auth/session-service.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createPool } from '../../server/db/pool.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const now = new Date('2026-09-13T06:00:00Z');
const config = { nodeEnv: 'test', sessionCookieName: 'rr_session', appOrigin: 'https://example.test' };

describe('登录与密码重置 PostgreSQL 集成', { skip: !databaseUrl }, () => {
  let pool;
  let app;
  let accounts;
  let sessions;
  let resetMessages;

  before(async () => {
    pool = createPool(databaseUrl);
    await runMigrations(pool);
    accounts = createAccountRepository(pool);
    sessions = createSessionService(pool, config);
  });

  beforeEach(async () => {
    await app?.close();
    await pool.query('DELETE FROM users');
    resetMessages = [];
    app = await buildApp({
      config,
      pool,
      clock: () => new Date(now),
      mailer: {
        sendVerification: async () => {},
        sendPasswordReset: async (message) => resetMessages.push(message),
      },
    });
  });

  after(async () => {
    await app?.close();
    await pool?.end();
  });

  async function createUser(email = 'owner@example.com', options = {}) {
    const user = await accounts.createUser({
      email,
      passwordHash: await argon2.hash(options.password ?? 'old secure password', { type: argon2.argon2id }),
    });
    if (options.verified !== false) await accounts.markEmailVerified(user.id, now);
    if (options.disabled) await accounts.disableUser(user.id, now);
    return user;
  }

  test('正确密码登录并建立新会话', async () => {
    await createUser();
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {
      email: ' OWNER@example.com ', password: 'old secure password',
    } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.email, 'owner@example.com');
    assert.match(response.headers['set-cookie'], /HttpOnly/);
  });

  test('未知邮箱、错误密码、未验证和禁用账号返回相同错误', async () => {
    await createUser('wrong@example.com');
    await createUser('unverified@example.com', { verified: false });
    await createUser('disabled@example.com', { disabled: true });
    const attempts = [
      { email: 'missing@example.com', password: 'old secure password' },
      { email: 'wrong@example.com', password: 'wrong password' },
      { email: 'unverified@example.com', password: 'old secure password' },
      { email: 'disabled@example.com', password: 'old secure password' },
    ];
    const bodies = [];
    for (const payload of attempts) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
      assert.equal(response.statusCode, 401);
      bodies.push(response.body);
    }
    assert.equal(new Set(bodies).size, 1);
  });

  test('找回密码不暴露邮箱是否存在', async () => {
    await createUser();
    const known = await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: {
      email: 'owner@example.com',
    } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: {
      email: 'missing@example.com',
    } });
    assert.equal(known.statusCode, 202);
    assert.equal(unknown.statusCode, 202);
    assert.equal(known.body, unknown.body);
    assert.equal(resetMessages.length, 1);
    assert.match(resetMessages[0].token, /^[A-Za-z0-9_-]{43}$/);
  });

  test('重置密码使全部旧会话失效且令牌不可重复使用', async () => {
    const user = await createUser();
    const oldSessionA = await sessions.createSession(user.id, now);
    const oldSessionB = await sessions.createSession(user.id, now);
    await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: {
      email: 'owner@example.com',
    } });
    const token = resetMessages[0].token;
    const response = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: {
      token, password: 'new secure password',
    } });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['set-cookie'], /rr_session=/);
    assert.equal(await sessions.findUserByToken(oldSessionA.token, now), null);
    assert.equal(await sessions.findUserByToken(oldSessionB.token, now), null);
    const updatedUser = await accounts.findUserById(user.id);
    assert.equal(await argon2.verify(updatedUser.passwordHash, 'new secure password'), true);
    assert.equal(await argon2.verify(updatedUser.passwordHash, 'old secure password'), false);
    const repeated = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: {
      token, password: 'another secure password',
    } });
    assert.equal(repeated.statusCode, 400);
    assert.equal(repeated.json().error.code, 'TOKEN_INVALID');
  });

  test('过期重置令牌被拒绝', async () => {
    await createUser();
    await app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: {
      email: 'owner@example.com',
    } });
    await pool.query("UPDATE email_tokens SET expires_at = '2026-09-13T05:59:59Z'");
    const response = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: {
      token: resetMessages[0].token, password: 'new secure password',
    } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'TOKEN_INVALID');
  });
});
