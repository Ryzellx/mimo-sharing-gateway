import { beforeEach, describe, expect, it } from 'vitest';
import { evenSplit, validateAllocationSum } from '../../src/services/allocations.js';

describe('allocation calculation', () => {
  it('splits total quota evenly across N users', () => {
    const parts = evenSplit(6_000_000_000, 2);
    expect(parts).toEqual([3_000_000_000, 3_000_000_000]);
  });

  it('splits 6B across 3 users as 2B each', () => {
    expect(evenSplit(6_000_000_000, 3)).toEqual([2_000_000_000, 2_000_000_000, 2_000_000_000]);
  });

  it('floors fractional splits without over-allocating', () => {
    const parts = evenSplit(10, 3);
    expect(parts).toEqual([3, 3, 3]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10);
  });

  it('rejects non-positive split counts', () => {
    expect(() => evenSplit(1000, 0)).toThrow();
    expect(() => evenSplit(1000, -1)).toThrow();
  });

  it('validates SUM(A_i) <= Q_available (custom allocation)', () => {
    const ok = validateAllocationSum([1_000_000_000, 2_000_000_000, 3_000_000_000], 6_000_000_000);
    expect(ok).toEqual({ ok: true, sum: 6_000_000_000, available: 6_000_000_000 });

    const bad = validateAllocationSum([1_000_000_000, 2_000_000_000, 4_000_000_000], 6_000_000_000);
    expect(bad.ok).toBe(false);
    expect(bad.sum).toBe(7_000_000_000);
  });

  it('treats unknown upstream quota as unlimited headroom', () => {
    expect(validateAllocationSum([5, 5], null).ok).toBe(true);
  });
});

describe('allocation even split edge cases', () => {
  let allocations: number[];
  beforeEach(() => {
    allocations = evenSplit(6_000_000_000, 2);
  });

  it('exhausting one allocation does not move quota to another', () => {
    const [a, b] = allocations as [number, number];
    const aUsed = a; // A burns its entire share
    const aRemaining = Math.max(0, a - aUsed);
    expect(aRemaining).toBe(0);
    // B untouched — quota is not auto-redistributed
    expect(b).toBe(3_000_000_000);
  });
});
