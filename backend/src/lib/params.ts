import { errors } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reject non-UUID path params before they reach Postgres. Without this, a
 * malformed id raises SQLSTATE 22P02 which surfaces as a 500.
 */
export function assertUuid(value: string, what = 'id'): string {
  if (!UUID_RE.test(value)) {
    throw errors.validation(`Invalid ${what}`);
  }
  return value;
}

/** Parse an integer query param with bounds, returning fallback when absent/invalid. */
export function intParam(
  raw: unknown,
  { min = 0, max = Number.MAX_SAFE_INTEGER, fallback }: { min?: number; max?: number; fallback: number },
): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}