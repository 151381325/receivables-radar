import { createApiClient } from './api-client.js';

const api = createApiClient(globalThis.fetch, { onAuthRequired: () => { window.location.href = '../'; } });
const state = { page: 1, pageSize: 20, status: 'all', query: '', currentUser: null, pendingUser: null };

const usersRoot = document.querySelector('#admin-users');
const summaryRoot = document.querySelector('#admin-summary');
const paginationRoot = document.querySelector('#admin-pagination');
const errorRoot = document.querySelector('#admin-error');
const noticeRoot = document.querySelector('#admin-notice');
const dialog = document.querySelector('#admin-status-dialog');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function showError(error) {
  noticeRoot.textContent = '';
  errorRoot.textContent = error?.message ?? '加载失败，请稍后重试';
  errorRoot.focus();
}

function renderSummary(summary) {
  clear(summaryRoot);
  for (const [label, value, note] of [
    ['注册总数', summary.total, '全部账号'], ['已验证邮箱', summary.verified, '完成邮箱验证'],
    ['未验证邮箱', summary.unverified, '尚未完成验证'], ['已停用', summary.disabled, '当前不可登录'],
  ]) {
    const card = element('article', 'summary-card');
    card.append(element('span', '', label), element('strong', '', String(value)), element('small', '', note));
    summaryRoot.append(card);
  }
}

function statusBadge(text, tone) {
  return element('span', `badge ${tone}`, text);
}

function renderUsers(users) {
  clear(usersRoot);
  if (users.length === 0) {
    usersRoot.append(element('p', 'empty-state', '没有找到符合条件的用户'));
    return;
  }
  for (const user of users) {
    const row = element('div', 'user-row');
    row.setAttribute('role', 'row');
    const account = element('div', 'account-cell');
    account.append(element('strong', '', user.email));
    if (user.id === state.currentUser.id) account.append(statusBadge('当前账号', 'neutral'));
    const created = element('span', '', formatDate(user.createdAt));
    const verified = statusBadge(user.emailVerified ? '已验证' : '未验证', user.emailVerified ? 'success' : 'warning');
    const count = element('span', '', `${user.receivableCount} 笔`);
    const access = statusBadge(user.disabled ? '已停用' : '未停用', user.disabled ? 'danger' : 'success');
    const action = element('div', 'action-cell');
    if (user.id === state.currentUser.id) {
      action.append(element('span', 'muted', '不可操作自己'));
    } else {
      const button = element('button', user.disabled ? 'row-action restore' : 'row-action disable', user.disabled ? '恢复账号' : '停用账号');
      button.type = 'button';
      button.addEventListener('click', () => openStatusDialog(user));
      action.append(button);
    }
    for (const cell of [account, created, verified, count, access, action]) {
      cell.setAttribute('role', 'cell');
      row.append(cell);
    }
    usersRoot.append(row);
  }
}

function renderPagination(pagination) {
  clear(paginationRoot);
  const info = element('span', '', `共 ${pagination.total} 个账号 · 第 ${pagination.page}/${Math.max(1, pagination.totalPages)} 页`);
  const controls = element('div', 'page-controls');
  const previous = element('button', 'button secondary compact', '上一页');
  const next = element('button', 'button secondary compact', '下一页');
  previous.type = next.type = 'button';
  previous.disabled = pagination.page <= 1;
  next.disabled = pagination.totalPages === 0 || pagination.page >= pagination.totalPages;
  previous.addEventListener('click', () => changePage(pagination.page - 1));
  next.addEventListener('click', () => changePage(pagination.page + 1));
  controls.append(previous, next);
  paginationRoot.append(info, controls);
}

async function changePage(page) {
  state.page = page;
  try { await loadUsers(); } catch (error) { showError(error); }
}

async function loadUsers() {
  errorRoot.textContent = '';
  const result = await api.listAdminUsers(state);
  renderUsers(result.users);
  renderPagination(result.pagination);
}

async function loadDashboard() {
  errorRoot.textContent = '';
  noticeRoot.textContent = '正在加载用户数据…';
  try {
    const [summaryResult] = await Promise.all([api.getAdminSummary(), loadUsers()]);
    renderSummary(summaryResult.summary);
    noticeRoot.textContent = '数据已更新';
  } catch (error) {
    showError(error);
  }
}

function openStatusDialog(user) {
  state.pendingUser = user;
  const disabling = !user.disabled;
  document.querySelector('#status-dialog-eyebrow').textContent = disabling ? '停用账号' : '恢复账号';
  document.querySelector('#status-dialog-message').textContent = disabling
    ? `停用 ${user.email} 后，该用户会立即退出所有设备并且无法再次登录。已有数据不会删除。`
    : `恢复 ${user.email} 后，该用户可以重新登录并访问已有数据。`;
  document.querySelector('#status-dialog-confirm').textContent = disabling ? '确认停用' : '确认恢复';
  dialog.showModal();
}

dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'confirm' || !state.pendingUser) {
    state.pendingUser = null;
    return;
  }
  const user = state.pendingUser;
  state.pendingUser = null;
  try {
    const result = await api.setAdminUserDisabled(user.id, !user.disabled);
    noticeRoot.textContent = result.user.disabled ? `已停用 ${result.user.email}` : `已恢复 ${result.user.email}`;
    const [summaryResult] = await Promise.all([api.getAdminSummary(), loadUsers()]);
    renderSummary(summaryResult.summary);
  } catch (error) {
    showError(error);
  }
});

document.querySelector('#admin-search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  state.query = document.querySelector('#admin-query').value.trim();
  state.page = 1;
  try { await loadUsers(); } catch (error) { showError(error); }
});

document.querySelector('#admin-status-filter').addEventListener('change', async (event) => {
  state.status = event.target.value;
  state.page = 1;
  try { await loadUsers(); } catch (error) { showError(error); }
});

document.querySelector('#admin-page-size').addEventListener('change', async (event) => {
  state.pageSize = Number(event.target.value);
  state.page = 1;
  try { await loadUsers(); } catch (error) { showError(error); }
});

document.querySelector('#admin-refresh').addEventListener('click', loadDashboard);
document.querySelector('#admin-logout').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  window.location.href = '../';
});

async function bootstrap() {
  try {
    const result = await api.getCurrentUser();
    if (!result.user.isAdmin) {
      errorRoot.textContent = '当前账号没有管理员权限';
      document.querySelector('.panel').hidden = true;
      return;
    }
    state.currentUser = result.user;
    document.querySelector('#admin-email').textContent = result.user.email;
    await loadDashboard();
  } catch (error) {
    if (error.code !== 'AUTH_REQUIRED') showError(error);
  }
}

bootstrap();
