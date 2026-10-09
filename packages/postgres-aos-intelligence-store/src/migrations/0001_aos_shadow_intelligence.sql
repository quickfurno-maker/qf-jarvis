-- ADR-0177 — AOS v2 shadow intelligence durability.
--
-- REVIEWED SOURCE ARTIFACT ONLY. This migration is not wired into a managed migration
-- ledger and importing the package applies nothing. Production application requires a
-- separately reviewed migration/deployment step.
--
-- This schema stores AOS evidence and operator-learning artifacts only. It is not a
-- business source of truth and contains no authorization column.

CREATE SCHEMA IF NOT EXISTS qf_jarvis_aos;

CREATE TABLE IF NOT EXISTS qf_jarvis_aos.case_snapshot (
  case_id text NOT NULL,
  case_key text NOT NULL,
  subject_ref text NOT NULL,
  state text NOT NULL,
  priority text NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  snapshot_json jsonb NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  stored_at timestamptz NOT NULL,
  PRIMARY KEY (case_id, snapshot_digest)
);

CREATE INDEX IF NOT EXISTS aos_case_snapshot_case_key_idx
  ON qf_jarvis_aos.case_snapshot (case_key, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS aos_case_snapshot_subject_idx
  ON qf_jarvis_aos.case_snapshot (subject_ref, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS qf_jarvis_aos.case_context_memory (
  case_key text NOT NULL,
  subject_ref text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL,
  memory_json jsonb NOT NULL,
  memory_digest text NOT NULL CHECK (memory_digest ~ '^sha256:[0-9a-f]{64}$'),
  stored_at timestamptz NOT NULL,
  PRIMARY KEY (case_key, revision)
);

CREATE INDEX IF NOT EXISTS aos_case_context_subject_idx
  ON qf_jarvis_aos.case_context_memory (subject_ref, updated_at DESC);

CREATE TABLE IF NOT EXISTS qf_jarvis_aos.recommendation (
  recommendation_id text PRIMARY KEY,
  case_id text NOT NULL,
  action text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  requires_owner_review boolean NOT NULL,
  recommendation_json jsonb NOT NULL,
  recommendation_digest text NOT NULL CHECK (recommendation_digest ~ '^sha256:[0-9a-f]{64}$'),
  stored_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS aos_recommendation_case_idx
  ON qf_jarvis_aos.recommendation (case_id, stored_at DESC);

CREATE TABLE IF NOT EXISTS qf_jarvis_aos.outcome_observation (
  observation_id text PRIMARY KEY,
  capability_ref text NOT NULL,
  case_id text NOT NULL,
  recommendation_id text NOT NULL,
  false_positive boolean NOT NULL,
  outcome_json jsonb NOT NULL,
  outcome_digest text NOT NULL CHECK (outcome_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  stored_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS aos_outcome_capability_idx
  ON qf_jarvis_aos.outcome_observation (capability_ref, observed_at DESC);

CREATE TABLE IF NOT EXISTS qf_jarvis_aos.behaviour_manifest (
  manifest_id text NOT NULL,
  manifest_version integer NOT NULL CHECK (manifest_version > 0),
  configuration_digest text NOT NULL CHECK (configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  lifecycle text NOT NULL,
  registry_json jsonb NOT NULL,
  manifest_json jsonb NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  stored_at timestamptz NOT NULL,
  PRIMARY KEY (manifest_id, manifest_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS aos_behaviour_configuration_idx
  ON qf_jarvis_aos.behaviour_manifest (configuration_digest, manifest_id, manifest_version);

REVOKE ALL ON SCHEMA qf_jarvis_aos FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA qf_jarvis_aos FROM PUBLIC;
