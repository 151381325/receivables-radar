import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../../server/app.js';
import { runMigrations } from '../../server/db/migrate.js';
import { createPool } from '../../server/db/pool.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const config = {
  nodeEnv: 'test', sessionCookieName: 'rr_session', appOrigin: 'https://example.test',
};

describe('注册与邮箱验证 PostgreSQL 集成', { skip: !databaseUrl }, () => {
  let pool;
  let app;
  let sent;

  before(async () => {
    pool = createPool(databaseUrl);
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await app?.close();
    await pool.query('DELETE FROM users');
    sent = [];
    app = await buildApp({
      config,
      pool,
      clock: () => new Date('2026-09-13T05:00:00Z'),
      mailer: { sendVerification: async (message) => sent.push(message) },
    });
  });

  after(async () => {
    await app?.close();
    await pool?.end();
  });

  test('拒绝无效邮箱、弱密码和未同意协议', async () => {
    for (const payload of [
      { email: 'bad', password: 'correct horse battery', acceptedTerms: true },
      { email: 'owner@example.com', password: 'short', acceptedTerms: true },
      { email: 'owner@example.com', password: 'correct horse battery', acceptedTerms: false },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    }
  });

  test('注册后仅发送原始验证码给邮箱适配器', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      email: ' Owner@Example.com ', password: 'correct horse battery', acceptedTerms: true,
    } });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { message: '验证邮件已发送，请检查邮箱' });
    assert.equal(sent[0].email, 'Owner@Example.com');
    assert.match(sent[0].token, /^[A-Za-z0-9_-]{43}$/);
    const stored = await pool.query('SELECT email_normalized, password_hash FROM users');
    assert.equal(stored.rows[0].email_normalized, 'owner@example.com');
    assert.match(stored.rows[0].password_hash, /^\$argon2id\$/);
  });

  test('规范化后的重复邮箱返回冲突且不重复发信', async () => {
    const payload = { email: 'User@Example.com', password: 'correct horse battery', acceptedTerms: true };
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', payload })).statusCode, 201);
    const duplicate = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      ...payload, email: ' user@example.COM ',
    } });

    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error.code, 'EMAIL_EXISTS');
    assert.equal(sent.length, 1);
  });

  test('有效验证码完成验证并建立安全会话', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      email: 'owner@example.com', password: 'correct horse battery', acceptedTerms: true,
    } });
    const response = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: {
      token: sent[0].token,
    } });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.emailVerified, true);
    assert.match(response.headers['set-cookie'], /rr_session=/);
    const repeated = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: {
      token: sent[0].token,
    } });
    assert.equal(repeated.statusCode, 400);
    assert.equal(repeated.json().error.code, 'TOKEN_INVALID');
  });

  test('过期验证码不能完成验证', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      email: 'expired@example.com', password: 'correct horse battery', acceptedTerms: true,
    } });
    await pool.query("UPDATE email_tokens SET expires_at = '2026-09-13T04:59:59Z'");
    const response = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: {
      token: sent[0].token,
    } });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'TOKEN_INVALID');
  });

  test('注册接口超过一分钟五次后触发限流', async () => {
    let response;
    for (let index = 0; index < 6; index += 1) {
      response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'bad', password: 'short', acceptedTerms: false },
      });
    }
    assert.equal(response.statusCode, 429);
  });
});

test('邮件适配器缺失时应用仍保留已有健康接口', async () => {
  const app = await buildApp({
    config,
    pool: { query: async () => ({ rows: [] }) },
    clock: () => new Date('2026-09-13T05:00:00Z'),
  });
  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
  await app.close();
});
