-- 0001_event_log.sql
--
-- The immutable canonical event log, in QF Jarvis's OWN schema.
--
-- Every column here corresponds to a field that already exists in the Phase 2
-- canonical envelope (packages/contracts/src/events/canonical-event.ts) or to the
-- signature and digest evidence that ADR-0020 requires an accepted event to carry.
-- NOTHING IS INVENTED. The envelope has no aggregate sequence, so this table has no
-- aggregate sequence — see ADR-0022.
--
-- EVERYTHING LIVES IN "qf_jarvis". NOTHING LIVES IN "public".
--
-- `public` is the shared, world-facing default: the schema a managed provider's Data API
-- reaches for first, and the schema every other tool assumes it may write to. An immutable
-- event log has no business living in a room with an unlocked door.
--
-- Every object below is FULLY QUALIFIED. Nothing here depends on `search_path`, because an
-- ambient `search_path` is a global variable set by whoever connected last — and
-- correctness that rests on one fails the day a pooler hands back a different session
-- (ADR-0023 §3).
--
-- ONE REPRESENTATION OF ONE EVENT
--
-- The envelope lives in columns. The payload lives in `payload` JSONB. THE COMPLETE
-- CANONICAL EVENT IS NOT ALSO STORED AS A JSONB BLOB, and that is the point: storing
-- both would create two representations of one accepted fact, and two representations
-- can disagree. A column says `subject_id = 'CORE-LEAD-42'` while the blob says
-- `'CORE-LEAD-43'` — and now the log, whose entire purpose is to be the thing you can
-- trust when everything else is in doubt, is a source of doubt.
--
-- There is no reconciliation job that fixes that, because there is nothing to reconcile
-- against. So the contradiction is made unrepresentable rather than defended against:
-- the persisted event is RECONSTRUCTED from the envelope columns plus `payload`, and
-- there is exactly one place each field is written.
--
-- WHAT THIS MIGRATION IS NOT
--
-- It is not ingestion. Stage 3.1 creates the table and its constraints; the verify →
-- parse → deduplicate → store pipeline is Stage 3.3. The UNIQUE constraint on
-- event_id lays the FOUNDATION for eventId-based idempotency, but the application
-- behaviour that distinguishes a benign duplicate from a conflicting one does not
-- exist yet and this migration does not claim it does.

-- ---------------------------------------------------------------------------
-- The event log
-- ---------------------------------------------------------------------------
--
-- The schema itself is created by the migration runner's bootstrap, under the advisory
-- lock, before any migration runs. It is deliberately not created here: a runner that
-- needs its own history table before it can read its own history has a bootstrap problem,
-- and the honest fix is to state the bootstrap rather than hide it in `0000_`.

