import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { setDb, type DB } from '../../src/db/client.js';
import { runMigrations, type SqlExecutor } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { MemoryLuaBackend } from '../../src/lib/quota-memory.js';
import { setQuotaBackend } from '../../src/lib/redis.js';
import { mimoAccounts, users } from '../../src/db/schema.js';
import { MimoAccountService } from '../../src/services/mimo-accounts.js';
import { MimoProvider } from '../../src/providers/mimo.js';
import { createUser } from '../../src/services/users.js';
import { createApiKey } from '../../src/services/api-keys.js';
import { setUserAllocation } from '../../src/services/allocations.js';
import { encryptSecret, maskMimoToken } from '../../src/lib/crypto.js';

export interface MockMimo {
  url: string;
  server: Server;
  calls: { path: string; body: any }[];
  behavior: {
    mode: 'ok' | 'error' | 'auth_error' | 'malformed';
    withUsage: boolean;
    stream: boolean;
    latencyMs: number;
  };
  close(): Promise<void>;
}

export async function startMockMimo(): Promise<MockMimo> {
  const calls: { path: string; body: any }[] = [];
  const behavior: MockMimo['behavior'] = {
    mode: 'ok',
    withUsage: true,
    stream: false,
    latencyMs: 0,
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      calls.push({ path: req.url ?? '', body });

      const respond = () => {
        if (behavior.mode === 'auth_error') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'bad token' } }));
          return;
        }
        if (behavior.mode === 'error') {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'upstream boom' } }));
          return;
        }
        if (behavior.mode === 'malformed') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('not-json{{{');
          return;
        }

        if (req.url?.startsWith('/account')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ plan: 'mimo-pro', status: 'active' }));
          return;
        }
        if (req.url?.startsWith('/usage')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              quota: { total_quota: 6_000_000_000, used_quota: 1_000_000, remaining_quota: 5_999_000_000 },
            }),
          );
          return;
        }
        if (req.url?.startsWith('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'mimo-v2', owned_by: 'mimo' }] }));
          return;
        }

        // chat completions
        const wantsStream = Boolean(body?.stream) || behavior.stream;
        if (wantsStream) {
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
          });
          const chunk1 = {
            choices: [{ delta: { content: 'Hello ' } }],
          };
          const chunk2 = {
            choices: [{ delta: { content: 'from mock upstream' } }],
          };
          res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
          res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
          if (behavior.withUsage) {
            res.write(
              `data: ${JSON.stringify({
                choices: [],
                usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
              })}\n\n`,
            );
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'cmpl-mock',
            choices: [{ message: { role: 'assistant', content: 'Hello from mock upstream' } }],
            ...(behavior.withUsage
              ? { usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } }
              : {}),
          }),
        );
      };

      if (behavior.latencyMs > 0) setTimeout(respond, behavior.latencyMs);
      else respond();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    calls,
    behavior,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

export interface TestContext {
  db: DB;
  pglite: PGlite;
  lua: MemoryLuaBackend;
  mock: MockMimo;
  mimo: MimoAccountService;
  accountId: string;
  teardown(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema }) as unknown as DB;

  const ex: SqlExecutor = {
    exec: (sql) => pglite.exec(sql),
    queryRows: async (sql) => ({ rows: (await pglite.query(sql)).rows as any[] }),
  };
  await runMigrations(ex);
  setDb({ db, client: null as any });

  const lua = new MemoryLuaBackend();
  setQuotaBackend(lua);

  const mock = await startMockMimo();
  const mimo = new MimoAccountService(
    new MimoProvider({
      baseUrl: mock.url,
      accountPath: '/account',
      usagePath: '/usage',
      modelsPath: '/models',
      chatPath: '/chat/completions',
    }),
  );
  const account = await mimo.addAccount({
    label: 'mock-account',
    baseUrl: mock.url,
    token: 'mimo_test_token_1234',
  });

  return {
    db,
    pglite,
    lua,
    mock,
    mimo,
    accountId: account.account.id,
    async teardown() {
      await mock.close();
      await lua.teardown();
      await pglite.close();
    },
  };
}

export async function seedUser(
  ctx: TestContext,
  opts: { username: string; totalTokens: number; sharedPool?: boolean },
) {
  const result = await createUser({
    username: opts.username,
    email: `${opts.username}@test.local`,
    password: 'Test-Password-1!',
    totalTokens: opts.totalTokens,
    accountId: ctx.accountId,
    sharedPool: opts.sharedPool ?? false,
  });
  const user = result.user;
  await setUserAllocation({
    userId: user.id,
    totalTokens: opts.totalTokens,
    accountId: ctx.accountId,
    changedBy: 'test',
    reason: 'seed',
  });
  const { raw } = await createApiKey({ userId: user.id });
  return { user, apiKey: raw };
}

export async function refreshTokenEncrypted(ctx: TestContext) {
  // sanity helper: token is stored encrypted, never plaintext
  const rows = await ctx.db.select().from(mimoAccounts).where(eq(mimoAccounts.id, ctx.accountId));
  return {
    encrypted: rows[0]!.tokenEncrypted,
    masked: rows[0]!.tokenMasked,
  };
}

export { users, encryptSecret, maskMimoToken };
