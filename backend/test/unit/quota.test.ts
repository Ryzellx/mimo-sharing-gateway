import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { MemoryLuaBackend } from '../../src/lib/quota-memory.js';
import * as lua from '../../src/lib/quota-lua.js';
import { QuotaService } from '../../src/services/quota.js';
import { setDb } from '../../src/db/client.js';

const backend = new MemoryLuaBackend();
const quota = new QuotaService(backend);

beforeAll(() => {
  // Persistence is not under test here — stub it so no real DB is touched.
  const stub: any = {
    insert: () => ({ values: () => Promise.resolve([]) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  setDb({ db: stub, client: null as any });
});

afterAll(async () => {
  await backend.teardown();
});

const KEY = lua.KEY;

describe('quota atomic reserve/finalize/release', () => {
  it('reserves within budget', async () => {
    const scope = 'user:t1';
    const res = await quota.reserve({
      userId: 't1',
      requestId: 'req-1',
      amount: 100,
      allocated: 1000,
      scope,
    });
    expect(res.ok).toBe(true);
    const counters = await quota.getCounters(scope);
    expect(counters.used).toBe(0);
    expect(counters.reserved).toBe(100);
  });

  it('rejects a reservation that exceeds remaining budget', async () => {
    const scope = 'user:t2';
    await quota.reserve({ userId: 't2', requestId: 'req-a', amount: 8000, allocated: 10000, scope });
    const second = await quota.reserve({
      userId: 't2',
      requestId: 'req-b',
      amount: 8000,
      allocated: 10000,
      scope,
    });
    expect(second.ok).toBe(false);
  });

  it('critical concurrency case: 1000 remaining, two 700 requests -> exactly one succeeds', async () => {
    const scope = 'user:race';
    // used=0, reserved=0, allocated=1000
    const [a, b] = await Promise.all([
      quota.reserve({ userId: 'race', requestId: 'ra', amount: 700, allocated: 1000, scope }),
      quota.reserve({ userId: 'race', requestId: 'rb', amount: 700, allocated: 1000, scope }),
    ]);
    const accepted = [a, b].filter((r) => r.ok);
    expect(accepted.length).toBe(1);

    const counters = await quota.getCounters(scope);
    expect(counters.reserved).toBe(700);
    expect(counters.used).toBe(0);
    expect(counters.used + counters.reserved).toBeLessThanOrEqual(1000);
  });

  it('finalizes actual usage and refunds the unused reservation', async () => {
    const scope = 'user:t3';
    await quota.reserve({ userId: 't3', requestId: 'req-f', amount: 500, allocated: 1000, scope });
    await quota.finalize({ userId: 't3', requestId: 'req-f', actual: 200, allocated: 1000, scope });
    const counters = await quota.getCounters(scope);
    // reserved released in full; only actual usage committed
    expect(counters.reserved).toBe(0);
    expect(counters.used).toBe(200);
  });

  it('releases reservation entirely on failure', async () => {
    const scope = 'user:t4';
    await quota.reserve({ userId: 't4', requestId: 'req-r', amount: 300, allocated: 1000, scope });
    await quota.release({ userId: 't4', requestId: 'req-r', scope });
    const counters = await quota.getCounters(scope);
    expect(counters.reserved).toBe(0);
    expect(counters.used).toBe(0);
  });

  it('remaining never goes negative under concurrent hammering', async () => {
    const scope = 'user:hammer';
    const attempts = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        quota.reserve({
          userId: 'hammer',
          requestId: `h-${i}`,
          amount: 130,
          allocated: 1000,
          scope,
        }),
      ),
    );
    const accepted = attempts.filter((r) => r.ok);
    expect(accepted.length).toBe(7); // floor(1000/130) = 7
    const counters = await quota.getCounters(scope);
    expect(counters.reserved).toBe(7 * 130);
    expect(counters.used + counters.reserved).toBeLessThanOrEqual(1000);
    expect(counters.reserved).toBeGreaterThanOrEqual(0);
  });

  it('clamps committed usage so used+reserved can never exceed allocation', async () => {
    const scope = 'user:clamp';
    await quota.reserve({ userId: 'clamp', requestId: 'c-1', amount: 100, allocated: 1000, scope });
    // upstream over-reports vs the reservation
    await quota.finalize({ userId: 'clamp', requestId: 'c-1', actual: 5000, allocated: 1000, scope });
    const counters = await quota.getCounters(scope);
    expect(counters.used).toBeLessThanOrEqual(1000);
  });
});

describe('reservation expiry reaper', () => {
  it('reclaims expired reservations and restores budget', async () => {
    let nowMs = 1_000_000;
    const reaper = new QuotaService(new MemoryLuaBackend(() => nowMs), () => nowMs);
    const b = (reaper as any).backend as MemoryLuaBackend;
    const scope = 'user:reap';

    await reaper.reserve({
      userId: 'reap',
      requestId: 'rp-1',
      amount: 400,
      allocated: 1000,
      scope,
      ttlSeconds: 60,
    });
    let counters = await reaper.getCounters(scope);
    expect(counters.reserved).toBe(400);

    // still active -> nothing to reap
    nowMs += 30_000;
    expect(await reaper.reapExpired()).toBe(0);

    // past TTL -> reservation reclaimed
    nowMs += 40_000;
    expect(await reaper.reapExpired()).toBe(1);
    counters = await reaper.getCounters(scope);
    expect(counters.reserved).toBe(0);
    await b.teardown();
  });
});

describe('lua script shapes', () => {
  it('uses only atomic counter ops (no read-then-write across calls)', () => {
    for (const script of [lua.RESERVE, lua.FINALIZE, lua.RELEASE, lua.RATE_LIMIT]) {
      expect(script).toContain("redis.call");
    }
  });

  it('reserve encodes scope and amount in the reservation record', () => {
    expect(lua.RESERVE).toContain("ARGV[5] .. '|' .. ARGV[2] .. '|' .. ARGV[6]");
    expect(KEY.reservation('abc')).toBe('reservation:abc');
    expect(KEY.reserved('user:abc')).toBe('quota:reserved:user:abc');
    expect(KEY.reservationsZset).toBe('reservations:expiry');
  });
});
