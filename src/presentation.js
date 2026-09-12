const STATUS_LABELS = {
  unbilled: '待开票',
  awaiting: '待付款',
  partial: '部分到账',
  paid: '已收款',
  paused: '暂停跟进',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(value));
}

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? '未知状态';
}

export function filterRecords(records, status) {
  return status === 'all' ? records : records.filter((record) => record.status === status);
}

export function buildRecordCardHTML(record) {
  const overdueClass = record.isOverdue ? ' is-overdue' : '';
  return `
    <article class="receivable-card${overdueClass}">
      <button class="card-open" type="button" data-open-record="${escapeHtml(record.id)}" aria-label="查看${escapeHtml(record.clientName)}的应收详情">
        <span class="card-topline">
          <span class="client-name">${escapeHtml(record.clientName)}</span>
          <span class="status-pill status-${escapeHtml(record.status)}">${statusLabel(record.status)}</span>
        </span>
        <span class="project-name">${escapeHtml(record.projectName)}</span>
        <span class="card-amount">${formatMoney(record.remainingAmount)}</span>
        <span class="card-meta">截止 ${escapeHtml(record.dueDate)} · ${escapeHtml(record.actionReason || '无需处理')}</span>
      </button>
    </article>`;
}
