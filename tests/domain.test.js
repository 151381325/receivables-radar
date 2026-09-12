import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addFollowUp,
  addPayment,
  calculateDashboard,
  createReceivable,
  deriveReceivable,
  getTodayQueue,
  removePayment,
  updateReceivable,
} from '../src/domain.js';

const NOW = '2026-09-01T08:00:00.000Z';

function makeRecord(overrides = {}) {
  return createReceivable({
    clientName: '青禾设计',
    projectName: '官网设计',
    totalAmount: 5000,
    invoiceSent: true,
    dueDate: '2026-09-10',
    ...overrides,
  }, NOW);
}

test('创建应收款时规范文本并补全初始字段', () => {
  const record = createReceivable({
    clientName: '  青禾设计  ',
    projectName: ' 官网设计 ',
    totalAmount: 5000,
    invoiceSent: false,
    dueDate: '2026-09-10',
  }, NOW);

  assert.equal(record.clientName, '青禾设计');
  assert.equal(record.projectName, '官网设计');
  assert.equal(record.paused, false);
  assert.deepEqual(record.paymentRecords, []);
  assert.deepEqual(record.followUpRecords, []);
  assert.ok(record.id);
});

test('创建应收款时拒绝空客户和非正金额', () => {
  assert.throws(() => makeRecord({ clientName: ' ' }), /客户名称/);
  assert.throws(() => makeRecord({ totalAmount: 0 }), /应收总额/);
});

test('部分到账后正确累计金额并更新状态', () => {
  const partial = addPayment(makeRecord(), {
    amount: 1200,
    paidAt: '2026-09-09',
    method: '银行转账',
  }, '2026-09-09T08:00:00.000Z');
  const result = deriveReceivable(partial, '2026-09-12');

  assert.equal(result.receivedAmount, 1200);
  assert.equal(result.remainingAmount, 3800);
  assert.equal(result.status, 'partial');
});

test('全额到账优先于暂停状态', () => {
  const paid = addPayment({ ...makeRecord(), paused: true }, {
    amount: 5000,
    paidAt: '2026-09-09',
    method: '银行转账',
  }, '2026-09-09T08:00:00.000Z');

  assert.equal(deriveReceivable(paid, '2026-09-12').status, 'paid');
  assert.equal(deriveReceivable(paid, '2026-09-12').remainingAmount, 0);
});

test('到账累计不得超过应收总额', () => {
  assert.throws(() => addPayment(makeRecord(), {
    amount: 5000.01,
    paidAt: '2026-09-09',
    method: '银行转账',
  }, NOW), /超过剩余金额/);
});

test('暂停的未收款不计为逾期', () => {
  const result = deriveReceivable({ ...makeRecord({ dueDate: '2026-09-01' }), paused: true }, '2026-09-12');

  assert.equal(result.status, 'paused');
  assert.equal(result.isOverdue, false);
  assert.equal(result.overdueDays, 0);
});

test('未暂停记录按本地日期计算逾期天数', () => {
  const result = deriveReceivable(makeRecord({ dueDate: '2026-09-01' }), '2026-09-12');

  assert.equal(result.isOverdue, true);
  assert.equal(result.overdueDays, 11);
});

test('记录跟进结果并更新下一次跟进日期', () => {
  const updated = addFollowUp(makeRecord(), {
    followedAt: '2026-09-12',
    result: '客户承诺下周付款',
    promiseDate: '2026-09-16',
    nextFollowUpDate: '2026-09-17',
  }, '2026-09-12T08:00:00.000Z');

  assert.equal(updated.nextFollowUpDate, '2026-09-17');
  assert.equal(updated.followUpRecords.length, 1);
  assert.equal(updated.followUpRecords[0].promiseDate, '2026-09-16');
});

test('今日队列只显示需当日处理的承诺超期和逾期记录', () => {
  const future = makeRecord({ clientName: '未来客户', dueDate: '2026-09-14' });
  const overdue = makeRecord({ clientName: '逾期客户', dueDate: '2026-09-01', nextFollowUpDate: '2026-09-12' });
  const promised = addFollowUp(makeRecord({ clientName: '承诺客户', dueDate: '2026-09-20' }), {
    followedAt: '2026-09-01',
    result: '承诺付款',
    promiseDate: '2026-09-10',
    nextFollowUpDate: '2026-09-15',
  }, NOW);

  const queue = getTodayQueue([future, overdue, promised], '2026-09-12');
  assert.deepEqual(queue.map((item) => item.clientName), ['承诺客户', '逾期客户']);
  assert.equal(queue.some((item) => item.clientName === '未来客户'), false);
});

test('仪表盘区分待收、逾期、今日行动和七天内到期金额', () => {
  const overdue = makeRecord({ totalAmount: 3000, dueDate: '2026-09-01', nextFollowUpDate: '2026-09-12' });
  const upcoming = makeRecord({ totalAmount: 5000, dueDate: '2026-09-15' });
  const paused = { ...makeRecord({ totalAmount: 2000, dueDate: '2026-09-01' }), paused: true };

  assert.deepEqual(calculateDashboard([overdue, upcoming, paused], '2026-09-12'), {
    outstandingAmount: 10000,
    overdueAmount: 3000,
    actionCount: 1,
    dueWithinSevenDaysAmount: 5000,
  });
});

test('编辑基础信息时保留时间线并拒绝把总额改到已收金额以下', () => {
  const paid = addPayment(makeRecord(), {
    amount: 1200,
    paidAt: '2026-09-09',
    method: '银行转账',
  }, '2026-09-09T08:00:00.000Z');
  const updated = updateReceivable(paid, { projectName: '官网设计二期', totalAmount: 6000 }, '2026-09-12T08:00:00.000Z');

  assert.equal(updated.projectName, '官网设计二期');
  assert.equal(updated.paymentRecords.length, 1);
  assert.throws(() => updateReceivable(paid, { totalAmount: 1000 }, NOW), /低于累计已收金额/);
});

test('删除误录的到账记录后重新计算剩余金额和状态', () => {
  const original = makeRecord();
  const paid = addPayment(original, {
    amount: 1200,
    paidAt: '2026-09-09',
    method: '银行转账',
  }, '2026-09-09T08:00:00.000Z');
  const restored = removePayment(paid, paid.paymentRecords[0].id, '2026-09-12T08:00:00.000Z');
  const result = deriveReceivable(restored, '2026-09-12');

  assert.equal(restored.paymentRecords.length, 0);
  assert.equal(result.remainingAmount, 5000);
  assert.equal(result.status, 'awaiting');
});
