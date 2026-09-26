import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from '../src/api-client.js';

test('每个请求都使用同源 Cookie 并发送 JSON', async () => {
  const calls = [];
  const api = createApiClient(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ user: { id: 'u1' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });

  await api.login({ email: 'owner@example.com', password: 'password' });
  assert.equal(calls[0].url, '/api/auth/login');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
});

test('服务端错误映射为带稳定代码的错误', async () => {
  const api = createApiClient(async () => new Response(JSON.stringify({
    error: { code: 'AUTH_REQUIRED', message: '请先登录' },
  }), { status: 401, headers: { 'content-type': 'application/json' } }));

  await assert.rejects(api.getCurrentUser(), (error) => (
    error.code === 'AUTH_REQUIRED' && error.message === '请先登录' && error.status === 401
  ));
});

test('登录会话失效时通知认证界面接管', async () => {
  let authRequiredCount = 0;
  const api = createApiClient(async () => new Response(JSON.stringify({
    error: { code: 'AUTH_REQUIRED', message: '请先登录' },
  }), { status: 401, headers: { 'content-type': 'application/json' } }), {
    onAuthRequired: () => { authRequiredCount += 1; },
  });

  await assert.rejects(api.listReceivables(), (error) => error.code === 'AUTH_REQUIRED');
  assert.equal(authRequiredCount, 1);
});

test('网络异常转换为可理解且可重试的错误', async () => {
  const api = createApiClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.getCurrentUser(), (error) => (
    error.code === 'NETWORK_ERROR' && error.message.includes('网络')
  ));
});

test('删除应收使用版本号避免覆盖其他设备的数据', async () => {
  const calls = [];
  const api = createApiClient(async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 204 });
  });

  await api.deleteReceivable('rec-1', 3);
  assert.equal(calls[0].url, '/api/receivables/rec-1');
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(calls[0].options.body, JSON.stringify({ version: 3 }));
});
