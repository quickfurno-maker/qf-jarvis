-- 0004_projection_foundation.sql
--
-- The projection foundation: checkpoints, bounded-retry attempt records, and two minimized,
-- disposable read models (Stage 3.4.1, ADR-0034).
--
-- Migrations 0001-0003 built and protected the immutable event log and the boundary audit tables.
-- This migration adds the derived-read-model foundation ADR-0022 (deterministic replay) and ADR-0021
-- (checkpoint-driven projections, bounded retries, a poison event HALTS its own projection) require —
-- and nothing else. It does NOT add the runner, the advisory-lock code, or the projection handlers
-- (later Stage 3.4 slices), and it introduces no dead-letter table, quarantine ledger, or replay
-- command (those are Stage 3.5).
--
--   * qf_jarvis.projection_checkpoint — one row per (projection_name, projection_version): the
--     highest event sequence fully applied, the active/blocked status, and bounded retry metadata.
--     MUTABLE (a checkpoint advances) — it is NOT the immutable log.
--   * qf_jarvis.projection_attempt — an APPEND-ONLY, PAYLOAD-FREE record of each processing attempt:
--     a bounded attempt number, a succeeded/failed outcome, and (on failure) a closed safe error code.
--     Never a payload, raw body, correlation/subject id, exception message, stack trace, SQL, or any
--     sender-controlled text.
--   * qf_jarvis.rm_event_type_activity, qf_jarvis.rm_daily_event_acceptance — two disposable,
--     non-authoritative read models over IMMUTABLE EVENT METADATA only (event type/version, sequence,
--     acceptance instant). They hold no payload, subject, correlation id, event id, or free text, so
--     erasure survives rebuild trivially (there is nothing to erase). rm_subject_activity (ADR-0022
--     §9) is a LATER Stage 3.6 model and is NOT created here.
--
-- A dedicated DEPLOYMENT role qf_jarvis_projection_runtime (separate from the ingestion role
-- qf_jarvis_runtime) receives least privilege, conditionally, exactly as 0002/0003 grant the
-- ingestion role. The ingestion role gains NOTHING on these tables. Managed status is unchanged:
-- 0004 is local/CI only; the managed database still carries only 0001 (ADR-0034 §13).
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- The projection checkpoint (mutable state; one row per name+version)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.projection_checkpoint (
  -- Repository-owned identity. projection_name is lowercase kebab-case (mirrors ProjectionName in TS).
  projection_name       TEXT        NOT NULL,
  projection_version    INTEGER     NOT NULL,

  -- The highest event.sequence FULLY APPLIED by this projection. Advances only on success, and only
  -- forward. A version bump is a new (name, version) identity that rebuilds from 0 (ADR-0022 §6).
  last_sequence         BIGINT      NOT NULL DEFAULT 0,

  -- active (processing, possibly retry-pending) or blocked (halted on a poison event).
  status                TEXT        NOT NULL DEFAULT 'active',

  -- The poison event's sequence, present ONLY while blocked; it is strictly beyond last_sequence and
  -- is never applied.
  blocked_sequence      BIGINT,

  -- Bounded consecutive failures on the NEXT event (0..MAX_PROJECTION_ATTEMPTS = 5).
  failed_attempt_count  SMALLINT    NOT NULL DEFAULT 0,

  -- The closed, repository-owned safe error code of the most recent failure; NULL when clean.
  last_safe_error_code  VARCHAR(64),

  -- The earliest injected instant at which the next attempt may run (bounded-backoff intent, ADR-0034
  -- §7). No scheduler/worker is added in Stage 3.4; the runner compares an INJECTED now against this.
  next_attempt_at       TIMESTAMPTZ,

  -- Repository-supplied from an injected clock (NOT database now()).
  created_at            TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL,

  CONSTRAINT projection_checkpoint_pk PRIMARY KEY (projection_name, projection_version),

  -- --- Constraints ---------------------------------------------------------

  -- The repository-owned projection-name format (mirrors PROJECTION_NAME_PATTERN in TS).
  CONSTRAINT projection_checkpoint_name_format
    CHECK (projection_name ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
           AND length(projection_name) BETWEEN 1 AND 64),

  CONSTRAINT projection_checkpoint_version_positive  CHECK (projection_version > 0),
  CONSTRAINT projection_checkpoint_last_sequence_nonneg CHECK (last_sequence >= 0),
  CONSTRAINT projection_checkpoint_status_known       CHECK (status IN ('active', 'blocked')),
  CONSTRAINT projection_checkpoint_failed_count_bounds CHECK (failed_attempt_count BETWEEN 0 AND 5),

  -- The status/count equivalence: an ACTIVE checkpoint has 0..MAX-1 (0..4) failures; a BLOCKED
  -- checkpoint has EXACTLY MAX (5). An active row with failed_attempt_count = 5 is rejected, and a
  -- blocked row with any other count is rejected (also enforced by the blocked_shape constraint).
  CONSTRAINT projection_checkpoint_active_count_bounds
    CHECK (status <> 'active' OR failed_attempt_count BETWEEN 0 AND 4),
  CONSTRAINT projection_checkpoint_blocked_count_is_max
    CHECK (status <> 'blocked' OR failed_attempt_count = 5),

  CONSTRAINT projection_checkpoint_error_code_safe
    CHECK (last_safe_error_code IS NULL OR last_safe_error_code IN (
      'projection-handler-failed', 'projection-checkpoint-invalid',
      'projection-state-write-failed', 'projection-attempt-write-failed'
    )),

  -- A blocked checkpoint: has a poison sequence beyond last_sequence, exactly MAX failures, a code,
  -- and no pending next-attempt.
  CONSTRAINT projection_checkpoint_blocked_shape
    CHECK (status <> 'blocked' OR (
      blocked_sequence IS NOT NULL
      AND blocked_sequence > last_sequence
      AND failed_attempt_count = 5
      AND last_safe_error_code IS NOT NULL
      AND next_attempt_at IS NULL
    )),

  -- An active checkpoint never carries a blocked sequence.
  CONSTRAINT projection_checkpoint_active_no_blocked_sequence
    CHECK (status <> 'active' OR blocked_sequence IS NULL),

  -- Active AND clean (no failures) carries neither an error code nor a next-attempt.
  CONSTRAINT projection_checkpoint_active_clean
    CHECK (NOT (status = 'active' AND failed_attempt_count = 0)
           OR (last_safe_error_code IS NULL AND next_attempt_at IS NULL)),

  -- Active AND failing (retry-pending) always carries a safe error code.
  CONSTRAINT projection_checkpoint_active_failing_has_code
    CHECK (NOT (status = 'active' AND failed_attempt_count > 0)
           OR last_safe_error_code IS NOT NULL),

  -- next_attempt_at is permitted ONLY for an active retry-pending checkpoint (1..MAX-1 failures).
  CONSTRAINT projection_checkpoint_next_attempt_only_retry_pending
    CHECK (next_attempt_at IS NULL
           OR (status = 'active' AND failed_attempt_count BETWEEN 1 AND 4))
);

