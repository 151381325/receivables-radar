import { parseBackup, serializeBackup } from './backup.js';
import { buildCalendarEvent } from './calendar.js';
import {
  addFollowUp,
  addPayment,
  calculateDashboard,
  createReceivable,
  deriveReceivable,
  getTodayQueue,
  updateReceivable,
} from './domain.js';
import {
  buildPrivacyNoticeHTML,
  buildRecordCardHTML,
  escapeHtml,
  filterRecords,
  formatMoney,
  statusLabel,
} from './presentation.js';
import { DEFAULT_STORAGE_KEY, createRepository } from './storage.js';
import { buildReminderMessage } from './templates.js';

const repository = createRepository(window.localStorage);
const viewPanels = [...document.querySelectorAll('[data-view-panel]')];
const state = { currentView: 'today', currentFilter: 'all', activeId: null };
let toastTimer;

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(dateText, days) {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return localDate(date);
}

function seedExamples() {
  if (window.localStorage.getItem(DEFAULT_STORAGE_KEY) !== null) return;
  const today = localDate();
  const now = new Date().toISOString();
  const unbilled = createReceivable({
    clientName: '远山工作室',
    projectName: '品牌视觉设计',
    totalAmount: 6800,
    invoiceSent: false,
    dueDate: shiftDate(today, 7),
    notes: '示例数据，可在详情中删除。',
  }, now);
  const overdue = addFollowUp(createReceivable({
    clientName: '星桥咨询',
    projectName: '年度顾问服务',
    totalAmount: 12000,
    invoiceSent: true,
    dueDate: shiftDate(today, -8),
    nextFollowUpDate: today,
    notes: '示例数据，可在详情中删除。',
  }, now), {
    followedAt: shiftDate(today, -4),
    result: '对方财务正在审批，约定本周确认。',
    promiseDate: shiftDate(today, -1),
    nextFollowUpDate: today,
  }, now);
  const partial = addPayment(createReceivable({
    clientName: '青禾文化',
    projectName: '小程序开发尾款',
    totalAmount: 9800,
    invoiceSent: true,
    dueDate: shiftDate(today, 2),
    nextFollowUpDate: shiftDate(today, 1),
    notes: '示例数据，可在详情中删除。',
  }, now), {
    amount: 4000,
    paidAt: shiftDate(today, -2),
    method: '银行转账',
    notes: '首笔到账',
  }, now);
  repository.replaceAll([unbilled, overdue, partial]);
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function emptyState(message = '还没有符合条件的应收款') {
  return `<div class="empty-state"><div class="empty-icon">✓</div><h3>${escapeHtml(message)}</h3><p>新建一笔应收，回款节奏就会自动排好。</p><button class="button primary" type="button" data-new-record>新建第一笔应收</button></div>`;
}

function renderToday(records, today) {
  const metrics = calculateDashboard(records, today);
  document.querySelector('#metric-outstanding').textContent = formatMoney(metrics.outstandingAmount);
  document.querySelector('#metric-overdue').textContent = formatMoney(metrics.overdueAmount);
  document.querySelector('#metric-actions').textContent = `${metrics.actionCount} 笔`;
  document.querySelector('#metric-upcoming').textContent = formatMoney(metrics.dueWithinSevenDaysAmount);

  const queue = getTodayQueue(records, today);
  document.querySelector('#queue-count').textContent = `${queue.length} 笔`;
  document.querySelector('#today-list').innerHTML = queue.length
    ? queue.map(buildRecordCardHTML).join('')
    : emptyState('今天没有需要处理的款项');
}

function renderAll(records, today) {
  const derived = records
    .map((record) => deriveReceivable(record, today))
    .sort((a, b) => {
      const closedA = ['paid', 'paused'].includes(a.status) ? 1 : 0;
      const closedB = ['paid', 'paused'].includes(b.status) ? 1 : 0;
      return closedA - closedB || a.dueDate.localeCompare(b.dueDate);
    });
  const filtered = filterRecords(derived, state.currentFilter);
  document.querySelector('#all-list').innerHTML = filtered.length
    ? filtered.map(buildRecordCardHTML).join('')
    : emptyState('这个状态下暂时没有记录');
}

function render() {
  const records = repository.list();
  const today = localDate();
  document.querySelector('#today-date').textContent = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date(`${today}T12:00:00`));
  renderToday(records, today);
  renderAll(records, today);
}

