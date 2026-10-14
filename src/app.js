import { parseBackup, serializeBackup } from './backup.js';
import { buildCalendarEvent } from './calendar.js';
import { calculateDashboard, deriveReceivable, getTodayQueue } from './domain.js';
import { runWithFormBusy } from './form-submit.js';
import {
  buildPrivacyNoticeHTML,
  buildRecordCardHTML,
  escapeHtml,
  formatMoney,
  statusLabel,
} from './presentation.js';
import { buildReminderMessage } from './templates.js';
import { queryReceivables } from './receivable-query.js';
import { initializeCardEffects } from './card-effects.js';
import { createRefreshCoordinator } from './refresh-coordinator.js';
import { saveTextFile } from './file-export.js';
import { createBackHandler } from './back-navigation.js';

let repository;
const viewPanels = [...document.querySelectorAll('[data-view-panel]')];
const state = { currentView: 'today', currentFilter: 'all', activeId: null };
const inputBaselines = new WeakMap();
let dialogSequence = 0;

function inputSnapshot(container) {
  return JSON.stringify([...container.querySelectorAll('input, select, textarea')].map(input => [input.id, input.value, input.checked ?? null]));
}

function hasUnsavedInputs(container) {
  return inputBaselines.has(container) && inputBaselines.get(container) !== inputSnapshot(container);
}

function showDialog(dialog) {
  inputBaselines.set(dialog, inputSnapshot(dialog));
  dialog.dataset.openSequence = String(++dialogSequence);
  dialog.showModal();
}

window.__radarHandleBack = createBackHandler({
  getContext: () => ({
    appVisible: !document.querySelector('#app-shell').hidden,
    view: state.currentView,
    dialogs: [...document.querySelectorAll('dialog[open]')]
      .sort((a, b) => Number(a.dataset.openSequence || 0) - Number(b.dataset.openSequence || 0))
      .map(dialog => ({ id: dialog.id, dirty: hasUnsavedInputs(dialog) })),
    formDirty: hasUnsavedInputs(document.querySelector('#receivable-form')),
    busy: mutationCount > 0 || [...document.querySelectorAll('form[data-busy="true"]')].some(form => form.closest('dialog[open]') || (state.currentView === 'form' && form.id === 'receivable-form')),
  }),
  confirmDiscard: () => window.confirm('当前内容尚未保存，确认放弃修改并返回？'),
  closeDialog: id => document.getElementById(id).close(),
  showToday: () => showView('today'),
});
let toastTimer;
const coordinateRefresh = createRefreshCoordinator();
let lastRefreshAt = 0;
let lastRenderedDate = '';
let mutationCount = 0;

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

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function setSyncStatus(message, canRetry = false) {
  const status = document.querySelector('#sync-status');
  status.textContent = message;
  document.querySelector('.header-controls [data-retry-sync]').hidden = !canRetry;
  document.querySelector('#sync-alert').hidden = !canRetry;
  status.classList.toggle('sync-failed', canRetry);
}

async function refreshRecords({ silent = false } = {}) {
  if (!repository) return;
  const currentRepository = repository;
  return coordinateRefresh(currentRepository, async () => { try {
    setSyncStatus('正在同步数据…');
    await currentRepository.load();
    if (repository !== currentRepository) return;
    render();
    lastRefreshAt = Date.now();
    setSyncStatus(`数据已同步 · ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`);
    if (!silent) showToast('已刷新云端数据');
  } catch (error) {
    if (repository !== currentRepository) return;
    setSyncStatus('同步失败，可重试', true);
    if (!silent) showToast(error.message);
    throw error;
  } });
}

async function handleMutation(action) {
  mutationCount += 1;
  try {
    return await action();
  } catch (error) {
    if (error.code === 'STALE_VERSION') {
      try { await refreshRecords({ silent: true }); showToast('这笔记录已在其他设备更新，请核对最新数据'); }
      catch { showToast('记录已在其他设备更新，当前刷新失败，请联网后重试'); }
    }
    throw error;
  } finally { mutationCount -= 1; }
}

function emptyState(kind) {
  const copy = kind === 'new'
    ? ['还没有应收款项', '记录客户、金额和到期日，开始管理回款。', '新增第一笔应收', 'data-new-record']
    : kind === 'today'
      ? ['今天没有待跟进款项', '已有安排会保留，逾期风险仍可在概览查看。', '查看全部应收', 'data-view="all"']
      : ['没有匹配的应收款', '试试其他关键词、付款状态或风险筛选。', '清除筛选', 'data-clear-filters'];
  return `<div class="empty-state"><div class="empty-icon">✓</div><h3>${copy[0]}</h3><p>${copy[1]}</p><button class="button quiet" type="button" ${copy[3]}>${copy[2]}</button></div>`;
}