COMMENT ON TABLE qf_jarvis.projection_checkpoint IS
  'One checkpoint per (projection_name, projection_version): highest applied event sequence, '
  'active/blocked status, and bounded retry metadata. Mutable state (advances forward only); '
  'timestamps are repository-supplied from an injected clock. Contains no payload or personal data.';

-- ---------------------------------------------------------------------------
-- The projection attempt log (APPEND-ONLY, payload-free)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.projection_attempt (
  -- Recording order of attempts. Database-generated; never supplied by a caller.
  sequence            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  projection_name     TEXT        NOT NULL,
  projection_version  INTEGER     NOT NULL,

  -- The event.sequence this attempt processed.
  event_sequence      BIGINT      NOT NULL,

  -- 1..MAX for this (projection, version, event).
  attempt_number      SMALLINT    NOT NULL,

  -- succeeded or failed.
  outcome             TEXT        NOT NULL,

  -- The closed, repository-owned safe error code (failure only); NULL on success.
  safe_error_code     VARCHAR(64),

  -- Injected timestamps (deterministic/testable); recorded_at is the database's own fact.
  started_at          TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  -- No duplicate attempt for the same projection+version+event+attempt-number.
  CONSTRAINT projection_attempt_unique
    UNIQUE (projection_name, projection_version, event_sequence, attempt_number),

  -- --- Constraints ---------------------------------------------------------

  CONSTRAINT projection_attempt_name_format
    CHECK (projection_name ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
           AND length(projection_name) BETWEEN 1 AND 64),
  CONSTRAINT projection_attempt_version_positive CHECK (projection_version > 0),
  CONSTRAINT projection_attempt_event_sequence_positive CHECK (event_sequence > 0),
  CONSTRAINT projection_attempt_number_bounds CHECK (attempt_number BETWEEN 1 AND 5),
  CONSTRAINT projection_attempt_outcome_known CHECK (outcome IN ('succeeded', 'failed')),
  CONSTRAINT projection_attempt_error_code_safe
    CHECK (safe_error_code IS NULL OR safe_error_code IN (
      'projection-handler-failed', 'projection-checkpoint-invalid',
      'projection-state-write-failed', 'projection-attempt-write-failed'
    )),
  CONSTRAINT projection_attempt_succeeded_has_no_code
    CHECK (outcome <> 'succeeded' OR safe_error_code IS NULL),
  CONSTRAINT projection_attempt_failed_has_code
    CHECK (outcome <> 'failed' OR safe_error_code IS NOT NULL),
  CONSTRAINT projection_attempt_timestamps_ordered CHECK (completed_at >= started_at)
);