CREATE TABLE qf_jarvis.event (
  -- Ingestion order. A total order over ARRIVAL, not over business time, and it must
  -- never be read as if it were. It exists so that replay is deterministic: live
  -- processing and a rebuild both traverse this column (ADR-0022).
  sequence               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The idempotency identity. Phase 2 calls eventId "the event's idempotency key",
  -- and the UNIQUE constraint below is what will make that a property the database
  -- holds rather than one the application defends under concurrency (ADR-0020).
  event_id               UUID        NOT NULL,

  event_type             TEXT        NOT NULL,
  event_version          INTEGER     NOT NULL,

  -- Always QuickFurno Core. A fact is only a fact once Core has recorded it (ADR-0001),
  -- and the Phase 2 envelope makes `source` a literal. The CHECK below makes the
  -- database refuse anything else, so a non-Core event cannot be stored even by a bug.
  source                 TEXT        NOT NULL,

  -- The subject, as the Phase 2 EntityReference: an opaque {entityType, entityId}.
  -- Core owns what a "lead" actually is. The entity-id character set excludes '@' and
  -- '+' at the contract layer, so a phone number or an email address cannot arrive here.
  subject_type           TEXT        NOT NULL,
  subject_id             TEXT        NOT NULL,

  -- When it happened, and when Core said so.
  occurred_at            TIMESTAMPTZ NOT NULL,
  emitted_at             TIMESTAMPTZ NOT NULL,

  correlation_id         UUID        NOT NULL,
  causation_event_id     UUID,

  -- The event's PAYLOAD, and only the payload. The envelope is above, in columns.
  -- Nothing here duplicates a column, so nothing here can contradict one.
  --
  -- The payload is JSONB because its shape varies by event type: it is the one part of
  -- a canonical event this table cannot give a fixed schema without hard-coding all 41
  -- Phase 2 contracts into SQL and re-migrating on every contract change.
  payload                JSONB       NOT NULL,

  -- SEMANTIC digest: SHA-256 over the deterministic canonical JSON of the ENTIRE parsed
  -- and validated canonical event — envelope and payload together, not the payload
  -- alone. This is what a duplicate is compared on, so that a byte-level difference
  -- meaning the same thing is not a false conflict (ADR-0020 §8).
  --
  -- It is named for what it digests. `payload_digest` would have been a lie by omission
  -- the first time somebody diffed two events whose payloads matched and whose envelopes
  -- did not.
  semantic_event_digest  BYTEA       NOT NULL,

  -- RAW digest: SHA-256 over the exact bytes received. Evidence, and the value the
  -- signature commits to (ADR-0020 §2).
  body_digest            BYTEA       NOT NULL,

  -- Signature evidence. Stage 3.2 populates these; the columns are NOT NULL because
  -- ADR-0020 admits nothing to the store that was not verified first. A nullable
  -- signature column would be a place to put an unverified event, and there must not
  -- be one.
  signature_algorithm    TEXT        NOT NULL,
  signature_key_id       TEXT        NOT NULL,
  signature_signed_at    TIMESTAMPTZ NOT NULL,
  signature              BYTEA       NOT NULL,

  -- Generated by PostgreSQL, never supplied by a caller. When we accepted it is our
  -- fact to record, not the sender's to assert.
  accepted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- --- Constraints ---------------------------------------------------------
  --
  -- These mirror STABLE Phase 2 shapes. They do not restate all of Phase 2 in SQL —
  -- Zod is where a contract is validated, and duplicating it here would give us two
  -- validators to keep in step. What is enforced below is only what PostgreSQL can
  -- check cheaply and what will not change under us: bounds, character sets, literals,
  -- and the two envelope invariants.

  -- The foundation of eventId idempotency (Stage 3.3 builds the behaviour on it).
  CONSTRAINT event_event_id_unique
    UNIQUE (event_id),

  -- MAX_CONTRACT_VERSION is 1000 in the Phase 2 contracts. A version outside that
  -- range is not a future version; it is a malformed one.
  CONSTRAINT event_version_is_positive_and_bounded
    CHECK (event_version >= 1 AND event_version <= 1000),

  -- SHA-256 is exactly 32 bytes. Anything else is not a SHA-256.
  CONSTRAINT event_semantic_event_digest_is_sha256
    CHECK (octet_length(semantic_event_digest) = 32),
  CONSTRAINT event_body_digest_is_sha256
    CHECK (octet_length(body_digest) = 32),

  CONSTRAINT event_signature_not_empty
    CHECK (octet_length(signature) > 0),

  -- MACHINE_TOKEN_PATTERN and MAX_MACHINE_TOKEN_LENGTH from the Phase 2 contracts
  -- (packages/contracts/src/common/text.ts). Bounds and pattern are ONE constraint per
  -- column rather than two, so a violation names the same constraint whichever half it
  -- breaks — a test asserting on a constraint name should not depend on the order
  -- PostgreSQL happens to evaluate two CHECKs in.
  --
  -- Registered event types look like `qf.recommendation.lifecycle-state-recorded`; the
  -- longest in the Phase 2 catalogue is 42 characters, well inside 64.
  CONSTRAINT event_type_is_machine_token
    CHECK (
      length(event_type) BETWEEN 1 AND 64
      AND event_type ~ '^[a-z0-9]+([-.][a-z0-9]+)*$'
    ),

  -- MAX_ENTITY_TYPE_LENGTH = 64, and the same machine-token pattern.
  --
  -- Deliberately NOT a closed list of subject types. QuickFurno Core owns its own entity
  -- taxonomy and Phase 3 has not integrated with Core, so enumerating `lead`, `vendor`,
  -- `client` here would be inventing a fact about a system we have not looked at — the
  -- exact mistake the contracts refused to make (entity-reference.ts).
  CONSTRAINT event_subject_type_is_machine_token
    CHECK (
      length(subject_type) BETWEEN 1 AND 64
      AND subject_type ~ '^[a-z0-9]+([-.][a-z0-9]+)*$'
    ),

  -- MAX_ENTITY_ID_LENGTH = 128, character set [A-Za-z0-9._:-].
  --
  -- Deliberately NOT a UUID. Core chooses its own identifier scheme and we carry the
  -- string opaquely; a UUID column here would be a guess about Core's database.
  --
  -- The character set excludes '@' and '+', so an email address and an E.164 phone
  -- number are structurally unable to appear in this column. That is a guardrail, not
  -- the privacy control — the control is that this is a REFERENCE, and Core resolves it.
  CONSTRAINT event_subject_id_is_opaque_core_reference
    CHECK (
      length(subject_id) BETWEEN 1 AND 128
      AND subject_id ~ '^[A-Za-z0-9._:-]+$'
    ),

  -- The envelope's `source` is a literal. Enforce it here too: a bug that tried to
  -- store a non-Core event would be storing a forgery with extra steps.
  CONSTRAINT event_source_is_quickfurno_core
    CHECK (source = 'quickfurno-core'),

  -- ADR-0020 approves exactly one signature algorithm: Ed25519, asymmetric, so that
  -- Jarvis holds only public keys and CANNOT FORGE A CORE EVENT even if fully
  -- compromised. A second accepted algorithm is a second way in; there is one, and the
  -- database is where that stops being a convention.
  CONSTRAINT event_signature_algorithm_is_ed25519
    CHECK (signature_algorithm = 'ed25519'),

  CONSTRAINT event_signature_key_id_bounds
    CHECK (length(signature_key_id) BETWEEN 1 AND 128),

  -- "An event may not causally reference itself." A self-causing event turns the
  -- audit walk into an infinite loop, and the backward walk is what makes an
  -- incident recoverable rather than merely alarming.
  CONSTRAINT event_causation_is_not_self
    CHECK (causation_event_id IS NULL OR causation_event_id <> event_id),

  -- "emittedAt must not precede occurredAt" — an event announced before it happened
  -- is a clock fault or a forgery, and either way it is not processed.
  CONSTRAINT event_emitted_at_not_before_occurred_at
    CHECK (emitted_at >= occurred_at)
);

