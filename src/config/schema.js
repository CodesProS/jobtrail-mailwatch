// src/config/schema.js — the sidecar's tables. Idempotent (IF NOT EXISTS), so it
// is safe to run on every boot (server.js) as well as from scripts/migrate.js.
//
// All tables are prefixed mw_ so this DB can be shared with JobTrail's.

export const SCHEMA_SQL = `
-- Single-row config / connection state (id is always 1).
CREATE TABLE IF NOT EXISTS mw_config (
  id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  jobtrail_email          TEXT,
  jobtrail_password_enc   TEXT,
  jobtrail_token_cache    TEXT,
  jobtrail_token_exp      BIGINT DEFAULT 0,
  gmail_email             TEXT,
  gmail_refresh_token_enc TEXT,
  gmail_connected_at      TIMESTAMPTZ,
  last_message_ts         BIGINT NOT NULL DEFAULT 0,   -- epoch seconds: next scan starts here
  last_sync_at            TIMESTAMPTZ,
  last_sync_summary       TEXT
);

INSERT INTO mw_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- One row per Gmail message we have looked at.
CREATE TABLE IF NOT EXISTS mw_detections (
  id                SERIAL PRIMARY KEY,
  gmail_msg_id      TEXT NOT NULL UNIQUE,
  gmail_thread_id   TEXT,
  from_addr         TEXT,
  from_domain       TEXT,
  subject           TEXT,
  snippet           TEXT,
  received_at       TIMESTAMPTZ,

  is_job_related    BOOLEAN,
  detected_company  TEXT,
  detected_role     TEXT,
  event_type        TEXT,       -- rejection | interview_invite | phone_screen | assessment | offer | application_received | other
  proposed_status   TEXT,       -- mapped JobTrail status, or NULL
  llm_confidence    NUMERIC,
  llm_json          JSONB,

  matched_job_id    INTEGER,    -- JobTrail application id
  matched_job_label TEXT,       -- "Company — Role" cached for display
  match_score       NUMERIC,
  match_margin      NUMERIC,
  candidates_json   JSONB,      -- [{ id, label, score, status }] for the review dropdown

  state             TEXT NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending','applied','dismissed','no_match','ignored','error')),
  note              TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mw_detections ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS mw_detections_state_idx ON mw_detections (state);
CREATE INDEX IF NOT EXISTS mw_detections_created_idx ON mw_detections (created_at DESC);
`;
