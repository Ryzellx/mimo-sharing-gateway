import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  ENCRYPTION_KEY: z.string().min(16, 'ENCRYPTION_KEY must be at least 16 chars'),

  MIMO_API_URL: z.string().url().default('https://api.mimo.example/v1'),
  MIMO_API_TOKEN: z.string().default(''),
  MIMO_CHAT_PATH: z.string().default('/chat/completions'),
  MIMO_ACCOUNT_PATH: z.string().default(''),
  MIMO_USAGE_PATH: z.string().default(''),
  MIMO_MODELS_PATH: z.string().default(''),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  QUOTA_MODE: z.enum(['allocation', 'shared_pool']).default('allocation'),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_RPH: z.coerce.number().int().positive().default(1000),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('admin@gateway.local'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe-Admin-1!'),
  BOOTSTRAP_ADMIN_USERNAME: z.string().min(3).default('admin'),
});

export type Env = z.infer<typeof Env>;

function load(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = {
  env: load(),
  isProd: process.env.NODE_ENV === 'production',
  corsOrigins: (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
