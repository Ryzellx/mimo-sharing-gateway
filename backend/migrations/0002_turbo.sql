-- MIMO GATEWAY TURBO: auto-detect, split, expiry
ALTER TABLE mimo_accounts
  ADD COLUMN IF NOT EXISTS account_path text,
  ADD COLUMN IF NOT EXISTS usage_path text,
  ADD COLUMN IF NOT EXISTS models_path text,
  ADD COLUMN IF NOT EXISTS chat_path text,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS mimo_accounts_status_idx ON mimo_accounts(status);
CREATE INDEX IF NOT EXISTS users_expires_at_idx ON users(expires_at);