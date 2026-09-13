import { withTransaction } from '../db/pool.js';
import { fenToYuan, yuanToFen } from './money.js';

function staleVersionError() {
  const error = new Error('记录已在其他设备更新');
  error.code = 'STALE_VERSION';
  return error;
}

function mapReceivable(row, payments = [], followUps = []) {
  if (!row) return null;
  return {
    id: row.id, clientName: row.client_name, projectName: row.project_name,
    totalAmount: fenToYuan(Number(row.total_amount_fen)), invoiceSent: row.invoice_sent,
    dueDate: row.due_date.toISOString().slice(0, 10),
    nextFollowUpDate: row.next_follow_up_date?.toISOString().slice(0, 10) ?? null,
    paused: row.paused, notes: row.notes, version: row.version,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    paymentRecords: payments.map((item) => ({ id: item.id, amount: fenToYuan(Number(item.amount_fen)), paidAt: item.paid_at.toISOString().slice(0, 10), method: item.method, notes: item.notes })),
    followUpRecords: followUps.map((item) => ({ id: item.id, followedAt: item.followed_at.toISOString().slice(0, 10), result: item.result, promiseDate: item.promise_date?.toISOString().slice(0, 10) ?? null, nextFollowUpDate: item.next_follow_up_date?.toISOString().slice(0, 10) ?? null })),
  };
}

async function hydrate(client, userId, row) {
  if (!row) return null;
  const [payments, followUps] = await Promise.all([
    client.query('SELECT * FROM payments WHERE user_id = $1 AND receivable_id = $2 ORDER BY created_at', [userId, row.id]),
    client.query('SELECT * FROM follow_ups WHERE user_id = $1 AND receivable_id = $2 ORDER BY created_at', [userId, row.id]),
  ]);
  return mapReceivable(row, payments.rows, followUps.rows);
}

