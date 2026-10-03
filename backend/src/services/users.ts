import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { allocations, apiKeys, mimoAccounts, rateLimits, users } from '../db/schema.js';
import { hashPassword } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { mimoAccounts$ } from './mimo-accounts.js';
import { createApiKey } from './api-keys.js';

export type UserRow = typeof users.$inferSelect;

export interface CreateUserResult {
  user: PublicUser;
  allocation: { totalTokens: number; accountId: string | null };
  apiKey: { view: Awaited<ReturnType<typeof createApiKey>>['view']; raw: string } | null;
  autoShared: boolean;
}

export async function createUser(params: {
  username: string;
  email: string;
  password: string;
  totalTokens?: number;
  accountId?: string | null;
  sharedPool?: boolean;
  requestsPerMinute?: number;
  requestsPerHour?: number;
  expiresAt?: string | null;
}): Promise<CreateUserResult> {
  const db = getDb();
  const passwordHash = await hashPassword(params.password);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, params.username))
    .limit(1);
  if (existing.length > 0) throw errors.validation('Username already taken');

  // Auto-allocation: if an account is picked and no explicit totalTokens is
  // given, split the account's remaining quota evenly across current users + 1.
  let totalTokens = params.totalTokens ?? 0;
  let autoShared = false;
  if (params.accountId && params.totalTokens === undefined) {
    totalTokens = await mimoAccounts$.autoShareTokens(params.accountId);
    autoShared = true;
  }
  if (params.accountId && params.expiresAt === undefined) {
    const account = await mimoAccounts$.getAccount(params.accountId);
    if (account.expiresAt && totalTokens > 0) {
      params.expiresAt = account.expiresAt.toISOString();
    }
  }

  const [user] = await db
    .insert(users)
    .values({
      username: params.username,
      email: params.email,
      passwordHash,
      sharedPool: params.sharedPool ?? false,
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
    })
    .returning();

  await db.insert(allocations).values({
    userId: user!.id,
    accountId: params.accountId ?? null,
    totalTokens,
    usedTokens: 0,
    reservedTokens: 0,
  });

  await db.insert(rateLimits).values({
    userId: user!.id,
    requestsPerMinute: params.requestsPerMinute ?? 60,
    requestsPerHour: params.requestsPerHour ?? 1000,
  });

  const apiKey = await createApiKey({ userId: user!.id, name: 'default' });

  return {
    user: publicUser(user!),
    allocation: { totalTokens, accountId: params.accountId ?? null },
    apiKey,
    autoShared,
  };
}

export async function updateUser(
  userId: string,
  patch: {
    email?: string;
    status?: 'active' | 'disabled';
    sharedPool?: boolean;
    requestsPerMinute?: number;
    requestsPerHour?: number;
    expiresAt?: string | null;
  },
): Promise<PublicUser> {
  const db = getDb();
  const [user] = await db
    .update(users)
    .set({
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.status !== undefined
        ? { status: patch.status, disabledAt: patch.status === 'disabled' ? new Date() : null }
        : {}),
      ...(patch.sharedPool !== undefined ? { sharedPool: patch.sharedPool } : {}),
      ...(patch.expiresAt !== undefined
        ? { expiresAt: patch.expiresAt !== null ? new Date(patch.expiresAt) : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!user) throw errors.notFound('User not found');

  if (patch.requestsPerMinute !== undefined || patch.requestsPerHour !== undefined) {
    const [current] = await db.select().from(rateLimits).where(eq(rateLimits.userId, userId)).limit(1);
    if (current) {
      await db
        .update(rateLimits)
        .set({
          requestsPerMinute: patch.requestsPerMinute ?? current.requestsPerMinute,
          requestsPerHour: patch.requestsPerHour ?? current.requestsPerHour,
          updatedAt: new Date(),
        })
        .where(eq(rateLimits.userId, userId));
    }
  }
  return publicUser(user);
}

export async function disableUser(userId: string) {
  return updateUser(userId, { status: 'disabled' });
}

export async function enableUser(userId: string) {
  return updateUser(userId, { status: 'active' });
}

/** Strip secrets before a user row leaves the API layer. */
export type PublicUser = Omit<UserRow, 'passwordHash'>;

export function publicUser(u: UserRow | PublicUser): PublicUser {
  const { passwordHash: _omit, ...safe } = u as UserRow;
  return safe;
}

export async function getUser(userId: string): Promise<UserRow> {
  const rows = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw errors.notFound('User not found');
  return user;
}

export async function getUserWithMeta(userId: string) {
  const db = getDb();
  const user = await getUser(userId);
  const [alloc] = await db.select().from(allocations).where(eq(allocations.userId, userId)).limit(1);
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  const [rate] = await db.select().from(rateLimits).where(eq(rateLimits.userId, userId)).limit(1);
  return { user: publicUser(user), allocation: alloc ?? null, apiKeys: keys, rate: rate ?? null };
}

export async function listUsers() {
  const db = getDb();
  const rows = await db
    .select({
      user: users,
      allocation: allocations,
      accountLabel: mimoAccounts.label,
    })
    .from(users)
    .leftJoin(allocations, eq(allocations.userId, users.id))
    .leftJoin(mimoAccounts, eq(mimoAccounts.id, allocations.accountId));
  return rows.map((r) => ({
    user: {
      id: r.user.id,
      username: r.user.username,
      email: r.user.email,
      status: r.user.status,
      sharedPool: r.user.sharedPool,
      createdAt: r.user.createdAt,
      lastRequestAt: r.user.lastRequestAt,
      expiresAt: r.user.expiresAt,
      accountLabel: r.accountLabel ?? null,
    },
    allocation: r.allocation,
  }));
}

export async function countUsers(): Promise<number> {
  const rows = await getDb().select({ id: users.id }).from(users);
  return rows.length;
}

export async function resetApiKey(userId: string) {
  const db = getDb();
  await db
    .update(apiKeys)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(eq(apiKeys.userId, userId));
  return createApiKey({ userId, name: 'reset' });
}