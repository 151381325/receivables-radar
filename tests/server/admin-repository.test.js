import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdminRepository } from '../../server/admin/repository.js';

test('管理员汇总返回账号验证和停用统计', async () => {
  const pool = {
    query: async (sql) => {
      assert.match(sql, /COUNT\(\*\).*total/s);
      return {
        rows: [{ total: '12', verified: '8', unverified: '4', disabled: '2' }],
      };
    },
  };

  const result = await createAdminRepository(pool).getSummary();

  assert.deepEqual(result, { total: 12, verified: 8, unverified: 4, disabled: 2 });
});

test('用户列表使用稳定分页、参数化搜索并只映射安全字段', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: '1' }] };
      return {
        rows: [{
          id: 'user-1',
          email: 'owner@example.com',
          password_hash: 'must-not-leak',
          email_verified_at: new Date('2026-09-01T00:00:00.000Z'),
          disabled_at: null,
          created_at: new Date('2026-08-01T00:00:00.000Z'),
          receivable_count: '3',
        }],
      };
    },
  };

  const result = await createAdminRepository(pool).listUsers({
    page: 2,
    pageSize: 20,
    query: "owner%' OR true --",
    status: 'active',
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /owner|' OR true/);
    assert.ok(call.params.includes("%owner\\%' OR true --%"));
  }
  assert.match(calls[1].sql, /ORDER BY users\.created_at DESC, users\.id DESC/);
  assert.deepEqual(calls[1].params.slice(-2), [20, 20]);
  assert.deepEqual(result, {
    users: [{
      id: 'user-1',
      email: 'owner@example.com',
      createdAt: '2026-08-01T00:00:00.000Z',
      emailVerified: true,
      disabled: false,
      receivableCount: 3,
    }],
    total: 1,
    page: 2,
    pageSize: 20,
  });
  assert.equal('passwordHash' in result.users[0], false);
});

test('停用账号在同一事务中注销会话并记录审计', async () => {
  const calls = [];
  const row = {
    id: 'user-2', email: 'member@example.com', email_verified_at: new Date(),
    disabled_at: null, created_at: new Date('2026-08-01T00:00:00.000Z'),
  };
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/SELECT .*FROM users.*FOR UPDATE/s.test(sql)) return { rows: [row] };
      if (/UPDATE users\s+SET disabled_at/.test(sql)) {
        row.disabled_at = new Date('2026-09-28T00:00:00.000Z');
        return { rows: [row] };
      }
      if (/DELETE FROM sessions/.test(sql) || /INSERT INTO admin_actions/.test(sql)) return { rows: [] };
      if (/COUNT\(\*\).*FROM receivables/s.test(sql)) return { rows: [{ count: '2' }] };
      throw new Error(`未处理 SQL: ${sql}`);
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); },
  };
  const pool = { connect: async () => client };

  const result = await createAdminRepository(pool).setUserDisabled({
    actorUserId: 'admin-1', targetUserId: 'user-2', disabled: true,
    now: new Date('2026-09-28T00:00:00.000Z'),
  });

  assert.equal(result.changed, true);
  assert.equal(result.user.disabled, true);
  assert.equal(result.user.receivableCount, 2);
  assert.ok(calls.some(({ sql }) => /DELETE FROM sessions/.test(sql)));
  assert.ok(calls.some(({ sql }) => /INSERT INTO admin_actions/.test(sql)));
  assert.deepEqual(calls.map(({ sql }) => sql).slice(-2), ['COMMIT', 'RELEASE']);
});

test('重复停用是幂等操作且不重复注销会话或写审计', async () => {
  const sqlCalls = [];
  const row = {
    id: 'user-2', email: 'member@example.com', email_verified_at: null,
    disabled_at: new Date('2026-09-27T00:00:00.000Z'),
    created_at: new Date('2026-08-01T00:00:00.000Z'),
  };
  const client = {
    async query(sql) {
      sqlCalls.push(String(sql));
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/FOR UPDATE/.test(sql)) return { rows: [row] };
      if (/COUNT\(\*\).*FROM receivables/s.test(sql)) return { rows: [{ count: '0' }] };
      throw new Error(`幂等操作不应执行 SQL: ${sql}`);
    },
    release() { sqlCalls.push('RELEASE'); },
  };

  const result = await createAdminRepository({ connect: async () => client }).setUserDisabled({
    actorUserId: 'admin-1', targetUserId: 'user-2', disabled: true, now: new Date(),
  });

  assert.equal(result.changed, false);
  assert.doesNotMatch(sqlCalls.join('\n'), /DELETE FROM sessions|INSERT INTO admin_actions|UPDATE users/);
});