export function createReceivableRepository(pool) {
  async function current(client, userId, id) {
    const result = await client.query('SELECT * FROM receivables WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL', [userId, id]);
    return result.rows[0] ?? null;
  }
  async function listWithClient(client, userId) {
    const result = await client.query('SELECT * FROM receivables WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC', [userId]);
    return Promise.all(result.rows.map((row) => hydrate(client, userId, row)));
  }
  return {
    async list(userId) {
      return listWithClient(pool, userId);
    },
    async create(userId, record) {
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `INSERT INTO receivables (id,user_id,client_name,project_name,total_amount_fen,invoice_sent,due_date,next_follow_up_date,paused,notes,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [record.id, userId, record.clientName, record.projectName, yuanToFen(record.totalAmount), record.invoiceSent, record.dueDate, record.nextFollowUpDate, record.paused, record.notes, record.createdAt, record.updatedAt ?? record.createdAt],
        );
        return hydrate(client, userId, result.rows[0]);
      });
    },
    async update(userId, id, version, record) {
      return withTransaction(pool, async (client) => {
        const existing = await current(client, userId, id);
        if (!existing) return null;
        if (existing.version !== version) throw staleVersionError();
        const result = await client.query(
          `UPDATE receivables SET client_name=$4,project_name=$5,total_amount_fen=$6,invoice_sent=$7,due_date=$8,next_follow_up_date=$9,paused=$10,notes=$11,version=version+1,updated_at=now()
           WHERE user_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL RETURNING *`,
          [userId, id, version, record.clientName, record.projectName, yuanToFen(record.totalAmount), record.invoiceSent, record.dueDate, record.nextFollowUpDate, record.paused, record.notes],
        );
        if (!result.rows[0]) throw staleVersionError();
        return hydrate(client, userId, result.rows[0]);
      });
    },
    async addPayment(userId, id, version, payment) {
      return withTransaction(pool, async (client) => {
        const existing = await current(client, userId, id);
        if (!existing) return null;
        if (existing.version !== version) throw staleVersionError();
        const paid = await client.query('SELECT COALESCE(SUM(amount_fen), 0) AS amount FROM payments WHERE user_id=$1 AND receivable_id=$2', [userId, id]);
        if (Number(paid.rows[0].amount) + yuanToFen(payment.amount) > Number(existing.total_amount_fen)) throw new Error('到账金额不能超过剩余金额');
        await client.query('INSERT INTO payments (id,receivable_id,user_id,amount_fen,paid_at,method,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [payment.id, id, userId, yuanToFen(payment.amount), payment.paidAt, payment.method, payment.notes]);
        const updated = await client.query('UPDATE receivables SET version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [userId, id]);
        return hydrate(client, userId, updated.rows[0]);
      });
    },
    async addFollowUp(userId, id, version, followUp) {
      return withTransaction(pool, async (client) => {
        const existing = await current(client, userId, id);
        if (!existing) return null;
        if (existing.version !== version) throw staleVersionError();
        await client.query('INSERT INTO follow_ups (id,receivable_id,user_id,followed_at,result,promise_date,next_follow_up_date) VALUES ($1,$2,$3,$4,$5,$6,$7)', [followUp.id, id, userId, followUp.followedAt, followUp.result, followUp.promiseDate, followUp.nextFollowUpDate]);
        const updated = await client.query('UPDATE receivables SET next_follow_up_date=$3,version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [userId, id, followUp.nextFollowUpDate]);
        return hydrate(client, userId, updated.rows[0]);
      });
    },
    async removePayment(userId, id, paymentId, version) {
      return withTransaction(pool, async (client) => {
        const existing = await current(client, userId, id);
        if (!existing) return null;
        if (existing.version !== version) throw staleVersionError();
        const removed = await client.query('DELETE FROM payments WHERE user_id=$1 AND receivable_id=$2 AND id=$3 RETURNING id', [userId, id, paymentId]);
        if (!removed.rows[0]) return null;
        const updated = await client.query('UPDATE receivables SET version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *', [userId, id]);
        return hydrate(client, userId, updated.rows[0]);
      });
    },
    async softDelete(userId, id, version) {
      return withTransaction(pool, async (client) => {
        const existing = await current(client, userId, id);
        if (!existing) return null;
        if (existing.version !== version) throw staleVersionError();
        await client.query('UPDATE receivables SET deleted_at=now(),version=version+1,updated_at=now() WHERE user_id=$1 AND id=$2', [userId, id]);
        return true;
      });
    },
    async importRecords(userId, records) {
      return withTransaction(pool, async (client) => {
        let importedCount = 0; let skippedCount = 0;
        for (const record of records) {
          const exists = await client.query('SELECT 1 FROM receivables WHERE user_id=$1 AND id=$2', [userId, record.id]);
          if (exists.rows[0]) { skippedCount += 1; continue; }
          const createdAt = record.createdAt ?? new Date().toISOString();
          const updatedAt = record.updatedAt ?? createdAt;
          await client.query(`INSERT INTO receivables (id,user_id,client_name,project_name,total_amount_fen,invoice_sent,due_date,next_follow_up_date,paused,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [record.id,userId,record.clientName,record.projectName,yuanToFen(record.totalAmount),record.invoiceSent,record.dueDate,record.nextFollowUpDate,record.paused,record.notes,createdAt,updatedAt]);
          for (const payment of record.paymentRecords ?? []) {
            await client.query('INSERT INTO payments (id,receivable_id,user_id,amount_fen,paid_at,method,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [payment.id, record.id, userId, yuanToFen(payment.amount), payment.paidAt, payment.method, payment.notes ?? '']);
          }
          for (const followUp of record.followUpRecords ?? []) {
            await client.query('INSERT INTO follow_ups (id,receivable_id,user_id,followed_at,result,promise_date,next_follow_up_date) VALUES ($1,$2,$3,$4,$5,$6,$7)', [followUp.id, record.id, userId, followUp.followedAt, followUp.result, followUp.promiseDate ?? null, followUp.nextFollowUpDate ?? null]);
          }
          importedCount += 1;
        }
        return { importedCount, skippedCount, records: await listWithClient(client, userId) };
      });
    },
  };
}
