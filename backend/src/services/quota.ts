import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { allocations, quotaReservations, users } from '../db/schema.js';
import { errors } from '../lib/errors.js';
import * as lua from '../lib/quota-lua.js';
import { getQuotaBackend, type QuotaBackend } from '../lib/redis.js';
import { config } from '../config.js';

export interface ReserveParams {
  userId: string;
  requestId: string;
  amount: number;
  allocated: number;
  scope?: string;
  ttlSeconds?: number;
}

export interface ReserveResult {
  ok: boolean;
  reserved: number;
}

/**
 * Quota lifecycle: reserve() -> request() -> finalize() | release().
 *
 * All counter math happens inside single atomic Lua scripts, so two concurrent
 * requests can never both pass the same remaining budget. `used`/`reserved`
 * counters are mirrored to Postgres asynchronously for durability and for the
 * dashboard, while Redis is the fast, race-free source of truth on the hot path.
 */
export class QuotaService {
  constructor(private readonly backendOverride?: QuotaBackend, private readonly now: () => number = () => Date.now()) {}

  private get backend(): QuotaBackend {
    return this.backendOverride ?? getQuotaBackend();
  }

  private scopeOf(userId: string, override?: string): string {
    return override ?? `user:${userId}`;
  }

  async reserve(p: ReserveParams): Promise<ReserveResult> {
    const scope = this.scopeOf(p.userId, p.scope);
    const ttl = p.ttlSeconds ?? config.env.RESERVATION_TTL_SECONDS;
    const result = await this.backend.eval(
      lua.RESERVE,
      [
        lua.KEY.used(scope),
        lua.KEY.reserved(scope),
        lua.KEY.reservation(p.requestId),
        lua.KEY.reservationsZset,
      ],
      [
        String(p.allocated),
        String(p.amount),
        String(ttl),
        String(this.now()),
        scope,
        p.requestId,
      ],
    );
    const ok = Number(result) === 1;
    if (ok) {
      await this.persistReservation(p, ttl).catch(() => undefined);
    }
    return { ok, reserved: ok ? p.amount : 0 };
  }

  async finalize(p: {
    userId: string;
    requestId: string;
    actual: number;
    allocated: number;
    scope?: string;
  }): Promise<number> {
    const scope = this.scopeOf(p.userId, p.scope);
    const released = await this.backend.eval(
      lua.FINALIZE,
      [
        lua.KEY.reservation(p.requestId),
        lua.KEY.used(scope),
        lua.KEY.reserved(scope),
        lua.KEY.reservationsZset,
      ],
      [String(p.actual), String(p.allocated), p.requestId],
    );
    await this.closeReservation(p.requestId, p.userId, 'committed', p.actual).catch(() => undefined);
    return Number(released ?? 0);
  }

  async release(p: { userId: string; requestId: string; scope?: string }): Promise<number> {
    const scope = this.scopeOf(p.userId, p.scope);
    const released = await this.backend.eval(
      lua.RELEASE,
      [lua.KEY.reservation(p.requestId), lua.KEY.reserved(scope), lua.KEY.reservationsZset],
      [p.requestId],
    );
    await this.closeReservation(p.requestId, p.userId, 'released', 0).catch(() => undefined);
    return Number(released ?? 0);
  }

  async reapExpired(): Promise<number> {
    const reaped = await this.backend.eval(
      lua.REAP_EXPIRED,
      [lua.KEY.reservationsZset],
      [String(this.now()), lua.KEY.reservedPrefix, lua.KEY.reservationPrefix],
    );
    const count = Number(reaped ?? 0);
    if (count > 0) {
      const db = getDb();
      await db
        .update(quotaReservations)
        .set({ status: 'expired', finalizedAt: new Date() })
        .where(
          sql`${quotaReservations.status} = 'reserved' AND ${quotaReservations.expiresAt} < now()`,
        );
    }
    return count;
  }

  /** Read the live counters held by the backend. */
  async getCounters(scope: string): Promise<{ used: number; reserved: number }> {
    const raw = await this.backend.eval(
      lua.GET_COUNTERS,
      [lua.KEY.used(scope), lua.KEY.reserved(scope)],
      [],
    );
    const [used, reserved] = String(raw ?? '0:0').split(':');
    return { used: Number(used ?? 0), reserved: Number(reserved ?? 0) };
  }

  /** Force counters to known values (used when reconciling from Postgres). */
  async setCounters(scope: string, used: number, reserved: number) {
    await this.backend.eval(
      lua.SET_COUNTERS,
      [lua.KEY.used(scope), lua.KEY.reserved(scope)],
      [String(used), String(reserved)],
    );
  }

  /** Mirror Redis counters into the allocations row (non-hot path). */
  async syncCountersToDb(userId: string) {
    const { used, reserved } = await this.getCounters(`user:${userId}`);
    const db = getDb();
    await db
      .update(allocations)
      .set({ usedTokens: used, reservedTokens: reserved, updatedAt: new Date() })
      .where(eq(allocations.userId, userId));
    return { used, reserved };
  }

  private async persistReservation(p: ReserveParams, ttlSeconds: number) {
    const db = getDb();
    await db.insert(quotaReservations).values({
      userId: p.userId,
      requestId: p.requestId,
      amount: p.amount,
      status: 'reserved',
      expiresAt: new Date(this.now() + ttlSeconds * 1000),
    });
    await db
      .update(users)
      .set({ lastRequestAt: new Date() })
      .where(eq(users.id, p.userId));
  }

  private async closeReservation(
    requestId: string,
    userId: string,
    status: 'committed' | 'released',
    actual: number,
  ) {
    const db = getDb();
    await db
      .update(quotaReservations)
      .set({ status, finalizedAt: new Date(), amount: actual })
      .where(eq(quotaReservations.requestId, requestId));
    await db
      .update(users)
      .set({ lastRequestAt: new Date() })
      .where(eq(users.id, userId));
  }
}

export function quotaExceededError() {
  return errors.quotaExceeded('Quota exhausted: allocation has no remaining tokens');
}

let defaultService: QuotaService | null = null;
export function getQuotaService(): QuotaService {
  defaultService ??= new QuotaService();
  return defaultService;
}
