import type { ProviderModel } from '../providers/types.js';

/**
 * Auto-detect — probes a Mimo/Xiaomi-style upstream with a raw token and
 * discovers which of the common endpoint layouts it actually serves:
 *   models : /v1/models, /models, /api/models
 *   account: /v1/account, /api/account, /v1/user, /api/user, /v1/me, /api/me, /user, /account
 *   quota  : /v1/quota, /api/quota, /v1/usage, /api/usage, /usage, /v1/limits
 *
 * Any path that returns 2xx + parseable JSON is remembered and reused by the
 * provider on later syncs. Unknown layouts degrade gracefully: fields that
 * cannot be discovered are left null and the UI says so honestly.
 */

export interface DetectResult {
  detected: boolean;
  baseUrl: string;
  accountPath: string | null;
  usagePath: string | null;
  modelsPath: string | null;
  chatPath: string | null;
  plan: string | null;
  totalQuota: number | null;
  usedQuota: number | null;
  remainingQuota: number | null;
  quotaResetAt: string | null;
  models: ProviderModel[];
  raw: { account?: unknown; quota?: unknown; models?: unknown };
  errors: Record<string, string>;
}

const PROBE_TIMEOUT_MS = 7000;

const MODELS_PATHS = ['/v1/models', '/models', '/api/models'];
const ACCOUNT_PATHS = ['/v1/account', '/api/account', '/v1/user', '/api/user', '/v1/me', '/api/me', '/user', '/account'];
const QUOTA_PATHS = ['/v1/quota', '/api/quota', '/v1/usage', '/api/usage', '/usage', '/v1/limits', '/api/limits'];

async function probeJson(baseUrl: string, path: string, token: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
}

function deepPick(obj: unknown, keys: string[]): unknown {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = deepPick(item, keys);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const k of keys) {
      if (record[k] !== undefined && record[k] !== null) return record[k];
    }
    for (const v of Object.values(record)) {
      const found = deepPick(v, keys);
      if (found !== undefined && found !== null) return found;
    }
  }
  return undefined;
}

function quoteFrom(body: unknown, keys: string[]): number | null {
  const v = deepPick(body, keys);
  return asNumber(v);
}

function planOf(body: unknown): string | null {
  const v = deepPick(body, ['plan', 'plan_name', 'planName', 'package', 'tier', 'membership']);
  return typeof v === 'string' ? v : null;
}

function modelsOf(body: unknown): ProviderModel[] {
  if (!body) return [];
  const list: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown>)?.data)
      ? ((body as Record<string, unknown>).data as unknown[])
      : [];
  const out: ProviderModel[] = [];
  for (const item of list) {
    const rec = item as Record<string, unknown>;
    const id = rec.id ?? rec.model ?? rec.name;
    if (typeof id === 'string' && id) {
      out.push({
        id,
        ownedBy:
          typeof rec.owned_by === 'string'
            ? rec.owned_by
            : typeof rec.ownedBy === 'string'
              ? rec.ownedBy
              : null,
        raw: item,
      });
    }
  }
  return out;
}

export async function detectAccount(baseUrl: string, token: string): Promise<DetectResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const errors: Record<string, string> = {};
  const raw: DetectResult['raw'] = {};

  let accountPath: string | null = null;
  let usagePath: string | null = null;
  let modelsPath: string | null = null;
  let accountBody: unknown = null;
  let quotaBody: unknown = null;
  let modelsBody: unknown = null;

  // Models first — cheapest and most reliable signal that the token works.
  for (const p of MODELS_PATHS) {
    const body = await probeJson(base, p, token);
    if (body !== null) {
      const models = modelsOf(body);
      if (models.length > 0 || Array.isArray(body)) {
        modelsPath = p;
        modelsBody = body;
        raw.models = body;
        break;
      }
      errors[p] = 'no models in payload';
    } else {
      errors[p] = 'no 2xx';
    }
  }

  // Account info (plan).
  for (const p of ACCOUNT_PATHS) {
    const body = await probeJson(base, p, token);
    if (body !== null) {
      accountPath = p;
      accountBody = body;
      raw.account = body;
      break;
    }
    errors[p] = 'no 2xx';
  }

  // Quota / usage.
  for (const p of QUOTA_PATHS) {
    const body = await probeJson(base, p, token);
    if (body !== null) {
      usagePath = p;
      quotaBody = body;
      raw.quota = body;
      break;
    }
    errors[p] = 'no 2xx';
  }

  const plan = planOf(accountBody ?? quotaBody);
  const totalQuota = quoteFrom(quotaBody ?? accountBody, ['total_quota', 'totalQuota', 'total', 'quota_total', 'max_tokens', 'daily_limit', 'limit']);
  const usedQuota = quoteFrom(quotaBody ?? accountBody, ['used_quota', 'usedQuota', 'used', 'quota_used', 'used_tokens']);
  const remainingQuota = quoteFrom(quotaBody ?? accountBody, ['remaining_quota', 'remainingQuota', 'remaining', 'quota_remaining', 'remaining_tokens', 'balance']);
  const resetAt = deepPick(quotaBody ?? accountBody, ['reset_at', 'reset_date', 'resetAt', 'expires_at']) ?? null;

  const detected = modelsPath !== null || accountPath !== null || usagePath !== null;

  return {
    detected,
    baseUrl: base,
    accountPath,
    usagePath,
    modelsPath,
    chatPath: '/v1/chat/completions',
    plan,
    totalQuota,
    usedQuota,
    remainingQuota,
    quotaResetAt: resetAt !== null && typeof resetAt === 'string' ? resetAt : null,
    models: modelsPath ? modelsOf(modelsBody ?? modelsBody) : [],
    raw,
    errors,
  };
}