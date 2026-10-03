import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../services/audit.js';
import { loginAdmin, loginUser, requireAdmin, requireUser } from '../services/auth.js';
import {
  accountTotals,
  allocationHistoryFor,
  evenSplit,
  listAllocations,
  rebalanceAllocations,
  setUserAllocation,
  validateAllocationSum,
  type AllocationView,
} from '../services/allocations.js';
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '../services/api-keys.js';
import { mimoAccounts$ } from '../services/mimo-accounts.js';
import { customModels$ } from '../services/custom-models.js';
import { reconciliation } from '../services/reconciliation.js';
import {
  countUsers,
  createUser,
  disableUser,
  enableUser,
  getUserWithMeta,
  listUsers,
  resetApiKey,
  updateUser,
  publicUser,
} from '../services/users.js';
import {
  queryUsage,
  recentRequests,
  requestCountSince,
  usageByDay,
  usageByModel,
  usageTotals,
} from '../services/usage.js';
import { getSettings, patchSettings } from '../services/settings.js';
import { listAudit } from '../services/audit.js';
import { errors } from '../lib/errors.js';
import { assertUuid } from '../lib/params.js';
import { getQuotaService } from '../services/quota.js';
import { mimoModels } from '../db/schema.js';
import { getDb } from '../db/client.js';

// Hard bounds keep oversized/overflowing values away from the DB layer.
// BIGINT_MAX is mirrored in the migration for tokens_used/total.
const BIGINT_MAX = 9_223_372_036_854_775_807;
const tokens = z
  .number()
  .int()
  .min(0)
  .max(BIGINT_MAX)
  .refine((n) => Number.isSafeInteger(n), 'Value exceeds safe integer range');

const LoginBody = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(1024) });

