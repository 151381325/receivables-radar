import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { registerAdminRoutes } from '../../server/routes/admin.js';

async function createApp({ user, repository }) {
  const app = Fastify();
  app.decorateRequest('user', null);
  const authenticate = async (request, reply) => {
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED' } });
    }
    request.user = user;
  };
  await registerAdminRoutes(app, { repository, authenticate });
  await app.ready();
  return app;
}

const repository = {
  getSummary: async () => ({ total: 4, verified: 3, unverified: 1, disabled: 1 }),
  listUsers: async (options) => ({
    users: [], total: 0, page: options.page, pageSize: options.pageSize,
  }),
};

test('管理员接口先要求登录再校验管理员身份', async () => {
  const anonymous = await createApp({ user: null, repository });
  const anonymousResponse = await anonymous.inject({ method: 'GET', url: '/api/admin/summary' });
  assert.equal(anonymousResponse.statusCode, 401);
  await anonymous.close();

  const regular = await createApp({
    user: { id: 'regular', email: 'regular@example.com', isAdmin: false }, repository,
  });
  const regularResponse = await regular.inject({ method: 'GET', url: '/api/admin/summary' });
  assert.equal(regularResponse.statusCode, 403);
  assert.equal(regularResponse.json().error.code, 'ADMIN_REQUIRED');
  await regular.close();
});

test('管理员可以读取统计和参数化用户列表', async () => {
  const calls = [];
  const trackedRepository = {
    ...repository,
    listUsers: async (options) => {
      calls.push(options);
      return { users: [], total: 0, page: options.page, pageSize: options.pageSize };
    },
  };
  const app = await createApp({
    user: { id: 'admin', email: 'admin@example.com', isAdmin: true },
    repository: trackedRepository,
  });

  const summary = await app.inject({ method: 'GET', url: '/api/admin/summary' });
  assert.equal(summary.statusCode, 200);
  assert.deepEqual(summary.json(), { summary: await repository.getSummary() });

  const list = await app.inject({
    method: 'GET',
    url: '/api/admin/users?page=2&pageSize=50&status=disabled&query=owner%40example.com',
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(calls, [{ page: 2, pageSize: 50, status: 'disabled', query: 'owner@example.com' }]);
  assert.deepEqual(list.json().pagination, { page: 2, pageSize: 50, total: 0, totalPages: 0 });
  await app.close();
});

test('用户列表拒绝越界分页和未知状态', async () => {
  const app = await createApp({
    user: { id: 'admin', email: 'admin@example.com', isAdmin: true }, repository,
  });

  for (const url of [
    '/api/admin/users?page=0',
    '/api/admin/users?pageSize=10',
    '/api/admin/users?status=unknown',
    `/api/admin/users?query=${'a'.repeat(255)}`,
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  }
  await app.close();
});

test('管理员可以停用其他账号但不能停用自己', async () => {
  const calls = [];
  const trackedRepository = {
    ...repository,
    setUserDisabled: async (options) => {
      calls.push(options);
      return {
        changed: true,
        user: {
          id: options.targetUserId, email: 'member@example.com', createdAt: '2026-08-01T00:00:00.000Z',
          emailVerified: true, disabled: options.disabled, receivableCount: 1,
        },
      };
    },
  };
  const app = await createApp({
    user: { id: 'admin', email: 'admin@example.com', isAdmin: true }, repository: trackedRepository,
  });

  const response = await app.inject({
    method: 'PATCH', url: '/api/admin/users/member/status', payload: { disabled: true },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0], {
    actorUserId: 'admin', targetUserId: 'member', disabled: true,
  });

  const self = await app.inject({
    method: 'PATCH', url: '/api/admin/users/admin/status', payload: { disabled: true },
  });
  assert.equal(self.statusCode, 400);
  assert.equal(self.json().error.code, 'SELF_DISABLE_FORBIDDEN');

  const invalid = await app.inject({
    method: 'PATCH', url: '/api/admin/users/member/status', payload: { disabled: 'yes' },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});
