import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createPool } from '../../server/db/pool.js';

test('account deletion migration upgrades existing audit rows without losing users or events', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const schema = `deletion_migration_${crypto.randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    const directory = new URL('../../server/db/migrations/', import.meta.url);
    for (const filename of (await readdir(directory)).filter(name => /^00[1-5]_.*\.sql$/.test(name)).sort()) {
      await client.query(await readFile(new URL(filename, directory), 'utf8'));
    }
    const actor = crypto.randomUUID();
    const target = crypto.randomUUID();
    await client.query("INSERT INTO users(id,email,email_normalized,password_hash) VALUES ($1,'a@example.test','a@example.test','placeholder'),($2,'b@example.test','b@example.test','placeholder')", [actor, target]);
    await client.query("INSERT INTO admin_actions(actor_user_id,target_user_id,action) VALUES ($1,$2,'enable_user')", [actor, target]);
    await client.query('SAVEPOINT old_constraint');
    await assert.rejects(client.query('DELETE FROM users WHERE id=$1', [target]), error => error.code === '23503');
    await client.query('ROLLBACK TO SAVEPOINT old_constraint');
    await client.query(await readFile(new URL('006_account_deletion_audit.sql', directory), 'utf8'));
    assert.equal(Number((await client.query('SELECT count(*) FROM users')).rows[0].count), 2);
    assert.deepEqual((await client.query('SELECT actor_user_id,target_user_id,action FROM admin_actions')).rows, [{ actor_user_id: actor, target_user_id: target, action: 'enable_user' }]);
    await client.query('DELETE FROM users WHERE id=$1', [target]);
    assert.deepEqual((await client.query('SELECT actor_user_id,target_user_id,action FROM admin_actions')).rows, [{ actor_user_id: actor, target_user_id: null, action: 'enable_user' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
