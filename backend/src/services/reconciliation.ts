import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { mimoAccounts, usageLogs } from '../db/schema.js';
import { mimoAccounts$ } from './mimo-accounts.js';

/**
 * Background reconciliation: pull official usage from Mimo (when the endpoint
 * is configured), compare against local usage, persist the delta, and refresh
 * sync status. Local rows are never modified by this job.
 */
export class ReconciliationService {
  constructor(private readonly accounts = mimoAccounts$) {}

  async syncAll() {
    const all = await getDb().select().from(mimoAccounts).where(eq(mimoAccounts.status, 'active'));
    const results = [];
    for (const account of all) {
      results.push(await this.accounts.syncAccount(account.id));
    }
    return results;
  }

  /** Sum of locally recorded usage for every account. */
  async localUsageByAccount(): Promise<Record<string, number>> {
    const rows = await getDb()
      .select({
        accountId: usageLogs.accountId,
        total: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)`,
      })
      .from(usageLogs)
      .groupBy(usageLogs.accountId);
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.accountId) out[r.accountId] = Number(r.total ?? 0);
    }
    return out;
  }

  /** Compare local vs official for the dashboard reconciliation panel. */
  async report() {
    const accounts = await getDb().select().from(mimoAccounts);
    const local = await this.localUsageByAccount();
    return accounts.map((a) => {
      const localUsed = local[a.id] ?? 0;
      const official = a.usedQuota;
      return {
        accountId: a.id,
        label: a.label,
        localUsage: localUsed,
        officialUsage: official,
        difference: official !== null && official !== undefined ? localUsed - official : null,
        lastSyncAt: a.lastSyncAt,
        lastSyncStatus: a.lastSyncStatus,
        configured: official !== null && official !== undefined,
      };
    });
  }
}

export const reconciliation = new ReconciliationService();
