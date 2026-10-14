import { createApiClient } from './api-client.js';
import { validatePasswordConfirmation } from './auth-validation.js';
import { createCloudRepository } from './cloud-repository.js';
import { runWithFormBusy } from './form-submit.js';

const authShell = document.querySelector('#auth-shell');
const appShell = document.querySelector('#app-shell');
const authTitle = document.querySelector('#auth-title');
const authLead = document.querySelector('#auth-lead');
const authError = document.querySelector('#auth-error');
const statusMessage = document.querySelector('#auth-status-message');
const panels = [...document.querySelectorAll('[data-auth-panel]')];
let resetToken = null;
let appLoaded = false;
let activeRepository = null;
let sessionGeneration = 0;

function clearAuthenticatedState(message) {
  sessionGeneration++;
  appLoaded = false;
  activeRepository?.clear();
  activeRepository = null;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  document.querySelectorAll('#today-list, #all-list, #detail-content, #recent-activity, #vip-catalog').forEach(element => element.replaceChildren());
  document.querySelectorAll('form').forEach(form => form.reset());
  document.querySelector('#reminder-text').value = '';
  document.querySelectorAll('#metric-outstanding, #metric-received, #metric-overdue, #metric-upcoming').forEach(element => { element.textContent = '¥0.00'; });
  document.querySelector('#metric-actions').textContent = '0 笔';
  document.querySelector('#account-email').textContent = '';
  document.querySelector('#admin-link').hidden = true;
  appShell.hidden = true;
  authShell.hidden = false;
  showAuthView('login');
  authError.textContent = message;
  authError.focus();
}

const api = createApiClient(globalThis.fetch, {
  getSessionGeneration: () => sessionGeneration,
  onAuthRequired: () => {
    if (appShell.hidden) return;
    clearAuthenticatedState('登录已过期，请重新登录');
  },
});

const viewCopy = {
  login: ['欢迎回来', '登录后，电脑和手机上的回款记录会保持一致。'],
  register: ['创建账号', '一个账号，在电脑和手机上都能安心跟进回款。'],
  forgot: ['找回密码', '输入注册邮箱，我们会发送一封限时重置邮件。'],
  reset: ['设置新密码', '新密码保存后，其他设备上的旧登录会自动失效。'],
  resend: ['重发验证邮件', '验证链接有效期30分钟，请同时检查垃圾邮件。'],
  status: ['请查看邮箱', '按照邮件里的提示继续，验证链接30分钟内有效。'],
};

function showAuthView(view, message = '') {
  const [title, lead] = viewCopy[view];
  authTitle.textContent = title;
  authLead.textContent = lead;
  authError.textContent = '';
  panels.forEach((panel) => { panel.hidden = panel.dataset.authPanel !== view; });
  if (message) statusMessage.textContent = message;
  requestAnimationFrame(() => panels.find((panel) => !panel.hidden)?.querySelector('input')?.focus());
}

async function enterApp(user) {
  sessionGeneration++;
  document.querySelector('#account-email').textContent = user.email;
  const adminLink = document.querySelector('#admin-link');
  adminLink.hidden = !user.isAdmin;
  document.querySelector('#delete-account-button').disabled = Boolean(user.isAdmin);
  document.querySelector('#delete-account-admin-hint').hidden = !user.isAdmin;
  if (!appLoaded) {
    const { startApp } = await import('./app.js');
    activeRepository = createCloudRepository(api);
    await startApp(activeRepository);
    appLoaded = true;
  }
  authShell.hidden = true;
  appShell.hidden = false;
  api.getEntitlements().then(result => {
    const catalog = document.querySelector('#vip-catalog');
    catalog.replaceChildren();
    for (const feature of Object.values(result.catalog ?? {}).filter(item => item.plan === 'vip')) {
      const row = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = feature.name;
      const status = document.createElement('span');
      status.textContent = '规划中';
      row.append(title, status);
      catalog.append(row);
    }
  }).catch(() => { document.querySelector('#vip-catalog').textContent = '暂时无法加载功能规划，核心功能不受影响。'; });
}

async function submit(form, action) {
  const data = new FormData(form);
  return runWithFormBusy(form, async () => {
    authError.textContent = '';
    try {
      await action(data);
    } catch (error) {
      authError.textContent = error.message;
      authError.focus();
    }
  });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-auth-view]');
  if (button) showAuthView(button.dataset.authView);
});

