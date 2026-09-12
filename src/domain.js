const DAY_MS = 24 * 60 * 60 * 1000;

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function requireText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}不能超过${maxLength}字`);
  return text;
}

function requireDate(value, label) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label}格式不正确`);
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`${label}不是有效日期`);
  }
  return text;
}

function optionalDate(value, label) {
  return value ? requireDate(value, label) : null;
}

function dayNumber(dateText) {
  const [year, month, day] = requireDate(dateText, '日期').split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

function newId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

export function createReceivable(input, now = new Date().toISOString()) {
  const totalAmount = roundMoney(input.totalAmount);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error('应收总额必须大于0');

  return {
    id: input.id || newId('rec'),
    clientName: requireText(input.clientName, '客户名称', 50),
    projectName: requireText(input.projectName, '项目名称', 100),
    totalAmount,
    invoiceSent: Boolean(input.invoiceSent),
    dueDate: requireDate(input.dueDate, '付款截止日期'),
    nextFollowUpDate: optionalDate(input.nextFollowUpDate, '下次跟进日期'),
    paused: Boolean(input.paused),
    notes: String(input.notes ?? '').trim().slice(0, 500),
    paymentRecords: Array.isArray(input.paymentRecords) ? structuredClone(input.paymentRecords) : [],
    followUpRecords: Array.isArray(input.followUpRecords) ? structuredClone(input.followUpRecords) : [],
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function deriveReceivable(record, today) {
  const receivedAmount = roundMoney((record.paymentRecords ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const remainingAmount = roundMoney(Math.max(0, Number(record.totalAmount) - receivedAmount));
  let status = 'awaiting';
  if (remainingAmount === 0) status = 'paid';
  else if (record.paused) status = 'paused';
  else if (receivedAmount > 0) status = 'partial';
  else if (!record.invoiceSent) status = 'unbilled';

  const active = status !== 'paid' && status !== 'paused';
  const rawOverdueDays = daysBetween(record.dueDate, today);
  const isOverdue = active && rawOverdueDays > 0;
  const overdueDays = isOverdue ? rawOverdueDays : 0;
  const latestPromiseDate = [...(record.followUpRecords ?? [])]
    .reverse()
    .find((item) => item.promiseDate)?.promiseDate ?? null;
  const promiseOverdue = active && latestPromiseDate && daysBetween(latestPromiseDate, today) > 0;
  const followUpDue = active && record.nextFollowUpDate && daysBetween(record.nextFollowUpDate, today) >= 0;
  const dueDistance = daysBetween(today, record.dueDate);

  let actionPriority = 99;
  let actionReason = '';
  if (active && promiseOverdue) [actionPriority, actionReason] = [0, '承诺付款日已过'];
  else if (active && isOverdue) [actionPriority, actionReason] = [1, `已逾期 ${overdueDays} 天`];
  else if (active && followUpDue) [actionPriority, actionReason] = [2, '已到跟进日期'];
  else if (active && dueDistance === 0) [actionPriority, actionReason] = [3, '今天到期'];
  else if (active && dueDistance > 0 && dueDistance <= 3) [actionPriority, actionReason] = [4, `${dueDistance} 天后到期`];
  else if (active && status === 'unbilled' && !record.nextFollowUpDate) [actionPriority, actionReason] = [5, '待发送付款通知'];
  else if (active) [actionPriority, actionReason] = [6, '持续跟进'];

  const needsActionToday = active && (Boolean(promiseOverdue) || isOverdue || Boolean(followUpDue) || dueDistance === 0 || (status === 'unbilled' && !record.nextFollowUpDate));

  return {
    ...record,
    receivedAmount,
    remainingAmount,
    status,
    isOverdue,
    overdueDays,
    latestPromiseDate,
    promiseOverdue: Boolean(promiseOverdue),
    needsActionToday,
    actionPriority,
    actionReason,
  };
}

export function addPayment(record, payment, now = new Date().toISOString()) {
  const amount = roundMoney(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('到账金额必须大于0');
  const remaining = deriveReceivable(record, now.slice(0, 10)).remainingAmount;
  if (amount > remaining) throw new Error('到账金额不能超过剩余金额');

  return {
    ...record,
    paymentRecords: [
      ...(record.paymentRecords ?? []),
      {
        id: newId('pay'),
        amount,
        paidAt: requireDate(payment.paidAt, '到账日期'),
        method: requireText(payment.method || '其他', '收款方式', 30),
        notes: String(payment.notes ?? '').trim().slice(0, 200),
      },
    ],
    updatedAt: now,
  };
}

export function removePayment(record, paymentId, now = new Date().toISOString()) {
  const paymentRecords = (record.paymentRecords ?? []).filter((payment) => payment.id !== paymentId);
  if (paymentRecords.length === (record.paymentRecords ?? []).length) throw new Error('没有找到该到账记录');
  return { ...record, paymentRecords, updatedAt: now };
}

export function addFollowUp(record, followUp, now = new Date().toISOString()) {
  const nextFollowUpDate = optionalDate(followUp.nextFollowUpDate, '下次跟进日期');
  return {
    ...record,
    nextFollowUpDate,
    followUpRecords: [
      ...(record.followUpRecords ?? []),
      {
        id: newId('follow'),
        followedAt: requireDate(followUp.followedAt, '跟进日期'),
        result: requireText(followUp.result, '跟进结果', 300),
        promiseDate: optionalDate(followUp.promiseDate, '承诺付款日期'),
        nextFollowUpDate,
      },
    ],
    updatedAt: now,
  };
}

export function getTodayQueue(records, today) {
  return records
    .map((record) => deriveReceivable(record, today))
    .filter((record) => record.needsActionToday)
    .sort((a, b) => a.actionPriority - b.actionPriority
      || a.dueDate.localeCompare(b.dueDate)
      || a.clientName.localeCompare(b.clientName, 'zh-CN'));
}

export function calculateDashboard(records, today) {
  const derived = records.map((record) => deriveReceivable(record, today));
  return {
    outstandingAmount: roundMoney(derived.reduce((sum, item) => sum + item.remainingAmount, 0)),
    overdueAmount: roundMoney(derived.filter((item) => item.isOverdue).reduce((sum, item) => sum + item.remainingAmount, 0)),
    actionCount: derived.filter((item) => item.needsActionToday).length,
    dueWithinSevenDaysAmount: roundMoney(derived
      .filter((item) => !['paid', 'paused'].includes(item.status))
      .filter((item) => {
        const distance = daysBetween(today, item.dueDate);
        return distance >= 0 && distance <= 7;
      })
      .reduce((sum, item) => sum + item.remainingAmount, 0)),
  };
}

export function updateReceivable(record, changes, now = new Date().toISOString()) {
  const updated = createReceivable({
    ...record,
    ...changes,
    id: record.id,
    createdAt: record.createdAt,
    paymentRecords: record.paymentRecords,
    followUpRecords: record.followUpRecords,
  }, now);
  const receivedAmount = deriveReceivable(record, now.slice(0, 10)).receivedAmount;
  if (updated.totalAmount < receivedAmount) throw new Error('应收总额不能低于累计已收金额');
  return updated;
}