COMMENT ON TABLE qf_jarvis.projection_attempt IS
  'Append-only, PAYLOAD-FREE record of projection processing attempts. UPDATE and DELETE are refused '
  'by trigger. Carries only a bounded attempt number, a succeeded/failed outcome, and a closed safe '
  'error code on failure — never a payload, raw body, correlation/subject id, exception message, '
  'stack trace, SQL, or any sender-controlled text.';

CREATE INDEX projection_attempt_by_projection_event
  ON qf_jarvis.projection_attempt (projection_name, projection_version, event_sequence);
CREATE INDEX projection_attempt_by_projection_outcome
  ON qf_jarvis.projection_attempt (projection_name, projection_version, outcome);

-- ---------------------------------------------------------------------------
-- The two minimized read models (disposable, non-authoritative, metadata-only)
-- ---------------------------------------------------------------------------

-- Activity per canonical event type+version. Keys and values are repository-owned taxonomy and
-- database-generated infrastructure metadata only.
CREATE TABLE qf_jarvis.rm_event_type_activity (
  event_type            TEXT        NOT NULL,
  event_version         INTEGER     NOT NULL,
  event_count           BIGINT      NOT NULL,
  first_event_sequence  BIGINT      NOT NULL,
  last_event_sequence   BIGINT      NOT NULL,
  last_accepted_at      TIMESTAMPTZ NOT NULL,

  CONSTRAINT rm_event_type_activity_pk PRIMARY KEY (event_type, event_version),
  CONSTRAINT rm_event_type_activity_version_positive CHECK (event_version > 0),
  CONSTRAINT rm_event_type_activity_count_positive CHECK (event_count > 0),
  CONSTRAINT rm_event_type_activity_first_seq_positive CHECK (first_event_sequence > 0),
  CONSTRAINT rm_event_type_activity_seq_order CHECK (last_event_sequence >= first_event_sequence)
);

COMMENT ON TABLE qf_jarvis.rm_event_type_activity IS
  'Disposable, non-authoritative read model: per event type+version, the count and the first/last '
  'ingestion sequence and last acceptance instant. IMMUTABLE EVENT METADATA ONLY — no payload, '
  'subject, correlation id, event id, or free text. Rebuildable from the log at any time.';

-- Acceptance volume per UTC calendar day. accepted_date is ALWAYS derived from the immutable
-- event.accepted_at in UTC (date_trunc/cast at UTC), never from a wall clock.
CREATE TABLE qf_jarvis.rm_daily_event_acceptance (
  accepted_date         DATE        PRIMARY KEY,
  event_count           BIGINT      NOT NULL,
  first_event_sequence  BIGINT      NOT NULL,
  last_event_sequence   BIGINT      NOT NULL,

  CONSTRAINT rm_daily_event_acceptance_count_positive CHECK (event_count > 0),
  CONSTRAINT rm_daily_event_acceptance_first_seq_positive CHECK (first_event_sequence > 0),
  CONSTRAINT rm_daily_event_acceptance_seq_order CHECK (last_event_sequence >= first_event_sequence)
);

COMMENT ON TABLE qf_jarvis.rm_daily_event_acceptance IS
  'Disposable, non-authoritative read model: per UTC calendar day (derived from event.accepted_at), '
  'the accepted-event count and the first/last ingestion sequence. IMMUTABLE EVENT METADATA ONLY — '
  'no payload, subject, correlation id, event id, or free text. Rebuildable from the log at any time.';

