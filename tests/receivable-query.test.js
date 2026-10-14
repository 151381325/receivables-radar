import test from 'node:test';
import assert from 'node:assert/strict';
import { queryReceivables } from '../src/receivable-query.js';

const records = [
  { id: 'a', clientName: '星桥', projectName: '设计', remainingAmount: 300, dueDate: '2026-10-01', status: 'awaiting', isOverdue: true },
  { id: 'b', clientName: '青禾', projectName: '官网', remainingAmount: 100, dueDate: '2026-10-18', status: 'partial', isOverdue: false },
  { id: 'c', clientName: '远山', projectName: '官网', remainingAmount: 200, dueDate: '2026-11-01', status: 'paused', isOverdue: false },
];
test('客户项目搜索与风险筛选组合，金额排序不改变源数组', () => {
  const result = queryReceivables(records, { query: '官网', risk: 'upcoming', sort: 'amount-desc', today: '2026-10-14' });
  assert.deepEqual(result.map(r => r.id), ['b']);
  assert.deepEqual(queryReceivables(records, { risk: 'overdue' }).map(r => r.id), ['a']);
  assert.deepEqual(queryReceivables(records, { sort: 'amount-desc' }).map(r => r.id), ['a', 'c', 'b']);
  assert.deepEqual(records.map(r => r.id), ['a', 'b', 'c']);
});
