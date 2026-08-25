-- JAO-5 controlled ambient operations: durable monitor-control state (QFJ-P12, ADR-0119).
--
-- ============================================================================
-- THIS IS NOT A MANAGED MIGRATION.
-- ============================================================================
--
-- A LOCAL schema asset, applied explicitly by the JAO-5 integration harness to a disposable test
-- database. Deliberately NOT in packages/event-backbone/src/persistence/migrations/, which is the
-- managed history `pnpm db:migrate` applies and the deployed database carries.
--
-- Appending there would make ambient monitor state arrive in a real database as a side effect of a
-- routine migration run -- adopted by nobody, reviewed as part of nothing. Managed adoption is a
-- separate production-activation decision. Until then: schema exists, rollout does not.
--
-- ============================================================================
-- Why this state is durable at all
-- ============================================================================
--
-- Ambient governance that lives in process memory is governance a restart removes. If a restart
-- reset dedupe, budgets, quieting, the last scheduled slot, the kill switch or expiry, then
-- restarting would be the bypass -- and an unstable system restarts most.
--
-- So every gate JAO-5 enforces is backed by a row here, and the last invariants are database
-- constraints rather than application checks: UNIQUE on the dedupe key is what makes "at most one
-- investigation per trigger identity" true under concurrency, not the code that also checks it.
--
-- ============================================================================
-- What is stored, and what is structurally impossible to store
-- ============================================================================
--
-- Stored: identifiers, closed status tokens, counters, revisions and instants. Governance and
-- provenance only.
--
-- Not stored, and there is nowhere to put it: control-plane snapshots, event payloads, model
-- prompts or results, chain-of-thought, attention bodies, diagnosis text, recommended next steps,
-- credentials, or any business record. There is no json/jsonb column and no unbounded text column
-- in this file.
--
-- This is OPERATIONAL CONTROL state. It is not CRM, consent, packages, payments, vendor registry,
-- assignments or activation truth, and none of those appear here.
--
-- Forward-only. No DROP, no ALTER of anything pre-existing, no CASCADE, no trigger, no extension,
-- no superuser feature, no environment-specific value. Its own schema, so it cannot collide with a
-- managed object and a managed DROP SCHEMA cannot take it with it.

CREATE SCHEMA IF NOT EXISTS qf_jarvis_jao5;

