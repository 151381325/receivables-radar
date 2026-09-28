import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readProjectFile = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('管理页包含汇总、搜索筛选、分页和状态确认界面', async () => {
  const html = await readProjectFile('admin/index.html');
  for (const fragment of [
    'id="admin-summary"', 'id="admin-search-form"', 'id="admin-status-filter"',
    'id="admin-users"', 'id="admin-pagination"', 'id="admin-status-dialog"',
    'src="../src/admin.js"',
  ]) assert.ok(html.includes(fragment), `缺少管理界面片段：${fragment}`);
});

test('管理页只用安全 DOM API 渲染用户数据', async () => {
  const source = await readProjectFile('src/admin.js');
  assert.ok(source.includes('textContent'));
  assert.match(source, /summary\.unverified/);
  assert.doesNotMatch(source, /'可登录'/, '未验证邮箱不能被误标为可登录');
  assert.ok(!source.includes('innerHTML'), '用户数据不得通过 innerHTML 渲染');
  for (const forbidden of ['passwordHash', 'password_hash', 'sessionToken', 'tokenHash']) {
    assert.ok(!source.includes(forbidden), `管理页不得读取敏感字段：${forbidden}`);
  }
});

test('主应用仅向管理员显示用户管理入口', async () => {
  const [html, source] = await Promise.all([
    readProjectFile('index.html'), readProjectFile('src/auth-ui.js'),
  ]);
  assert.match(html, /id="admin-link"[^>]+hidden/);
  assert.match(source, /adminLink\.hidden = !user\.isAdmin/);
});

test('构建脚本发布管理页面', async () => {
  const source = await readProjectFile('scripts/build.mjs');
  assert.match(source, /\.\.\/admin\//);
});
