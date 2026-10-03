import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from './logger.js';

export interface QuotaBackend {
  eval(script: string, keys: string[], argv: string[]): Promise<number | string | string[] | null>;
}

class RedisBackend implements QuotaBackend {
  constructor(private readonly redis: Redis) {}

  async eval(script: string, keys: string[], argv: string[]) {
    const res = await this.redis.eval(script, keys.length, ...keys, ...argv);
    return res as number | string | string[] | null;
  }
}

let redis: Redis | null = null;
let backend: QuotaBackend | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    redis.on('error', (err: Error) => logger.warn({ err: err.message }, 'redis error'));
  }
  return redis;
}

export function getQuotaBackend(): QuotaBackend {
  if (!backend) backend = new RedisBackend(getRedis());
  return backend;
}

export function setQuotaBackend(custom: QuotaBackend) {
  backend = custom;
}

export async function closeRedis() {
  if (redis) {
    await redis.quit().catch(() => redis?.disconnect());
    redis = null;
    backend = null;
  }
}
