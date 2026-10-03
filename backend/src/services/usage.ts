import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { requestLogs, usageLogs, users } from '../db/schema.js';
import type { UsageTotals } from '../lib/token-estimate.js';

export type UsageSource = 'official' | 'estimated';

export interface RecordUsageParams {
  userId: string;
  accountId: string | null;
  requestId: string;
  model: string;
  usage: UsageTotals;
  source: UsageSource;
  durationMs: number;
  httpStatus: number;
  cost?: number | null;
}

export async function recordUsage(p: RecordUsageParams) {
  await getDb()
    .insert(usageLogs)
    .values({
      userId: p.userId,
      accountId: p.accountId,
      requestId: p.requestId,
      model: p.model,
      promptTokens: p.usage.prompt_tokens,
      completionTokens: p.usage.completion_tokens,
      totalTokens: p.usage.total_tokens,
      usageSource: p.source,
      cost: p.cost ?? null,
      durationMs: p.durationMs,
      httpStatus: p.httpStatus,
    })
    .onConflictDoNothing({ target: usageLogs.requestId });
}

export async function recordRequest(p: {
  requestId: string;
  userId: string | null;
  model: string | null;
  path: string;
  stream: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
  clientIp: string | null;
}) {
  await getDb()
    .insert(requestLogs)
    .values(p)
    .onConflictDoNothing({ target: requestLogs.requestId });
}

export type UsageRange = 'today' | '7d' | '30d' | 'custom';

export function rangeStart(range: UsageRange, from?: string, to?: string): { start: Date; end: Date } {
  const end = to ? new Date(to) : new Date();
  switch (range) {
    case 'today': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { start: d, end };
    }
    case '7d':
      return { start: new Date(end.getTime() - 7 * 86_400_000), end };
    case '30d':
      return { start: new Date(end.getTime() - 30 * 86_400_000), end };
    case 'custom':
      return { start: from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000), end };
  }
}

export async function queryUsage(params: {
  range: UsageRange;
  from?: string;
  to?: string;
  userId?: string;
  model?: string;
  limit?: number;
}) {
  const db = getDb();
  const { start } = rangeStart(params.range, params.from, params.to);
  const conditions = [gte(usageLogs.createdAt, start)];
  if (params.userId) conditions.push(eq(usageLogs.userId, params.userId));
  if (params.model) conditions.push(eq(usageLogs.model, params.model));

  const rows = await db
    .select({
      log: usageLogs,
      username: users.username,
    })
    .from(usageLogs)
    .leftJoin(users, eq(users.id, usageLogs.userId))
    .where(and(...conditions))
    .orderBy(desc(usageLogs.createdAt))
    .limit(params.limit ?? 200);

  return rows.map((r) => ({
    id: r.log.id,
    requestId: r.log.requestId,
    userId: r.log.userId,
    username: r.username ?? null,
    accountId: r.log.accountId,
    model: r.log.model,
    promptTokens: r.log.promptTokens,
    completionTokens: r.log.completionTokens,
    totalTokens: r.log.totalTokens,
    usageSource: r.log.usageSource,
    cost: r.log.cost,
    durationMs: r.log.durationMs,
    httpStatus: r.log.httpStatus,
    createdAt: r.log.createdAt,
  }));
}

export async function usageTotals(params: {
  range: UsageRange;
  from?: string;
  to?: string;
  userId?: string;
}) {
  const { start } = rangeStart(params.range, params.from, params.to);
  const conditions = [gte(usageLogs.createdAt, start)];
  if (params.userId) conditions.push(eq(usageLogs.userId, params.userId));
  const rows = await getDb()
    .select({
      requests: sql<number>`count(*)::int`,
      input: sql<number>`coalesce(sum(${usageLogs.promptTokens}), 0)`,
      output: sql<number>`coalesce(sum(${usageLogs.completionTokens}), 0)`,
      total: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)`,
    })
    .from(usageLogs)
    .where(and(...conditions));
  const r = rows[0];
  return {
    requests: Number(r?.requests ?? 0),
    inputTokens: Number(r?.input ?? 0),
    outputTokens: Number(r?.output ?? 0),
    totalTokens: Number(r?.total ?? 0),
  };
}

export async function usageByDay(params: { range: UsageRange; from?: string; to?: string; userId?: string }) {
  const { start } = rangeStart(params.range, params.from, params.to);
  const conditions = [gte(usageLogs.createdAt, start)];
  if (params.userId) conditions.push(eq(usageLogs.userId, params.userId));
  const rows = await getDb()
    .select({
      day: sql<string>`to_char(date_trunc('day', ${usageLogs.createdAt}), 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageLogs)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('day', ${usageLogs.createdAt})`)
    .orderBy(sql`date_trunc('day', ${usageLogs.createdAt})`);
  return rows.map((r) => ({ day: r.day, totalTokens: Number(r.total ?? 0), requests: Number(r.requests ?? 0) }));
}

export async function usageByModel(params: { range: UsageRange; from?: string; to?: string; userId?: string }) {
  const { start } = rangeStart(params.range, params.from, params.to);
  const conditions = [gte(usageLogs.createdAt, start)];
  if (params.userId) conditions.push(eq(usageLogs.userId, params.userId));
  const rows = await getDb()
    .select({
      model: usageLogs.model,
      total: sql<number>`coalesce(sum(${usageLogs.totalTokens}), 0)`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageLogs)
    .where(and(...conditions))
    .groupBy(usageLogs.model)
    .orderBy(sql`coalesce(sum(${usageLogs.totalTokens}), 0)`);
  return rows.map((r) => ({ model: r.model, totalTokens: Number(r.total ?? 0), requests: Number(r.requests ?? 0) }));
}

export async function requestCountSince(since: Date, userId?: string): Promise<number> {
  const conditions = [gte(requestLogs.createdAt, since)];
  if (userId) conditions.push(eq(requestLogs.userId, userId));
  const rows = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(requestLogs)
    .where(and(...conditions));
  return Number(rows[0]?.c ?? 0);
}

export async function recentRequests(params: { userId?: string; limit?: number }) {
  const conditions = params.userId ? [eq(requestLogs.userId, params.userId)] : [];
  return getDb()
    .select()
    .from(requestLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(requestLogs.createdAt))
    .limit(params.limit ?? 50);
}

export async function distinctModels(): Promise<string[]> {
  const rows = await getDb().select({ model: usageLogs.model }).from(usageLogs).groupBy(usageLogs.model);
  return rows.map((r) => r.model);
}
