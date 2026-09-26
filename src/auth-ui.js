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

const api = createApiClient(globalThis.fetch, {
  onAuthRequired: () => {
    if (appShell.hidden) return;
    appLoaded = false;
    appShell.hidden = true;
    authShell.hidden = false;
    document.querySelector('#account-email').textContent = '';
    showAuthView('login');
    authError.textContent = '登录已过期，请重新登录';
    authError.focus();
  },
});

const viewCopy = {
  login: ['欢迎回来', '登录后，电脑和手机上的回款记录会保持一致。'],
  register: ['创建账号', '一个账号，在电脑和手机上都能安心跟进回款。'],
  forgot: ['找回密码', '输入注册邮箱，我们会发送一封限时重置邮件。'],
  reset: ['设置新密码', '新密码保存后，其他设备上的旧登录会自动失效。'],
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
  document.querySelector('#account-email').textContent = user.email;
  if (!appLoaded) {
    const { startApp } = await import('./app.js');
    await startApp(createCloudRepository(api));
    appLoaded = true;
  }
  authShell.hidden = true;
  appShell.hidden = false;
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

document.querySelector('#logout-button').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  window.location.reload();
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
