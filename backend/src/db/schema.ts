import { bigint, boolean, doublePrecision, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = (name = 'id') => uuid(name).defaultRandom().primaryKey();
const createdAt = (name = 'created_at') =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
const tokens = (name: string) => bigint(name, { mode: 'number' });

export const adminUsers = pgTable('admin_users', {
  id: id(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('super_admin'),
  createdAt: createdAt(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull().default('active'),
  sharedPool: boolean('shared_pool').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastRequestAt: timestamp('last_request_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyLast4: text('key_last4').notNull(),
    name: text('name').notNull().default('default'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('api_keys_hash_idx').on(t.keyHash)],
);

export const mimoAccounts = pgTable('mimo_accounts', {
  id: id(),
  label: text('label').notNull(),
  baseUrl: text('base_url').notNull(),
  tokenEncrypted: text('token_encrypted').notNull(),
  tokenMasked: text('token_masked').notNull(),
  status: text('status').notNull().default('active'),
  plan: text('plan'),
  totalQuota: tokens('total_quota'),
  usedQuota: tokens('used_quota'),
  remainingQuota: tokens('remaining_quota'),
  quotaResetAt: timestamp('quota_reset_at', { withTimezone: true }),
  accountPath: text('account_path'),
  usagePath: text('usage_path'),
  modelsPath: text('models_path'),
  chatPath: text('chat_path'),
  metadata: jsonb('metadata'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: text('last_sync_status'),
  lastSyncError: text('last_sync_error'),
  createdAt: createdAt(),
});

export const mimoModels = pgTable(
  'mimo_models',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => mimoAccounts.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    ownedBy: text('owned_by'),
    raw: jsonb('raw'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mimo_models_account_model_idx').on(t.accountId, t.modelId)],
);

export const allocations = pgTable(
  'allocations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => mimoAccounts.id, { onDelete: 'set null' }),
    totalTokens: tokens('total_tokens').notNull().default(0),
    usedTokens: tokens('used_tokens').notNull().default(0),
    reservedTokens: tokens('reserved_tokens').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('allocations_user_idx').on(t.userId)],
);

export const allocationHistory = pgTable('allocation_history', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id'),
  oldTotal: tokens('old_total'),
  newTotal: tokens('new_total'),
  changedBy: text('changed_by'),
  reason: text('reason'),
  createdAt: createdAt(),
});

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => mimoAccounts.id, { onDelete: 'set null' }),
    requestId: uuid('request_id'),
    model: text('model').notNull(),
    promptTokens: tokens('prompt_tokens').notNull().default(0),
    completionTokens: tokens('completion_tokens').notNull().default(0),
    totalTokens: tokens('total_tokens').notNull().default(0),
    usageSource: text('usage_source').notNull().default('estimated'),
    cost: doublePrecision('cost'),
    durationMs: integer('duration_ms'),
    httpStatus: integer('http_status'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('usage_logs_request_idx').on(t.requestId)],
);

export const requestLogs = pgTable('request_logs', {
  id: id(),
  requestId: uuid('request_id').notNull().unique(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  model: text('model'),
  path: text('path').notNull(),
  stream: boolean('stream').notNull().default(false),
  httpStatus: integer('http_status'),
  errorCode: text('error_code'),
  durationMs: integer('duration_ms'),
  clientIp: text('client_ip'),
  createdAt: createdAt(),
});

export const quotaReservations = pgTable(
  'quota_reservations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id'),
    amount: tokens('amount').notNull(),
    status: text('status').notNull().default('reserved'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('quota_reservations_request_idx').on(t.requestId)],
);

export const quotaSnapshots = pgTable('quota_snapshots', {
  id: id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => mimoAccounts.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('mimo'),
  totalQuota: tokens('total_quota'),
  usedQuota: tokens('used_quota'),
  remainingQuota: tokens('remaining_quota'),
  localUsed: tokens('local_used'),
  difference: tokens('difference'),
  createdAt: createdAt(),
});

export const reconciliationLogs = pgTable('reconciliation_logs', {
  id: id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => mimoAccounts.id, { onDelete: 'cascade' }),
  localUsage: tokens('local_usage').notNull(),
  officialUsage: tokens('official_usage'),
  difference: tokens('difference'),
  status: text('status').notNull().default('ok'),
  detail: text('detail'),
  createdAt: createdAt(),
});

export const rateLimits = pgTable('rate_limits', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  requestsPerMinute: integer('requests_per_minute').notNull().default(60),
  requestsPerHour: integer('requests_per_hour').notNull().default(1000),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  metadata: jsonb('metadata'),
  ip: text('ip'),
  createdAt: createdAt(),
});

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customModels = pgTable(
  'custom_models',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => mimoAccounts.id, { onDelete: 'cascade' }),
    modelAlias: text('model_alias').notNull(),
    targetModel: text('target_model').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('custom_models_account_alias_idx').on(t.accountId, t.modelAlias)],
);
