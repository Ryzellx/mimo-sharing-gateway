import { LuaFactory } from 'wasmoon';
import type { QuotaBackend } from './redis.js';

/**
 * In-process Lua executor used for tests (and as a dev fallback) so the exact
 * production Lua scripts are exercised without a running Redis server.
 * Data lives in a plain map; each script execution is atomic (single-threaded),
 * mirroring Redis's guarantee that one script never interleaves with another.
 */

type ZSet = Map<string, number>;

function toScore(v: string | number): number {
  const s = String(v).toLowerCase();
  if (s === '-inf' || s === '-infinity') return -Infinity;
  if (s === '+inf' || s === 'inf' || s === '+infinity' || s === 'infinity') return Infinity;
  return Number(v);
}

export class MemoryRedis {
  strings = new Map<string, { value: string; expiresAt: number | null }>();
  zsets = new Map<string, ZSet>();
  private now = () => Date.now();

  setNow(fn: () => number) {
    this.now = fn;
  }

  private alive(key: string): boolean {
    const entry = this.strings.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.strings.delete(key);
      return false;
    }
    return entry !== undefined;
  }

  get(key: string): string | null {
    return this.alive(key) ? this.strings.get(key)!.value : null;
  }

  set(key: string, value: string, exSeconds?: number) {
    this.strings.set(key, {
      value,
      expiresAt: exSeconds ? this.now() + exSeconds * 1000 : null,
    });
  }

  del(key: string) {
    this.strings.delete(key);
    this.zsets.delete(key);
  }

  incrby(key: string, by: number): number {
    const cur = Number(this.get(key) ?? '0');
    const next = cur + by;
    this.set(key, String(next));
    return next;
  }

  private zset(key: string): ZSet {
    let z = this.zsets.get(key);
    if (!z) {
      z = new Map();
      this.zsets.set(key, z);
    }
    return z;
  }

  zadd(key: string, score: number, member: string) {
    this.zset(key).set(member, score);
  }

  zrem(key: string, member: string) {
    this.zset(key).delete(member);
  }

  zcard(key: string) {
    return this.zset(key).size;
  }

  zremrangebyscore(key: string, min: number, max: number) {
    const z = this.zset(key);
    let removed = 0;
    for (const [member, score] of [...z]) {
      if (score >= min && score <= max) {
        z.delete(member);
        removed++;
      }
    }
    return removed;
  }

  zrangebyscore(key: string, min: number, max: number, limit?: [number, number]): string[] {
    const entries = [...this.zset(key).entries()]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
    return limit ? entries.slice(limit[0], limit[0] + limit[1]) : entries;
  }

  pexpire(key: string, ms: number) {
    const entry = this.strings.get(key);
    if (entry) entry.expiresAt = this.now() + ms;
  }

  call(cmd: string, ...args: (string | number)[]): unknown {
    switch (cmd.toUpperCase()) {
      case 'GET':
        return this.get(String(args[0]));
      case 'SET': {
        const exIdx = args.findIndex((a) => String(a).toUpperCase() === 'EX');
        this.set(
          String(args[0]),
          String(args[1]),
          exIdx >= 0 ? Number(args[exIdx + 1]) : undefined,
        );
        return 'OK';
      }
      case 'DEL': {
        const existed = this.get(String(args[0])) !== null || this.zsets.has(String(args[0]));
        this.del(String(args[0]));
        return existed ? 1 : 0;
      }
      case 'INCRBY':
        return this.incrby(String(args[0]), Number(args[1]));
      case 'DECRBY':
        return this.incrby(String(args[0]), -Number(args[1]));
      case 'ZADD':
        this.zadd(String(args[0]), Number(args[1]), String(args[2]));
        return 1;
      case 'ZREM':
        this.zrem(String(args[0]), String(args[1]));
        return 1;
      case 'ZCARD':
        return this.zcard(String(args[0]));
      case 'ZREMRANGEBYSCORE':
        return this.zremrangebyscore(String(args[0]), toScore(args[1]!), toScore(args[2]!));
      case 'ZRANGEBYSCORE': {
        const limitIdx = args.findIndex((a) => String(a).toUpperCase() === 'LIMIT');
        const limit =
          limitIdx >= 0 ? [Number(args[limitIdx + 1]), Number(args[limitIdx + 2])] as [number, number] : undefined;
        return this.zrangebyscore(String(args[0]), toScore(args[1]!), toScore(args[2]!), limit);
      }
      case 'PEXPIRE':
        this.pexpire(String(args[0]), Number(args[1]));
        return 1;
      default:
        throw new Error(`MemoryRedis: unsupported command ${cmd}`);
    }
  }
}

const SEP = '\x1f';

function luaString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

function luaTable(values: string[]): string {
  return `{${values.map(luaString).join(',')}}`;
}

const SHIM = `
redis = {}
local SEP = string.char(31)
local function split(s)
  local t = {}
  if type(s) ~= 'string' or s == '' then return t end
  for part in string.gmatch(s, '[^' .. SEP .. ']+') do
    t[#t + 1] = part
  end
  return t
end
function redis.call(cmd, ...)
  local r = __redis_call(cmd, ...)
  if type(cmd) == 'string' and string.upper(cmd) == 'ZRANGEBYSCORE' then
    return split(r)
  end
  return r
end
`;

/**
 * Lua scripts are executed by a real Lua VM (wasmoon) against this in-memory
 * redis mock, so the exact production scripts are what gets tested. Only
 * strings and numbers cross the JS/Lua boundary — the shim converts delimited
 * string replies into Lua tables — keeping the interop surface minimal.
 */
export class MemoryLuaBackend implements QuotaBackend {
  private factory: LuaFactory | null = null;
  private lua: any = null;
  private queue: Promise<unknown> = Promise.resolve();
  readonly store = new MemoryRedis();

  constructor(private readonly now: () => number = () => Date.now()) {
    this.store.setNow(this.now);
  }

  private async engine() {
    if (!this.lua) {
      this.factory ??= new LuaFactory();
      const lua = await this.factory.createEngine();
      const store = this.store;
      await lua.global.set('__redis_call', (...args: any[]) => {
        const r = store.call(String(args[0]), ...args.slice(1));
        if (Array.isArray(r)) return r.join(SEP);
        return r === null || r === undefined ? false : r;
      });
      await lua.doString(SHIM);
      this.lua = lua;
    }
    return this.lua;
  }

  private async reset() {
    const lua = this.lua;
    this.lua = null;
    if (lua) {
      try {
        lua.global.close();
      } catch {
        /* already closed */
      }
    }
  }

  private async runOnce(script: string, keys: string[], argv: string[]): Promise<any> {
    const lua = await this.engine();
    const prelude = `KEYS = ${luaTable(keys)}\nARGV = ${luaTable(argv)}\n`;
    const result = await lua.doString(prelude + script);
    return result ?? null;
  }

  /**
   * Evaluated scripts are serialized through a queue: one Lua script never
   * interleaves with another, exactly like Redis. Each script gets a fresh VM
   * (wasmoon instances leak Lua stack slots across runs), and a failing VM is
   * rebuilt before the script is retried once.
   */
  eval(script: string, keys: string[], argv: string[]): Promise<any> {
    const run = async () => {
      await this.reset();
      try {
        return await this.runOnce(script, keys, argv);
      } catch {
        await this.reset();
        return await this.runOnce(script, keys, argv);
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async teardown() {
    await this.queue.catch(() => undefined);
    await this.reset();
  }
}