document.querySelector('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, async (data) => {
    const result = await api.login({ email: data.get('email'), password: data.get('password') });
    await enterApp(result.user);
  });
});

document.querySelector('#register-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, async (data) => {
    const confirmationError = validatePasswordConfirmation(data.get('password'), data.get('passwordConfirmation'));
    if (confirmationError) throw new Error(confirmationError);
    const result = await api.register({
      email: data.get('email'), password: data.get('password'),
      acceptedTerms: data.get('acceptedTerms') === 'on',
    });
    showAuthView('status', result.message);
  });
});

document.querySelector('#forgot-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, async (data) => {
    const result = await api.requestPasswordReset(data.get('email'));
    showAuthView('status', result.message);
  });
});

document.querySelector('#reset-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, async (data) => {
    const confirmationError = validatePasswordConfirmation(data.get('password'), data.get('passwordConfirmation'));
    if (confirmationError) throw new Error(confirmationError);
    const result = await api.resetPassword({ token: resetToken, password: data.get('password') });
    history.replaceState({}, '', '/');
    await enterApp(result.user);
  });
});

document.querySelector('#resend-form').addEventListener('submit', event => {
  event.preventDefault();
  submit(event.currentTarget, async data => {
    const result = await api.resendVerification(data.get('email'));
    showAuthView('status', result.message);
  });
});

const deleteDialog = document.querySelector('#delete-account-dialog');
const deleteForm = document.querySelector('#delete-account-form');
document.querySelector('#delete-account-button').addEventListener('click', () => {
  deleteForm.reset();
  document.querySelector('#delete-account-error').textContent = '';
  deleteDialog.showModal();
});
deleteDialog.addEventListener('close', () => { deleteForm.reset(); document.querySelector('#delete-account-error').textContent = ''; });
deleteDialog.addEventListener('cancel', event => { if (deleteForm.dataset.busy === 'true') event.preventDefault(); });
deleteDialog.addEventListener('click', event => {
  if (event.target === deleteDialog && deleteForm.dataset.busy === 'true') event.stopImmediatePropagation();
}, true);
deleteForm.addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.querySelector('#delete-account-password').value;
  const confirmation = document.querySelector('#delete-account-confirmation').value;
  const acknowledged = document.querySelector('#delete-account-acknowledged').checked;
  const errorElement = document.querySelector('#delete-account-error');
  if (!password || confirmation !== '注销' || !acknowledged) {
    errorElement.textContent = '请输入当前密码、填写“注销”并确认删除后果';
    errorElement.focus();
    return;
  }
  await runWithFormBusy(deleteForm, async () => {
    errorElement.textContent = '';
    try {
      await api.deleteAccount({ password, confirmation, acknowledged });
      clearAuthenticatedState('账号已注销，在线数据已删除。所有设备的原登录均已失效。');
    } catch (error) {
      document.querySelector('#delete-account-password').value = '';
      errorElement.textContent = error.code === 'NETWORK_ERROR' ? '暂时无法确认注销结果，请恢复网络后重新登录核实，或联系我们。' : error.message;
      errorElement.focus();
    }
  });
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  const button = document.querySelector('#logout-button');
  button.disabled = true;
  try {
    await api.logout();
    activeRepository?.clear();
    window.location.reload();
  } catch (error) {
    document.querySelector('#logout-error').textContent = `退出未完成：${error.message}。请重试。`;
    button.disabled = false;
  }
});

async function bootstrap() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (url.pathname.endsWith('/verify-email') && token) {
    try {
      const result = await api.verifyEmail(token);
      history.replaceState({}, '', '/');
      await enterApp(result.user);
    } catch (error) {
      showAuthView('login');
      authError.textContent = error.message;
    }
    return;
  }
  if (url.pathname.endsWith('/reset-password') && token) {
    resetToken = token;
    showAuthView('reset');
    return;
  }
  try {
    const result = await api.getCurrentUser();
    await enterApp(result.user);
  } catch (error) {
    showAuthView('login');
    if (error.code !== 'AUTH_REQUIRED') authError.textContent = error.message;
  }
}

bootstrap();
