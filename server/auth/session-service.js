import { randomBytes, randomUUID } from 'node:crypto';

import { hashOpaqueToken } from './crypto.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionService(pool, config) {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  };

  return {
    cookieName: config.sessionCookieName,
    cookieOptions,

    async createSession(userId, now = new Date()) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
      await pool.query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), userId, hashOpaqueToken(token), expiresAt],
      );
      return { token, expiresAt };
    },

    async findUserByToken(token, now = new Date()) {
      if (!token) return null;
      const result = await pool.query(
        `SELECT users.id, users.email, users.email_verified_at
         FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = $1
           AND sessions.expires_at > $2
           AND users.disabled_at IS NULL`,
        [hashOpaqueToken(token), now],
      );
      const row = result.rows[0];
      return row ? {
        id: row.id,
        email: row.email,
        emailVerified: Boolean(row.email_verified_at),
      } : null;
    },

    async destroySession(token) {
      if (!token) return;
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashOpaqueToken(token)]);
    },

    async destroyAllUserSessions(userId) {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    },
  };
}
