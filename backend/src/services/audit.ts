import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { auditLogs, systemSettings } from '../db/schema.js';

export type AuditAction =
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DISABLED'
  | 'USER_ENABLED'
  | 'API_KEY_CREATED'
  | 'API_KEY_REVOKED'
  | 'ALLOCATION_CHANGED'
  | 'ALLOCATION_REBALANCED'
  | 'MIMO_TOKEN_ADDED'
  | 'MIMO_TOKEN_REMOVED'
  | 'MIMO_TOKEN_TESTED'
  | 'MIMO_REDETECTED'
  | 'ALLOCATION_REVOKED'
  | 'CUSTOM_MODEL_CREATED'
  | 'CUSTOM_MODEL_UPDATED'
  | 'CUSTOM_MODEL_DELETED'
  | 'QUOTA_SYNCED'
  | 'ADMIN_LOGIN'
  | 'USER_LOGIN'
  | 'SETTINGS_CHANGED';

export async function recordAudit(entry: {
  actor: string;
  action: AuditAction;
  target?: string | null;
  metadata?: unknown;
  ip?: string | null;
}) {
  await getDb().insert(auditLogs).values({
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    metadata: entry.metadata ?? null,
    ip: entry.ip ?? null,
  });
}

export async function listAudit(limit = 100) {
  return getDb().select().from(auditLogs).orderBy(auditLogs.createdAt).limit(limit);
}

export async function getSettingValue<T>(key: string, fallback: T): Promise<T> {
  const rows = await getDb()
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  const row = rows[0];
  return row ? (row.value as T) : fallback;
}

export async function setSettingValue(key: string, value: unknown) {
  await getDb()
    .insert(systemSettings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: value as never, updatedAt: new Date() },
    });
}

export async function listSettings(): Promise<Record<string, unknown>> {
  const rows = await getDb().select().from(systemSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
