import { readdir, readFile } from 'node:fs/promises';

import { loadConfig } from '../config.js';
import { createPool, withTransaction } from './pool.js';

const defaultMigrationsUrl = new URL('./migrations/', import.meta.url);

export async function runMigrations(pool, migrationsUrl = defaultMigrationsUrl) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const filenames = (await readdir(migrationsUrl))
    .filter((filename) => /^\d+.*\.sql$/.test(filename))
    .sort();

  const appliedResult = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((row) => row.filename));

  for (const filename of filenames) {
    if (applied.has(filename)) continue;
    const sql = await readFile(new URL(filename, migrationsUrl), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename],
      );
    });
  }

  return filenames.filter((filename) => !applied.has(filename));
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
