-- MIMO GATEWAY: custom models with system prompts
CREATE TABLE IF NOT EXISTS custom_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES mimo_accounts(id) ON DELETE CASCADE,
  model_alias text NOT NULL,
  target_model text NOT NULL,
  system_prompt text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_models_account_alias_idx ON custom_models(account_id, model_alias);
CREATE INDEX IF NOT EXISTS custom_models_alias_idx ON custom_models(model_alias);