import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { getQuotaService } from '../services/quota.js';
import { reconciliation } from '../services/reconciliation.js';

let timers: NodeJS.Timeout[] = [];

/**
 * Background jobs:
 *  - quota reconciliation against Mimo (every SYNC_INTERVAL_SECONDS)
 *  - expired reservation reaper (every 30s)
 */
export function startJobs() {
  stopJobs();

  const syncMs = config.env.SYNC_INTERVAL_SECONDS * 1000;
  timers.push(
    setInterval(() => {
      reconciliation
        .syncAll()
        .then((results) => logger.debug({ count: results.length }, 'quota sync complete'))
        .catch((err) => logger.warn({ err }, 'quota sync failed'));
    }, syncMs),
  );

  timers.push(
    setInterval(() => {
      getQuotaService()
        .reapExpired()
        .then((n) => {
          if (n > 0) logger.info({ reaped: n }, 'expired reservations reclaimed');
        })
        .catch((err) => logger.warn({ err }, 'reservation reap failed'));
    }, 30_000),
  );

  for (const t of timers) t.unref?.();
}

export function stopJobs() {
  for (const t of timers) clearInterval(t);
  timers = [];
}
