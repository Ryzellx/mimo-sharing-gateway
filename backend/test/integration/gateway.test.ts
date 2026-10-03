import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import { usageLogs, quotaReservations, requestLogs, apiKeys } from '../../src/db/schema.js';
import { getQuotaService } from '../../src/services/quota.js';
import { createTestContext, seedUser, type TestContext } from '../helpers/test-context.js';
import type { FastifyInstance } from 'fastify';

let ctx: TestContext;
let app: FastifyInstance;

beforeAll(async () => {
  ctx = await createTestContext();
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await ctx.teardown();
});

beforeEach(() => {
  ctx.mock.behavior.mode = 'ok';
  ctx.mock.behavior.withUsage = true;
  ctx.mock.behavior.latencyMs = 0;
  ctx.mock.behavior.stream = false;
});

function authHeader(apiKey: string) {
  return { authorization: `Bearer ${apiKey}` };
}

const chatBody = (over: Record<string, unknown> = {}) => ({
  model: 'mimo-v2',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false,
  ...over,
});

describe('gateway request lifecycle', () => {
  it('routes a valid request end-to-end and commits official usage', async () => {
    ctx.mock.behavior.mode = 'ok';
    ctx.mock.behavior.withUsage = true;
    const { apiKey, user } = await seedUser(ctx, { username: 'alice', totalTokens: 1_000_000 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.choices[0].message.content).toContain('mock upstream');
    expect(res.headers['x-quota-source']).toBe('official');

    const [log] = await ctx.db.select().from(usageLogs).where(eq(usageLogs.userId, user.id));
    expect(log).toBeTruthy();
    expect(log!.usageSource).toBe('official');
    expect(log!.promptTokens).toBe(12);
    expect(log!.completionTokens).toBe(6);
    expect(log!.totalTokens).toBe(18);

    const counters = await getQuotaService().getCounters(`user:${user.id}`);
    expect(counters.used).toBe(18);
    expect(counters.reserved).toBe(0);
  });

  it('rejects an invalid api key with INVALID_API_KEY', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader('gw_live_totallybogus0000'),
      payload: chatBody(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_API_KEY');
  });

  it('rejects a disabled user with USER_DISABLED', async () => {
    const { apiKey, user } = await seedUser(ctx, { username: 'bob', totalTokens: 1000 });
    await ctx.db
      .update((await import('../../src/db/schema.js')).users)
      .set({ status: 'disabled' })
      .where(eq((await import('../../src/db/schema.js')).users.id, user.id));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('USER_DISABLED');
  });

  it('locks a user whose allocation is exhausted while others keep working', async () => {
    ctx.mock.behavior.withUsage = true;
    const a = await seedUser(ctx, { username: 'carol', totalTokens: 3_000_000_000 });
    const b = await seedUser(ctx, { username: 'dave', totalTokens: 3_000_000_000 });

    // Burn carol's entire allocation (simulate her using all 3B)
    await getQuotaService().setCounters(`user:${a.user.id}`, 3_000_000_000, 0);

    const resA = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(a.apiKey),
      payload: chatBody(),
    });
    expect(resA.statusCode).toBe(402);
    expect(resA.json().error.code).toBe('QUOTA_EXCEEDED');

    // Quota is NOT moved from carol to dave — dave works only on his own share
    const resB = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(b.apiKey),
      payload: chatBody(),
    });
    expect(resB.statusCode).toBe(200);

    const countersB = await getQuotaService().getCounters(`user:${b.user.id}`);
    expect(countersB.used).toBeLessThan(3_000_000_000);
  });

  it('rejects when the allocation cannot cover the reservation', async () => {
    const { apiKey } = await seedUser(ctx, { username: 'erin', totalTokens: 500 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody({ max_tokens: 4096 }),
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('critical concurrency: two overlapping requests cannot oversubscribe remaining quota', async () => {
    ctx.mock.behavior.latencyMs = 30;
    const { apiKey, user } = await seedUser(ctx, { username: 'frank', totalTokens: 200 });
    // each request reserves prompt + DEFAULT_MAX_TOKENS(2048) > 200 -> both rejected
    // so give the user exactly enough for one request reservation
    await (await import('../../src/services/allocations.js')).setUserAllocation({
      userId: user.id,
      totalTokens: 2200,
      changedBy: 'test',
    });
    await getQuotaService().setCounters(`user:${user.id}`, 0, 0);

    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: authHeader(apiKey),
        payload: chatBody(),
      }),
      app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: authHeader(apiKey),
        payload: chatBody(),
      }),
    ]);

    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([200, 402]);

    const counters = await getQuotaService().getCounters(`user:${user.id}`);
    expect(counters.used).toBeGreaterThanOrEqual(0);
    expect(counters.used + counters.reserved).toBeLessThanOrEqual(2200);
    ctx.mock.behavior.latencyMs = 0;
  });

  it('falls back to estimated usage when upstream omits usage', async () => {
    ctx.mock.behavior.withUsage = false;
    const { apiKey, user } = await seedUser(ctx, { username: 'gina', totalTokens: 100_000 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-quota-source']).toBe('estimated');

    const [log] = await ctx.db.select().from(usageLogs).where(eq(usageLogs.userId, user.id));
    expect(log!.usageSource).toBe('estimated');
    expect(log!.totalTokens).toBe(log!.promptTokens + log!.completionTokens);
    ctx.mock.behavior.withUsage = true;
  });

  it('streams SSE, records usage after the stream, and refunds nothing extra', async () => {
    ctx.mock.behavior.withUsage = true;
    const { apiKey, user } = await seedUser(ctx, { username: 'hank', totalTokens: 100_000 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody({ stream: true }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('data:');
    expect(res.payload).toContain('[DONE]');

    // allow the async finalize to land
    await new Promise((r) => setTimeout(r, 250));

    const [log] = await ctx.db.select().from(usageLogs).where(eq(usageLogs.userId, user.id));
    expect(log).toBeTruthy();
    expect(log!.usageSource).toBe('official');
    expect(log!.totalTokens).toBe(17);

    const counters = await getQuotaService().getCounters(`user:${user.id}`);
    expect(counters.used).toBe(17);
    expect(counters.reserved).toBe(0);
  });

  it('maps upstream failure to UPSTREAM_ERROR and releases the reservation', async () => {
    ctx.mock.behavior.mode = 'error';
    const { apiKey, user } = await seedUser(ctx, { username: 'iris', totalTokens: 100_000 });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('UPSTREAM_ERROR');

    const counters = await getQuotaService().getCounters(`user:${user.id}`);
    expect(counters.reserved).toBe(0);
    expect(counters.used).toBe(0);
    ctx.mock.behavior.mode = 'ok';
  });

  it('maps upstream auth failure to MIMO_AUTH_ERROR', async () => {
    ctx.mock.behavior.mode = 'auth_error';
    const { apiKey } = await seedUser(ctx, { username: 'judy', totalTokens: 100_000 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('MIMO_AUTH_ERROR');
    ctx.mock.behavior.mode = 'ok';
  });

  it('revoking an api key immediately blocks further requests', async () => {
    const { apiKey, user } = await seedUser(ctx, { username: 'kate', totalTokens: 100_000 });
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    expect(ok.statusCode).toBe(200);

    const [key] = await ctx.db.select().from(apiKeys).where(eq(apiKeys.userId, user.id));
    await ctx.db.update(apiKeys).set({ status: 'revoked' }).where(eq(apiKeys.id, key!.id));

    const after = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('INVALID_API_KEY');
  });

  it('reserves then commits: reservation rows are closed', async () => {
    const { apiKey, user } = await seedUser(ctx, { username: 'liam', totalTokens: 100_000 });
    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    const rows = await ctx.db
      .select()
      .from(quotaReservations)
      .where(eq(quotaReservations.userId, user.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('committed');
  });

  it('writes request logs with status and timing', async () => {
    const { apiKey, user } = await seedUser(ctx, { username: 'mona', totalTokens: 100_000 });
    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeader(apiKey),
      payload: chatBody(),
    });
    const rows = await ctx.db
      .select()
      .from(requestLogs)
      .where(eq(requestLogs.userId, user.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.httpStatus).toBe(200);
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('lists models through the OpenAI-compatible endpoint', async () => {
    const { apiKey } = await seedUser(ctx, { username: 'nina', totalTokens: 1000 });
    await ctx.mimo.syncAccount(ctx.accountId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: authHeader(apiKey),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.object).toBe('list');
    expect(json.data.some((m: any) => m.id === 'mimo-v2')).toBe(true);
  });
});