function renderToday(records, today) {
  const metrics = calculateDashboard(records, today);
  document.querySelector('#metric-outstanding').textContent = formatMoney(metrics.outstandingAmount);
  document.querySelector('#metric-overdue').textContent = formatMoney(metrics.overdueAmount);
  document.querySelector('#metric-actions').textContent = `${metrics.actionCount} 笔`;
  document.querySelector('#metric-upcoming').textContent = formatMoney(metrics.dueWithinSevenDaysAmount);
  const derived = records.map(record => deriveReceivable(record, today));
  const active = derived.filter(record => record.remainingAmount > 0);
  const overdue = derived.filter(record => record.isOverdue);
  document.querySelector('#metric-received').textContent = formatMoney(derived.reduce((sum, record) => sum + record.receivedAmount, 0));
  document.querySelector('#outstanding-note').textContent = `${active.length} 笔待收 · 含暂停跟进款项`;
  document.querySelector('#today-subtitle').textContent = metrics.actionCount ? `今天有 ${metrics.actionCount} 笔待跟进；共有 ${overdue.length} 笔逾期款项。` : '今天没有待跟进款项，后续安排已保留。';
  document.querySelector('#risk-note').textContent = overdue.length ? `${overdue.length} 笔已逾期，风险仍需关注。` : '暂无逾期款项，按计划跟进即可。';
  document.querySelector('.risk-card').classList.toggle('no-risk', !overdue.length);

  const queue = getTodayQueue(records, today);
  document.querySelector('#queue-count').textContent = `${queue.length} 笔`;
  document.querySelector('#today-list').innerHTML = queue.length
    ? queue.map(buildRecordCardHTML).join('')
    : emptyState(records.length ? 'today' : 'new');
  const events = records.flatMap(record => [
    { id: record.id, client: record.clientName, date: record.createdAt.slice(0, 10), type: '新增应收', text: record.projectName },
    ...record.paymentRecords.map(item => ({ id: record.id, client: record.clientName, date: item.paidAt, type: '登记到账', text: formatMoney(item.amount) })),
    ...record.followUpRecords.map(item => ({ id: record.id, client: record.clientName, date: item.followedAt, type: '记录跟进', text: item.result })),
  ]).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  document.querySelector('#recent-activity').innerHTML = events.length ? events.map(item => `<button type="button" class="activity-event" data-open-record="${escapeHtml(item.id)}"><span>${escapeHtml(item.date)} · ${item.type}</span><strong>${escapeHtml(item.client)}</strong><small>${escapeHtml(item.text)}</small></button>`).join('') : '<p class="activity-empty">还没有动态。新增应收或记录跟进后会显示在这里。</p>';
}

function renderAll(records, today) {
  const derived = records
    .map((record) => deriveReceivable(record, today))
    .sort((a, b) => {
      const closedA = ['paid', 'paused'].includes(a.status) ? 1 : 0;
      const closedB = ['paid', 'paused'].includes(b.status) ? 1 : 0;
      return closedA - closedB || a.dueDate.localeCompare(b.dueDate);
    });
  const filtered = queryReceivables(derived, { status: state.currentFilter, query: document.querySelector('#record-search').value, risk: document.querySelector('#risk-select').value, sort: document.querySelector('#record-sort').value, today });
  document.querySelector('#all-list').innerHTML = filtered.length
    ? filtered.map(buildRecordCardHTML).join('')
    : emptyState(records.length ? 'filter' : 'new');
  document.querySelector('#ledger-total').textContent = `当前列表 ${filtered.length} 笔 · 待收合计 ${formatMoney(filtered.reduce((sum, record) => sum + record.remainingAmount, 0))}`;
}

function render() {
  const records = repository.list();
  const today = localDate();
  lastRenderedDate = today;
  document.querySelector('#today-date').textContent = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date(`${today}T12:00:00`));
  renderToday(records, today);
  renderAll(records, today);
  initializeCardEffects();
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
  inputBaselines.set(form, inputSnapshot(form));
  showView('form');
  requestAnimationFrame(() => document.querySelector('#client-name').focus());
}

