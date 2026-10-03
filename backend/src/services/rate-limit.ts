import { config } from '../config.js';
import { getQuotaBackend, type QuotaBackend } from '../lib/redis.js';
import * as lua from '../lib/quota-lua.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remainingMinute: number;
  remainingHour: number;
}

/**
 * Redis sliding-window rate limiter (ZSET per window). Atomic: check and
 * increment happen in one script so bursts can never slip past the limit.
 */
export class RateLimiter {
  constructor(private readonly backendOverride?: QuotaBackend, private readonly now: () => number = () => Date.now()) {}

  private get backend(): QuotaBackend {
    return this.backendOverride ?? getQuotaBackend();
  }

  private async consume(key: string, windowMs: number, limit: number): Promise<boolean> {
    if (limit <= 0) return true;
    const member = `${this.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const res = await this.backend.eval(
      lua.RATE_LIMIT,
      [key],
      [String(this.now()), String(windowMs), String(limit), member],
    );
    return Number(res) === 1;
  }

  async check(params: {
    userId: string;
    requestsPerMinute?: number;
    requestsPerHour?: number;
  }): Promise<RateLimitDecision> {
    const rpm = params.requestsPerMinute ?? config.env.RATE_LIMIT_RPM;
    const rph = params.requestsPerHour ?? config.env.RATE_LIMIT_RPH;

    const minuteOk = await this.consume(lua.KEY.rateWindow(params.userId, '1m'), MINUTE, rpm);
    const hourOk = await this.consume(lua.KEY.rateWindow(params.userId, '1h'), HOUR, rph);

    const allowed = minuteOk && hourOk;
    return {
      allowed,
      retryAfterSeconds: allowed ? 0 : minuteOk ? 3600 : 60,
      remainingMinute: minuteOk ? rpm - 1 : 0,
      remainingHour: hourOk ? rph - 1 : 0,
    };
  }
}

let defaultLimiter: RateLimiter | null = null;
export function getRateLimiter(): RateLimiter {
  defaultLimiter ??= new RateLimiter();
  return defaultLimiter;
}
