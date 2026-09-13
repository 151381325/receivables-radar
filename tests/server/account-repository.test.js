import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEmail, hashOpaqueToken } from '../../server/auth/crypto.js';
import { createAccountRepository } from '../../server/auth/account-repository.js';
import { createPool } from '../../server/db/pool.js';
import { runMigrations } from '../../server/db/migrate.js';

test('邮箱规范化会去除两端空格并统一为小写', () => {
  assert.equal(normalizeEmail('  User@Example.COM  '), 'user@example.com');
});

test('不透明令牌只保存稳定的 SHA-256 摘要', () => {
  assert.equal(
    hashOpaqueToken('one-time-token'),
    '6384b5b002fb13416b8cd9048a35efdaf4f53b4a62d6abd397c956c80e296172',
  );
});

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('账号仓库 PostgreSQL 集成', { skip: !databaseUrl }, () => {
  let pool;
  let repository;

  before(async () => {
    pool = createPool(databaseUrl);
    await runMigrations(pool);
    repository = createAccountRepository(pool);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
  });

  after(async () => {
    await pool?.end();
  });

  test('邮箱按规范化值保持唯一并可忽略大小写查询', async () => {
    const user = await repository.createUser({
      email: 'User@Example.com',
      passwordHash: 'argon-hash',
    });

    assert.equal((await repository.findUserByEmail(' user@example.COM ')).id, user.id);
    await assert.rejects(
      repository.createUser({ email: 'user@example.com', passwordHash: 'other-hash' }),
      (error) => error.code === '23505',
    );
  });

  test('验证令牌只能消费一次', async () => {
    const user = await repository.createUser({ email: 'owner@example.com', passwordHash: 'hash' });
    const now = new Date('2026-09-13T03:00:00.000Z');
    await repository.createEmailToken({
      userId: user.id,
      purpose: 'verify_email',
      tokenHash: hashOpaqueToken('verify-token'),
      expiresAt: new Date('2026-09-13T03:30:00.000Z'),
    });

    const lookup = {
      purpose: 'verify_email',
      tokenHash: hashOpaqueToken('verify-token'),
      now,
    };
    assert.equal((await repository.consumeEmailToken(lookup)).userId, user.id);
    assert.equal(await repository.consumeEmailToken(lookup), null);
  });

  test('过期令牌不能消费', async () => {
    const user = await repository.createUser({ email: 'expired@example.com', passwordHash: 'hash' });
    await repository.createEmailToken({
      userId: user.id,
      purpose: 'reset_password',
      tokenHash: hashOpaqueToken('expired-token'),
      expiresAt: new Date('2026-09-13T02:59:59.000Z'),
    });

    assert.equal(await repository.consumeEmailToken({
      purpose: 'reset_password',
      tokenHash: hashOpaqueToken('expired-token'),
      now: new Date('2026-09-13T03:00:00.000Z'),
    }), null);
  });

  test('禁用账号会记录时间并可按 ID 读取', async () => {
    const user = await repository.createUser({ email: 'disabled@example.com', passwordHash: 'hash' });
    const disabledAt = new Date('2026-09-13T03:00:00.000Z');
    await repository.disableUser(user.id, disabledAt);

    assert.equal((await repository.findUserById(user.id)).disabledAt.toISOString(), disabledAt.toISOString());
  });
});
