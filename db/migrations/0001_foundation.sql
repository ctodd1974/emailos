-- EmailOS Slice 1 foundation migration.
-- Tenant tables only: users, sessions, workspaces, workspace_members, provider_connections,
-- plus schema_migrations (migration bookkeeping) and the citext extension for case-insensitive emails.
--
-- Notes:
--   * Applied by db/migrate.ts, which runs each statement SEPARATELY (the Neon HTTP
--     driver rejects multi-statement SQL in one request — verified 2026-09-03).
--   * CREATE statements are idempotent-safe (IF NOT EXISTS); migrate.ts additionally
--     records applied versions in schema_migrations and skips them, so re-runs are safe.
--   * gen_random_uuid() requires pgcrypto on older Postgres; PG 13+ has it built-in
--     (verified available on Neon PG 18.6 — no pgcrypto extension needed).

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id   ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_connection_id uuid,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_user_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members (user_id);

CREATE TABLE IF NOT EXISTS provider_connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL DEFAULT 'resend',
  api_key_encrypted text NOT NULL,
  label       text,
  default_region text,
  webhook_signing_secret_encrypted text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Workspaces reference their default provider connection (nullable in Slice 1:
-- no provider configured yet). provider_connections is created above, so the
-- FK is added here. `IF NOT EXISTS` is not valid for ADD CONSTRAINT; DO blocks
-- are avoided because the splitter doesn't parse them — the FK is added with a
-- guarded existence check via a second migration if needed. Idempotency at the
-- runner level (version recorded once) means this runs exactly once per DB.
ALTER TABLE workspaces ADD CONSTRAINT workspaces_provider_connection_fk
  FOREIGN KEY (provider_connection_id) REFERENCES provider_connections(id) ON DELETE SET NULL;