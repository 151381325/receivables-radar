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
      <p>账号信息以及你录入的应收、跟进和到账记录会保存到回款雷达的服务器，用于账号登录、数据同步和回款管理。</p>
    </section>
    <section class="privacy-section">
      <h3>电脑和手机会同步数据</h3>
      <p>使用同一账号登录后，服务器会向不同设备提供同一份业务记录。请妥善保管密码，不要与他人共用账号。</p>
    </section>
    <section class="privacy-section">
      <h3>请主动做好备份</h3>
      <p>云端同步不能代替备份。建议定期导出备份文件并妥善保存，以便发生误删或异常时恢复记录。</p>
    </section>
    <section class="privacy-section">
      <h3>不要录入敏感信息</h3>
      <p>请勿在客户名称、项目名称或备注中填写银行卡号、身份证号、密码、验证码等敏感信息。</p>
    </section>
    <section class="privacy-section">
      <h3>了解你的数据权利</h3>
      <p>你可以在站内查看、修改、删除或导出业务记录。账号注销和全部数据删除请按<a href="./privacy/" target="_blank" rel="noopener">完整隐私政策</a>中的方式联系我们。</p>
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
