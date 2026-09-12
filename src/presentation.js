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

export function buildPrivacyNoticeHTML() {
  return `
    <section class="privacy-section">
      <h3>数据保存在哪里？</h3>
      <p>你录入的应收、跟进和到账记录仅保存在当前浏览器中，不会上传到回款雷达的服务器。</p>
    </section>
    <section class="privacy-section">
      <h3>不同设备不会自动同步</h3>
      <p>手机和电脑各自保存独立数据。如需迁移，请先在原设备导出备份，再在新设备恢复备份。</p>
    </section>
    <section class="privacy-section">
      <h3>请主动做好备份</h3>
      <p>清除浏览器数据、使用无痕模式、更换设备或卸载浏览器都可能造成记录丢失，建议定期导出备份。</p>
    </section>
    <section class="privacy-section">
      <h3>不要录入敏感信息</h3>
      <p>请勿在客户名称、项目名称或备注中填写银行卡号、身份证号、密码、验证码等敏感信息。</p>
    </section>`;
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
