import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('认证页面包含完整账号流程和无障碍错误区域', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const fragment of [
    'id="auth-shell"', 'id="login-form"', 'id="register-form"',
    'id="forgot-form"', 'id="reset-form"', 'id="auth-error"',
    'role="alert"', 'tabindex="-1"', 'id="account-email"', 'id="logout-button"',
    'src="./src/auth-ui.js"',
  ]) assert.ok(html.includes(fragment), `缺少认证界面片段：${fragment}`);
});

test('登录后的云端账号不会自动写入演示应收数据', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('seedExamples();'));
});

test('认证脚本覆盖验证链接、重置链接和登录后加载应用', async () => {
  const source = await readFile(new URL('../src/auth-ui.js', import.meta.url), 'utf8');
  for (const fragment of [
    "searchParams.get('token')", 'verifyEmail', 'resetPassword',
    "import('./app.js')", 'getCurrentUser', 'logout',
  ]) assert.ok(source.includes(fragment), `缺少认证流程：${fragment}`);
});
