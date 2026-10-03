import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDb, createDb, setDb } from './db/client.js';
import { runMigrations, type SqlExecutor } from './db/migrate.js';
import { logger } from './lib/logger.js';
import { closeRedis, getRedis } from './lib/redis.js';
import { ensureBootstrapAdmin } from './services/auth.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';

async function main() {
  const { db, client } = createDb();
  setDb({ db, client });

  const ex: SqlExecutor = {
    exec: (sql) => client.unsafe(sql),
    queryRows: async (sql) => ({ rows: (await client.unsafe(sql)) as any[] }),
  };
  const applied = await runMigrations(ex);
  if (applied.length > 0) logger.info({ applied }, 'migrations applied');

  await ensureBootstrapAdmin();

  try {
    await getRedis().ping();
  } catch (err) {
    logger.error({ err }, 'Redis unavailable — quota enforcement will fail closed');
  }

  const app = await buildApp();
  startJobs();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    await app.close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.env.PORT, host: '0.0.0.0' });
  logger.info({ port: config.env.PORT }, 'gateway listening');
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