function timelineHtml(record) {
  const payments = (record.paymentRecords ?? []).map((item) => ({
    date: item.paidAt,
    type: '到账',
    text: `${formatMoney(item.amount)} · ${item.method}${item.notes ? ` · ${item.notes}` : ''}`,
    paymentId: item.id,
  }));
  const followUps = (record.followUpRecords ?? []).map((item) => ({
    date: item.followedAt,
    type: '跟进',
    text: `${item.result}${item.promiseDate ? ` · 承诺 ${item.promiseDate} 付款` : item.promiseAction === 'clear' ? ' · 已撤销原承诺' : ''}`,
  }));
  const items = [...payments, ...followUps].sort((a, b) => b.date.localeCompare(a.date));
  if (!items.length) return '<p class="project-name">还没有到账或跟进记录。</p>';
  return items.map((item) => `<div class="timeline-item"><span>${escapeHtml(item.date)} · ${item.type}</span><p>${escapeHtml(item.text)}</p>${item.paymentId ? `<button type="button" class="text-button correction-button" data-remove-payment="${escapeHtml(item.paymentId)}">纠正误录到账</button>` : ''}</div>`).join('');
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
  showDialog(document.querySelector('#record-dialog'));
}

function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}

function activeRecord() {
  return state.activeId ? repository.get(state.activeId) : null;
}

function showExportResult(result) {
  showToast(result.status === 'saved' ? '文件已保存' : result.status === 'cancelled' ? '已取消保存' : '已发起下载，请确认文件已保存');
}

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) showView(viewButton.dataset.view);

  if (event.target.closest('[data-new-record]')) openForm();
  const correction = event.target.closest('[data-remove-payment]');
  if (correction) {
    const record = activeRecord();
    if (record && !correction.disabled && window.confirm('确认撤销这条误录到账吗？剩余待收金额会重新计算。')) {
      correction.disabled = true;
      handleMutation(() => repository.removePayment(record.id, correction.dataset.removePayment, record.version)).then(() => {
        closeDialogs(); render(); openDetail(record.id); showToast('误录到账已撤销，余额已更新');
      }).catch(error => { showToast(error.message); correction.disabled = false; });
    }
  }
  if (event.target.closest('[data-clear-filters]')) {
    state.currentFilter = 'all';
    document.querySelector('#record-search').value = '';
    document.querySelector('#risk-select').value = 'all';
    document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('is-active', button.dataset.filter === 'all'));
    renderAll(repository.list(), localDate());
  }

  if (event.target.closest('[data-refresh-records], [data-retry-sync]')) {
    refreshRecords().catch(() => {});
  }

  if (event.target.closest('[data-open-privacy]')) {
    document.querySelector('#privacy-content').innerHTML = buildPrivacyNoticeHTML();
    showDialog(document.querySelector('#privacy-dialog'));
  }

  const recordButton = event.target.closest('[data-open-record]');
  if (recordButton) openDetail(recordButton.dataset.openRecord);
  const followButton = event.target.closest('[data-follow-record]');
  if (followButton) { openDetail(followButton.dataset.followRecord); document.querySelector('#detail-follow-up').click(); }

  const closeButton = event.target.closest('[data-close-dialog]');
  if (closeButton) closeButton.closest('dialog')?.close();

  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) {
    state.currentFilter = filterButton.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('is-active', button === filterButton));
    renderAll(repository.list(), localDate());
  }
});

document.querySelector('#receivable-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runWithFormBusy(form, async () => {
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
      await handleMutation(() => (existing
        ? repository.update(existing.id, { ...input, version: existing.version })
        : repository.create(input)));
      render();
      showView('today');
      showToast(existing ? '应收信息已更新' : '应收已创建');
    } catch (error) {
      document.querySelector('#form-error').textContent = error.message;
    }
  });
});

document.querySelector('#detail-edit').addEventListener('click', () => {
  const record = activeRecord();
  closeDialogs();
  if (record) openForm(record);
});

document.querySelector('#detail-delete').addEventListener('click', async () => {
  const record = activeRecord();
  if (!record || !window.confirm(`确认删除“${record.clientName} · ${record.projectName}”吗？此操作无法撤销。`)) return;
  try {
    await handleMutation(() => repository.remove(record.id, record.version));
    closeDialogs();
    render();
    showToast('应收记录已删除');
  } catch (error) { showToast(error.message); }
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
  showDialog(document.querySelector('#payment-dialog'));
});

document.querySelector('#payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await runWithFormBusy(event.currentTarget, async () => {
    const record = activeRecord();
    if (!record) return;
    try {
      await handleMutation(() => repository.addPayment(record.id, {
        version: record.version,
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
});

document.querySelector('#detail-follow-up').addEventListener('click', () => {
  const record = activeRecord();
  if (!record) return;
  document.querySelector('#record-dialog').close();
  document.querySelector('#follow-form').reset();
  document.querySelector('#follow-error').textContent = '';
  document.querySelector('#follow-date').value = localDate();
  document.querySelector('#follow-next-date').value = record.nextFollowUpDate ?? '';
  showDialog(document.querySelector('#follow-dialog'));
});

document.querySelector('#follow-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await runWithFormBusy(event.currentTarget, async () => {
    const record = activeRecord();
    if (!record) return;
    try {
      await handleMutation(() => repository.addFollowUp(record.id, {
        version: record.version,
        followedAt: document.querySelector('#follow-date').value,
        result: document.querySelector('#follow-result').value,
        promiseDate: document.querySelector('#promise-date').value || null,
        promiseAction: document.querySelector('#promise-action').value,
        nextFollowUpDate: document.querySelector('#follow-next-date').value || null,
      }));
      closeDialogs();
      render();
      showToast('跟进记录已保存');
    } catch (error) {
      document.querySelector('#follow-error').textContent = error.message;
    }
  });
});

