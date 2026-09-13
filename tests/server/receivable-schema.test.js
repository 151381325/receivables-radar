import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('应收迁移定义账号隔离、版本和整数金额字段', async () => {
  const sql = await readFile(new URL('../../server/db/migrations/002_receivables.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'CREATE TABLE receivables', 'user_id uuid NOT NULL REFERENCES users(id)',
    'version integer NOT NULL DEFAULT 1', 'total_amount_fen bigint NOT NULL',
    'deleted_at timestamptz', 'CREATE TABLE payments', 'amount_fen bigint NOT NULL',
    'CREATE TABLE follow_ups', 'UNIQUE (user_id, id)',
  ]) assert.ok(sql.includes(fragment), `缺少迁移定义：${fragment}`);
  assert.doesNotMatch(sql, /\b(float|real|double precision)\b/i);
});
