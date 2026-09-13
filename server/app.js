import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

import { createSessionService } from './auth/session-service.js';
import { createAuthenticate } from './plugins/authenticate.js';
import { registerAuthRoutes } from './routes/auth.js';

export async function buildApp({ config, pool, mailer = null, clock = () => new Date() }) {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });
  const sessions = createSessionService(pool, config);
  const authenticate = createAuthenticate(sessions, clock);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest('user', null);

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ({
    user: request.user,
  }));

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[sessions.cookieName];
    await sessions.destroySession(token);
    reply.clearCookie(sessions.cookieName, sessions.cookieOptions);
    return reply.code(204).send();
  });

  if (mailer) {
    await registerAuthRoutes(app, { config, pool, mailer, clock });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后重试' },
      });
    }
    request.log.error({ err: error, requestId: request.id }, 'request failed');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' },
    });
  });

  return app;
}
