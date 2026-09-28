import { requireAdmin } from '../plugins/require-admin.js';

const ALLOWED_PAGE_SIZES = new Set([20, 50]);
const ALLOWED_STATUSES = new Set(['all', 'active', 'disabled', 'verified', 'unverified']);

function validationError(reply, message) {
  return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message } });
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

export async function registerAdminRoutes(app, { repository, authenticate }) {
  const preHandler = [authenticate, requireAdmin];

  app.get('/api/admin/summary', {
    preHandler,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async () => ({ summary: await repository.getSummary() }));

  app.get('/api/admin/users', {
    preHandler,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const page = parsePositiveInteger(request.query?.page, 1);
    const pageSize = parsePositiveInteger(request.query?.pageSize, 20);
    const status = typeof request.query?.status === 'string' ? request.query.status : 'all';
    const query = typeof request.query?.query === 'string' ? request.query.query.trim() : '';
    if (page === null) return validationError(reply, '页码必须为正整数');
    if (!ALLOWED_PAGE_SIZES.has(pageSize)) return validationError(reply, '每页数量只支持20或50');
    if (!ALLOWED_STATUSES.has(status)) return validationError(reply, '账号状态无效');
    if (query.length > 254) return validationError(reply, '搜索内容不能超过254个字符');

    const result = await repository.listUsers({ page, pageSize, status, query });
    return {
      users: result.users,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / result.pageSize),
      },
    };
  });

  app.patch('/api/admin/users/:id/status', {
    preHandler,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const disabled = request.body?.disabled;
    if (typeof disabled !== 'boolean') {
      return validationError(reply, 'disabled 必须为布尔值');
    }
    if (disabled && request.params.id === request.user.id) {
      return reply.code(400).send({
        error: { code: 'SELF_DISABLE_FORBIDDEN', message: '不能停用当前管理员账号' },
      });
    }
    try {
      return await repository.setUserDisabled({
        actorUserId: request.user.id,
        targetUserId: request.params.id,
        disabled,
      });
    } catch (error) {
      if (error.code === 'USER_NOT_FOUND') {
        return reply.code(404).send({
          error: { code: 'USER_NOT_FOUND', message: '用户不存在' },
        });
      }
      throw error;
    }
  });
}
