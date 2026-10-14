import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../server/app.js';

test('重发验证对未知和已验证邮箱返回相同信息，未验证邮箱发送有效链接且有冷却', async () => {
  let cooldown = false;
  const sent = [];
  const pool = { async query(sql, params) {
    if (sql.includes('SELECT * FROM users WHERE email_normalized')) {
      return { rows: params[0] === 'pending@example.com' ? [{ id: 'pending', email: 'pending@example.com', email_normalized: 'pending@example.com', email_verified_at: null }] : params[0] === 'verified@example.com' ? [{ id: 'verified', email: 'verified@example.com', email_verified_at: new Date() }] : [] };
    }
    if (sql.includes('SELECT id FROM email_tokens')) return { rows: cooldown ? [{ id: 'recent' }] : [] };
    if (sql.includes('INSERT INTO email_tokens')) { cooldown = true; return { rows: [{ id: 'token-row' }] }; }
    if (sql.includes('DELETE FROM email_tokens')) return { rows: [] };
    throw new Error('Unexpected database operation');
  } };
  const app = await buildApp({ config: { nodeEnv: 'test', sessionCookieName: 'rr', appOrigin: 'https://example.test' }, pool, mailer: { async sendVerification(message) { sent.push(message); } } });
  try {
    const results = [];
    for (const email of ['unknown@example.com', 'verified@example.com', 'pending@example.com', 'pending@example.com']) {
      const result = await app.inject({ method: 'POST', url: '/api/auth/resend-verification', payload: { email } });
      assert.equal(result.statusCode, 202);
      results.push(result.json());
    }
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[0], results[2]);
    assert.deepEqual(results[2], results[3]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, 'pending@example.com');
    assert.match(sent[0].token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(results).includes(sent[0].token), false);
  } finally { await app.close(); }
});