function showView(view) {
  state.currentView = view;
  viewPanels.forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === view);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openForm(record = null) {
  const form = document.querySelector('#receivable-form');
  form.reset();
  document.querySelector('#form-error').textContent = '';
  document.querySelector('#record-id').value = record?.id ?? '';
  document.querySelector('#form-title').textContent = record ? '编辑应收' : '新建应收';
  document.querySelector('#pause-field').hidden = !record;

  if (record) {
    document.querySelector('#client-name').value = record.clientName;
    document.querySelector('#project-name').value = record.projectName;
    document.querySelector('#total-amount').value = record.totalAmount;
    document.querySelector('#invoice-sent').checked = record.invoiceSent;
    document.querySelector('#due-date').value = record.dueDate;
    document.querySelector('#next-follow-up').value = record.nextFollowUpDate ?? '';
    document.querySelector('#notes').value = record.notes ?? '';
    document.querySelector('#paused').checked = record.paused;
  } else {
    document.querySelector('#due-date').value = shiftDate(localDate(), 7);
  }
  showView('form');
  requestAnimationFrame(() => document.querySelector('#client-name').focus());
}

function timelineHtml(record) {
  const payments = (record.paymentRecords ?? []).map((item) => ({
    date: item.paidAt,
    type: '到账',
    text: `${formatMoney(item.amount)} · ${item.method}${item.notes ? ` · ${item.notes}` : ''}`,
  }));
  const followUps = (record.followUpRecords ?? []).map((item) => ({
    date: item.followedAt,
    type: '跟进',
    text: `${item.result}${item.promiseDate ? ` · 承诺 ${item.promiseDate} 付款` : ''}`,
  }));
  const items = [...payments, ...followUps].sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) return '<p class="project-name">还没有到账或跟进记录。</p>';
  return items.map((item) => `<div class="timeline-item"><span>${escapeHtml(item.date)} · ${item.type}</span><p>${escapeHtml(item.text)}</p></div>`).join('');
}

function openDetail(id) {
  const record = repository.get(id);
  if (!record) return;
  state.activeId = id;
  const derived = deriveReceivable(record, localDate());
  document.querySelector('#detail-title').textContent = `${record.clientName} · ${record.projectName}`;
  document.querySelector('#detail-content').innerHTML = `
    <div class="detail-summary">
      <div class="detail-stat"><span>剩余待收</span><strong>${formatMoney(derived.remainingAmount)}</strong></div>
      <div class="detail-stat"><span>已收金额</span><strong>${formatMoney(derived.receivedAmount)}</strong></div>
      <div class="detail-stat"><span>当前状态</span><strong>${statusLabel(derived.status)}</strong></div>
    </div>
    <div class="detail-meta">
      <div><span>付款截止日</span><strong>${escapeHtml(record.dueDate)}</strong></div>
      <div><span>下次跟进日</span><strong>${escapeHtml(record.nextFollowUpDate || '未设置')}</strong></div>
      <div><span>付款通知</span><strong>${record.invoiceSent ? '已发送' : '待发送'}</strong></div>
      <div><span>备注</span><strong>${escapeHtml(record.notes || '无')}</strong></div>
    </div>
    <div class="timeline"><h3>时间线</h3><div class="timeline-list">${timelineHtml(record)}</div></div>`;
  document.querySelector('#detail-payment').disabled = derived.status === 'paid';
  document.querySelector('#detail-follow-up').disabled = derived.status === 'paid';
  document.querySelector('#record-dialog').showModal();
}

function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}

function activeRecord() {
  return state.activeId ? repository.get(state.activeId) : null;
}

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) showView(viewButton.dataset.view);

  if (event.target.closest('[data-new-record]')) openForm();

  if (event.target.closest('[data-open-privacy]')) {
    document.querySelector('#privacy-content').innerHTML = buildPrivacyNoticeHTML();
    document.querySelector('#privacy-dialog').showModal();
  }

  const recordButton = event.target.closest('[data-open-record]');
  if (recordButton) openDetail(recordButton.dataset.openRecord);

  const closeButton = event.target.closest('[data-close-dialog]');
  if (closeButton) closeButton.closest('dialog')?.close();

  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) {
    state.currentFilter = filterButton.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('is-active', button === filterButton));
    renderAll(repository.list(), localDate());
  }
});

document.querySelector('#receivable-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = document.querySelector('#record-id').value;
  const dueDate = document.querySelector('#due-date').value;
  if (dueDate < localDate() && !window.confirm('付款截止日期早于今天，是否作为历史欠款继续保存？')) return;

  const input = {
    clientName: document.querySelector('#client-name').value,
    projectName: document.querySelector('#project-name').value,
    totalAmount: document.querySelector('#total-amount').value,
    invoiceSent: document.querySelector('#invoice-sent').checked,
    dueDate,
    nextFollowUpDate: document.querySelector('#next-follow-up').value || null,
    notes: document.querySelector('#notes').value,
    paused: document.querySelector('#paused').checked,
  };

  try {
    const existing = id ? repository.get(id) : null;
    const record = existing ? updateReceivable(existing, input) : createReceivable(input);
    repository.save(record);
    render();
    showView('today');
    showToast(existing ? '应收信息已更新' : '应收已创建');
  } catch (error) {
    document.querySelector('#form-error').textContent = error.message;
  }
});

