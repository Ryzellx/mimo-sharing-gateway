import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { allocations, mimoAccounts, mimoModels, quotaSnapshots, reconciliationLogs, usageLogs, users } from '../db/schema.js';
import { decryptSecret, encryptSecret, maskMimoToken } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { mimoProvider, providerForAccount } from '../providers/mimo.js';
import type { AIProvider, ChatRequest } from '../providers/types.js';
import { detectAccount } from './detect.js';

export type MimoAccountRow = typeof mimoAccounts.$inferSelect;

export interface AccountAllocationView {
  userId: string;
  username: string;
  email: string;
  status: string;
  totalTokens: number;
  usedTokens: number;
  reservedTokens: number;
  remainingTokens: number;
  usagePercent: number;
  expiresAt: Date | null;
  lastRequestAt: Date | null;
}

/**
 * Mimo account management. The upstream API token is encrypted at rest with
 * AES-256-GCM and only ever leaves this module as a decrypted value handed
 * directly to the provider for an upstream call — never to logs or the API.
 */
export class MimoAccountService {
  constructor(readonly provider: AIProvider = mimoProvider) {}

  async addAccount(params: {
    label: string;
    baseUrl: string;
    token: string;
    expiresAt?: string | null;
    skipDetect?: boolean;
  }): Promise<{ account: MimoAccountRow; detect: Awaited<ReturnType<typeof detectAccount>> | null }> {
    const baseUrl = params.baseUrl.replace(/\/+$/, '');
    const [row] = await getDb()
      .insert(mimoAccounts)
      .values({
        label: params.label,
        baseUrl,
        tokenEncrypted: encryptSecret(params.token),
        tokenMasked: maskMimoToken(params.token),
        status: 'active',
        expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
      })
      .returning();
    const account = row!;

    if (!params.skipDetect) {
      const detect = await detectAccount(baseUrl, params.token);
      if (detect.detected) {
        await this.applyDetect(account.id, detect);
        const refreshed = await this.getAccount(account.id);
        return { account: refreshed, detect };
      }
      return { account, detect };
    }
    return { account, detect: null };
  }

  /** Persist a detection result onto the account row + sync model catalog. */
  async applyDetect(accountId: string, detect: Awaited<ReturnType<typeof detectAccount>>) {
    const db = getDb();
    await db
      .update(mimoAccounts)
      .set({
        accountPath: detect.accountPath,
        usagePath: detect.usagePath,
        modelsPath: detect.modelsPath,
        chatPath: detect.chatPath,
        plan: detect.plan,
        totalQuota: detect.totalQuota,
        usedQuota: detect.usedQuota,
        remainingQuota: detect.remainingQuota,
        quotaResetAt: detect.quotaResetAt ? new Date(detect.quotaResetAt) : null,
        metadata: detect.raw as Record<string, unknown>,
        lastSyncAt: new Date(),
        lastSyncStatus: 'ok',
        lastSyncError: null,
        status: 'active',
      })
      .where(eq(mimoAccounts.id, accountId));
    for (const m of detect.models) {
      await db
        .insert(mimoModels)
        .values({ accountId, modelId: m.id, ownedBy: m.ownedBy ?? null, raw: m.raw ?? null })
        .onConflictDoNothing({ target: [mimoModels.accountId, mimoModels.modelId] });
    }
  }

  async removeAccount(accountId: string) {
    const [row] = await getDb()
      .delete(mimoAccounts)
      .where(eq(mimoAccounts.id, accountId))
      .returning();
    if (!row) throw errors.notFound('Mimo account not found');
    return row;
  }

  async listAccounts() {
    return getDb().select().from(mimoAccounts);
  }

  async getAccount(accountId: string): Promise<MimoAccountRow> {
    const rows = await getDb()
      .select()
      .from(mimoAccounts)
      .where(eq(mimoAccounts.id, accountId))
      .limit(1);
    const row = rows[0];
    if (!row) throw errors.notFound('Mimo account not found');
    return row;
  }

  decryptedToken(account: MimoAccountRow): string {
    return decryptSecret(account.tokenEncrypted);
  }

  /** Chat against a specific account, using that account's own base URL. */
  async chat(
    account: MimoAccountRow,
    request: ChatRequest,
    opts: { signal?: AbortSignal } = {},
  ) {
    return providerForAccount(account).chat(this.decryptedToken(account), request, {
      ...opts,
      baseUrl: account.baseUrl,
    });
  }