document.querySelector('#detail-reminder').addEventListener('click', () => {
  const record = activeRecord();
  if (!record) return;
  const reminder = buildReminderMessage(deriveReceivable(record, localDate()), localDate());
  document.querySelector('#record-dialog').close();
  document.querySelector('#reminder-stage').textContent = `建议阶段：${reminder.stage}`;
  document.querySelector('#reminder-text').value = reminder.text;
  document.querySelector('#export-follow-calendar').disabled = !record.nextFollowUpDate;
  showDialog(document.querySelector('#reminder-dialog'));
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

async function exportCalendar(eventType) {
  const record = activeRecord();
  if (!record) return;
  try {
    const derived = deriveReceivable(record, localDate());
    showExportResult(await saveTextFile(`回款提醒-${record.clientName}-${eventType}.ics`, buildCalendarEvent(derived, eventType), 'text/calendar;charset=utf-8'));
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector('#export-follow-calendar').addEventListener('click', () => exportCalendar('followUp'));
document.querySelector('#export-due-calendar').addEventListener('click', () => exportCalendar('due'));

document.querySelector('#export-backup').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    showExportResult(await saveTextFile(`回款雷达备份-${localDate()}.json`, serializeBackup(repository.list()), 'application/json;charset=utf-8'));
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});

document.querySelector('#import-backup').addEventListener('click', () => document.querySelector('#backup-file').click());
document.querySelector('#backup-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const source = await file.text();
    const parsed = parseBackup(source, []);
    if (!parsed.records.length) { showToast('这个备份没有可导入的记录'); return; }
    if (!window.confirm(`将导入 ${parsed.records.length} 笔本地记录到云端；同 ID 的云端记录会保留。导入前会下载原始备份，是否继续？`)) return;
    const backupResult = await saveTextFile(`回款雷达导入前备份-${localDate()}.json`, serializeBackup(repository.list()), 'application/json;charset=utf-8');
    if (backupResult.status === 'cancelled') { showToast('已取消保存，未导入数据'); return; }
    if (backupResult.status === 'started' && !window.confirm('请确认导入前备份已下载并保存，再继续导入。是否已保存？')) return;
    const result = await handleMutation(() => repository.importRecords(parsed.records));
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

export async function startApp(cloudRepository) {
  repository = cloudRepository;
  state.activeId = null;
  state.currentFilter = 'all';
  document.querySelector('#record-search').value = '';
  document.querySelector('#risk-select').value = 'all';
  document.querySelector('#record-sort').value = 'date-asc';
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('is-active', button.dataset.filter === 'all'));
  render();
  showView('today');
  await refreshRecords({ silent: true });
}

document.querySelector('#record-search').addEventListener('input', () => renderAll(repository.list(), localDate()));
document.querySelectorAll('#risk-select, #record-sort').forEach(element => element.addEventListener('change', () => renderAll(repository.list(), localDate())));
document.querySelector('#risk-filter').addEventListener('click', () => {
  document.querySelector('#risk-select').value = 'overdue'; state.currentFilter = 'all';
  document.querySelector('#record-search').value = '';
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('is-active', button.dataset.filter === 'all'));
  renderAll(repository.list(), localDate()); showView('all');
});
function updatePromiseInput() {
  const setting = document.querySelector('#promise-action').value === 'set';
  document.querySelector('#promise-date').disabled = !setting;
  document.querySelector('#promise-date').required = setting;
}
document.querySelector('#promise-action').addEventListener('change', updatePromiseInput);
document.querySelector('#detail-follow-up').addEventListener('click', updatePromiseInput);
function refreshOnReturn() {
  if (!repository || document.querySelector('#app-shell').hidden || document.visibilityState === 'hidden' || mutationCount || document.querySelector('dialog[open]')) return;
  if (lastRenderedDate !== localDate()) render();
  if (Date.now() - lastRefreshAt > 15000) refreshRecords({ silent: true }).catch(() => {});
}
document.addEventListener('visibilitychange', refreshOnReturn);
window.addEventListener('focus', refreshOnReturn);
window.addEventListener('online', () => { lastRefreshAt = 0; refreshOnReturn(); });
setInterval(refreshOnReturn, 60000);
