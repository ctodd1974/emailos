-- EmailOS Slice 2 migration — Audience.
-- Tables: subscribers, audiences, audience_memberships, tags, subscriber_tags,
--         suppressions, segments, segment_rules.
--
-- Notes:
--   * Applied by db/migrate.ts, one statement per request (the Neon HTTP driver
--     rejects multi-statement SQL — verified 2026-09-03).
--   * Every statement is IF NOT EXISTS-safe (tables + indexes). Uniqueness is
--     expressed as CREATE UNIQUE INDEX rather than ADD CONSTRAINT precisely
--     because indexes support IF NOT EXISTS while constraints do not (see the
--     migration rule in db/migrate.ts). No ADD CONSTRAINT statements here.
--   * citext (case-insensitive email) is created by 0001_foundation.sql.
--   * Every tenant table carries workspace_id NOT NULL REFERENCES workspaces(id)
--     (proposal §4.3). Join tables carry it too, denormalized, so isolation is
--     enforced at the row level even for joins.
--   * Subscriber status vocabulary: active | unsubscribed | suppressed | bounced
--     | complained. Source vocabulary: manual | csv | form | api | test | import.
--     Both are plain text (proposal §5) — validation lives in the server layer.
--   * engaged_at stays NULL until real engagement events exist (Slice 3+).
--     Nothing here fabricates engagement.

-- ---------------------------------------------------------------------------
-- subscribers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscribers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email            citext NOT NULL,
  first_name       text,
  last_name        text,
  status           text NOT NULL DEFAULT 'active',
  source           text NOT NULL DEFAULT 'manual',
  source_detail    text,
  custom_fields    jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_metadata jsonb,
  subscribed_at    timestamptz NOT NULL DEFAULT now(),
  engaged_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscribers_workspace_email
  ON subscribers (workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_subscribers_workspace_status
  ON subscribers (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_subscribers_workspace_engaged
  ON subscribers (workspace_id, engaged_at);
CREATE INDEX IF NOT EXISTS idx_subscribers_workspace_created
  ON subscribers (workspace_id, created_at);

-- ---------------------------------------------------------------------------
-- audiences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audiences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE (workspace_id, name), case-insensitive so "Newsletter" and
-- "newsletter" cannot both exist in one workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_audiences_workspace_name
  ON audiences (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_audiences_workspace
  ON audiences (workspace_id);

-- ---------------------------------------------------------------------------
-- audience_memberships (join: audience <-> subscriber)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audience_memberships (
  audience_id   uuid NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audience_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_audience_memberships_subscriber
  ON audience_memberships (subscriber_id);
CREATE INDEX IF NOT EXISTS idx_audience_memberships_workspace
  ON audience_memberships (workspace_id);

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_workspace_name
  ON tags (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_tags_workspace
  ON tags (workspace_id);

-- ---------------------------------------------------------------------------
-- subscriber_tags (join: subscriber <-> tag)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_tags (
  subscriber_id uuid NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriber_tags_tag
  ON subscriber_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_subscriber_tags_workspace
  ON subscriber_tags (workspace_id);

-- ---------------------------------------------------------------------------
-- suppressions (safety-critical: never emailed, enforced at send time in Slice 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppressions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email                  citext NOT NULL,
  reason                 text NOT NULL,              -- unsubscribe | bounce | complaint | manual
  source                 text NOT NULL DEFAULT 'emailos', -- emailos | resend_sync
  provider_suppression_id text,
  subscriber_id          uuid REFERENCES subscribers(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppressions_workspace_email
  ON suppressions (workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_suppressions_workspace_created
  ON suppressions (workspace_id, created_at);

-- ---------------------------------------------------------------------------
-- segments + segment_rules (foundation only: no behavioral rules until Slice 8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS segments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  match_type   text NOT NULL DEFAULT 'all',   -- all | any
  is_dynamic   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_segments_workspace_name
  ON segments (workspace_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_segments_workspace
  ON segments (workspace_id);

CREATE TABLE IF NOT EXISTS segment_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id   uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position     int NOT NULL DEFAULT 0,
  field        text NOT NULL,   -- whitelist enforced server-side
  operator     text NOT NULL,   -- whitelist enforced server-side
  value        jsonb NOT NULL DEFAULT 'null'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_segment_rules_segment_position
  ON segment_rules (segment_id, position);
