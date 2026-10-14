import argon2 from 'argon2';
import { withTransaction } from '../db/pool.js';
import { isAdminEmail } from '../auth/admin-role.js';
import { createSessionService } from '../auth/session-service.js';

function reject(status, code, message) {
  return { status, error: { code, message } };
}

export async function registerAccountRoutes(app, { pool, config, authenticate }) {
  const sessions = createSessionService(pool, config);
  app.delete('/api/account', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if ((request.headers.origin && request.headers.origin !== config.appOrigin)
      || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: { code: 'ORIGIN_REJECTED', message: '请从回款雷达页面操作' } });
    }
    const body = request.body;
    if (!body || Array.isArray(body) || typeof body !== 'object'
      || Object.keys(body).some(key => !['password', 'confirmation', 'acknowledged'].includes(key))
      || typeof body.password !== 'string' || !body.password.length || body.password.length > 128
      || body.confirmation !== '注销' || body.acknowledged !== true) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '请输入当前密码、填写“注销”并确认删除后果' } });
    }
    const result = await withTransaction(pool, async client => {
      // Lock identity and password together: a concurrent password reset cannot race this check.
      const { rows } = await client.query('SELECT id,email,password_hash,disabled_at FROM users WHERE id=$1 FOR UPDATE', [request.user.id]);
      const user = rows[0];
      if (!user || user.disabled_at) return reject(401, 'AUTH_REQUIRED', '请重新登录');
      if (isAdminEmail(user.email, config.adminEmail)) return reject(403, 'ADMIN_DELETION_BLOCKED', '管理员账号不支持自助注销，请通过隐私政策中的联系渠道处理');
      if (!await argon2.verify(user.password_hash, body.password).catch(() => false)) {
        return reject(403, 'PASSWORD_INCORRECT', '当前密码不正确，未注销账号');
      }
      // Dependent online records and sessions cascade; audit identities become NULL.
      await client.query('DELETE FROM users WHERE id=$1', [user.id]);
      return null;
    });
    if (result) return reply.code(result.status).send({ error: result.error });
    reply.clearCookie(sessions.cookieName, sessions.cookieOptions);
    return reply.code(204).send();
  });
}
