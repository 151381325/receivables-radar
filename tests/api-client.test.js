import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from '../src/api-client.js';

test('账号注销只提交当前账号校验信息，接受204无响应体', async () => {
  let received;
  const api = createApiClient(async (url, options) => { received = { url, options }; return new Response(null, { status: 204 }); });
  await api.deleteAccount({ password: 'isolated input', confirmation: '注销', acknowledged: true });
  assert.equal(received.url, '/api/account');
  assert.equal(received.options.method, 'DELETE');
  assert.deepEqual(JSON.parse(received.options.body), { password: 'isolated input', confirmation: '注销', acknowledged: true });
});

test('旧会话迟到的401不能触发新账号的认证失效回调', async () => {
  let generation = 0;
  let finish;
  let authFailures = 0;
  const api = createApiClient(() => new Promise(resolve => { finish = resolve; }), {
    getSessionGeneration: () => generation,
    onAuthRequired: () => { authFailures++; },
  });
  const oldRequest = api.listReceivables();
  generation++;
  finish(new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: '请先登录' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(oldRequest, error => error.code === 'SESSION_CHANGED');
  assert.equal(authFailures, 0);
});

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
  assert.equal(calls[0].options.cache, 'no-store');
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

test('管理员客户端安全编码查询条件并更新账号状态', async () => {
  const calls = [];
  const api = createApiClient(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.includes('/status')
      ? { changed: true, user: { id: 'user/1', disabled: true } }
      : { users: [], pagination: { page: 2, pageSize: 50, total: 0, totalPages: 0 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });

  await api.listAdminUsers({ page: 2, pageSize: 50, status: 'unverified', query: 'a+b@example.com' });
  await api.setAdminUserDisabled('user/1', true);

  assert.equal(calls[0].url, '/api/admin/users?page=2&pageSize=50&status=unverified&query=a%2Bb%40example.com');
  assert.equal(calls[1].url, '/api/admin/users/user%2F1/status');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(calls[1].options.body, JSON.stringify({ disabled: true }));
});

test('导入记录中的特殊 ID 在全部修改接口中安全编码', async () => {
  const paths = [];
  const api = createApiClient(async (url) => { paths.push(url); return new Response(JSON.stringify({ record: { id: 'r/a#1' } }), { headers: { 'content-type': 'application/json' } }); });
  await api.updateReceivable('r/a#1', {});
  await api.addPayment('r/a#1', {});
  await api.addFollowUp('r/a#1', {});
  await api.deleteReceivable('r/a#1', 1);
  assert.deepEqual(paths, ['/api/receivables/r%2Fa%231', '/api/receivables/r%2Fa%231/payments', '/api/receivables/r%2Fa%231/follow-ups', '/api/receivables/r%2Fa%231']);
});
