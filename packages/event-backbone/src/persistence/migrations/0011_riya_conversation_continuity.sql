-- 0011_riya_conversation_continuity.sql
--
-- Durable Riya conversational continuity (RWC-P2B, ADR-0095).
--
-- RWC-P2A (ADR-0093) defined `RiyaConversationContinuityStateV1` and RWC-P2C (ADR-0094) declared the
-- `RiyaContinuityStorePort` it must be stored through -- with no implementation, and deliberately so:
-- the port was written to make three durable requirements visible BEFORE a schema existed. A
-- tenant-scoped key, an atomic create-if-absent, and a compare-and-set. This migration is the schema
-- that answers them.
--
-- It adds exactly ONE table:
--
--   * qf_jarvis.riya_conversation_continuity -- ONE row per (tenant_id, conversation_id): the working
--     state Riya carries between turns so the next turn is not the first turn.
--
-- STORAGE SHAPE (owner-locked). The domain state is kept as ONE validated JSONB envelope, `state_json`,
-- and NOT normalized into a column per conversational field. Only the two things PostgreSQL must be the
-- authority for are lifted out as first-class relational columns: the tenant+conversation KEY, and the
-- `continuity_revision` the compare-and-set predicate binds on. Everything else -- version, phase, the
-- ADR-0067 discovery snapshot, per-field provenance, summary confirmation, completion evidence -- lives
-- inside `state_json`, so the schema is insulated from conversational field growth: a new discovery
-- field is an ADR-0067 change, not an ALTER TABLE here.
--
-- WHY NOT PERSIST THE CONSTRUCTED RUNTIME STATE DIRECTLY. A constructed `NeedDiscovery` carries
-- `behaviourVersion: 1` and an explicit `undefined` for every value not discovered, while
-- `NeedDiscoveryInput` is `.strict()` and declares no `behaviourVersion`. So the OUTPUT of the P2A
-- constructor is NOT a valid INPUT to it, and a naive `JSON.stringify(state)` would produce durable rows
-- no reader could ever re-validate. The adapter therefore owns an explicit persistence codec: it stores
-- the INPUT-shaped projection in `state_json`, and rebuilds a canonical state by passing that projection
-- back through the SAME `createRiyaConversationContinuityState`. This migration stores what the codec
-- writes and constrains only what the codec guarantees.
--
-- WHAT THIS TABLE IS NOT.
--
-- It is NOT ADR-0016 agent memory. That contract governs derived, rebuildable, `authoritative: false`
-- records with non-empty `sourceEventIds`, isolated per agent and shared ACROSS conversations. This is
-- the opposite kind of thing: operational state for ONE conversation. None of ADR-0016's literals
-- appear here, and borrowing them would disguise working state as memory and weaken the contract that
-- makes memory safe to delete.
--
-- It is NOT business truth. Consent, opt-out, suppression, contact identity, city validity, vendor
-- availability, pricing, packages, lead creation and business `canSubmit` belong to QuickFurno Core.
-- There is no column here that could express any of them, and `state_json` is content-minimised by the
-- P2A contract that validates every write and every read.
--
-- It is NOT a transcript. No message history, no recent turns, no rolling summary, no context window,
-- no free text at all. The ADR-0067 discovery snapshot inside `state_json` is bounded structured data;
-- a second free-text blob would be a transcript with a friendlier name, and the constructor refuses one.
--
-- It carries NO channel. WEB and WhatsApp are the same governed Riya (ADR-0092), so a channel would be
-- the beginning of a second one. It also carries no user id, phone, email, name, browser token, cookie,
-- session, provider message id or credential.
--
-- `conversation_id` is NOT assumed globally unique (ADR-0076 section 3, restated by ADR-0094). The
-- primary key is composite and there is deliberately NO conversation-only unique index: adding one
-- would silently re-impose the global-uniqueness assumption and merge two tenants' conversations into
-- one row.
--
-- WHAT THE CONSTRAINTS BELOW DO AND DO NOT DO. They validate the ENVELOPE against the key columns and
-- nothing more: that `state_json` is an object, that its `version` is 1, and that the identity and
-- revision it carries agree with the relational columns those values are indexed and compared on. The
-- authoritative validator is `createRiyaConversationContinuityState`, and the adapter re-proves every
-- row through it on the way in AND on the way out. The NeedDiscovery rules, the provenance/value pairing
-- and the summary-readiness rule are deliberately NOT restated in SQL: a second copy would drift from
-- ADR-0067, and the version that drifted would be the one nobody was reading. RWC-P4 owns phase
-- transition, extraction and provenance merge, and none of it is implemented here.
--
-- Managed status is unchanged: 0011 is LOCAL/CI only. Nothing here is applied to the managed
-- QF-Jarvis database, and this migration authorizes no such application.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. The continuity state
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.riya_conversation_continuity (
  -- The composite identity. Tenant AND conversation, never a conversation alone. Both are immutable
  -- after insert (trigger below).
  tenant_id            VARCHAR(128) NOT NULL,
  conversation_id      VARCHAR(128) NOT NULL,

  -- The optimistic-concurrency counter for THIS state, lifted out of the envelope because it is the
  -- value the compare-and-set predicate binds on -- a revision that could only be read by decoding a
  -- JSONB document is a revision no WHERE clause could use as a lock. Deliberately NOT the
  -- conversation-control revision of 0008: they version different things, advance at different times,
  -- and a single shared counter would make a continuity write appear to a control gate as a control
  -- change.
  continuity_revision  BIGINT       NOT NULL,

  -- The ONE validated domain envelope, stored as the INPUT-shaped projection the adapter's codec
  -- writes (see the header). `createRiyaConversationContinuityState` is the authoritative validator;
  -- these columns hold only what the database must independently key, compare and bound.
  state_json           JSONB        NOT NULL,

  -- Operational metadata, stamped by the DATABASE. Neither is a business time, and neither versions
  -- the state -- `continuity_revision` alone does that. `created_at` never changes; `updated_at` moves
  -- on every accepted compare-and-set.
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT riya_conversation_continuity_pk PRIMARY KEY (tenant_id, conversation_id),

  -- --- Identifier grammar -- mirrors RWC-P2A EXACTLY ---------------------------------------------
  --
  -- 1-128 characters of `[A-Za-z0-9._:-]`, which is the grammar the P2A constructor enforces. The
  -- excluded characters do work: no `@`, no `+`, no whitespace, so an email address, an E.164 number
  -- or a sentence cannot become an identifier here.
  --
  -- 0008 additionally excludes the reserved whole token `latest`, and this migration deliberately does
  -- NOT copy that. P2A is the authoritative validator for this state and accepts it, so excluding it
  -- here would make the DATABASE stricter than the contract: a state the constructor certifies as
  -- valid would fail to store, and the adapter would report a repository invariant for a row the
  -- contract permits. The two must agree in BOTH directions, not merely in one.

  CONSTRAINT riya_conversation_continuity_tenant_is_identifier
    CHECK (length(tenant_id) BETWEEN 1 AND 128 AND tenant_id ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT riya_conversation_continuity_conversation_is_identifier
    CHECK (length(conversation_id) BETWEEN 1 AND 128 AND conversation_id ~ '^[A-Za-z0-9._:-]+$'),

  -- --- Revision bounds ---------------------------------------------------------------------------
  --
  -- A conversation revision, not an authored version: 0 is the legitimate starting value. Bounded by
  -- the JavaScript safe integer for the reason ADR-0055 records -- a ceiling of one million is a
  -- ceiling a long-lived conversation eventually hits, silently, long after deployment.
  CONSTRAINT riya_conversation_continuity_revision_in_safe_range
    CHECK (continuity_revision >= 0 AND continuity_revision <= 9007199254740991),

  -- --- The envelope must agree with the columns it is indexed and compared on --------------------
  --
  -- Cheap, structural, fail-fast checks -- NOT a second copy of the domain schema. They catch the one
  -- class of corruption a key/JSON split makes possible: a row whose indexed identity or compared
  -- revision disagrees with the envelope those columns are supposed to describe. Everything subtler
  -- (phase legality, provenance accounting, summary readiness) is the constructor's job on read, and
  -- restating it here is exactly the drift these constraints refuse to start.

  CONSTRAINT riya_conversation_continuity_state_is_object
    CHECK (jsonb_typeof(state_json) = 'object'),
  CONSTRAINT riya_conversation_continuity_state_version_is_one
    CHECK (jsonb_typeof(state_json -> 'version') = 'number'
           AND (state_json ->> 'version') = '1'),
  CONSTRAINT riya_conversation_continuity_state_tenant_matches
    CHECK ((state_json ->> 'tenantId') = tenant_id),
  CONSTRAINT riya_conversation_continuity_state_conversation_matches
    CHECK ((state_json ->> 'conversationId') = conversation_id),
  -- The envelope revision must be a non-negative integer (no fraction, no exponent, no sign) AND equal
  -- the first-class column. The grammar guard runs before the cast so a hand-crafted `1.5` or `1e0` is
  -- refused rather than coerced. This is what keeps the CAS column and the stored envelope from ever
  -- disagreeing about which revision a row is at.
  CONSTRAINT riya_conversation_continuity_state_revision_matches
    CHECK (jsonb_typeof(state_json -> 'continuityRevision') = 'number'
           AND (state_json ->> 'continuityRevision') ~ '^[0-9]+$'
           AND (state_json ->> 'continuityRevision')::numeric = continuity_revision)
);

COMMENT ON TABLE qf_jarvis.riya_conversation_continuity IS
  'One row per (tenant_id, conversation_id): the working conversational state Riya carries between '
  'turns (RWC-P2A/P2B, ADR-0093/ADR-0095). The domain state is one validated JSONB envelope '
  '(state_json); only the tenant+conversation key and the continuity_revision CAS counter are '
  'first-class columns. NOT ADR-0016 agent memory, NOT a transcript, NOT a customer profile, NOT a CRM '
  'record, NOT training data and NOT business truth. Content-minimised by the P2A contract: no message, '
  'transcript, rolling summary, channel, user id, phone, email, name, browser or session token, '
  'provider message id, consent, canSubmit, lead, vendor, city authority, price or package. The '
  'authoritative validator is createRiyaConversationContinuityState; these constraints validate the '
  'envelope against its key columns and are not a second decision engine.';

-- ---------------------------------------------------------------------------
-- 2. Enforcement -- identity immutable, revision strictly monotonic by one
-- ---------------------------------------------------------------------------
--
-- These rules are in the database rather than only in the adapter because the adapter is one caller.
-- A migration, a console session or a future second writer would otherwise be able to move a revision
-- out of band, and every optimistic compare-and-set binding on that revision would silently accept --
-- or overwrite -- stale state. The CHECKs above already tie `state_json` to the columns on every write;
-- this trigger adds the two rules a CHECK cannot express, because both compare NEW against OLD.

CREATE OR REPLACE FUNCTION qf_jarvis.riya_conversation_continuity_guard()
  RETURNS trigger
  LANGUAGE plpgsql
AS $guard$
BEGIN
  -- INSERT is governed entirely by the CHECKs; a first row may legitimately be created at any revision
  -- its envelope agrees with, so there is nothing to compare against here.
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- The identity is the primary key and it is immutable. A row that changed tenant or conversation
  -- would be a different conversation wearing an existing row's history.
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.conversation_id <> OLD.conversation_id THEN
    RAISE EXCEPTION
      'the Riya continuity state identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Overflow before it happens: a revision at the safe-integer ceiling cannot advance, and the adapter
  -- could not represent OLD + 1 to compare it anyway.
  IF OLD.continuity_revision >= 9007199254740991 THEN
    RAISE EXCEPTION
      'the Riya continuity state revision is exhausted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- EVERY update is one logical continuity mutation and advances the revision by EXACTLY one. Combined
  -- with the adapter's compare-and-set predicate (WHERE continuity_revision = expectedRevision) and its
  -- own nextState.continuityRevision === expectedRevision + 1 check, this makes a skipped, repeated or
  -- decremented revision impossible from ANY writer, not merely from the adapter. The envelope revision
  -- is pinned to this same value by the state_revision_matches CHECK, so both move together or neither
  -- moves.
  IF NEW.continuity_revision <> OLD.continuity_revision + 1 THEN
    RAISE EXCEPTION
      'the Riya continuity state revision must advance by exactly one'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END
$guard$;

COMMENT ON FUNCTION qf_jarvis.riya_conversation_continuity_guard() IS
  'BEFORE UPDATE guard: refuses an identity change, refuses advancing an exhausted revision, and '
  'requires every update to advance continuity_revision by exactly one. Defense in depth for the '
  'adapter compare-and-set; the envelope/column agreement is held by CHECK constraints.';

CREATE TRIGGER riya_conversation_continuity_guard_trigger
  BEFORE UPDATE ON qf_jarvis.riya_conversation_continuity
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.riya_conversation_continuity_guard();

-- ---------------------------------------------------------------------------
-- 3. Access -- belt-and-braces revokes, then least privilege for the deployment role
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.riya_conversation_continuity FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.riya_conversation_continuity FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- `qf_jarvis_runtime` is a DEPLOYMENT role: it does not exist on a laptop or in CI unless a test
-- creates it, so the grants are conditional exactly as 0002, 0007, 0008 and 0010 do it.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;

    -- Read and create. No DELETE and no TRUNCATE: erasure and retention are NOT decided by RWC-P2B,
    -- and a privilege that has no legitimate use should not be granted while somebody decides.
    GRANT SELECT, INSERT ON qf_jarvis.riya_conversation_continuity TO qf_jarvis_runtime;

    -- UPDATE only the columns a compare-and-set replaces: the CAS revision, the envelope, and the
    -- database-stamped updated_at. `tenant_id`, `conversation_id` and `created_at` are absent, which
    -- makes the identity of a stored conversation immutable as a PRIVILEGE as well as by the trigger --
    -- two independent guards rather than one the adapter must be trusted not to work around.
    GRANT UPDATE (continuity_revision, state_json, updated_at)
      ON qf_jarvis.riya_conversation_continuity TO qf_jarvis_runtime;
  END IF;
END
$grant$;