-- ---------------------------------------------------------------------------
-- Immutability for the attempt log — append-only, exactly as the event/audit logs
-- ---------------------------------------------------------------------------

CREATE FUNCTION qf_jarvis.projection_attempt_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'The projection-attempt log is append-only: % is not permitted on table '
    '"qf_jarvis.projection_attempt". Attempt records are immutable audit facts.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION qf_jarvis.projection_attempt_reject_mutation() IS
  'Refuses UPDATE and DELETE on the projection-attempt log. Fires for every role, including the owner.';

CREATE TRIGGER projection_attempt_is_immutable
  BEFORE UPDATE OR DELETE ON qf_jarvis.projection_attempt
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.projection_attempt_reject_mutation();

-- ---------------------------------------------------------------------------
-- Access — belt-and-braces PUBLIC / managed-alias revokes, and projection-role least privilege
-- ---------------------------------------------------------------------------
--
-- New tables grant nothing to PUBLIC or the managed aliases by default; these explicit revokes state
-- the intent locally and are idempotent. The runner bootstrap also revokes ALL TABLES from
-- anon/authenticated/service_role and PUBLIC on every migration run.

REVOKE ALL ON qf_jarvis.projection_checkpoint    FROM PUBLIC;
REVOKE ALL ON qf_jarvis.projection_attempt       FROM PUBLIC;
REVOKE ALL ON qf_jarvis.rm_event_type_activity   FROM PUBLIC;
REVOKE ALL ON qf_jarvis.rm_daily_event_acceptance FROM PUBLIC;

-- Explicit managed-alias denial for the four new tables, when those roles exist (Supabase only).
DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_checkpoint FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_attempt FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_event_type_activity FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_daily_event_acceptance FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- The DEDICATED projection role. Separate from the ingestion role qf_jarvis_runtime, which gains
-- NOTHING here. Conditional and idempotent (the role is a deployment artifact; it does not exist on a
-- laptop or in CI). No LOGIN password is set in Git — see docs/engineering/managed-database-runbook.md.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN
    -- Clean-slate reassertion of least privilege, exactly as 0002/0003 do for the ingestion role.
    REVOKE ALL ON SCHEMA qf_jarvis FROM qf_jarvis_projection_runtime;
    REVOKE ALL ON ALL TABLES IN SCHEMA qf_jarvis FROM qf_jarvis_projection_runtime;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA qf_jarvis FROM qf_jarvis_projection_runtime;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qf_jarvis FROM qf_jarvis_projection_runtime;

    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_projection_runtime;

    -- The event log: COLUMN-LEVEL SELECT on ONLY the immutable metadata the runner and the two
    -- initial projections read. NO payload, NO subject/correlation ids, NO signature/digest columns,
    -- and NO INSERT/UPDATE/DELETE — projections never write the log.
    GRANT SELECT (sequence, event_type, event_version, accepted_at)
      ON qf_jarvis.event TO qf_jarvis_projection_runtime;

    -- The checkpoint: mutable state the runner advances. SELECT/INSERT/UPDATE; no DELETE/TRUNCATE.
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.projection_checkpoint TO qf_jarvis_projection_runtime;

    -- The attempt log: append-only. INSERT on the caller columns; SELECT on the safe columns the
    -- runner reads (to compute the next attempt number and inspect outcomes). No UPDATE/DELETE.
    GRANT INSERT (projection_name, projection_version, event_sequence, attempt_number, outcome,
                  safe_error_code, started_at, completed_at)
      ON qf_jarvis.projection_attempt TO qf_jarvis_projection_runtime;
    GRANT SELECT (sequence, projection_name, projection_version, event_sequence, attempt_number,
                  outcome, safe_error_code, started_at, completed_at, recorded_at)
      ON qf_jarvis.projection_attempt TO qf_jarvis_projection_runtime;

    -- The read models: upsert. SELECT/INSERT/UPDATE; no DELETE/TRUNCATE (a version-bump rebuild is a
    -- trusted admin operation, not a runtime grant).
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.rm_event_type_activity   TO qf_jarvis_projection_runtime;
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.rm_daily_event_acceptance TO qf_jarvis_projection_runtime;
  END IF;
END
$grant$;