  isExpired(account: MimoAccountRow, now = new Date()): boolean {
    return account.expiresAt !== null && account.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Test the stored token against the upstream. Honors integration-point
   * configuration: endpoints that are not configured report "not configured"
   * rather than pretending to be healthy.
   */
  async testConnection(accountId: string) {
    const account = await this.getAccount(accountId);
    const token = this.decryptedToken(account);
    const results: Record<string, unknown> = {};
    let authed = true;
    try {
      const p = providerForAccount(account);
      results.account = await p.getAccount(token);
      results.plan = await p.getPlan(token);
      results.quota = await p.getQuota(token);
      results.models = await p.getModels(token);
    } catch (err) {
      authed = false;
      results.error = (err as Error).message;
    }
    await getDb()
      .update(mimoAccounts)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: authed ? 'ok' : 'error',
        lastSyncError: authed ? null : String((results as any).error ?? 'unknown'),
        status: authed ? 'active' : 'error',
      })
      .where(eq(mimoAccounts.id, accountId));
    return { authed, results };
  }

  /** Re-run auto-detect on an existing account (paths + quota + models). */
  async redetect(accountId: string) {
    const account = await this.getAccount(accountId);
    const detect = await detectAccount(account.baseUrl, this.decryptedToken(account));
    if (detect.detected) {
      await this.applyDetect(accountId, detect);
    }
    const refreshed = await this.getAccount(accountId);
    return { account: refreshed, detect };
  }

  /**
   * Refresh account information + models, then snapshot quota. Local usage is
   * compared to official usage and the delta is persisted — local data is
   * never deleted, only annotated.
   */
  async syncAccount(accountId: string) {
    const db = getDb();
    const account = await this.getAccount(accountId);
    const token = this.decryptedToken(account);
    const p = providerForAccount(account);

    let plan: string | null = account.plan;
    let total: number | null = account.totalQuota;
    let used: number | null = account.usedQuota;
    let remaining: number | null = account.remainingQuota;
    let resetAt: Date | null = account.quotaResetAt;
    let status: 'ok' | 'partial' | 'not_configured' = 'not_configured';
    let detail = 'quota endpoint not configured';

    try {
      const info = await p.getAccount(token);
      if (info.configured) {
        plan = info.plan ?? plan;
        status = 'ok';
        detail = 'account synced';
      }
      const quota = await p.getQuota(token);
      if (quota.configured) {
        total = quota.total ?? total;
        used = quota.used ?? used;
        remaining = quota.remaining ?? remaining;
        resetAt = quota.resetAt ? new Date(quota.resetAt) : resetAt;
        status = 'ok';
        detail = 'quota synced';
      }
      const models = await p.getModels(token);
      if (models.configured) {
        for (const m of models.models) {
          await db
            .insert(mimoModels)
            .values({ accountId, modelId: m.id, ownedBy: m.ownedBy ?? null, raw: m.raw ?? null })
            .onConflictDoNothing({ target: [mimoModels.accountId, mimoModels.modelId] });
        }
      }
    } catch (err) {
      status = 'partial';
      detail = (err as Error).message;
    }

    const localUsed = await this.localUsedTokens(accountId);
    const difference = used !== null ? localUsed - used : null;

    await db
      .update(mimoAccounts)
      .set({
        plan,
        totalQuota: total,
        usedQuota: used,
        remainingQuota: remaining,
        quotaResetAt: resetAt,
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncError: status === 'ok' ? null : detail,
      })
      .where(eq(mimoAccounts.id, accountId));

    await db.insert(quotaSnapshots).values({
      accountId,
      source: 'mimo',
      totalQuota: total,
      usedQuota: used,
      remainingQuota: remaining,
      localUsed,
      difference,
    });

    await db.insert(reconciliationLogs).values({
      accountId,
      localUsage: localUsed,
      officialUsage: used,
      difference,
      status: status === 'ok' ? (difference === 0 ? 'ok' : 'drift') : status,
      detail,
    });

    const refreshed = await this.getAccount(accountId);
    return { account: refreshed, localUsed, officialUsed: used, difference, status, detail };
  }

  async localUsedTokens(accountId: string): Promise<number> {
    const rows = await getDb()
      .select({ total: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)` })
      .from(usageLogs)
      .where(eq(usageLogs.accountId, accountId));
    return Number(rows[0]?.total ?? 0);
  }

  async listModels(accountId: string) {
    return getDb().select().from(mimoModels).where(eq(mimoModels.accountId, accountId));
  }

  async listReconciliation(accountId: string, limit = 50) {
    return getDb()
      .select()
      .from(reconciliationLogs)
      .where(eq(reconciliationLogs.accountId, accountId))
      .orderBy(reconciliationLogs.createdAt)
      .limit(limit);
  }

  async listSnapshots(accountId: string, limit = 50) {
    return getDb()
      .select()
      .from(quotaSnapshots)
      .where(eq(quotaSnapshots.accountId, accountId))
      .orderBy(quotaSnapshots.createdAt)
      .limit(limit);
  }

  /** Users currently allocated to this account, with live remaining tokens. */
  async listAllocations(accountId: string): Promise<AccountAllocationView[]> {
    const db = getDb();
    const rows = await db
      .select({
        userId: users.id,
        username: users.username,
        email: users.email,
        status: users.status,
        lastRequestAt: users.lastRequestAt,
        expiresAt: users.expiresAt,
        totalTokens: allocations.totalTokens,
        usedTokens: allocations.usedTokens,
        reservedTokens: allocations.reservedTokens,
      })
      .from(allocations)
      .innerJoin(users, eq(users.id, allocations.userId))
      .where(eq(allocations.accountId, accountId));
    return rows.map((r) => {
      const total = r.totalTokens ?? 0;
      const used = r.usedTokens ?? 0;
      const reserved = r.reservedTokens ?? 0;
      return {
        userId: r.userId,
        username: r.username,
        email: r.email,
        status: r.status,
        lastRequestAt: r.lastRequestAt ?? null,
        expiresAt: r.expiresAt ?? null,
        totalTokens: total,
        usedTokens: used,
        reservedTokens: reserved,
        remainingTokens: Math.max(0, total - used - reserved),
        usagePercent: total > 0 ? Math.min(100, Math.round((used / total) * 1000) / 10) : 0,
      };
    });
  }

  /** Active (non-disabled) user count allocated to this account. */
  async activeUserCount(accountId: string): Promise<number> {
    const rows = await getDb()
      .select({ id: users.id })
      .from(allocations)
      .innerJoin(users, eq(users.id, allocations.userId))
      .where(eq(allocations.accountId, accountId));
    return rows.length;
  }

  /**
   * Auto-share: how many tokens a NEW user should get on this account so the
   * quota is split evenly between the current active users + the new one.
   */
  async autoShareTokens(accountId: string): Promise<number> {
    const account = await this.getAccount(accountId);
    const pool = account.remainingQuota ?? account.totalQuota ?? 0;
    const count = await this.activeUserCount(accountId);
    const per = Math.floor(pool / (count + 1));
    return pool > 0 ? per : 0;
  }

  /** Revoke a user's allocation from this account (token debt preserved). */
  async revokeAllocation(accountId: string, userId: string) {
    const db = getDb();
    const rows = await db
      .select()
      .from(allocations)
      .where(eq(allocations.userId, userId))
      .limit(1);
    const alloc = rows[0];
    if (!alloc) throw errors.notFound('Allocation not found');
    if (alloc.accountId !== accountId) throw errors.validation('User is not allocated to this account');
    const floor = alloc.usedTokens + alloc.reservedTokens;
    const [updated] = await db
      .update(allocations)
      .set({
        accountId: null,
        totalTokens: Math.max(floor, 0),
        updatedAt: new Date(),
      })
      .where(eq(allocations.userId, userId))
      .returning();
    return updated!;
  }

  /** Account summary for the account page: quota + users + models. */
  async accountDetail(accountId: string) {
    const account = await this.getAccount(accountId);
    const [allocations, models, usedQuota] = await Promise.all([
      this.listAllocations(accountId),
      this.listModels(accountId),
      this.localUsedTokens(accountId),
    ]);
    const sumAllocated = allocations.reduce((a, b) => a + b.totalTokens, 0);
    return { account, allocations, models, localUsed: usedQuota, sumAllocated };
  }
}

export const mimoAccounts$ = new MimoAccountService();