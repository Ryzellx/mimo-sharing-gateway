CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'super_admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  shared_pool boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_request_at timestamptz,
  disabled_at timestamptz
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  key_last4 text NOT NULL,
  name text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash);

CREATE TABLE IF NOT EXISTS mimo_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  base_url text NOT NULL,
  token_encrypted text NOT NULL,
  token_masked text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  plan text,
  total_quota bigint,
  used_quota bigint,
  remaining_quota bigint,
  quota_reset_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mimo_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES mimo_accounts(id) ON DELETE CASCADE,
  model_id text NOT NULL,
  owned_by text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mimo_models_account_model_idx ON mimo_models (account_id, model_id);

CREATE TABLE IF NOT EXISTS allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES mimo_accounts(id) ON DELETE SET NULL,
  total_tokens bigint NOT NULL DEFAULT 0,
  used_tokens bigint NOT NULL DEFAULT 0,
  reserved_tokens bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS allocations_user_idx ON allocations (user_id);

CREATE TABLE IF NOT EXISTS allocation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid,
  old_total bigint,
  new_total bigint,
  changed_by text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  account_id uuid REFERENCES mimo_accounts(id) ON DELETE SET NULL,
  request_id uuid,
  model text NOT NULL,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  total_tokens bigint NOT NULL DEFAULT 0,
  usage_source text NOT NULL DEFAULT 'estimated',
  cost double precision,
  duration_ms integer,
  http_status integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usage_logs_request_idx ON usage_logs (request_id);
CREATE INDEX IF NOT EXISTS usage_logs_user_time_idx ON usage_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS usage_logs_time_idx ON usage_logs (created_at);

CREATE TABLE IF NOT EXISTS request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  model text,
  path text NOT NULL,
  stream boolean NOT NULL DEFAULT false,
  http_status integer,
  error_code text,
  duration_ms integer,
  client_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_logs_user_time_idx ON request_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS request_logs_time_idx ON request_logs (created_at);

CREATE TABLE IF NOT EXISTS quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid,
  amount bigint NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  finalized_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS quota_reservations_request_idx ON quota_reservations (request_id);
CREATE INDEX IF NOT EXISTS quota_reservations_expiry_idx ON quota_reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS quota_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES mimo_accounts(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'mimo',
  total_quota bigint,
  used_quota bigint,
  remaining_quota bigint,
  local_used bigint,
  difference bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quota_snapshots_account_time_idx ON quota_snapshots (account_id, created_at);

CREATE TABLE IF NOT EXISTS reconciliation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES mimo_accounts(id) ON DELETE CASCADE,
  local_usage bigint NOT NULL,
  official_usage bigint,
  difference bigint,
  status text NOT NULL DEFAULT 'ok',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reconciliation_logs_account_time_idx ON reconciliation_logs (account_id, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  requests_per_minute integer NOT NULL DEFAULT 60,
  requests_per_hour integer NOT NULL DEFAULT 1000,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text NOT NULL,
  action text NOT NULL,
  target text,
  metadata jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs (created_at);

CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
