import { withTransaction } from '../db/pool.js';

function asNumber(value) {
  return Number(value ?? 0);
}

function asIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    createdAt: asIsoString(row.created_at),
    emailVerified: Boolean(row.email_verified_at),
    disabled: Boolean(row.disabled_at),
    receivableCount: asNumber(row.receivable_count),
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function buildFilters({ query, status }) {
  const clauses = [];
  const params = [];
  if (query) {
    params.push(`%${escapeLike(query)}%`);
    clauses.push(`LOWER(users.email) LIKE LOWER($${params.length}) ESCAPE '\\'`);
  }
  if (status === 'active') clauses.push('users.disabled_at IS NULL');
  if (status === 'disabled') clauses.push('users.disabled_at IS NOT NULL');
  if (status === 'verified') clauses.push('users.email_verified_at IS NOT NULL');
  if (status === 'unverified') clauses.push('users.email_verified_at IS NULL');
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export function createAdminRepository(pool) {
  return {
    async getSummary() {
      const result = await pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
          COUNT(*) FILTER (WHERE email_verified_at IS NULL) AS unverified,
          COUNT(*) FILTER (WHERE disabled_at IS NOT NULL) AS disabled
        FROM users
      `);
      const row = result.rows[0] ?? {};
      return {
        total: asNumber(row.total),
        verified: asNumber(row.verified),
        unverified: asNumber(row.unverified),
        disabled: asNumber(row.disabled),
      };
    },

    async listUsers({ page, pageSize, query = '', status = 'all' }) {
      const { where, params } = buildFilters({ query, status });
      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM users ${where}`,
        params,
      );
      const offset = (page - 1) * pageSize;
      const listParams = [...params, pageSize, offset];
      const result = await pool.query(
        `SELECT
           users.id,
           users.email,
           users.email_verified_at,
           users.disabled_at,
           users.created_at,
           COUNT(receivables.id) FILTER (WHERE receivables.deleted_at IS NULL) AS receivable_count
         FROM users
         LEFT JOIN receivables ON receivables.user_id = users.id
         ${where}
         GROUP BY users.id
         ORDER BY users.created_at DESC, users.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams,
      );
      return {
        users: result.rows.map(mapUser),
        total: asNumber(countResult.rows[0]?.total),
        page,
        pageSize,
      };
    },

    async setUserDisabled({ actorUserId, targetUserId, disabled, now = new Date() }) {
      return withTransaction(pool, async (client) => {
        const existingResult = await client.query(
          `SELECT id, email, email_verified_at, disabled_at, created_at
           FROM users
           WHERE id = $1
           FOR UPDATE`,
          [targetUserId],
        );
        let row = existingResult.rows[0];
        if (!row) {
          const error = new Error('用户不存在');
          error.code = 'USER_NOT_FOUND';
          throw error;
        }

        const alreadyInState = Boolean(row.disabled_at) === disabled;
        if (!alreadyInState) {
          const updated = await client.query(
            `UPDATE users
             SET disabled_at = CASE WHEN $2 THEN $3::timestamptz ELSE NULL END,
                 updated_at = $3
             WHERE id = $1
             RETURNING id, email, email_verified_at, disabled_at, created_at`,
            [targetUserId, disabled, now],
          );
          row = updated.rows[0];
          if (disabled) {
            await client.query('DELETE FROM sessions WHERE user_id = $1', [targetUserId]);
          }
          await client.query(
            `INSERT INTO admin_actions (actor_user_id, target_user_id, action)
             VALUES ($1, $2, $3)`,
            [actorUserId, targetUserId, disabled ? 'disable_user' : 'enable_user'],
          );
        }

        const receivableCount = await client.query(
          `SELECT COUNT(*) AS count
           FROM receivables
           WHERE user_id = $1 AND deleted_at IS NULL`,
          [targetUserId],
        );
        return {
          changed: !alreadyInState,
          user: mapUser({ ...row, receivable_count: receivableCount.rows[0]?.count }),
        };
      });
    },
  };
}
