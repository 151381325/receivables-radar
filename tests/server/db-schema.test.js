import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { withTransaction } from '../../server/db/pool.js';

test('认证迁移定义受约束的账号表', async () => {
  const sql = await readFile(
    new URL('../../server/db/migrations/001_auth.sql', import.meta.url),
    'utf8',
  );

  for (const fragment of [
    'CREATE TABLE users',
    'email_normalized',
    'password_hash',
    'CREATE TABLE sessions',
    'token_hash',
    'expires_at',
    'CREATE TABLE email_tokens',
    "CHECK (purpose IN ('verify_email', 'reset_password'))",
  ]) {
    assert.match(sql, new RegExp(fragment.replace(/[()]/g, '\\$&')));
  }
});

test('事务成功时提交并释放连接', async () => {
  const calls = [];
  const client = {
    query: async (sql) => calls.push(sql),
    release: () => calls.push('RELEASE'),
  };
  const pool = { connect: async () => client };

  const result = await withTransaction(pool, async (connection) => {
    assert.equal(connection, client);
    calls.push('WORK');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(calls, ['BEGIN', 'WORK', 'COMMIT', 'RELEASE']);
});

test('事务失败时回滚、释放连接并保留原错误', async () => {
  const calls = [];
  const expected = new Error('database work failed');
  const client = {
    query: async (sql) => calls.push(sql),
    release: () => calls.push('RELEASE'),
  };
  const pool = { connect: async () => client };

  await assert.rejects(
    withTransaction(pool, async () => {
      calls.push('WORK');
      throw expected;
    }),
    (error) => error === expected,
  );
  assert.deepEqual(calls, ['BEGIN', 'WORK', 'ROLLBACK', 'RELEASE']);
});