document.querySelector('#detail-edit').addEventListener('click', () => {
  const record = activeRecord();
  closeDialogs();
  if (record) openForm(record);
});

document.querySelector('#detail-delete').addEventListener('click', () => {
  const record = activeRecord();
  if (!record || !window.confirm(`确认删除“${record.clientName} · ${record.projectName}”吗？此操作无法撤销。`)) return;
  repository.remove(record.id);
  closeDialogs();
  render();
  showToast('应收记录已删除');
});

document.querySelector('#detail-payment').addEventListener('click', () => {
  const record = activeRecord();
  if (!record) return;
  const derived = deriveReceivable(record, localDate());
  document.querySelector('#record-dialog').close();
  document.querySelector('#payment-form').reset();
  document.querySelector('#payment-error').textContent = '';
  document.querySelector('#payment-amount').max = derived.remainingAmount;
  document.querySelector('#payment-amount').value = derived.remainingAmount;
  document.querySelector('#payment-date').value = localDate();
  document.querySelector('#payment-dialog').showModal();
});

document.querySelector('#payment-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const record = activeRecord();
  if (!record) return;
  try {
    repository.save(addPayment(record, {
      amount: document.querySelector('#payment-amount').value,
      paidAt: document.querySelector('#payment-date').value,
      method: document.querySelector('#payment-method').value,
      notes: document.querySelector('#payment-notes').value,
    }));
    closeDialogs();
    render();
    showToast('到账记录已保存');
  } catch (error) {
    document.querySelector('#payment-error').textContent = error.message;
  }
});

document.querySelector('#detail-follow-up').addEventListener('click', () => {
  const record = activeRecord();
  if (!record) return;
  document.querySelector('#record-dialog').close();
  document.querySelector('#follow-form').reset();
  document.querySelector('#follow-error').textContent = '';
  document.querySelector('#follow-date').value = localDate();
  document.querySelector('#follow-next-date').value = record.nextFollowUpDate ?? '';
  document.querySelector('#follow-dialog').showModal();
});

document.querySelector('#follow-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const record = activeRecord();
  if (!record) return;
  try {
    repository.save(addFollowUp(record, {
      followedAt: document.querySelector('#follow-date').value,
      result: document.querySelector('#follow-result').value,
      promiseDate: document.querySelector('#promise-date').value || null,
      nextFollowUpDate: document.querySelector('#follow-next-date').value || null,
    }));
    closeDialogs();
    render();
    showToast('跟进记录已保存');
  } catch (error) {
    document.querySelector('#follow-error').textContent = error.message;
  }
});

document.querySelector('#detail-reminder').addEventListener('click', () => {
  const record = activeRecord();
  if (!record) return;
  const reminder = buildReminderMessage(deriveReceivable(record, localDate()), localDate());
  document.querySelector('#record-dialog').close();
  document.querySelector('#reminder-stage').textContent = `建议阶段：${reminder.stage}`;
  document.querySelector('#reminder-text').value = reminder.text;
  document.querySelector('#export-follow-calendar').disabled = !record.nextFollowUpDate;
  document.querySelector('#reminder-dialog').showModal();
});

document.querySelector('#copy-reminder').addEventListener('click', async () => {
  const textarea = document.querySelector('#reminder-text');
  try {
    await navigator.clipboard.writeText(textarea.value);
  } catch {
    textarea.select();
    document.execCommand('copy');
  }
  showToast('催款文案已复制');
});

function exportCalendar(eventType) {
  const record = activeRecord();
  if (!record) return;
  try {
    const derived = deriveReceivable(record, localDate());
    downloadText(`回款提醒-${record.clientName}-${eventType}.ics`, buildCalendarEvent(derived, eventType), 'text/calendar;charset=utf-8');
    showToast('日历提醒已导出');
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector('#export-follow-calendar').addEventListener('click', () => exportCalendar('followUp'));
document.querySelector('#export-due-calendar').addEventListener('click', () => exportCalendar('due'));

document.querySelector('#export-backup').addEventListener('click', () => {
  downloadText(`回款雷达备份-${localDate()}.json`, serializeBackup(repository.list()), 'application/json;charset=utf-8');
  showToast('完整备份已导出');
});

document.querySelector('#import-backup').addEventListener('click', () => document.querySelector('#backup-file').click());
document.querySelector('#backup-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const result = parseBackup(await file.text(), repository.list());
    repository.replaceAll(result.records);
    render();
    showToast(`恢复完成：导入 ${result.importedCount} 笔，跳过 ${result.skippedCount} 笔`);
  } catch (error) {
    showToast(error.message);
  } finally {
    event.target.value = '';
  }
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

seedExamples();
render();
showView('today');
