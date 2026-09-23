-- ADR-0016 + ADR-0161 — governed derived agent memory.
--
-- REVIEWED SOURCE ARTIFACT ONLY. This file is not wired into the managed migration ledger.
-- Applying it to a managed database still requires the separately governed migration authorization
-- and the owner-approved retention/erasure lifecycle decision. Runtime code must remain disabled
-- until those gates exist.

CREATE SCHEMA IF NOT EXISTS qf_jarvis_memory;

CREATE TABLE IF NOT EXISTS qf_jarvis_memory.agent_memory_record (
  memory_record_id text PRIMARY KEY,
  owner_agent text NOT NULL,
  subject_keys text[] NOT NULL CHECK (cardinality(subject_keys) BETWEEN 1 AND 10),
  record_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS agent_memory_owner_expiry_idx
  ON qf_jarvis_memory.agent_memory_record (owner_agent, expires_at DESC);

CREATE INDEX IF NOT EXISTS agent_memory_subject_keys_gin
  ON qf_jarvis_memory.agent_memory_record USING gin (subject_keys);

REVOKE ALL ON SCHEMA qf_jarvis_memory FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA qf_jarvis_memory FROM PUBLIC;
