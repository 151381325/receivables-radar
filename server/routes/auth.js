import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

import { createAccountRepository } from '../auth/account-repository.js';
import { hashOpaqueToken } from '../auth/crypto.js';
import { createSessionService } from '../auth/session-service.js';
import { withTransaction } from '../db/pool.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const LOGIN_ERROR = {
  error: { code: 'LOGIN_FAILED', message: '邮箱或密码不正确，或账号尚不可用' },
};
const RESET_ACCEPTED = { message: '如果该邮箱已注册，重置邮件将很快发送' };
const dummyPasswordHash = argon2.hash(randomBytes(32).toString('base64url'), {
  type: argon2.argon2id,
});

function validationError(reply, message) {
  return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message } });
}

export async function registerAuthRoutes(app, { config, pool, mailer, clock }) {
  const accounts = createAccountRepository(pool);
  const sessions = createSessionService(pool, config);

  app.post('/api/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return validationError(reply, '请输入有效邮箱');
    }
    if (password.length < 10 || password.length > 128) {
      return validationError(reply, '密码长度应为10至128个字符');
    }
    if (request.body?.acceptedTerms !== true) {
      return validationError(reply, '请先阅读并同意用户协议与隐私政策');
    }

    let user;
    try {
      user = await accounts.createUser({
        email,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      });
    } catch (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error: { code: 'EMAIL_EXISTS', message: '该邮箱已注册' },
        });
      }
      throw error;
    }

    const token = randomBytes(32).toString('base64url');
    await accounts.createEmailToken({
      userId: user.id,
      purpose: 'verify_email',
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(clock().getTime() + TOKEN_LIFETIME_MS),
    });
    try {
      await mailer.sendVerification({ email: user.email, token });
    } catch (error) {
      await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
      throw error;
    }
    return reply.code(201).send({ message: '验证邮件已发送，请检查邮箱' });
  });

  app.post('/api/auth/verify-email', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = typeof request.body?.token === 'string' ? request.body.token.trim() : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return reply.code(400).send({
        error: { code: 'TOKEN_INVALID', message: '验证链接无效或已过期' },
      });
    }

    const now = clock();
    const result = await withTransaction(pool, async (client) => {
      const transactionAccounts = createAccountRepository(client);
      const consumed = await transactionAccounts.consumeEmailToken({
        purpose: 'verify_email', tokenHash: hashOpaqueToken(token), now,
      });
      if (!consumed) return null;
      const user = await transactionAccounts.markEmailVerified(consumed.userId, now);
      const transactionSessions = createSessionService(client, config);
      const session = await transactionSessions.createSession(user.id, now);
      return { user, session };
    });

    if (!result) {
      return reply.code(400).send({
        error: { code: 'TOKEN_INVALID', message: '验证链接无效或已过期' },
      });
    }
    reply.setCookie(sessions.cookieName, result.session.token, {
      ...sessions.cookieOptions,
      expires: result.session.expiresAt,
    });
    return reply.send({
      user: { id: result.user.id, email: result.user.email, emailVerified: true },
    });
  });

  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const user = email ? await accounts.findUserByEmail(email) : null;
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? await dummyPasswordHash,
      password || 'invalid-password',
    ).catch(() => false);
    if (!user || !passwordMatches || !user.emailVerifiedAt || user.disabledAt) {
      return reply.code(401).send(LOGIN_ERROR);
    }

    await sessions.destroySession(request.cookies[sessions.cookieName]);
    const session = await sessions.createSession(user.id, clock());
    reply.setCookie(sessions.cookieName, session.token, {
      ...sessions.cookieOptions,
      expires: session.expiresAt,
    });
    return reply.send({
      user: { id: user.id, email: user.email, emailVerified: true },
    });
  });

  app.post('/api/auth/request-password-reset', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
    const user = email ? await accounts.findUserByEmail(email) : null;
    if (user?.emailVerifiedAt && !user.disabledAt) {
      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashOpaqueToken(token);
      await accounts.createEmailToken({
        userId: user.id,
        purpose: 'reset_password',
        tokenHash,
        expiresAt: new Date(clock().getTime() + TOKEN_LIFETIME_MS),
      });
      try {
        await mailer.sendPasswordReset({ email: user.email, token });
      } catch (error) {
        await pool.query('DELETE FROM email_tokens WHERE token_hash = $1', [tokenHash]);
        request.log.error({ err: error, requestId: request.id }, 'password reset email failed');
      }
    }
    return reply.code(202).send(RESET_ACCEPTED);
  });

  app.post('/api/auth/reset-password', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = typeof request.body?.token === 'string' ? request.body.token.trim() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return reply.code(400).send({
        error: { code: 'TOKEN_INVALID', message: '重置链接无效或已过期' },
      });
    }
    if (password.length < 10 || password.length > 128) {
      return validationError(reply, '密码长度应为10至128个字符');
    }

    const now = clock();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const result = await withTransaction(pool, async (client) => {
      const transactionAccounts = createAccountRepository(client);
      const consumed = await transactionAccounts.consumeEmailToken({
        purpose: 'reset_password', tokenHash: hashOpaqueToken(token), now,
      });
      if (!consumed) return null;
      const user = await transactionAccounts.findUserById(consumed.userId);
      if (!user || user.disabledAt) return null;
      await transactionAccounts.replacePassword(user.id, passwordHash, now);
      const transactionSessions = createSessionService(client, config);
      await transactionSessions.destroyAllUserSessions(user.id);
      const session = await transactionSessions.createSession(user.id, now);
      return { user, session };
    });

    if (!result) {
      return reply.code(400).send({
        error: { code: 'TOKEN_INVALID', message: '重置链接无效或已过期' },
      });
    }
    reply.setCookie(sessions.cookieName, result.session.token, {
      ...sessions.cookieOptions,
      expires: result.session.expiresAt,
    });
    return reply.send({
      user: { id: result.user.id, email: result.user.email, emailVerified: true },
    });
  });
}
