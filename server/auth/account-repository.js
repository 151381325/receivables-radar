import { randomUUID } from 'node:crypto';

import { normalizeEmail } from './crypto.js';

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.email_normalized,
    passwordHash: row.password_hash,
    emailVerifiedAt: row.email_verified_at,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAccountRepository(pool) {
  return {
    async createUser({ email, passwordHash }) {
      const cleanEmail = String(email).trim();
      const result = await pool.query(
        `INSERT INTO users (id, email, email_normalized, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [randomUUID(), cleanEmail, normalizeEmail(cleanEmail), passwordHash],
      );
      return mapUser(result.rows[0]);
    },

    async findUserByEmail(email) {
      const result = await pool.query(
        'SELECT * FROM users WHERE email_normalized = $1',
        [normalizeEmail(email)],
      );
      return mapUser(result.rows[0]);
    },

    async findUserById(id) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return mapUser(result.rows[0]);
    },

    async createEmailToken({ userId, purpose, tokenHash, expiresAt }) {
      const result = await pool.query(
        `INSERT INTO email_tokens (id, user_id, purpose, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, purpose, token_hash, expires_at, created_at`,
        [randomUUID(), userId, purpose, tokenHash, expiresAt],
      );
      return result.rows[0];
    },

    async consumeEmailToken({ purpose, tokenHash, now }) {
      const result = await pool.query(
        `UPDATE email_tokens
         SET consumed_at = $3
         WHERE purpose = $1
           AND token_hash = $2
           AND consumed_at IS NULL
           AND expires_at > $3
         RETURNING user_id`,
        [purpose, tokenHash, now],
      );
      return result.rows[0] ? { userId: result.rows[0].user_id } : null;
    },

    async markEmailVerified(userId, now) {
      const result = await pool.query(
        `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, $2), updated_at = $2
         WHERE id = $1
         RETURNING *`,
        [userId, now],
      );
      return mapUser(result.rows[0]);
    },

    async replacePassword(userId, passwordHash, now) {
      const result = await pool.query(
        `UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1 RETURNING *`,
        [userId, passwordHash, now],
      );
      return mapUser(result.rows[0]);
    },

    async disableUser(userId, now) {
      const result = await pool.query(
        `UPDATE users SET disabled_at = $2, updated_at = $2 WHERE id = $1 RETURNING *`,
        [userId, now],
      );
      return mapUser(result.rows[0]);
    },
  };
}
