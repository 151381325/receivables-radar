import { pathToFileURL } from 'node:url';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createPool } from './db/pool.js';

export async function startServer(env = process.env) {
  const config = loadConfig(env);
  const pool = createPool(config.databaseUrl);
  await runMigrations(pool);
  const app = await buildApp({ config, pool });

  const shutdown = async () => {
    await app.close();
    await pool.end();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ host: config.host, port: config.port });
  return { app, pool };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
