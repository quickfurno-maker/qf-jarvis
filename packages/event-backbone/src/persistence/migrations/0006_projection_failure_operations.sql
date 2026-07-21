-- 0006_projection_failure_operations.sql
--
-- Projection FAILURE PERSISTENCE foundation (QFJ-P03.07C, ADR-0040).
--
-- QFJ-P03.07A designed projection failure operations and concluded SCHEMA_REQUIRED; QFJ-P03.07B added
-- the closed five-category failure taxonomy and the deterministic-handler-failure contract in code.
-- This migration adds ONLY the durable persistence foundation those operations need — nothing wires it
-- into the production runner (that is QFJ-P03.07D), and there is NO operator API, quarantine command,
-- replay authorization workflow, or replay execution here (those are QFJ-P03.07E/F). It contains ONLY
-- projection-failure persistence: no RAG, pgvector, agents, tasks, memory, WhatsApp, model gateway,
-- Core integration, payments, analytics, subject activity, or any MVP/Post-MVP runtime schema.
--
--   * qf_jarvis.projection_failure — the MUTABLE failure aggregate: exactly one row per durable
--     failure. Identity columns are immutable (trigger); lifecycle status advances forward through
--     repository-owned methods. A PARTIAL UNIQUE INDEX enforces "at most one active (unresolved)
--     failure per (projection_name, projection_version, projection_position)".
--   * qf_jarvis.projection_failure_action — an APPEND-ONLY, attributable audit ledger of every
--     lifecycle action (UPDATE/DELETE refused by trigger).
--   * qf_jarvis.projection_replay_authorization — MUTABLE replay-authorization state (identity
--     immutable). A PARTIAL UNIQUE INDEX enforces "at most one ACTIVE authorization per failure".
--   * qf_jarvis.projection_replay_attempt — replay-attempt + lease evidence. Identity and lease are
--     immutable; a single transition started -> terminal is allowed once (trigger). A PARTIAL UNIQUE
--     INDEX enforces "at most one live (started) attempt per failure"; UNIQUE(failure_id, attempt_number)
--     enforces attempt-number uniqueness; a composite FK ties an attempt's authorization to its failure.
--
-- The active-failure BICONDITIONAL (a blocked checkpoint <-> exactly one unresolved active failure) is
-- a CROSS-TABLE property no single constraint can prove alone. This migration enforces the
-- DATABASE-enforceable half (at most one active failure per name/version/position; identity integrity)
-- and leaves the full biconditional to the atomic repository transaction and the reconciliation query
-- (QFJ-P03.07D/E). The projection_checkpoint table is DELIBERATELY UNCHANGED: it already carries the
-- blocked state and blocked_position (migrations 0004/0005), correlation is by the natural
-- (name, version, blocked_position) key, and touching it would risk runner/ordering semantics.
--
-- All external identity is a repository-supplied UUID (like qf_jarvis.event.event_id); recording order
-- uses BIGINT GENERATED ALWAYS AS IDENTITY. Timestamps are repository-supplied from an injected clock
-- (recorded_at defaults to clock_timestamp() on the append-only ledger, exactly as 0004's attempt log).
--
-- Managed status is UNCHANGED: 0006 is local/CI only; the managed database still carries only 0001, and
-- NO managed migration is authorized (ADR-0039 / ADR-0040). Migrations 0001-0005 are byte-for-byte
-- unchanged. There is NO 0007.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. The failure aggregate (mutable state; identity immutable)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.projection_failure (
  -- Repository-supplied branded identity (UUID), immutable.
  failure_id              UUID        NOT NULL,

  -- The blocked projection identity + cursor. projection_position is the blocked projection position;
  -- event_storage_sequence is the immutable raw event identity, retained for reconciliation.
  projection_name         TEXT        NOT NULL,
  projection_version      INTEGER     NOT NULL,
  projection_position     BIGINT      NOT NULL,
  event_storage_sequence  BIGINT      NOT NULL,
  -- The event's canonical id, when available (metadata only).
  event_id                UUID,

  -- The closed five-category taxonomy value that produced this durable failure. Only the deterministic
  -- exhaustion path is expected to create a durable aggregate (ADR-0040), but the column is constrained
  -- to the full closed vocabulary so a future authorized category cannot smuggle in free text.
  category                TEXT        NOT NULL,
  -- The closed, repository-owned diagnostic code (never a raw message).
  safe_error_code         VARCHAR(64) NOT NULL,
  -- An OPTIONAL bounded, sanitized diagnostic digest (never a raw message, stack, SQL, or payload).
  detail_digest           VARCHAR(128),

  -- The lifecycle state (closed vocabulary). Non-terminal = "active/unresolved".
  status                  TEXT        NOT NULL DEFAULT 'open',
  -- Optimistic-concurrency / revision counter. A replay authorization binds to an exact generation.
  generation              INTEGER     NOT NULL DEFAULT 0,

  -- Bounded counters.
  automatic_attempt_count SMALLINT    NOT NULL DEFAULT 0,
  replay_attempt_count    INTEGER     NOT NULL DEFAULT 0,

  -- Attribution for the lifecycle milestones (bounded actor ids).
  acknowledged_at         TIMESTAMPTZ,
  acknowledged_by         VARCHAR(128),
  quarantined_at          TIMESTAMPTZ,
  quarantined_by          VARCHAR(128),
  resolved_at             TIMESTAMPTZ,
  -- The replay attempt that resolved this failure (set only when RESOLVED).
  resolved_attempt_id     UUID,

  first_failed_at         TIMESTAMPTZ NOT NULL,
  last_failed_at          TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL,

  CONSTRAINT projection_failure_pk PRIMARY KEY (failure_id),
  -- Composite unique on (failure_id, projection_name, projection_version) is NOT needed; the natural
  -- (name, version, position) active-uniqueness is a partial index (below).

  -- --- Constraints ---------------------------------------------------------
  CONSTRAINT projection_failure_name_format
    CHECK (projection_name ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
           AND length(projection_name) BETWEEN 1 AND 64),
  CONSTRAINT projection_failure_version_positive  CHECK (projection_version > 0),
  CONSTRAINT projection_failure_position_positive CHECK (projection_position > 0),
  CONSTRAINT projection_failure_event_seq_positive CHECK (event_storage_sequence > 0),

  CONSTRAINT projection_failure_category_known
    CHECK (category IN (
      'DETERMINISTIC_HANDLER_FAILURE', 'TRANSIENT_INFRASTRUCTURE_FAILURE',
      'REPOSITORY_INVARIANT_FAILURE', 'CANCELLATION_OR_SHUTDOWN', 'UNKNOWN_UNCLASSIFIED_FAILURE'
    )),
  CONSTRAINT projection_failure_code_known
    CHECK (safe_error_code IN (
      'projection-handler-failed', 'projection-infrastructure-failed',
      'projection-repository-invariant-failed', 'projection-cancelled', 'projection-unknown-failure'
    )),
  CONSTRAINT projection_failure_status_known
    CHECK (status IN (
      'open', 'acknowledged', 'quarantined', 'replay-authorized', 'replaying',
      'resolved', 'superseded', 'retired'
    )),
  CONSTRAINT projection_failure_generation_nonneg CHECK (generation >= 0),
  CONSTRAINT projection_failure_auto_count_bounds  CHECK (automatic_attempt_count BETWEEN 0 AND 5),
  CONSTRAINT projection_failure_replay_count_nonneg CHECK (replay_attempt_count >= 0),
  CONSTRAINT projection_failure_timestamps_ordered
    CHECK (last_failed_at >= first_failed_at AND updated_at >= created_at),
  -- A RESOLVED failure carries a resolution time AND the successful attempt reference; a non-resolved
  -- failure carries neither.
  CONSTRAINT projection_failure_resolved_shape
    CHECK ((status = 'resolved')
           = (resolved_at IS NOT NULL AND resolved_attempt_id IS NOT NULL)),
  -- Acknowledged/quarantined attribution is paired (a time implies an actor and vice versa).
  CONSTRAINT projection_failure_ack_paired
    CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CONSTRAINT projection_failure_quar_paired
    CHECK ((quarantined_at IS NULL) = (quarantined_by IS NULL))
);

COMMENT ON TABLE qf_jarvis.projection_failure IS
  'The durable projection-failure aggregate (ADR-0040). One row per failure; identity columns are '
  'immutable (trigger); lifecycle status advances forward through repository-owned methods. A partial '
  'unique index enforces at most one active (unresolved) failure per (name, version, position). '
  'Carries only closed, bounded, sanitized fields — never a raw Error, message, stack, SQL, or payload.';

-- At most one ACTIVE (unresolved) failure per blocked projection position. Terminal statuses are
-- excluded so a resolved/superseded/retired failure never blocks a fresh one at the same position.
CREATE UNIQUE INDEX projection_failure_active_unique
  ON qf_jarvis.projection_failure (projection_name, projection_version, projection_position)
  WHERE status NOT IN ('resolved', 'superseded', 'retired');

-- Operator-queue and runner-lookup helpers.
CREATE INDEX projection_failure_by_projection
  ON qf_jarvis.projection_failure (projection_name, projection_version, status);
CREATE INDEX projection_failure_by_status_created
  ON qf_jarvis.projection_failure (status, created_at);

-- ---------------------------------------------------------------------------
-- 2. The append-only, attributable action/audit ledger
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.projection_failure_action (
  -- Recording order (database-generated) and a repository-supplied branded action id.
  sequence             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_id            UUID        NOT NULL,
  failure_id           UUID        NOT NULL,

  action_type          TEXT        NOT NULL,
  -- The closed actor type; actor_id is a bounded identifier (a system action uses actor_type 'system').
  actor_type           TEXT        NOT NULL,
  actor_id             VARCHAR(128) NOT NULL,
  reason               VARCHAR(512),
  idempotency_key      VARCHAR(128),
  correlation_id       UUID,
  expected_generation  INTEGER,
  resulting_generation INTEGER,

  occurred_at          TIMESTAMPTZ NOT NULL,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT projection_failure_action_id_unique UNIQUE (action_id),
  CONSTRAINT projection_failure_action_failure_fk
    FOREIGN KEY (failure_id) REFERENCES qf_jarvis.projection_failure (failure_id),
  CONSTRAINT projection_failure_action_type_known
    CHECK (action_type IN (
      'created', 'acknowledged', 'quarantined', 'replay-authorized', 'replay-started',
      'lease-taken-over', 'replay-succeeded', 'replay-failed', 'authorization-consumed',
      'reconciled', 'resolved', 'superseded'
    )),
  CONSTRAINT projection_failure_action_actor_type_known
    CHECK (actor_type IN (
      'system', 'read-only-operator', 'failure-operator', 'replay-approver', 'administrator'
    )),
  CONSTRAINT projection_failure_action_generation_nonneg
    CHECK ((expected_generation IS NULL OR expected_generation >= 0)
           AND (resulting_generation IS NULL OR resulting_generation >= 0))
);

COMMENT ON TABLE qf_jarvis.projection_failure_action IS
  'Append-only, attributable audit ledger of projection-failure lifecycle actions (ADR-0040). '
  'UPDATE and DELETE are refused by trigger. Carries only closed action/actor vocabularies and bounded '
  'attribution (actor id, reason, idempotency key, correlation id, generations) — never raw text.';

CREATE INDEX projection_failure_action_by_failure
  ON qf_jarvis.projection_failure_action (failure_id, sequence);
-- Idempotency keys are unique where present (prevents duplicate action creation).
CREATE UNIQUE INDEX projection_failure_action_idempotency_unique
  ON qf_jarvis.projection_failure_action (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Replay authorization (mutable state; identity immutable)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.projection_replay_authorization (
  authorization_id    UUID        NOT NULL,
  failure_id          UUID        NOT NULL,
  -- The EXACT failure generation this authorization is bound to.
  failure_generation  INTEGER     NOT NULL,

  state               TEXT        NOT NULL DEFAULT 'active',
  authorized_by       VARCHAR(128) NOT NULL,
  reason              VARCHAR(512),
  idempotency_key     VARCHAR(128) NOT NULL,

  created_at          TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ,
  consumed_at         TIMESTAMPTZ,
  consumed_attempt_id UUID,
  revoked_at          TIMESTAMPTZ,

  CONSTRAINT projection_replay_authorization_pk PRIMARY KEY (authorization_id),
  -- The composite unique key an attempt's FK references, to prove an attempt's authorization belongs to
  -- the attempt's failure.
  CONSTRAINT projection_replay_authorization_failure_unique UNIQUE (authorization_id, failure_id),
  CONSTRAINT projection_replay_authorization_failure_fk
    FOREIGN KEY (failure_id) REFERENCES qf_jarvis.projection_failure (failure_id),
  CONSTRAINT projection_replay_authorization_idempotency_unique UNIQUE (idempotency_key),

  CONSTRAINT projection_replay_authorization_state_known
    CHECK (state IN ('active', 'consumed', 'expired', 'revoked')),
  CONSTRAINT projection_replay_authorization_generation_nonneg CHECK (failure_generation >= 0),
  CONSTRAINT projection_replay_authorization_expiry_after_created
    CHECK (expires_at IS NULL OR expires_at > created_at),
  -- A consumed authorization carries a consumption time AND the consuming attempt reference.
  CONSTRAINT projection_replay_authorization_consumed_shape
    CHECK ((state = 'consumed')
           = (consumed_at IS NOT NULL AND consumed_attempt_id IS NOT NULL)),
  CONSTRAINT projection_replay_authorization_revoked_shape
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

COMMENT ON TABLE qf_jarvis.projection_replay_authorization IS
  'Explicit replay authorization (ADR-0040). Identity is immutable (trigger); state advances '
  'active -> consumed/expired/revoked. A partial unique index enforces at most one ACTIVE authorization '
  'per failure. Bound to an exact failure generation; single-consume via consumed_attempt_id.';

-- At most one ACTIVE authorization per failure.
CREATE UNIQUE INDEX projection_replay_authorization_active_unique
  ON qf_jarvis.projection_replay_authorization (failure_id)
  WHERE state = 'active';

-- ---------------------------------------------------------------------------
-- 4. Replay-attempt + lease evidence (identity/lease immutable; single terminal transition)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.projection_replay_attempt (
  attempt_id          UUID        NOT NULL,
  failure_id          UUID        NOT NULL,
  authorization_id    UUID        NOT NULL,
  attempt_number      INTEGER     NOT NULL,

  state               TEXT        NOT NULL DEFAULT 'started',
  -- Lease evidence (immutable once written).
  lease_owner         VARCHAR(128) NOT NULL,
  lease_acquired_at   TIMESTAMPTZ NOT NULL,
  lease_expires_at    TIMESTAMPTZ NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL,

  -- Terminal evidence (set once on the single started -> terminal transition).
  finished_at         TIMESTAMPTZ,
  outcome_code        VARCHAR(64),
  resulting_position  BIGINT,
  -- Reconciliation evidence: whether the terminal commit outcome was observed or ambiguous.
  commit_observed     BOOLEAN,

  correlation_id      UUID,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT projection_replay_attempt_pk PRIMARY KEY (attempt_id),
  CONSTRAINT projection_replay_attempt_failure_fk
    FOREIGN KEY (failure_id) REFERENCES qf_jarvis.projection_failure (failure_id),
  -- The authorization must belong to THIS attempt's failure (composite FK to the authorization's
  -- (authorization_id, failure_id) unique key).
  CONSTRAINT projection_replay_attempt_authorization_fk
    FOREIGN KEY (authorization_id, failure_id)
    REFERENCES qf_jarvis.projection_replay_authorization (authorization_id, failure_id),
  -- Attempt-number uniqueness per failure.
  CONSTRAINT projection_replay_attempt_number_unique UNIQUE (failure_id, attempt_number),

  CONSTRAINT projection_replay_attempt_number_positive CHECK (attempt_number >= 1),
  CONSTRAINT projection_replay_attempt_state_known
    CHECK (state IN ('started', 'succeeded', 'failed', 'abandoned')),
  CONSTRAINT projection_replay_attempt_lease_coherent CHECK (lease_expires_at > lease_acquired_at),
  CONSTRAINT projection_replay_attempt_started_after_lease CHECK (started_at >= lease_acquired_at),
  CONSTRAINT projection_replay_attempt_resulting_position_positive
    CHECK (resulting_position IS NULL OR resulting_position > 0),
  CONSTRAINT projection_replay_attempt_outcome_code_known
    CHECK (outcome_code IS NULL OR outcome_code IN (
      'projection-handler-failed', 'projection-infrastructure-failed',
      'projection-repository-invariant-failed', 'projection-cancelled', 'projection-unknown-failure'
    )),
  -- A live attempt has no terminal evidence; a terminal attempt has a finished time. A 'succeeded'
  -- attempt carries a resulting checkpoint position; a 'failed' attempt carries an outcome code.
  CONSTRAINT projection_replay_attempt_started_shape
    CHECK (state <> 'started'
           OR (finished_at IS NULL AND outcome_code IS NULL AND resulting_position IS NULL)),
  CONSTRAINT projection_replay_attempt_terminal_finished
    CHECK (state = 'started' OR finished_at IS NOT NULL),
  CONSTRAINT projection_replay_attempt_succeeded_shape
    CHECK (state <> 'succeeded' OR resulting_position IS NOT NULL),
  CONSTRAINT projection_replay_attempt_failed_shape
    CHECK (state <> 'failed' OR outcome_code IS NOT NULL)
);

COMMENT ON TABLE qf_jarvis.projection_replay_attempt IS
  'Replay-attempt and lease evidence (ADR-0040). Identity and lease are immutable (trigger); a single '
  'transition started -> {succeeded,failed,abandoned} is allowed once. A partial unique index enforces '
  'at most one live (started) attempt per failure; UNIQUE(failure_id, attempt_number) enforces '
  'attempt-number uniqueness; a composite FK ties the authorization to the attempt''s failure. An '
  'ambiguous commit is recorded via commit_observed and is NEVER blind replay permission.';

CREATE INDEX projection_replay_attempt_by_failure
  ON qf_jarvis.projection_replay_attempt (failure_id, attempt_number);
-- At most one LIVE (started) attempt/lease per failure.
CREATE UNIQUE INDEX projection_replay_attempt_live_unique
  ON qf_jarvis.projection_replay_attempt (failure_id)
  WHERE state = 'started';

-- ---------------------------------------------------------------------------
-- 5. Immutability / controlled-transition triggers
-- ---------------------------------------------------------------------------

-- The failure aggregate: DELETE refused for every role (including the owner); identity columns
-- immutable; only forward, repository-mediated status/counter/attribution updates are permitted.
CREATE FUNCTION qf_jarvis.projection_failure_guard_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'The projection-failure aggregate is not deletable: DELETE is not permitted on '
      '"qf_jarvis.projection_failure". Failures are durable evidence.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.failure_id <> OLD.failure_id
     OR NEW.projection_name <> OLD.projection_name
     OR NEW.projection_version <> OLD.projection_version
     OR NEW.projection_position <> OLD.projection_position
     OR NEW.event_storage_sequence <> OLD.event_storage_sequence
     OR NEW.category <> OLD.category
     OR NEW.safe_error_code <> OLD.safe_error_code
     OR NEW.first_failed_at <> OLD.first_failed_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION
      'projection-failure identity columns are immutable (failure_id, projection identity, event '
      'identity, category, safe_error_code, first_failed_at, created_at).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$guard$;

COMMENT ON FUNCTION qf_jarvis.projection_failure_guard_mutation() IS
  'Refuses DELETE and any change to immutable identity columns on qf_jarvis.projection_failure. Fires '
  'for every role, including the owner.';

CREATE TRIGGER projection_failure_is_guarded
  BEFORE UPDATE OR DELETE ON qf_jarvis.projection_failure
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.projection_failure_guard_mutation();

-- The action ledger: append-only (UPDATE and DELETE refused).
CREATE FUNCTION qf_jarvis.projection_failure_action_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $reject$
BEGIN
  RAISE EXCEPTION
    'The projection-failure action ledger is append-only: % is not permitted on '
    '"qf_jarvis.projection_failure_action". Action records are immutable audit facts.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$reject$;

COMMENT ON FUNCTION qf_jarvis.projection_failure_action_reject_mutation() IS
  'Refuses UPDATE and DELETE on the projection-failure action ledger. Fires for every role, including the owner.';

CREATE TRIGGER projection_failure_action_is_immutable
  BEFORE UPDATE OR DELETE ON qf_jarvis.projection_failure_action
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.projection_failure_action_reject_mutation();

-- Replay authorization: DELETE refused; identity columns immutable; state may advance.
CREATE FUNCTION qf_jarvis.projection_replay_authorization_guard_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'The replay authorization is not deletable: DELETE is not permitted on '
      '"qf_jarvis.projection_replay_authorization".'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.authorization_id <> OLD.authorization_id
     OR NEW.failure_id <> OLD.failure_id
     OR NEW.failure_generation <> OLD.failure_generation
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION
      'replay-authorization identity columns are immutable (authorization_id, failure_id, '
      'failure_generation, idempotency_key, created_at).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$guard$;

COMMENT ON FUNCTION qf_jarvis.projection_replay_authorization_guard_mutation() IS
  'Refuses DELETE and any change to immutable identity columns on qf_jarvis.projection_replay_authorization.';

CREATE TRIGGER projection_replay_authorization_is_guarded
  BEFORE UPDATE OR DELETE ON qf_jarvis.projection_replay_authorization
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.projection_replay_authorization_guard_mutation();

-- Replay attempt: DELETE refused; identity + lease + started immutable; exactly one started -> terminal
-- transition (no terminal -> anything, no re-open).
CREATE FUNCTION qf_jarvis.projection_replay_attempt_guard_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Replay-attempt evidence is not deletable: DELETE is not permitted on '
      '"qf_jarvis.projection_replay_attempt".'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.attempt_id <> OLD.attempt_id
     OR NEW.failure_id <> OLD.failure_id
     OR NEW.authorization_id <> OLD.authorization_id
     OR NEW.attempt_number <> OLD.attempt_number
     OR NEW.lease_owner <> OLD.lease_owner
     OR NEW.lease_acquired_at <> OLD.lease_acquired_at
     OR NEW.lease_expires_at <> OLD.lease_expires_at
     OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION
      'replay-attempt identity and lease columns are immutable.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state <> 'started' THEN
    RAISE EXCEPTION
      'a terminal replay attempt cannot transition again (started -> terminal is a one-way, '
      'single transition).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$guard$;

COMMENT ON FUNCTION qf_jarvis.projection_replay_attempt_guard_mutation() IS
  'Refuses DELETE, any identity/lease change, and any transition out of a terminal state on '
  'qf_jarvis.projection_replay_attempt (started -> terminal exactly once).';

CREATE TRIGGER projection_replay_attempt_is_guarded
  BEFORE UPDATE OR DELETE ON qf_jarvis.projection_replay_attempt
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.projection_replay_attempt_guard_mutation();

-- ---------------------------------------------------------------------------
-- 6. Access — PUBLIC / managed-alias denials, projection-role least privilege
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.projection_failure               FROM PUBLIC;
REVOKE ALL ON qf_jarvis.projection_failure_action        FROM PUBLIC;
REVOKE ALL ON qf_jarvis.projection_replay_authorization  FROM PUBLIC;
REVOKE ALL ON qf_jarvis.projection_replay_attempt        FROM PUBLIC;

-- Managed aliases: no access to the new objects (Supabase only; conditional + idempotent).
DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_failure FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_failure_action FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_replay_authorization FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_replay_attempt FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON FUNCTION qf_jarvis.projection_failure_guard_mutation() FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON FUNCTION qf_jarvis.projection_failure_action_reject_mutation() FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON FUNCTION qf_jarvis.projection_replay_authorization_guard_mutation() FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON FUNCTION qf_jarvis.projection_replay_attempt_guard_mutation() FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- The projection role: SELECT/INSERT/UPDATE on the mutable-state tables (NO DELETE, NO TRUNCATE — the
-- guard triggers ALSO refuse delete for every role); INSERT/SELECT only on the append-only action
-- ledger. The runtime role gains exactly what QFJ-P03.07D/E/F will need to CREATE and ADVANCE failure
-- state and evidence, and nothing more. The ingestion role (qf_jarvis_runtime) gains NOTHING here.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_projection_runtime;

    -- The failure aggregate: create and advance state; never delete/truncate.
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.projection_failure TO qf_jarvis_projection_runtime;

    -- The action ledger: append-only. INSERT + SELECT; no UPDATE/DELETE.
    GRANT SELECT, INSERT ON qf_jarvis.projection_failure_action TO qf_jarvis_projection_runtime;

    -- Replay authorization + attempt: create and advance state; never delete/truncate.
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.projection_replay_authorization TO qf_jarvis_projection_runtime;
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.projection_replay_attempt TO qf_jarvis_projection_runtime;
  END IF;
END
$grant$;