COMMENT ON TABLE qf_jarvis.event IS
  'The immutable canonical event log. Append-only: UPDATE and DELETE are refused by trigger. '
  'Ordered by `sequence` (ingestion order, NOT business order). The envelope is in columns and '
  'the payload is in `payload`; the complete event is NOT also stored as a blob, so the two '
  'cannot contradict each other. Contains no personal data by construction — Phase 2 contracts '
  'carry opaque Core references, never copies of people.';

COMMENT ON COLUMN qf_jarvis.event.sequence IS
  'Ingestion order. A total order over ARRIVAL, not business time. Replay traverses this.';
COMMENT ON COLUMN qf_jarvis.event.payload IS
  'The canonical event''s payload, and only the payload. The envelope is in columns; nothing '
  'here duplicates one. The persisted event is reconstructed from the columns plus this.';
COMMENT ON COLUMN qf_jarvis.event.semantic_event_digest IS
  'SHA-256 over the deterministic canonical JSON of the ENTIRE parsed and validated canonical '
  'event — envelope and payload together, not the payload alone. Semantic identity, used to '
  'distinguish a benign duplicate from a conflicting one (Stage 3.3).';
COMMENT ON COLUMN qf_jarvis.event.body_digest IS
  'SHA-256 over the exact bytes received. Evidence; the value the signature commits to.';

-- ---------------------------------------------------------------------------
-- Indexes — only where a query is actually foreseen. No speculative indexes.
-- ---------------------------------------------------------------------------

-- Ingestion-order scans are the projection runner's only read pattern (Stage 3.4).
-- The PRIMARY KEY on `sequence` already provides this index; it is not duplicated.

-- The audit walk: "show me everything in this business thread."
CREATE INDEX event_correlation_id_idx
  ON qf_jarvis.event (correlation_id);

-- The backward walk: "what did this event cause?" Partial, because most events have
-- no causation and there is no reason to index the nulls.
CREATE INDEX event_causation_event_id_idx
  ON qf_jarvis.event (causation_event_id)
  WHERE causation_event_id IS NOT NULL;

-- Dispatch and per-contract queries; also how a projection selects the types it handles.
CREATE INDEX event_type_version_idx
  ON qf_jarvis.event (event_type, event_version);

-- "Everything that ever happened to this subject." The shape matches the contract's
-- EntityReference exactly — it is a compound opaque reference, so the index is compound.
CREATE INDEX event_subject_idx
  ON qf_jarvis.event (subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------
--
-- Two independent controls, because neither is sufficient alone:
--
--   1. A trigger. It fires for EVERY role, including the table owner, so it holds even
--      where grants do not.
--   2. REVOKE. It stops UPDATE and DELETE for ordinary roles.
--
-- WHAT THIS DOES NOT DO, stated plainly rather than implied:
--
--   * A PostgreSQL SUPERUSER is not constrained by grants, and the table OWNER can
--     `ALTER TABLE ... DISABLE TRIGGER`. Neither control binds them.
--   * Therefore THE RUNTIME APPLICATION ROLE MUST NOT BE A SUPERUSER, AND MUST NOT OWN
--     THIS SCHEMA OR THIS TABLE. The migration role and the runtime role are separate
--     responsibilities. That is a deployment obligation, and Stage 3.1 does not and
--     cannot discharge it — it is recorded here so it is not discovered later
--     (ADR-0023 §4).

CREATE FUNCTION qf_jarvis.event_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'The event log is append-only: % is not permitted on table "qf_jarvis.event". '
    'Accepted events are immutable audit records. Corrections are new records, never edits.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION qf_jarvis.event_reject_mutation() IS
  'Refuses UPDATE and DELETE on the event log. Fires for every role, including the owner.';

CREATE TRIGGER event_is_immutable
  BEFORE UPDATE OR DELETE ON qf_jarvis.event
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.event_reject_mutation();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- The schema-level revoke in the runner's bootstrap already makes every object in here
-- unreachable by name without USAGE. These are belt-and-braces on the table itself, and
-- they cost nothing.
--
-- The managed-provider roles (`anon`, `authenticated`, `service_role`) are revoked by the
-- bootstrap's conditional DO block, which re-runs on EVERY migration — so a provider that
-- re-grants during a platform upgrade is re-revoked rather than silently tolerated. They
-- are not named unconditionally here, because they do not exist on a laptop or in CI and
-- a migration that only runs on the provider is a migration CI never proved (ADR-0023 §5).

REVOKE ALL ON qf_jarvis.event FROM PUBLIC;
