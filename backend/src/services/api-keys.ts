import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { apiKeys, rateLimits, users } from '../db/schema.js';
import {
  generateApiKey,
  hashApiKey,
  maskApiKey,
  validateApiKeyFormat,
} from '../lib/crypto.js';
import { errors } from '../lib/errors.js';

export { validateApiKeyFormat };

export interface ApiKeyView {
  id: string;
  userId: string;
  name: string;
  masked: string;
  status: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function createApiKey(params: {
  userId: string;
  name?: string;
}): Promise<{ view: ApiKeyView; raw: string }> {
  const db = getDb();
  const key = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: params.userId,
      keyHash: key.hash,
      keyPrefix: key.prefix,
      keyLast4: key.last4,
      name: params.name ?? 'default',
    })
    .returning();
  await db
    .insert(rateLimits)
    .values({ userId: params.userId })
    .onConflictDoNothing({ target: rateLimits.userId });

  return {
    view: {
      id: row!.id,
      userId: row!.userId,
      name: row!.name,
      masked: maskApiKey(row!.keyPrefix, row!.keyLast4),
      status: row!.status,
      createdAt: row!.createdAt,
      lastUsedAt: null,
    },
    raw: key.raw,
  };
}

export async function revokeApiKey(userId: string, keyId: string) {
  const db = getDb();
  const [row] = await db
    .update(apiKeys)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning();
  if (!row) throw errors.notFound('API key not found');
  return true;
}

export async function rotateApiKey(userId: string, keyId: string) {
  await revokeApiKey(userId, keyId);
  return createApiKey({ userId, name: 'rotated' });
}

export async function listApiKeys(userId: string): Promise<ApiKeyView[]> {
  const rows = await getDb().select().from(apiKeys).where(eq(apiKeys.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    masked: maskApiKey(r.keyPrefix, r.keyLast4),
    status: r.status,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

export interface AuthenticatedKey {
  keyId: string;
  user: typeof users.$inferSelect;
  rate: typeof rateLimits.$inferSelect | null;
}

/** Hash-based lookup; the raw key is never stored or logged. */
export async function authenticateApiKey(raw: string): Promise<AuthenticatedKey | null> {
  if (!validateApiKeyFormat(raw)) return null;
  const db = getDb();
  const hash = hashApiKey(raw);
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
  const key = rows[0];
  if (!key || key.status !== 'active') return null;

  const userRows = await db.select().from(users).where(eq(users.id, key.userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const rateRows = await db.select().from(rateLimits).where(eq(rateLimits.userId, user.id)).limit(1);

  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .then(() => undefined)
    .catch(() => undefined);

  return { keyId: key.id, user, rate: rateRows[0] ?? null };
}
