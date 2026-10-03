import { desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { allocationHistory, allocations, mimoAccounts, users } from '../db/schema.js';
import { errors } from '../lib/errors.js';

export interface AllocationView {
  userId: string;
  username: string;
  email: string;
  status: string;
  sharedPool: boolean;
  accountId: string | null;
  totalTokens: number;
  usedTokens: number;
  reservedTokens: number;
  remainingTokens: number;
  usagePercent: number;
  lastRequestAt: Date | null;
}

/**
 * A_total = SUM(A_i) must satisfy A_total <= Q_available.
 * Q_available is the sum of known upstream totals (or Infinity when the
 * upstream does not expose quota — allocations are then purely bookkeeping).
 */
export function validateAllocationSum(
  totals: number[],
  available: number | null,
): { ok: boolean; sum: number; available: number | null } {
  const sum = totals.reduce((a, b) => a + b, 0);
  if (available === null) return { ok: true, sum, available };
  return { ok: sum <= available, sum, available };
}

export function evenSplit(available: number, count: number): number[] {
  if (count <= 0) throw errors.validation('Split count must be > 0');
  const per = Math.floor(available / count);
  return Array.from({ length: count }, () => per);
}

export async function getAllocationRow(userId: string) {
  const rows = await getDb().select().from(allocations).where(eq(allocations.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function listAllocations(): Promise<AllocationView[]> {
  const db = getDb();
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      email: users.email,
      status: users.status,
      sharedPool: users.sharedPool,
      lastRequestAt: users.lastRequestAt,
      accountId: allocations.accountId,
      totalTokens: allocations.totalTokens,
      usedTokens: allocations.usedTokens,
      reservedTokens: allocations.reservedTokens,
    })
    .from(users)
    .leftJoin(allocations, eq(allocations.userId, users.id));

  return rows.map((r) => {
    const total = r.totalTokens ?? 0;
    const used = r.usedTokens ?? 0;
    const reserved = r.reservedTokens ?? 0;
    const remaining = Math.max(0, total - used - reserved);
    return {
      userId: r.userId,
      username: r.username,
      email: r.email,
      status: r.status,
      sharedPool: r.sharedPool,
      accountId: r.accountId ?? null,
      totalTokens: total,
      usedTokens: used,
      reservedTokens: reserved,
      remainingTokens: remaining,
      usagePercent: total > 0 ? Math.min(100, Math.round((used / total) * 1000) / 10) : 0,
      lastRequestAt: r.lastRequestAt ?? null,
    };
  });
}

export async function setUserAllocation(params: {
  userId: string;
  totalTokens: number;
  accountId?: string | null;
  changedBy: string;
  reason?: string;
}) {
  const db = getDb();
  const existing = await getAllocationRow(params.userId);
  if (!existing) throw errors.notFound('Allocation not found for user');

  if (params.totalTokens < existing.usedTokens) {
    throw errors.validation(
      `New allocation ${params.totalTokens} is below already-used tokens ${existing.usedTokens}`,
    );
  }

  await db
    .update(allocations)
    .set({
      totalTokens: params.totalTokens,
      accountId: params.accountId ?? existing.accountId,
      updatedAt: new Date(),
    })
    .where(eq(allocations.userId, params.userId));

  await db.insert(allocationHistory).values({
    userId: params.userId,
    accountId: params.accountId ?? existing.accountId,
    oldTotal: existing.totalTokens,
    newTotal: params.totalTokens,
    changedBy: params.changedBy,
    reason: params.reason ?? null,
  });

  return getAllocationRow(params.userId);
}

/**
 * Rebalance is always an explicit, confirmed admin action. Historical usage is
 * never rewritten — only totals move, and every change lands in
 * allocation_history + audit_logs.
 */
export async function rebalanceAllocations(params: {
  assignments: { userId: string; totalTokens: number }[];
  accountId?: string | null;
  changedBy: string;
  reason?: string;
}) {
  const db = getDb();
  const userIds = params.assignments.map((a) => a.userId);
  const existingRows = await db
    .select()
    .from(allocations)
    .where(inArray(allocations.userId, userIds));

  for (const a of params.assignments) {
    const row = existingRows.find((r) => r.userId === a.userId);
    if (!row) throw errors.notFound(`Allocation not found for user ${a.userId}`);
    if (a.totalTokens < row.usedTokens) {
      throw errors.validation(
        `Allocation for ${a.userId} (${a.totalTokens}) is below used tokens (${row.usedTokens})`,
      );
    }
    await db
      .update(allocations)
      .set({ totalTokens: a.totalTokens, updatedAt: new Date() })
      .where(eq(allocations.userId, a.userId));
    await db.insert(allocationHistory).values({
      userId: a.userId,
      accountId: params.accountId ?? row.accountId,
      oldTotal: row.totalTokens,
      newTotal: a.totalTokens,
      changedBy: params.changedBy,
      reason: params.reason ?? 'rebalance',
    });
  }
  return listAllocations();
}

export async function getUserAllocationView(userId: string): Promise<AllocationView | null> {
  const all = await listAllocations();
  return all.find((a) => a.userId === userId) ?? null;
}

export async function accountTotals(): Promise<{ total: number | null; allocated: number }> {
  const db = getDb();
  const allocatedRows = await db
    .select({ sumAllocated: sql<number>`coalesce(sum(${allocations.totalTokens}), 0)` })
    .from(allocations);
  const sumAllocated = allocatedRows[0]?.sumAllocated ?? 0;
  const accounts = await db
    .select()
    .from(mimoAccounts)
    .where(eq(mimoAccounts.status, 'active'));
  const knownTotals = accounts
    .map((a) => a.totalQuota)
    .filter((v): v is number => typeof v === 'number');
  const total = knownTotals.length > 0 ? knownTotals.reduce((a, b) => a + b, 0) : null;
  return { total, allocated: Number(sumAllocated ?? 0) };
}

export async function allocationHistoryFor(userId: string) {
  return getDb()
    .select()
    .from(allocationHistory)
    .where(eq(allocationHistory.userId, userId))
    .orderBy(desc(allocationHistory.createdAt))
    .limit(50);
}
