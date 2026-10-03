import { describe, expect, it, afterAll } from 'vitest';
import { MemoryLuaBackend } from '../../src/lib/quota-memory.js';
import { RateLimiter } from '../../src/services/rate-limit.js';

const backend = new MemoryLuaBackend();
let nowMs = 1_000_000;
const limiter = new RateLimiter(backend, () => nowMs);

afterAll(async () => {
  await backend.teardown();
});

describe('rate limiting (redis sliding window)', () => {
  it('allows up to N requests per minute then blocks', async () => {
    nowMs = 1_000_000;
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await limiter.check({ userId: 'u1', requestsPerMinute: 5, requestsPerHour: 100 }));
    }
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
    expect(results[5]!.allowed).toBe(false);
    expect(results[5]!.retryAfterSeconds).toBe(60);
  });

  it('slides the window: capacity frees after the window passes', async () => {
    nowMs = 2_000_000;
    for (let i = 0; i < 3; i++) {
      await limiter.check({ userId: 'u2', requestsPerMinute: 3, requestsPerHour: 100 });
    }
    const blocked = await limiter.check({ userId: 'u2', requestsPerMinute: 3, requestsPerHour: 100 });
    expect(blocked.allowed).toBe(false);

    nowMs += 61_000;
    const afterWindow = await limiter.check({ userId: 'u2', requestsPerMinute: 3, requestsPerHour: 100 });
    expect(afterWindow.allowed).toBe(true);
  });

  it('enforces the hourly window independently', async () => {
    nowMs = 3_000_000;
    for (let i = 0; i < 2; i++) {
      await limiter.check({ userId: 'u3', requestsPerMinute: 100, requestsPerHour: 2 });
    }
    const blocked = await limiter.check({ userId: 'u3', requestsPerMinute: 100, requestsPerHour: 2 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(3600);
  });

  it('is atomic under bursts (never overshoots the limit)', async () => {
    nowMs = 4_000_000;
    const decisions = await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.check({ userId: 'u4', requestsPerMinute: 5, requestsPerHour: 100 }),
      ),
    );
    const allowed = decisions.filter((d) => d.allowed).length;
    expect(allowed).toBe(5);
  });

  it('zero limit disables the window (unlimited)', async () => {
    nowMs = 5_000_000;
    for (let i = 0; i < 20; i++) {
      const d = await limiter.check({ userId: 'u5', requestsPerMinute: 0, requestsPerHour: 0 });
      expect(d.allowed).toBe(true);
    }
  });
});