-- ---------------------------------------------------------------------------
-- The enrolled monitor instance. One row per enrollment; the compare-and-set target.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao5.ambient_monitor_instance (
  monitor_instance_id text        NOT NULL,
  monitor_id          text        NOT NULL,
  monitor_version     text        NOT NULL,
  definition_digest   text        NOT NULL,
  owner_id            text        NOT NULL,
  mode                text        NOT NULL,
  status              text        NOT NULL,
  enrolled_at         timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  quiet_until         timestamptz,
  killed_at           timestamptz,
  last_claimed_slot   bigint,
  revision            integer     NOT NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,

  CONSTRAINT ambient_monitor_instance_pk PRIMARY KEY (monitor_instance_id),

  CONSTRAINT ambient_monitor_instance_id_bounded
    CHECK (monitor_instance_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_monitor_instance_monitor_bounded
    CHECK (monitor_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_monitor_instance_owner_bounded
    CHECK (owner_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_monitor_instance_digest_hex
    CHECK (definition_digest ~ '^[0-9a-f]{64}$'),

  -- One mode. There is no production mode a row could be written into.
  CONSTRAINT ambient_monitor_instance_mode_shadow CHECK (mode = 'SHADOW'),
  CONSTRAINT ambient_monitor_instance_status_closed
    CHECK (status IN ('ACTIVE', 'QUIETED', 'KILLED', 'EXPIRED')),

  CONSTRAINT ambient_monitor_instance_revision_positive CHECK (revision >= 1),
  CONSTRAINT ambient_monitor_instance_expires_after_enrolled CHECK (expires_at > enrolled_at),
  CONSTRAINT ambient_monitor_instance_updated_not_before_created CHECK (updated_at >= created_at),
  CONSTRAINT ambient_monitor_instance_slot_non_negative
    CHECK (last_claimed_slot IS NULL OR last_claimed_slot >= 0),

  -- KILLED and the kill instant are ONE fact, so they cannot disagree. A row that says KILLED
  -- without an instant, or carries an instant without saying KILLED, is a kill switch whose state
  -- depends on which column you read.
  CONSTRAINT ambient_monitor_instance_kill_consistent
    CHECK ((killed_at IS NULL) = (status <> 'KILLED'))
);

-- ---------------------------------------------------------------------------
-- The budget window. Epoch-aligned, so a restart lands in the same window.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao5.ambient_budget_window (
  monitor_instance_id    text        NOT NULL,
  window_start_epoch     bigint      NOT NULL,
  window_seconds         integer     NOT NULL,
  investigations_claimed integer     NOT NULL,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,

  -- The window IS the identity. A second row for the same window would be a second budget.
  CONSTRAINT ambient_budget_window_pk PRIMARY KEY (monitor_instance_id, window_start_epoch),
  CONSTRAINT ambient_budget_window_instance_fk
    FOREIGN KEY (monitor_instance_id)
    REFERENCES qf_jarvis_jao5.ambient_monitor_instance (monitor_instance_id),

  CONSTRAINT ambient_budget_window_start_non_negative CHECK (window_start_epoch >= 0),
  CONSTRAINT ambient_budget_window_seconds_bounded
    CHECK (window_seconds BETWEEN 60 AND 86400),
  CONSTRAINT ambient_budget_window_claimed_non_negative CHECK (investigations_claimed >= 0),
  CONSTRAINT ambient_budget_window_claimed_bounded CHECK (investigations_claimed <= 16)
);

-- ---------------------------------------------------------------------------
-- The ambient investigation run. Claimed first, finalized later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao5.ambient_investigation_run (
  ambient_run_id      text        NOT NULL,
  monitor_instance_id text        NOT NULL,
  trigger_kind        text        NOT NULL,
  trigger_ref         text        NOT NULL,
  dedupe_key          text        NOT NULL,
  scheduled_slot      bigint,
  event_id            text,
  cycle_run_id        text        NOT NULL,
  claimed_at          timestamptz NOT NULL,
  status              text        NOT NULL,
  jao1_run_id         text        NOT NULL,
  finalized_at        timestamptz,
  outcome             text,
  attention_present   boolean,
  refusal_code        text,
  capability_calls    integer     NOT NULL,
  model_calls         integer     NOT NULL,

  CONSTRAINT ambient_investigation_run_pk PRIMARY KEY (ambient_run_id),
  CONSTRAINT ambient_investigation_run_instance_fk
    FOREIGN KEY (monitor_instance_id)
    REFERENCES qf_jarvis_jao5.ambient_monitor_instance (monitor_instance_id),

  -- THE ARBITRATION CONSTRAINT. At most one investigation per trigger identity, whatever the
  -- application believes about who won. This is what makes duplicate suppression a property of the
  -- database rather than of the code that happened to run -- including across restart, and
  -- including when two processes claim the same slot or the same event at the same instant.
  CONSTRAINT ambient_investigation_run_dedupe_unique UNIQUE (dedupe_key),

  CONSTRAINT ambient_investigation_run_id_bounded
    CHECK (ambient_run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_investigation_run_jao1_bounded
    CHECK (jao1_run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_investigation_run_cycle_bounded
    CHECK (cycle_run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_investigation_run_dedupe_bounded
    CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  CONSTRAINT ambient_investigation_run_trigger_ref_bounded
    CHECK (char_length(trigger_ref) BETWEEN 1 AND 160),

  CONSTRAINT ambient_investigation_run_trigger_closed
    CHECK (trigger_kind IN ('SCHEDULED_INTERVAL', 'APPROVED_EVENT')),
  CONSTRAINT ambient_investigation_run_status_closed
    CHECK (status IN ('CLAIMED', 'FINALIZED')),
  CONSTRAINT ambient_investigation_run_outcome_closed
    CHECK (outcome IS NULL OR outcome IN ('NO_ANOMALY', 'ATTENTION_CREATED', 'REFUSED')),

  CONSTRAINT ambient_investigation_run_calls_bounded
    CHECK (capability_calls BETWEEN 0 AND 1 AND model_calls BETWEEN 0 AND 1),

  -- FINALIZED and its metadata are one fact. A finalized run without an outcome, or an outcome on a
  -- run that never finalized, is a record that cannot be read honestly.
  CONSTRAINT ambient_investigation_run_finalize_consistent
    CHECK (
      (status = 'CLAIMED' AND finalized_at IS NULL AND outcome IS NULL AND attention_present IS NULL)
      OR
      (status = 'FINALIZED' AND finalized_at IS NOT NULL AND outcome IS NOT NULL
       AND attention_present IS NOT NULL)
    ),

  -- The trigger and its reference agree: a scheduled run has a slot, an event run has an event id.
  CONSTRAINT ambient_investigation_run_trigger_ref_consistent
    CHECK (
      (trigger_kind = 'SCHEDULED_INTERVAL' AND scheduled_slot IS NOT NULL AND event_id IS NULL)
      OR
      (trigger_kind = 'APPROVED_EVENT' AND event_id IS NOT NULL AND scheduled_slot IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ambient_investigation_run_by_instance
  ON qf_jarvis_jao5.ambient_investigation_run (monitor_instance_id, claimed_at);

-- ---------------------------------------------------------------------------
-- Operation replay. What makes a retried enrollment or kill safe.
-- ---------------------------------------------------------------------------
--
-- A caller that lost its connection does not know whether its enroll or kill committed. The unique
-- operation id answers that: same id and same semantic payload returns the committed result and
-- writes nothing; same id with a DIFFERENT payload fails closed rather than quietly becoming a
-- second, different operation.
--
-- Only a digest is stored, and the recorded result is IMMUTABLE committed identity -- the revision
-- and status the operation actually committed at, not a header that has moved on since. That is the
-- JAO-3 temporal-replay lesson applied before it could be repeated here.
CREATE TABLE IF NOT EXISTS qf_jarvis_jao5.ambient_operation_replay (
  operation_id         text        NOT NULL,
  monitor_instance_id  text        NOT NULL,
  operation_kind       text        NOT NULL,
  semantic_digest      text        NOT NULL,
  committed_revision   integer     NOT NULL,
  committed_status     text        NOT NULL,
  committed_at         timestamptz NOT NULL,
  created_at           timestamptz NOT NULL,

  CONSTRAINT ambient_operation_replay_pk PRIMARY KEY (operation_id),

  CONSTRAINT ambient_operation_replay_id_bounded
    CHECK (operation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_operation_replay_instance_bounded
    CHECK (monitor_instance_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT ambient_operation_replay_kind_closed
    CHECK (operation_kind IN ('ENROLL_MONITOR', 'KILL_MONITOR')),
  CONSTRAINT ambient_operation_replay_digest_hex
    CHECK (semantic_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ambient_operation_replay_revision_positive CHECK (committed_revision >= 1),
  CONSTRAINT ambient_operation_replay_status_closed
    CHECK (committed_status IN ('ACTIVE', 'QUIETED', 'KILLED', 'EXPIRED'))
);
