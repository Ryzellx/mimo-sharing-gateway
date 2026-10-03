import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, seedUser, type TestContext } from '../helpers/test-context.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.teardown();
});

describe('provider abstraction + mimo integration points', () => {
  it('never exposes the raw token (encrypted at rest, masked at API level)', async () => {
    const account = (await ctx.mimo.listAccounts())[0]!;
    expect(account.tokenEncrypted).not.toContain('mimo_test_token_1234');
    expect(account.tokenEncrypted.startsWith('v1.')).toBe(true);
    expect(account.tokenMasked.startsWith('mimo_tes')).toBe(true);
    expect(account.tokenMasked.endsWith('1234')).toBe(true);
  });

  it('reports "not configured" instead of inventing quota endpoints', async () => {
    // The default provider has no MIMO_USAGE_PATH / MIMO_ACCOUNT_PATH configured,
    // so sync must report the integration point as missing — not fake numbers.
    const { MimoAccountService } = await import('../../src/services/mimo-accounts.js');
    const unconfigured = new MimoAccountService();
    const result = await unconfigured.syncAccount(ctx.accountId);
    expect(result.status).toBe('not_configured');
    expect(result.officialUsed).toBeNull();
    expect(result.detail).toContain('not configured');
  });

  it('syncs account info when integration points are configured', async () => {
    const { db } = ctx;
    const { quotaSnapshots, reconciliationLogs } = await import('../../src/db/schema.js');
    const { eq } = await import('drizzle-orm');

    const result = await ctx.mimo.syncAccount(ctx.accountId);
    expect(result.status).toBe('ok');
    expect(result.officialUsed).toBe(1_000_000);
    expect(result.account.plan).toBe('mimo-pro');

    const snapshots = await db
      .select()
      .from(quotaSnapshots)
      .where(eq(quotaSnapshots.accountId, ctx.accountId));
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.at(-1)!.totalQuota).toBe(6_000_000_000);

    const recs = await db
      .select()
      .from(reconciliationLogs)
      .where(eq(reconciliationLogs.accountId, ctx.accountId));
    expect(recs.length).toBeGreaterThan(0);
    const last = recs.at(-1)!;
    // local usage (0) vs official (1,000,000) -> difference recorded, local data untouched
    expect(Number(last.officialUsage)).toBe(1_000_000);
    expect(Number(last.difference)).toBe(-1_000_000);
  });

  it('lists models from the configured models endpoint', async () => {
    const models = await ctx.mimo.listModels(ctx.accountId);
    expect(models.map((m) => m.modelId)).toContain('mimo-v2');
  });

  it('chat goes to the account base url with the decrypted token', async () => {
    ctx.mock.behavior.withUsage = true;
    const account = await ctx.mimo.getAccount(ctx.accountId);
    const result = await ctx.mimo.chat(account, {
      model: 'mimo-v2',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });
    expect(result.status).toBe(200);
    const call = ctx.mock.calls.at(-1)!;
    expect(call.path).toContain('/chat/completions');
  });
});

describe('admin/user isolation helpers', () => {
  it('creates isolated users with their own allocation', async () => {
    const a = await seedUser(ctx, { username: 'iso-a', totalTokens: 2_000_000_000 });
    const b = await seedUser(ctx, { username: 'iso-b', totalTokens: 2_000_000_000 });
    expect(a.user.id).not.toBe(b.user.id);
    const { getUserAllocationView } = await import('../../src/services/allocations.js');
    const allocA = await getUserAllocationView(a.user.id);
    const allocB = await getUserAllocationView(b.user.id);
    expect(allocA!.totalTokens).toBe(2_000_000_000);
    expect(allocB!.totalTokens).toBe(2_000_000_000);
  });
});
