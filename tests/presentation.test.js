import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRecordCardHTML, filterRecords, formatMoney, statusLabel } from '../src/presentation.js';

const record = {
  id: 'r1',
  clientName: '<青禾设计>',
  projectName: '官网升级',
  remainingAmount: 3800,
  totalAmount: 5000,
  status: 'partial',
  dueDate: '2026-09-15',
  actionReason: '3 天后到期',
  isOverdue: false,
};

test('金额使用人民币格式展示', () => {
  assert.equal(formatMoney(3800), '¥3,800.00');
});

test('状态代码转换为可读中文', () => {
  assert.equal(statusLabel('unbilled'), '待开票');
  assert.equal(statusLabel('partial'), '部分到账');
  assert.equal(statusLabel('paused'), '暂停跟进');
});

test('记录卡片转义用户文本并保留详情入口', () => {
  const html = buildRecordCardHTML(record);

  assert.doesNotMatch(html, /<青禾设计>/);
  assert.match(html, /&lt;青禾设计&gt;/);
  assert.match(html, /data-open-record="r1"/);
  assert.match(html, /¥3,800\.00/);
});

test('状态筛选支持全部和指定状态', () => {
  const records = [record, { ...record, id: 'r2', status: 'paid' }];
  assert.equal(filterRecords(records, 'all').length, 2);
  assert.deepEqual(filterRecords(records, 'paid').map((item) => item.id), ['r2']);
});
