import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBackup, serializeBackup } from '../src/backup.js';
import { createReceivable } from '../src/domain.js';

function record(id, clientName) {
  return createReceivable({
    id,
    clientName,
    projectName: '设计服务',
    totalAmount: 2000,
    invoiceSent: true,
    dueDate: '2026-09-30',
  }, '2026-09-01T08:00:00.000Z');
}

test('序列化备份包含固定版本、导出时间和全部记录', () => {
  const records = [record('r1', '青禾设计')];
  const text = serializeBackup(records, '2026-09-12T08:00:00.000Z');
  const parsed = JSON.parse(text);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.exportedAt, '2026-09-12T08:00:00.000Z');
  assert.deepEqual(parsed.records, records);
});

test('恢复时跳过已有 ID 并返回导入统计', () => {
  const existing = [record('existing', '已有客户')];
  const backup = serializeBackup([
    record('existing', '重复客户'),
    record('new', '新客户'),
  ], '2026-09-12T08:00:00.000Z');
  const result = parseBackup(backup, existing);

  assert.equal(result.importedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(result.records.map((item) => item.id), ['existing', 'new']);
});

test('错误 JSON 和错误版本均被拒绝', () => {
  assert.throws(() => parseBackup('{bad json', []), /备份文件无法读取/);
  assert.throws(() => parseBackup('{"version":2,"records":[]}', []), /版本/);
});

test('缺少必要字段的记录不会覆盖现有数据', () => {
  const existing = [record('existing', '已有客户')];
  const invalid = JSON.stringify({ version: 1, records: [{ id: 'bad' }] });

  assert.throws(() => parseBackup(invalid, existing), /记录结构不完整/);
  assert.equal(existing.length, 1);
});
