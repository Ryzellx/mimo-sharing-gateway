import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  buildUsage,
  estimateMessageTokens,
  estimateTokens,
  type UsageTotals,
} from '../lib/token-estimate.js';
import { authenticateApiKey } from '../services/api-keys.js';
import { getAllocationRow } from '../services/allocations.js';
import { getQuotaService, quotaExceededError } from '../services/quota.js';
import { getRateLimiter } from '../services/rate-limit.js';
import { recordRequest, recordUsage, type UsageSource } from '../services/usage.js';
import { mimoAccounts$ } from '../services/mimo-accounts.js';
import { customModels$ } from '../services/custom-models.js';
import { getDb } from '../db/client.js';
import { mimoModels } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { ChatResult, UpstreamUsage } from '../providers/types.js';

const ChatBody = z.object({
  model: z.string().min(1),
  messages: z.array(z.any()).min(1),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
});

type ChatBodyType = z.infer<typeof ChatBody>;

function extractBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw errors.invalidApiKey();
  return header.slice(7);
}

function estimateRequestTokens(body: ChatBodyType): { prompt: number; completionBudget: number } {
  let prompt = 0;
  for (const m of body.messages) {
    prompt += estimateMessageTokens(m?.content) + 4;
  }
  prompt += estimateTokens(body.model) + 2;
  const completionBudget = body.max_tokens ?? config.env.DEFAULT_MAX_TOKENS;
  return { prompt, completionBudget };
}

function parseSseUsage(buffer: string): UpstreamUsage | null {
  let last: UpstreamUsage | null = null;
  for (const line of buffer.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      if (obj?.usage && typeof obj.usage === 'object') {
        last = obj.usage as UpstreamUsage;
      }
    } catch {
      /* ignore malformed SSE frames */
    }
  }
  return last;
}

function completionTextFromSse(buffer: string): string {
  let out = '';
  for (const line of buffer.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      const delta = obj?.choices?.[0]?.delta?.content ?? obj?.choices?.[0]?.message?.content;
      if (typeof delta === 'string') out += delta;
    } catch {
      /* ignore */
    }
  }
  return out;
}