const CreateUserBody = z.object({
  username: z.string().min(3).max(64),
  email: z.string().email().max(320),
  password: z.string().min(8).max(1024),
  totalTokens: tokens.optional(),
  accountId: z.string().uuid().nullable().optional(),
  sharedPool: z.boolean().optional(),
  requestsPerMinute: z.number().int().positive().max(1_000_000).optional(),
  requestsPerHour: z.number().int().positive().max(1_000_000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const UpdateUserBody = z.object({
  email: z.string().email().max(320).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  sharedPool: z.boolean().optional(),
  requestsPerMinute: z.number().int().positive().max(1_000_000).optional(),
  requestsPerHour: z.number().int().positive().max(1_000_000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const AddMimoBody = z.object({
  label: z.string().min(1).max(128),
  baseUrl: z.string().url().max(2048),
  token: z.string().min(4).max(8192),
  expiresAt: z.string().datetime().nullable().optional(),
  skipDetect: z.boolean().optional(),
});

const CustomModelBody = z.object({
  accountId: z.string().uuid(),
  modelAlias: z.string().min(1).max(128),
  targetModel: z.string().min(1).max(256),
  systemPrompt: z.string().min(1).max(32_768),
});

const CustomModelPatchBody = z.object({
  modelAlias: z.string().min(1).max(128).optional(),
  targetModel: z.string().min(1).max(256).optional(),
  systemPrompt: z.string().min(1).max(32_768).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const AllocationBody = z.object({
  userId: z.string().uuid(),
  totalTokens: tokens,
  accountId: z.string().uuid().nullable().optional(),
  reason: z.string().max(512).optional(),
});

const SplitBody = z.object({
  userIds: z.array(z.string().uuid()).min(1),
  count: z.number().int().positive().max(1000).optional(),
  totals: z.array(tokens).optional(),
  accountId: z.string().uuid().nullable().optional(),
  reason: z.string().optional(),
  confirmed: z.boolean().optional().default(false),
});

const UsageQuery = z.object({
  range: z.enum(['today', '7d', '30d', 'custom']).default('7d'),
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().uuid().optional(),
  model: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

const SettingsBody = z.object({
  gatewayUrl: z.string().url().max(2048).optional(),
  defaultModel: z.string().max(256).optional(),
  quotaMode: z.enum(['allocation', 'shared_pool']).optional(),
  requestsPerMinute: z.number().int().positive().max(1_000_000).optional(),
  requestsPerHour: z.number().int().positive().max(1_000_000).optional(),
  syncIntervalSeconds: z.number().int().positive().max(86_400).optional(),
  reservationTtlSeconds: z.number().int().positive().max(86_400).optional(),
  logLevel: z.string().max(16).optional(),
  corsOrigin: z.string().max(2048).optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw errors.validation(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

function parseQuery<T extends z.ZodTypeAny>(schema: T, q: unknown): z.infer<T> {
  const r = schema.safeParse(q);
  if (!r.success) throw errors.validation(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.post('/api/auth/admin/login', {
    schema: { tags: ['auth'], summary: 'Admin login' },
  }, async (req) => {
    const body = parse(LoginBody, req.body);
    const result = await loginAdmin(body);
    await recordAudit({
      actor: result.username,
      action: 'ADMIN_LOGIN',
      target: result.username,
      ip: req.ip,
    });
    return result;
  });

  app.post('/api/auth/login', {
    schema: { tags: ['auth'], summary: 'User login' },
  }, async (req) => {
    const body = parse(LoginBody, req.body);
    return loginUser(body);
  });

  // ---- Dashboard ----
  app.get('/api/dashboard', {
    schema: { tags: ['admin'], summary: 'Aggregated dashboard metrics', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const accounts = await mimoAccounts$.listAccounts();
    const totals = await accountTotals();
    const usersCount = await countUsers();
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [todayTotals, monthTotals, todayRequests, allocations] = await Promise.all([
      usageTotals({ range: 'today' }),
      usageTotals({ range: 'custom', from: monthStart.toISOString() }),
      requestCountSince(today),
      listAllocations(),
    ]);

    const aggregate = accounts.reduce(
      (acc, a) => {
        if (a.totalQuota != null) acc.total += a.totalQuota;
        if (a.usedQuota != null) acc.used += a.usedQuota;
        if (a.remainingQuota != null) acc.remaining += a.remainingQuota;
        return acc;
      },
      { total: 0, used: 0, remaining: 0 },
    );
    const hasQuotaInfo = accounts.some((a) => a.totalQuota != null);

    const localUsed = allocations.reduce((a: number, b: AllocationView) => a + b.usedTokens, 0);

    return {
      plan: accounts[0]?.plan ?? null,
      quota: hasQuotaInfo
        ? {
            total: aggregate.total,
            used: aggregate.used,
            remaining: aggregate.remaining,
            usagePercent:
              aggregate.total > 0
                ? Math.round((aggregate.used / aggregate.total) * 1000) / 10
                : 0,
          }
        : {
            total: totals.total,
            used: localUsed,
            remaining: totals.total !== null ? Math.max(0, totals.total - localUsed) : null,
            usagePercent:
              totals.total && totals.total > 0
                ? Math.round((localUsed / totals.total) * 1000) / 10
                : 0,
          },
      allocation: { totalAllocated: totals.allocated, available: totals.total },
      users: { total: usersCount },
      requests: {
        today: todayRequests,
        total: todayRequests,
      },
      usage: {
        today: todayTotals.totalTokens,
        month: monthTotals.totalTokens,
        inputTokens: monthTotals.inputTokens,
        outputTokens: monthTotals.outputTokens,
      },
      system: {
        status: 'healthy',
        mimoConnection: accounts.length === 0
          ? 'no_accounts'
          : accounts.every((a) => a.status === 'active')
            ? 'online'
            : accounts.some((a) => a.status === 'error')
              ? 'upstream_error'
              : 'degraded',
        syncedAt: accounts[0]?.lastSyncAt ?? null,
        quotaMode: (await getSettings()).quotaMode,
        updatedAt: new Date(now).toISOString(),
      },
      accounts: accounts.map((a) => ({
        id: a.id,
        label: a.label,
        status: a.status,
        plan: a.plan,
        totalQuota: a.totalQuota,
        usedQuota: a.usedQuota,
        remainingQuota: a.remainingQuota,
        tokenMasked: a.tokenMasked,
        lastSyncAt: a.lastSyncAt,
        lastSyncStatus: a.lastSyncStatus,
      })),
    };
  });

  // ---- Users ----
  app.get('/api/users', {
    schema: { tags: ['admin'], summary: 'List users', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    return listUsers();
  });

  app.post('/api/users', {
    schema: { tags: ['admin'], summary: 'Create user (auto allocation + API key)', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const body = parse(CreateUserBody, req.body);
    const result = await createUser(body);
    await recordAudit({
      actor: admin.username,
      action: 'USER_CREATED',
      target: result.user.id,
      metadata: {
        username: result.user.username,
        totalTokens: result.allocation.totalTokens,
        accountId: result.allocation.accountId,
        autoShared: result.autoShared,
        apiKeyCreated: true,
      },
      ip: req.ip,
    });
    return {
      user: result.user,
      allocation: { totalTokens: result.allocation.totalTokens, accountId: result.allocation.accountId },
      autoShared: result.autoShared,
      apiKey: result.apiKey,
    };
  });

  app.get('/api/users/:id', {
    schema: { tags: ['admin'], summary: 'Get user detail', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    return getUserWithMeta(id);
  });

  app.patch('/api/users/:id', {
    schema: { tags: ['admin'], summary: 'Update user', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const body = parse(UpdateUserBody, req.body);
    const user = await updateUser(id, body);
    await recordAudit({
      actor: admin.username,
      action: body.status === 'disabled' ? 'USER_DISABLED' : 'USER_UPDATED',
      target: id,
      metadata: body,
      ip: req.ip,
    });
    return { user: publicUser(user) };
  });

  app.post('/api/users/:id/disable', {
    schema: { tags: ['admin'], summary: 'Disable user', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const user = await disableUser(id);
    await recordAudit({ actor: admin.username, action: 'USER_DISABLED', target: id, ip: req.ip });
    return { user: publicUser(user) };
  });

  app.post('/api/users/:id/enable', {
    schema: { tags: ['admin'], summary: 'Enable user', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const user = await enableUser(id);
    await recordAudit({ actor: admin.username, action: 'USER_ENABLED', target: id, ip: req.ip });
    return { user: publicUser(user) };
  });

  app.post('/api/users/:id/api-key', {
    schema: { tags: ['admin'], summary: 'Create or reset user API key', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const query = (req.query ?? {}) as { reset?: string };
    const result = query.reset === 'true' ? await resetApiKey(id) : await createApiKey({ userId: id });
    await recordAudit({
      actor: admin.username,
      action: 'API_KEY_CREATED',
      target: id,
      ip: req.ip,
    });
    return result;
  });

  app.delete('/api/users/:id/api-key', {
    schema: { tags: ['admin'], summary: 'Revoke user API key', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const body = (req.body ?? {}) as { keyId?: string };
    if (!body.keyId) throw errors.validation('keyId is required');
    await revokeApiKey(id, body.keyId);
    await recordAudit({ actor: admin.username, action: 'API_KEY_REVOKED', target: id, ip: req.ip });
    return { ok: true };
  });

  // ---- Allocation ----
  app.get('/api/allocation', {
    schema: { tags: ['admin'], summary: 'List allocations', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const [allocations, totals] = await Promise.all([listAllocations(), accountTotals()]);
    return {
      totalAllocatable: totals.total,
      totalAllocated: totals.allocated,
      remainingAllocatable: totals.total !== null ? Math.max(0, totals.total - totals.allocated) : null,
      allocations,
    };
  });

  app.post('/api/allocation/preview', {
    schema: { tags: ['admin'], summary: 'Preview an even split', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const body = parse(SplitBody, req.body);
    const totals = await accountTotals();
    const available = totals.total;
    const perUser = body.totals ?? evenSplit(available ?? 0, body.count ?? body.userIds.length);
    const check = validateAllocationSum(perUser, available);
    return {
      perUser,
      sum: check.sum,
      available: check.available,
      valid: check.ok,
      formula: 'A_total = SUM(A_i) <= Q_available',
    };
  });

  app.post('/api/allocation', {
    schema: { tags: ['admin'], summary: 'Set a single user allocation', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const body = parse(AllocationBody, req.body);
    const totals = await accountTotals();
    const others = (await listAllocations())
      .filter((a) => a.userId !== body.userId)
      .map((a) => a.totalTokens);
    const check = validateAllocationSum([...others, body.totalTokens], totals.total);
    if (!check.ok) {
      throw errors.validation(
        `SUM(allocation)=${check.sum} exceeds Q_available=${check.available}`,
      );
    }
    const alloc = await setUserAllocation({
      userId: body.userId,
      totalTokens: body.totalTokens,
      accountId: body.accountId ?? null,
      changedBy: admin.username,
      reason: body.reason,
    });
    await getQuotaService().setCounters(
      `user:${body.userId}`,
      alloc?.usedTokens ?? 0,
      alloc?.reservedTokens ?? 0,
    );
    await recordAudit({
      actor: admin.username,
      action: 'ALLOCATION_CHANGED',
      target: body.userId,
      metadata: { totalTokens: body.totalTokens },
      ip: req.ip,
    });
    return { allocation: alloc };
  });

  app.post('/api/allocation/rebalance', {
    schema: { tags: ['admin'], summary: 'Rebalance allocations (requires confirmation)', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const body = parse(SplitBody, req.body);
    if (!body.confirmed) {
      const totals = await accountTotals();
      const perUser = body.totals ?? evenSplit(totals.total ?? 0, body.userIds.length);
      const check = validateAllocationSum(perUser, totals.total);
      return {
        requiresConfirmation: true,
        preview: { perUser, sum: check.sum, available: check.available, valid: check.ok },
        note: 'Historical usage is preserved. Re-send with confirmed=true to apply.',
      };
    }
    const totals = await accountTotals();
    const perUser = body.totals ?? evenSplit(totals.total ?? 0, body.userIds.length);
    if (perUser.length !== body.userIds.length) {
      throw errors.validation('totals length must match userIds length');
    }
    const check = validateAllocationSum(perUser, totals.total);
    if (!check.ok) {
      throw errors.validation(`SUM(allocation)=${check.sum} exceeds Q_available=${check.available}`);
    }
    const assignments = body.userIds.map((userId, i) => ({
      userId,
      totalTokens: perUser[i]!,
    }));
    const result = await rebalanceAllocations({
      assignments,
      accountId: body.accountId ?? null,
      changedBy: admin.username,
      reason: body.reason,
    });
    await recordAudit({
      actor: admin.username,
      action: 'ALLOCATION_REBALANCED',
      target: body.userIds.join(','),
      metadata: { assignments },
      ip: req.ip,
    });
    return { allocations: result };
  });

  app.get('/api/allocation/:userId/history', {
    schema: { tags: ['admin'], summary: 'Allocation history for a user', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const { userId } = req.params as { userId: string };
    assertUuid(userId, 'user id');
    return allocationHistoryFor(userId);
  });

  // ---- Mimo accounts ----
  app.get('/api/mimo/accounts', {
    schema: { tags: ['mimo'], summary: 'List Mimo accounts', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const accounts = await mimoAccounts$.listAccounts();
    return accounts.map((a) => ({
      id: a.id,
      label: a.label,
      baseUrl: a.baseUrl,
      tokenMasked: a.tokenMasked,
      status: a.status,
      plan: a.plan,
      totalQuota: a.totalQuota,
      usedQuota: a.usedQuota,
      remainingQuota: a.remainingQuota,
      quotaResetAt: a.quotaResetAt,
      lastSyncAt: a.lastSyncAt,
      lastSyncStatus: a.lastSyncStatus,
      lastSyncError: a.lastSyncError,
      createdAt: a.createdAt,
    }));
  });

  app.post('/api/mimo/accounts', {
    schema: { tags: ['mimo'], summary: 'Add Mimo account (auto-detect plan/quota/models)', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const body = parse(AddMimoBody, req.body);
    const result = await mimoAccounts$.addAccount({
      label: body.label,
      baseUrl: body.baseUrl,
      token: body.token,
      expiresAt: body.expiresAt ?? null,
      skipDetect: body.skipDetect ?? false,
    });
    await recordAudit({
      actor: admin.username,
      action: 'MIMO_TOKEN_ADDED',
      target: result.account.id,
      metadata: {
        label: result.account.label,
        detected: result.detect?.detected ?? false,
        plan: result.detect?.plan ?? null,
      },
      ip: req.ip,
    });
    const { tokenEncrypted: _t, ...safe } = result.account;
    return { account: safe, detect: result.detect };
  });

  app.get('/api/mimo/accounts/:id/detail', {
    schema: { tags: ['mimo'], summary: 'Account detail: quota, users, models', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const detail = await mimoAccounts$.accountDetail(id);
    const { tokenEncrypted: _t, ...safe } = detail.account;
    return { ...detail, account: safe };
  });

  app.post('/api/mimo/accounts/:id/redetect', {
    schema: { tags: ['mimo'], summary: 'Re-run auto-detect on account', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const result = await mimoAccounts$.redetect(id);
    await recordAudit({
      actor: admin.username,
      action: 'MIMO_REDETECTED',
      target: id,
      metadata: { detected: result.detect.detected, plan: result.detect.plan },
      ip: req.ip,
    });
    const { tokenEncrypted: _t, ...safe } = result.account;
    return { account: safe, detect: result.detect };
  });

  app.post('/api/mimo/accounts/:id/auto-share', {
    schema: { tags: ['mimo'], summary: 'Preview the auto-split share for N new users', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const body = (req.body ?? {}) as { count?: number };
    const count = Math.max(1, Math.min(50, body.count ?? 1));
    const account = await mimoAccounts$.getAccount(id);
    const current = await mimoAccounts$.activeUserCount(id);
    const pool = account.remainingQuota ?? account.totalQuota ?? 0;
    const perUser = Math.floor(pool / (current + count));
    return {
      accountId: id,
      pool,
      currentUsers: current,
      requestedNewUsers: count,
      perUser,
      formula: `floor(pool / (currentUsers + newUsers)) = floor(${pool} / ${current + count})`,
    };
  });

  app.delete('/api/mimo/accounts/:id/users/:userId', {
    schema: { tags: ['mimo'], summary: 'Revoke a user allocation from this account', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id, userId } = req.params as { id: string; userId: string };
    assertUuid(id, 'account id');
    assertUuid(userId, 'user id');
    const alloc = await mimoAccounts$.revokeAllocation(id, userId);
    await recordAudit({
      actor: admin.username,
      action: 'ALLOCATION_REVOKED',
      target: userId,
      metadata: { accountId: id, totalTokens: alloc.totalTokens },
      ip: req.ip,
    });
    return { ok: true, allocation: alloc };
  });

  app.delete('/api/mimo/accounts/:id', {
    schema: { tags: ['mimo'], summary: 'Remove Mimo account', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    await mimoAccounts$.removeAccount(id);
    await recordAudit({ actor: admin.username, action: 'MIMO_TOKEN_REMOVED', target: id, ip: req.ip });
    return { ok: true };
  });

  // ---- Custom models (aliases with injected system prompts) ----
  app.get('/api/mimo/models/custom', {
    schema: { tags: ['mimo'], summary: 'List custom models', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    return customModels$.list();
  });

  app.post('/api/mimo/models/custom', {
    schema: { tags: ['mimo'], summary: 'Create custom model (alias + system prompt)', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const body = parse(CustomModelBody, req.body);
    const row = await customModels$.create(body);
    await recordAudit({
      actor: admin.username,
      action: 'CUSTOM_MODEL_CREATED',
      target: row.id,
      metadata: { modelAlias: row.modelAlias, targetModel: row.targetModel },
      ip: req.ip,
    });
    return { customModel: row };
  });

  app.patch('/api/mimo/models/custom/:id', {
    schema: { tags: ['mimo'], summary: 'Update custom model', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const body = parse(CustomModelPatchBody, req.body);
    const row = await customModels$.update(id, body);
    await recordAudit({
      actor: admin.username,
      action: 'CUSTOM_MODEL_UPDATED',
      target: id,
      metadata: { modelAlias: row.modelAlias },
      ip: req.ip,
    });
    return { customModel: row };
  });

  app.delete('/api/mimo/models/custom/:id', {
    schema: { tags: ['mimo'], summary: 'Delete custom model', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    await customModels$.remove(id);
    await recordAudit({ actor: admin.username, action: 'CUSTOM_MODEL_DELETED', target: id, ip: req.ip });
    return { ok: true };
  });

  app.post('/api/mimo/accounts/:id/test', {
    schema: { tags: ['mimo'], summary: 'Test Mimo token', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const result = await mimoAccounts$.testConnection(id);
    await recordAudit({ actor: admin.username, action: 'MIMO_TOKEN_TESTED', target: id, ip: req.ip });
    return result;
  });

  app.post('/api/mimo/accounts/:id/sync', {
    schema: { tags: ['mimo'], summary: 'Sync account info & quota', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    const result = await mimoAccounts$.syncAccount(id);
    await recordAudit({ actor: admin.username, action: 'QUOTA_SYNCED', target: id, ip: req.ip });
    return result;
  });

  app.get('/api/mimo/accounts/:id/models', {
    schema: { tags: ['mimo'], summary: 'List models for a Mimo account', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    return mimoAccounts$.listModels(id);
  });

  app.get('/api/mimo/accounts/:id/reconciliation', {
    schema: { tags: ['mimo'], summary: 'Reconciliation history', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    return mimoAccounts$.listReconciliation(id);
  });

  app.get('/api/mimo/accounts/:id/snapshots', {
    schema: { tags: ['mimo'], summary: 'Quota snapshots', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    assertUuid(id);
    return mimoAccounts$.listSnapshots(id);
  });

  app.get('/api/reconciliation', {
    schema: { tags: ['mimo'], summary: 'Local vs official usage report', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    return reconciliation.report();
  });

  // ---- Usage ----
  app.get('/api/usage', {
    schema: { tags: ['usage'], summary: 'Usage logs with filters', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const auth = requireUser(req);
    const q = parseQuery(UsageQuery, req.query);
    const filter = auth.role === 'admin' ? q : { ...q, userId: auth.sub };
    const [rows, totals, byDay, byModel] = await Promise.all([
      queryUsage(filter),
      usageTotals(filter),
      usageByDay(filter),
      usageByModel(filter),
    ]);
    return { rows, totals, byDay, byModel };
  });

  app.get('/api/requests', {
    schema: { tags: ['usage'], summary: 'Recent request logs', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const auth = requireUser(req);
    const q = parseQuery(UsageQuery, req.query);
    return recentRequests({
      userId: auth.role === 'admin' ? q.userId : auth.sub,
      limit: q.limit ?? 50,
    });
  });

  // ---- Audit ----
  app.get('/api/audit', {
    schema: { tags: ['admin'], summary: 'Audit log', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    const q = parseQuery(UsageQuery, req.query);
    return listAudit(q.limit ?? 100);
  });

  // ---- Settings ----
  app.get('/api/settings', {
    schema: { tags: ['admin'], summary: 'Get gateway settings', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    requireAdmin(req);
    return getSettings();
  });

  app.patch('/api/settings', {
    schema: { tags: ['admin'], summary: 'Update gateway settings', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const admin = requireAdmin(req);
    const body = parse(SettingsBody, req.body);
    const settings = await patchSettings(body);
    await recordAudit({
      actor: admin.username,
      action: 'SETTINGS_CHANGED',
      target: 'settings',
      metadata: body,
      ip: req.ip,
    });
    return settings;
  });
}

export function registerUserRoutes(app: FastifyInstance) {
  app.get('/api/me', {
    schema: { tags: ['user'], summary: 'User dashboard data', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const auth = requireUser(req);
    const meta = await getUserWithMeta(auth.sub);
    const total = meta.allocation?.totalTokens ?? 0;
    const used = meta.allocation?.usedTokens ?? 0;
    const reserved = meta.allocation?.reservedTokens ?? 0;
    const remaining = Math.max(0, total - used - reserved);
    const models = await getDb().select().from(mimoModels).limit(50);
    const reqs = await recentRequests({ userId: auth.sub, limit: 20 });
    const totals = await usageTotals({ range: '30d', userId: auth.sub });
    return {
      user: {
        id: meta.user.id,
        username: meta.user.username,
        email: meta.user.email,
        status: meta.user.status,
        lastRequestAt: meta.user.lastRequestAt,
        expiresAt: meta.user.expiresAt,
      },
      allocation: {
        total,
        used,
        reserved,
        remaining,
        remainingPercent: total > 0 ? Math.round((remaining / total) * 1000) / 10 : 0,
        exhausted: remaining <= 0,
      },
      account: meta.allocation?.accountId
        ? await (async () => {
            const acc = await mimoAccounts$.getAccount(meta.allocation!.accountId!);
            return {
              id: acc.id,
              label: acc.label,
              plan: acc.plan,
              remainingQuota: acc.remainingQuota,
              expiresAt: acc.expiresAt,
            };
          })()
        : null,
      apiKeys: meta.apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        status: k.status,
        masked: `${k.keyPrefix}${'•'.repeat(8)}${k.keyLast4}`,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      })),
      rate: meta.rate,
      models: models.map((m) => m.modelId),
      recentRequests: reqs,
      usage: totals,
    };
  });

  app.get('/api/me/api-keys', {
    schema: { tags: ['user'], summary: 'List my API keys', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const auth = requireUser(req);
    return listApiKeys(auth.sub);
  });

  app.post('/api/me/api-keys', {
    schema: { tags: ['user'], summary: 'Create API key', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const auth = requireUser(req);
    return createApiKey({ userId: auth.sub, name: ((req.body ?? {}) as any).name });
  });

  app.delete('/api/me/api-keys/:keyId', {
    schema: { tags: ['user'], summary: 'Revoke API key', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const auth = requireUser(req);
    const { keyId } = req.params as { keyId: string };
    assertUuid(keyId, 'key id');
    return revokeApiKey(auth.sub, keyId);
  });

  app.post('/api/me/api-keys/:keyId/rotate', {
    schema: { tags: ['user'], summary: 'Rotate API key', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest) => {
    const auth = requireUser(req);
    const { keyId } = req.params as { keyId: string };
    assertUuid(keyId, 'key id');
    return rotateApiKey(auth.sub, keyId);
  });
}
