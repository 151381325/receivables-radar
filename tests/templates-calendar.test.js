import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCalendarEvent } from '../src/calendar.js';
import { buildReminderMessage } from '../src/templates.js';

function derivedRecord(overrides = {}) {
  return {
    id: 'r1',
    clientName: '青禾设计',
    projectName: '官网设计',
    totalAmount: 5000,
    remainingAmount: 3800,
    dueDate: '2026-09-15',
    nextFollowUpDate: '2026-09-14',
    overdueDays: 0,
    isOverdue: false,
    promiseOverdue: false,
    latestPromiseDate: null,
    ...overrides,
  };
}

test('到期前文案带入客户、项目、剩余金额和截止日期', () => {
  const result = buildReminderMessage(derivedRecord(), '2026-09-12');

  assert.equal(result.stage, 'pre_due');
  assert.match(result.text, /青禾设计/);
  assert.match(result.text, /官网设计/);
  assert.match(result.text, /3,800\.00/);
  assert.match(result.text, /2026年9月15日/);
});

test('逾期天数选择对应的三档催款语气', () => {
  assert.equal(buildReminderMessage(derivedRecord({ isOverdue: true, overdueDays: 2 }), '2026-09-12').stage, 'overdue_gentle');
  assert.equal(buildReminderMessage(derivedRecord({ isOverdue: true, overdueDays: 6 }), '2026-09-12').stage, 'overdue_clear');
  assert.equal(buildReminderMessage(derivedRecord({ isOverdue: true, overdueDays: 12 }), '2026-09-12').stage, 'overdue_formal');
});

test('承诺付款日已过时优先生成承诺跟进文案', () => {
  const result = buildReminderMessage(derivedRecord({
    promiseOverdue: true,
    latestPromiseDate: '2026-09-10',
    isOverdue: true,
    overdueDays: 2,
  }), '2026-09-12');

  assert.equal(result.stage, 'promise_overdue');
  assert.match(result.text, /此前确认的2026年9月10日/);
});

test('跟进日历内容包含标准日历边界、标题和日期', () => {
  const ics = buildCalendarEvent(derivedRecord(), 'followUp');

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260914/);
  assert.match(ics, /SUMMARY:回款跟进：青禾设计/);
  assert.match(ics, /END:VCALENDAR/);
});

test('没有下一次跟进日时拒绝生成跟进日历', () => {
  assert.throws(() => buildCalendarEvent(derivedRecord({ nextFollowUpDate: null }), 'followUp'), /尚未设置下次跟进日期/);
});

test('付款截止日日历使用截止日期并转义特殊字符', () => {
  const ics = buildCalendarEvent(derivedRecord({ clientName: '青禾,设计', projectName: '官网;升级' }), 'due');

  assert.match(ics, /DTSTART;VALUE=DATE:20260915/);
  assert.match(ics, /青禾\\,设计/);
  assert.match(ics, /官网\\;升级/);
});