function completionTextFromJson(body: any): string {
  const content = body?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

export function registerGatewayRoutes(app: FastifyInstance) {
  const quota = getQuotaService();
  const limiter = getRateLimiter();

  app.post(
    '/v1/chat/completions',
    {
      schema: {
        tags: ['gateway'],
        summary: 'OpenAI-compatible chat completions proxied to Mimo',
        security: [{ bearerAuth: [] }],
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const requestId = randomUUID();
      const startedAt = Date.now();

      // Authenticate BEFORE parsing the body so an unauthenticated caller cannot
      // use validation errors to probe the request schema.
      const auth = await authenticateApiKey(extractBearer(req));
      if (!auth) {
        await persistRequest(requestId, null, 'unknown', false, 401, 'INVALID_API_KEY', startedAt, req);
        throw errors.invalidApiKey();
      }

      const parsed = ChatBody.safeParse(req.body);
      if (!parsed.success) {
        throw errors.validation(parsed.error.issues.map((i) => i.message).join('; '));
      }
      const body = parsed.data;

      const user = auth.user;
      if (user.status !== 'active') {
        await persistRequest(requestId, user.id, body.model, false, 403, 'USER_DISABLED', startedAt, req);
        throw errors.userDisabled();
      }
      if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
        await persistRequest(requestId, user.id, body.model, false, 403, 'USER_EXPIRED', startedAt, req);
        throw errors.userExpired();
      }

      const rate = await limiter.check({
        userId: user.id,
        requestsPerMinute: auth.rate?.requestsPerMinute,
        requestsPerHour: auth.rate?.requestsPerHour,
      });
      if (!rate.allowed) {
        await persistRequest(requestId, user.id, body.model, false, 429, 'RATE_LIMITED', startedAt, req);
        reply.header('retry-after', String(rate.retryAfterSeconds));
        throw errors.rateLimited(rate.retryAfterSeconds);
      }
      reply.header('x-ratelimit-remaining-minute', String(rate.remainingMinute));
      reply.header('x-ratelimit-remaining-hour', String(rate.remainingHour));

      const allocation = await getAllocationRow(user.id);
      const sharedPool = config.env.QUOTA_MODE === 'shared_pool' || user.sharedPool;
      const scope = sharedPool ? 'shared' : `user:${user.id}`;
      const allocated = sharedPool
        ? allocation?.totalTokens ?? config.env.DEFAULT_MAX_TOKENS * 1000
        : allocation?.totalTokens ?? 0;

      const { prompt, completionBudget } = estimateRequestTokens(body);
      const estimate = prompt + completionBudget;

      const reserved = await quota.reserve({
        userId: user.id,
        requestId,
        amount: estimate,
        allocated,
        scope,
      });
      if (!reserved.ok) {
        await persistRequest(requestId, user.id, body.model, body.stream, 402, 'QUOTA_EXCEEDED', startedAt, req);
        throw quotaExceededError();
      }

      // Resolve custom models (alias -> target + system prompt injection).
      // When the requested model is a custom alias, skip the upstream catalog
      // check (the alias only exists in the custom table) and rewrite the
      // outbound request. Usage is still logged under the alias the user asked
      // for, so per-alias analytics stay meaningful.
      const custom = await customModels$.resolve(body.model, allocation?.accountId ?? null);
      const outboundModel = custom?.targetModel ?? body.model;
      const outboundMessages = custom
        ? injectSystemPrompt(body.messages, custom.systemPrompt)
        : body.messages;

      if (!custom && allocation?.accountId) {
        const known = await getDb()
          .select()
          .from(mimoModels)
          .where(eq(mimoModels.accountId, allocation.accountId));
        if (known.length > 0 && !known.some((m) => m.modelId === body.model)) {
          await quota.release({ userId: user.id, requestId, scope });
          await persistRequest(requestId, user.id, body.model, body.stream, 404, 'MODEL_NOT_FOUND', startedAt, req);
          throw errors.modelNotFound(body.model);
        }
      }

      let account = allocation?.accountId ? await mimoAccounts$.getAccount(allocation.accountId) : null;
      if (account && mimoAccounts$.isExpired(account)) {
        await quota.release({ userId: user.id, requestId, scope });
        await persistRequest(requestId, user.id, body.model, body.stream, 503, 'ACCOUNT_EXPIRED', startedAt, req);
        throw errors.upstreamError('Mimo account expired');
      }
      if (!account) {
        const all = await mimoAccounts$.listAccounts();
        account = all.find((a) => a.status === 'active' && !mimoAccounts$.isExpired(a)) ?? null;
      }
      if (!account) {
        await quota.release({ userId: user.id, requestId, scope });
        await persistRequest(requestId, user.id, body.model, body.stream, 503, 'MIMO_UNAVAILABLE', startedAt, req);
        throw errors.mimoUnavailable();
      }

      let result: ChatResult;
      try {
        result = await mimoAccounts$.chat(account, {
          ...(body as any),
          model: outboundModel,
          messages: outboundMessages,
        });
      } catch (err) {
        await quota.release({ userId: user.id, requestId, scope });
        const code = err instanceof Object && 'code' in (err as any) ? (err as any).code : 'UPSTREAM_ERROR';
        await persistRequest(requestId, user.id, body.model, body.stream, 502, code, startedAt, req);
        throw err;
      }

      if (body.stream && result.stream) {
        return handleStream({
          req,
          reply,
          result,
          requestId,
          scope,
          allocated,
          estimate,
          prompt,
          user,
          account,
          model: body.model,
          startedAt,
          quota,
        });
      }

      // Non-streaming response.
      const usageFromUpstream = result.usage ?? null;
      const completionText = completionTextFromJson(result.body);
      const usage = resolveUsage(usageFromUpstream, prompt, completionText);
      const source: UsageSource = usageFromUpstream ? 'official' : 'estimated';

      const durationMs = Date.now() - startedAt;
      await quota.finalize({
        userId: user.id,
        requestId,
        actual: usage.total_tokens,
        allocated,
        scope,
      });
      await recordUsage({
        userId: user.id,
        accountId: account.id,
        requestId,
        model: body.model,
        usage,
        source,
        durationMs,
        httpStatus: 200,
      });
      await persistRequest(requestId, user.id, body.model, false, 200, null, startedAt, req);

      reply.header('x-request-id', requestId);
      reply.header('x-quota-source', source);
      return reply.send(result.body);
    },
  );

  app.get('/v1/models', {
    schema: { tags: ['gateway'], summary: 'List available models (upstream + custom)', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticateApiKey(extractBearer(req));
    if (!auth) throw errors.invalidApiKey();
    // Same account-state gates as /v1/chat/completions: a disabled or expired
    // user must not be able to enumerate the catalog either.
    if (auth.user.status !== 'active') throw errors.userDisabled();
    if (auth.user.expiresAt && auth.user.expiresAt.getTime() <= Date.now()) throw errors.userExpired();
    const [rows, customs] = await Promise.all([
      getDb().select().from(mimoModels),
      customModels$.list(),
    ]);
    const unique = new Map(rows.map((r) => [r.modelId, r]));
    const data = [...unique.values()].map((r) => ({
      id: r.modelId,
      object: 'model',
      created: Math.floor(r.createdAt.getTime() / 1000),
      owned_by: r.ownedBy ?? 'mimo',
    }));
    for (const c of customs.filter((c) => c.status === 'active')) {
      data.push({
        id: c.modelAlias,
        object: 'model',
        created: Math.floor(c.createdAt.getTime() / 1000),
        owned_by: 'custom',
      });
    }
    return reply.send({ object: 'list', data });
  });
}

function injectSystemPrompt(
  messages: { role?: string; content?: unknown }[],
  systemPrompt: string,
): { role: string; content: unknown }[] {
  const norm = messages.map((m) => ({ role: m.role ?? 'user', content: m.content ?? '' }));
  const sys: { role: string; content: unknown } = { role: 'system', content: systemPrompt };
  if (norm.length === 0) return [sys];
  const first = norm[0];
  if (first && first.role === 'system') {
    const existing = typeof first.content === 'string' ? first.content : '';
    return [
      { role: 'system', content: existing ? `${systemPrompt}\n\n${existing}` : systemPrompt },
      ...norm.slice(1),
    ];
  }
  return [sys, ...norm];
}

function resolveUsage(
  upstream: UpstreamUsage | null,
  promptTokens: number,
  completionText: string,
): UsageTotals {
  if (upstream && typeof upstream.total_tokens === 'number') {
    return {
      prompt_tokens: upstream.prompt_tokens ?? promptTokens,
      completion_tokens: upstream.completion_tokens ?? 0,
      total_tokens: upstream.total_tokens,
    };
  }
  const completion = estimateTokens(completionText);
  return buildUsage(promptTokens, completion);
}

async function persistRequest(
  requestId: string,
  userId: string | null,
  model: string | null,
  stream: boolean,
  httpStatus: number | null,
  errorCode: string | null,
  startedAt: number,
  req: FastifyRequest,
) {
  await recordRequest({
    requestId,
    userId,
    model,
    path: req.url,
    stream,
    httpStatus,
    errorCode,
    durationMs: Date.now() - startedAt,
    clientIp: req.ip ?? null,
  }).catch((err) => logger.warn({ err }, 'failed to persist request log'));
}

interface StreamCtx {
  req: FastifyRequest;
  reply: FastifyReply;
  result: ChatResult;
  requestId: string;
  scope: string;
  allocated: number;
  estimate: number;
  prompt: number;
  user: { id: string };
  account: { id: string };
  model: string;
  startedAt: number;
  quota: ReturnType<typeof getQuotaService>;
}

async function handleStream(ctx: StreamCtx) {
  const { reply, result } = ctx;
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-request-id': ctx.requestId,
  });

  const reader = result.stream!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let finished = false;

  const finalizeOnce = async (status: number, errorCode: string | null) => {
    if (finished) return;
    finished = true;
    const upstreamUsage = parseSseUsage(sseBuffer);
    const completionText = completionTextFromSse(sseBuffer);
    const usage = resolveUsage(upstreamUsage, ctx.prompt, completionText);
    const source: UsageSource = upstreamUsage ? 'official' : 'estimated';

    try {
      if (errorCode) {
        await ctx.quota.release({ userId: ctx.user.id, requestId: ctx.requestId, scope: ctx.scope });
      } else {
        await ctx.quota.finalize({
          userId: ctx.user.id,
          requestId: ctx.requestId,
          actual: usage.total_tokens,
          allocated: ctx.allocated,
          scope: ctx.scope,
        });
        await recordUsage({
          userId: ctx.user.id,
          accountId: ctx.account.id,
          requestId: ctx.requestId,
          model: ctx.model,
          usage,
          source,
          durationMs: Date.now() - ctx.startedAt,
          httpStatus: status,
        });
      }
      await persistRequest(
        ctx.requestId,
        ctx.user.id,
        ctx.model,
        true,
        status,
        errorCode,
        ctx.startedAt,
        ctx.req,
      );
    } catch (err) {
      logger.warn({ err }, 'stream finalize failed');
    }
  };

  const pump = async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        reply.raw.write(value);
      }
      reply.raw.end();
      await finalizeOnce(200, null);
    } catch (err) {
      logger.warn({ err }, 'stream relay failed');
      try {
        reply.raw.end();
      } catch {
        /* socket already closed */
      }
      await finalizeOnce(502, 'UPSTREAM_ERROR');
    }
  };

  ctx.req.raw.on('close', () => {
    if (!finished) {
      reader.cancel().catch(() => undefined);
      void finalizeOnce(200, null);
    }
  });

  await pump();
  return reply;
}
