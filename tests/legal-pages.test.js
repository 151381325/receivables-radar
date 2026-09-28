import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const projectUrl = new URL('../', import.meta.url);

async function readProjectFile(path) {
  const url = new URL(path, projectUrl);
  assert.ok(existsSync(url), `缺少公开页面：${path}`);
  return readFile(url, 'utf8');
}

test('注册页提供可点击的用户协议和隐私政策入口', async () => {
  const html = await readProjectFile('index.html');

  assert.match(html, /href="\.\/terms\/"[^>]*>用户协议<\/a>/);
  assert.match(html, /href="\.\/privacy\/"[^>]*>隐私政策<\/a>/);
});

test('全站页脚公示 ICP 备案号并链接工信部备案系统', async () => {
  const html = await readProjectFile('index.html');

  assert.match(html, /class="site-footer"/);
  assert.match(html, /渝ICP备2026023184号-1/);
  assert.match(html, /https:\/\/beian\.miit\.gov\.cn\//);
});

test('用户协议页面公开说明服务边界和用户责任', async () => {
  const html = await readProjectFile('terms/index.html');

  assert.match(html, /用户协议/);
  assert.match(html, /个人应收款管理/);
  assert.match(html, /不构成法律、财税或催收意见/);
  assert.match(html, /2026年9月28日/);
});

test('隐私政策页面说明云端处理、用户权利和账号注销渠道', async () => {
  const html = await readProjectFile('privacy/index.html');

  assert.match(html, /隐私政策/);
  assert.match(html, /中华人民共和国境内/);
  assert.match(html, /导出/);
  assert.match(html, /注销账号/);
  assert.match(html, /151381325@qq\.com/);
  assert.match(html, /2026年9月28日/);
});

test('构建脚本会发布用户协议和隐私政策页面', async () => {
  const source = await readProjectFile('scripts/build.mjs');

  assert.match(source, /terms/);
  assert.match(source, /privacy/);
});
