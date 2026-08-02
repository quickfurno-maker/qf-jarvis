-- 0008_conversation_control_persistence.sql
--
-- Durable conversation-control persistence (QFJ-P08-B2, ADR-0077).
--
-- QFJ-P08-A (ADR-0074, ADR-0075) built the pure control reducer and composed a writable capability
-- onto the ONE authoritative state source, but left the only implementation an in-process test fake:
-- a human takeover did not survive a restart, and two processes could not compare revisions. ADR-0076
-- then ratified the identity and ownership model this migration implements.
--
-- It adds exactly two tables:
--
--   * qf_jarvis.conversation_runtime_state — ONE row per (tenant_id, conversation_id): the Jarvis
--     RUNTIME-SAFETY replica the M1-M4 gates read. It is authoritative for gating only. QuickFurno
--     Core remains the business and privacy authority for party type, data class, cancellation and
--     subject status; those columns are a synchronized observation used to fail closed, never a
--     competing business record (ADR-0076 §1).
--
--   * qf_jarvis.conversation_control_command — ONE append-only row per accepted operator command,
--     serving BOTH durable idempotency (UNIQUE (tenant_id, command_id)) and the durable content-free
--     audit. Two tables would need their own consistency proof and could disagree.
--
-- ONE REVISION versions the whole safe state (ADR-0076 §2). M3 compares expectedRevision across the
-- entire state, M2's second gate compares revisions, and M4's post-gateway gate compares the revision
-- ALONE - so a field that could change without moving that number would be a change no gate can see.
-- The trigger below makes an out-of-band revision impossible rather than merely discouraged.
--
-- `conversation_id` is NOT assumed globally unique (ADR-0076 §3). The primary key is composite and
-- there is deliberately NO conversation-only unique index: adding one would silently re-impose the
-- global-uniqueness assumption the phase exists to remove.
--
-- It adds NO consent, opt-out, suppression, approval, communication-authorization, execution or
-- business table; NO operations-projection columns (their writers are still ungoverned - ADR-0076
-- §9); NO Core-synchronization path; and NO message, reply, prompt, knowledge, model, provider,
-- recipient or free-text content anywhere.
--
-- The canonical event log is NOT the control write path: 0001 constrains `source` to
-- 'quickfurno-core', so Jarvis structurally cannot append an operator command as an event, and an
-- asynchronously projected read model could not satisfy ADR-0075's requirement that an APPLIED state
-- be authoritative BEFORE the write resolves.
--
-- Managed status is unchanged: 0008 is local/CI only; the managed database still carries only 0001.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. The conversation runtime-safety state (authoritative for Jarvis gating only)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.conversation_runtime_state (
  -- The composite identity. Both parts are immutable after insert (trigger below).
  tenant_id           VARCHAR(128) NOT NULL,
  conversation_id     VARCHAR(128) NOT NULL,

  -- The ONE revision. It versions every column below except observed_at, which is correlation
  -- metadata and does not independently define revision identity (ADR-0076 §2).
  revision            BIGINT       NOT NULL,

  -- Core-derived observations. An operator command may NEVER change these, and the runtime role is
  -- granted no UPDATE privilege on them (see the grants below).
  party_type          TEXT         NOT NULL,
  data_class          TEXT         NOT NULL,
  cancelled           BOOLEAN      NOT NULL,
  subject_status      TEXT         NOT NULL,
  -- An OPAQUE subject reference, never subject content. NULL when the conversation has no subject.
  subject_ref         VARCHAR(128),

  -- Operator-owned control flags. Only the four ADR-0074 actions may change these.
  human_takeover      BOOLEAN      NOT NULL,
  ai_paused           BOOLEAN      NOT NULL,

  -- A safe correlation instant/reference (ADR-0059 calls it "instant/reference"), NOT forced to a
  -- timestamp type: the contract admits a non-instant correlation reference, and narrowing it here
  -- would impose a rule governance does not state.
  observed_at         VARCHAR(128) NOT NULL,

  CONSTRAINT conversation_runtime_state_pk PRIMARY KEY (tenant_id, conversation_id),

  -- --- Identifier grammar — mirrors the runtime's exact-identifier contract --------------------
  --
  -- The grammar already excludes `*`: it is not in either character class. The RESERVED WHOLE TOKEN
  -- `latest` is not, and a regex alone would let it through. Both strings mean "any of them" to the
  -- runtime contract, so both must be impossible HERE too — otherwise direct SQL, which the runtime
  -- role is permitted to issue, could store an identity the application layer declares invalid and
  -- would then refuse to read back. The database must never be the weaker of the two.

  CONSTRAINT conversation_runtime_state_tenant_is_exact_identifier
    CHECK (length(tenant_id) BETWEEN 1 AND 128 AND tenant_id ~ '^[A-Za-z0-9._:-]+$'
           AND lower(tenant_id) <> 'latest'),
  CONSTRAINT conversation_runtime_state_conversation_is_exact_identifier
    CHECK (length(conversation_id) BETWEEN 1 AND 128 AND conversation_id ~ '^[A-Za-z0-9._:-]+$'
           AND lower(conversation_id) <> 'latest'),
  CONSTRAINT conversation_runtime_state_subject_ref_is_opaque_reference
    CHECK (subject_ref IS NULL
           OR (length(subject_ref) BETWEEN 1 AND 128 AND subject_ref ~ '^[A-Za-z0-9._:-]+$'
               AND lower(subject_ref) <> 'latest')),
  CONSTRAINT conversation_runtime_state_observed_at_is_safe_reference
    CHECK (length(observed_at) BETWEEN 1 AND 128 AND observed_at ~ '^[A-Za-z0-9._:+-]+$'
           AND lower(observed_at) <> 'latest'),

  -- --- Bounds and closed vocabularies ----------------------------------------------------------

  -- The runtime's revision is a JavaScript safe integer; a value it could not represent is not a
  -- revision it could ever compare.
  CONSTRAINT conversation_runtime_state_revision_in_safe_range
    CHECK (revision >= 0 AND revision <= 9007199254740991),

  CONSTRAINT conversation_runtime_state_party_type_known
    CHECK (party_type IN ('CLIENT', 'VENDOR', 'UNKNOWN')),
  CONSTRAINT conversation_runtime_state_data_class_known
    CHECK (data_class IN ('HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY')),
  -- Exactly RUNTIME_SUBJECT_STATUSES. Only 'clear' permits proceeding; the others are refusals the
  -- privacy gate reports, and a package spec asserts this list against the frozen vocabulary so drift
  -- fails loudly rather than silently widening what the database will store.
  CONSTRAINT conversation_runtime_state_subject_status_known
    CHECK (subject_status IN ('clear', 'erased', 'anonymised', 'tombstoned', 'in-progress'))
);

COMMENT ON TABLE qf_jarvis.conversation_runtime_state IS
  'One row per (tenant_id, conversation_id): the Jarvis RUNTIME-SAFETY control replica the M1-M4 gates '
  'read. Authoritative for gating only - QuickFurno Core remains the business and privacy authority, '
  'and the Core-derived columns are a synchronized observation used to fail closed. One revision '
  'versions every column except observed_at. Content-free: no message, reply, prompt, knowledge, '
  'model, provider, recipient, consent, approval or free text.';

-- ---------------------------------------------------------------------------
-- 2. State enforcement — identity immutable, revision monotonic, no deletes
-- ---------------------------------------------------------------------------
--
-- These rules are in the database rather than only in the adapter because the adapter is one caller.
-- A migration, a console session or a future second writer would otherwise be able to move a revision
-- out of band, and every in-flight gate comparing that revision would silently accept stale state.

CREATE OR REPLACE FUNCTION qf_jarvis.conversation_runtime_state_guard()
  RETURNS trigger
  LANGUAGE plpgsql
AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'qf_jarvis.conversation_runtime_state is not deletable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A new operational state starts unconstrained and uncontrolled. Importing an ALREADY-CONTROLLED
    -- conversation is deliberately not authorized here (ADR-0076 §6); it needs its own governed path.
    IF NEW.revision <> 0 OR NEW.human_takeover <> false OR NEW.ai_paused <> false THEN
      RAISE EXCEPTION
        'a new conversation runtime state must start at revision 0, not taken over and not paused'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.conversation_id <> OLD.conversation_id THEN
    RAISE EXCEPTION
      'the conversation runtime state identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.revision >= 9007199254740991 THEN
    RAISE EXCEPTION
      'the conversation runtime state revision is exhausted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- EVERY update advances the one revision by exactly one. This is what makes "no field changes
  -- without moving the revision" a property the database holds rather than one the adapter promises.
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION
      'the conversation runtime state revision must advance by exactly one'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END
$guard$;

COMMENT ON FUNCTION qf_jarvis.conversation_runtime_state_guard() IS
  'Refuses DELETE, refuses an identity change, requires a new row to start at revision 0 / not taken '
  'over / not paused, and requires every UPDATE to advance the single revision by exactly one.';

CREATE TRIGGER conversation_runtime_state_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON qf_jarvis.conversation_runtime_state
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.conversation_runtime_state_guard();

-- ---------------------------------------------------------------------------
-- 3. The control command ledger — durable idempotency AND durable audit, in one row
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.conversation_control_command (
  -- Append order within a conversation. Not a business time and never read as one.
  sequence                   BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The idempotency identity. Tenant-scoped, because command ids are no more globally unique than
  -- conversation ids are.
  tenant_id                  VARCHAR(128) NOT NULL,
  command_id                 VARCHAR(128) NOT NULL,

  -- The conversation this command addressed, and the full command identity, stored as discrete
  -- columns so an exact-duplicate comparison is a predicate rather than a digest nobody can read.
  conversation_id            VARCHAR(128) NOT NULL,
  control_version            SMALLINT     NOT NULL,
  expected_revision          BIGINT       NOT NULL,
  action                     TEXT         NOT NULL,
  operator_ref               VARCHAR(128) NOT NULL,
  reason_ref                 VARCHAR(128),
  issued_at                  TIMESTAMPTZ  NOT NULL,

  -- The decision, exactly as the reducer produced it.
  outcome                    TEXT         NOT NULL,
  reason                     TEXT         NOT NULL,
  observed_revision          BIGINT       NOT NULL,
  resulting_revision         BIGINT       NOT NULL,
  resulting_human_takeover   BOOLEAN      NOT NULL,
  resulting_ai_paused        BOOLEAN      NOT NULL,

  record_version             SMALLINT     NOT NULL,
  -- The DATABASE stamps when the row was recorded. Distinct from issued_at, which is the operator's.
  recorded_at                TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),

  -- ONE row per (tenant, command). This single constraint is what makes duplicate handling a property
  -- the database holds under concurrency rather than one the application defends.
  CONSTRAINT conversation_control_command_identity_unique UNIQUE (tenant_id, command_id),

  -- A command can only be recorded against a conversation that actually exists. This is what makes
  -- "no lazy row creation from an operator command" enforceable at the storage layer too.
  CONSTRAINT conversation_control_command_state_fk
    FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES qf_jarvis.conversation_runtime_state (tenant_id, conversation_id),

  -- --- Identifier grammar ------------------------------------------------------------------------
  --
  -- Same rule as the state table: the grammar excludes `*`, and the reserved whole token `latest` is
  -- excluded explicitly. An audit row naming operator `latest` would be an accountability hole, not
  -- merely a validation gap.

  CONSTRAINT conversation_control_command_tenant_is_exact_identifier
    CHECK (length(tenant_id) BETWEEN 1 AND 128 AND tenant_id ~ '^[A-Za-z0-9._:-]+$'
           AND lower(tenant_id) <> 'latest'),
  CONSTRAINT conversation_control_command_command_is_exact_identifier
    CHECK (length(command_id) BETWEEN 1 AND 128 AND command_id ~ '^[A-Za-z0-9._:-]+$'
           AND lower(command_id) <> 'latest'),
  CONSTRAINT conversation_control_command_conversation_is_exact_identifier
    CHECK (length(conversation_id) BETWEEN 1 AND 128 AND conversation_id ~ '^[A-Za-z0-9._:-]+$'
           AND lower(conversation_id) <> 'latest'),
  CONSTRAINT conversation_control_command_operator_is_exact_identifier
    CHECK (length(operator_ref) BETWEEN 1 AND 128 AND operator_ref ~ '^[A-Za-z0-9._:-]+$'
           AND lower(operator_ref) <> 'latest'),
  -- An opaque reason CODE, never free text. A value with a space is prose, and prose is how a message
  -- body enters a record this table promises is content-free.
  CONSTRAINT conversation_control_command_reason_ref_is_opaque_code
    CHECK (reason_ref IS NULL
           OR (length(reason_ref) BETWEEN 1 AND 128 AND reason_ref ~ '^[A-Za-z0-9._:-]+$'
               AND lower(reason_ref) <> 'latest')),

  -- --- Closed vocabularies and versions ----------------------------------------------------------

  CONSTRAINT conversation_control_command_control_version_is_one CHECK (control_version = 1),
  CONSTRAINT conversation_control_command_record_version_is_one CHECK (record_version = 1),

  CONSTRAINT conversation_control_command_action_known
    CHECK (action IN ('TAKE_OWNERSHIP', 'RELEASE_OWNERSHIP', 'PAUSE_AI', 'RESUME_AI')),
  CONSTRAINT conversation_control_command_outcome_known
    CHECK (outcome IN ('APPLIED', 'NO_CHANGE', 'REFUSED')),
  CONSTRAINT conversation_control_command_reason_known
    CHECK (reason IN ('applied', 'already-satisfied', 'revision-mismatch',
                      'human-takeover-active', 'revision-exhausted')),

  CONSTRAINT conversation_control_command_revisions_in_safe_range
    CHECK (expected_revision BETWEEN 0 AND 9007199254740991
           AND observed_revision BETWEEN 0 AND 9007199254740991
           AND resulting_revision BETWEEN 0 AND 9007199254740991),

  -- --- The decision arithmetic each outcome/reason implies ---------------------------------------
  --
  -- These mirror the reducer (ADR-0074) and the composition's foreign-decision canonicalizer
  -- (ADR-0075 §8a). They validate EVIDENCE; they are not a second decision engine, and the reducer
  -- remains the only thing that decides.

  CONSTRAINT conversation_control_command_outcome_reason_pairing
    CHECK ((outcome = 'APPLIED'   AND reason = 'applied')
        OR (outcome = 'NO_CHANGE' AND reason = 'already-satisfied')
        OR (outcome = 'REFUSED'   AND reason IN ('revision-mismatch',
                                                 'human-takeover-active',
                                                 'revision-exhausted'))),

  CONSTRAINT conversation_control_command_applied_advances_one
    CHECK (outcome <> 'APPLIED'
           OR (expected_revision = observed_revision
               AND observed_revision < 9007199254740991
               AND resulting_revision = observed_revision + 1)),

  CONSTRAINT conversation_control_command_no_change_holds_revision
    CHECK (outcome <> 'NO_CHANGE'
           OR (expected_revision = observed_revision
               AND resulting_revision = observed_revision)),

  -- Staleness is decided BEFORE the action semantics, so the flags carry no claim about the action
  -- and are deliberately not constrained here.
  CONSTRAINT conversation_control_command_mismatch_disagrees
    CHECK (reason <> 'revision-mismatch'
           OR (expected_revision <> observed_revision
               AND resulting_revision = observed_revision)),

  -- The only semantic refusal, and only RESUME_AI can produce it. `aiPaused` is deliberately NOT
  -- required: ADR-0074 accepts an external takeover-without-pause state, and RESUME still refuses.
  CONSTRAINT conversation_control_command_takeover_active_is_resume
    CHECK (reason <> 'human-takeover-active'
           OR (action = 'RESUME_AI'
               AND expected_revision = observed_revision
               AND resulting_revision = observed_revision
               AND resulting_human_takeover = true)),

  CONSTRAINT conversation_control_command_exhausted_at_ceiling
    CHECK (reason <> 'revision-exhausted'
           OR (expected_revision = observed_revision
               AND observed_revision = 9007199254740991
               AND resulting_revision = observed_revision)),

  -- --- The post-state each ACTION implies (ADR-0075 §8a) -----------------------------------------
  --
  -- Arithmetic alone is not enough: a record can be arithmetically perfect and still claim a takeover
  -- was applied while its own flags say otherwise.

  CONSTRAINT conversation_control_command_applied_post_state
    CHECK (outcome <> 'APPLIED' OR (
      (action = 'TAKE_OWNERSHIP'    AND resulting_human_takeover = true  AND resulting_ai_paused = true)
      OR (action = 'RELEASE_OWNERSHIP' AND resulting_human_takeover = false AND resulting_ai_paused = true)
      OR (action = 'PAUSE_AI'          AND resulting_ai_paused = true)
      OR (action = 'RESUME_AI'         AND resulting_human_takeover = false AND resulting_ai_paused = false)
    )),

  CONSTRAINT conversation_control_command_no_change_post_state
    CHECK (outcome <> 'NO_CHANGE' OR (
      (action = 'TAKE_OWNERSHIP'    AND resulting_human_takeover = true  AND resulting_ai_paused = true)
      OR (action = 'RELEASE_OWNERSHIP' AND resulting_human_takeover = false)
      OR (action = 'PAUSE_AI'          AND resulting_ai_paused = true)
      OR (action = 'RESUME_AI'         AND resulting_human_takeover = false AND resulting_ai_paused = false)
    )),

  -- Exhaustion is only reachable when the action would REQUIRE a change; otherwise the reducer would
  -- have answered NO_CHANGE (or, for RESUME_AI under a takeover, human-takeover-active) first.
  CONSTRAINT conversation_control_command_exhausted_needed_a_change
    CHECK (reason <> 'revision-exhausted' OR (
      (action = 'TAKE_OWNERSHIP'    AND NOT (resulting_human_takeover AND resulting_ai_paused))
      OR (action = 'RELEASE_OWNERSHIP' AND resulting_human_takeover = true)
      OR (action = 'PAUSE_AI'          AND resulting_ai_paused = false)
      OR (action = 'RESUME_AI'         AND resulting_human_takeover = false AND resulting_ai_paused = true)
    ))
);

COMMENT ON TABLE qf_jarvis.conversation_control_command IS
  'Append-only. One row per accepted operator control command, serving BOTH durable idempotency '
  '(UNIQUE tenant_id, command_id) and the durable content-free audit - including NO_CHANGE and REFUSED '
  'decisions, because a record that only existed on success would make refusals invisible. Opaque '
  'references only: no subject_ref, no message, reply, prompt, model, provider, recipient or free text.';

-- Audit reads for one conversation, in append order.
CREATE INDEX conversation_control_command_by_conversation
  ON qf_jarvis.conversation_control_command (tenant_id, conversation_id, sequence);

-- ---------------------------------------------------------------------------
-- 4. Ledger enforcement — append only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION qf_jarvis.conversation_control_command_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
AS $append_only$
BEGIN
  RAISE EXCEPTION
    'qf_jarvis.conversation_control_command is append-only'
    USING ERRCODE = 'restrict_violation';
END
$append_only$;

COMMENT ON FUNCTION qf_jarvis.conversation_control_command_append_only() IS
  'Refuses UPDATE and DELETE. A decision is not rewritten after the response; a corrupt row is '
  'corrected by a new compensating record and an incident, never by a silent edit.';

CREATE TRIGGER conversation_control_command_append_only_trigger
  BEFORE UPDATE OR DELETE ON qf_jarvis.conversation_control_command
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.conversation_control_command_append_only();

-- ---------------------------------------------------------------------------
-- 5. Access — belt-and-braces revokes, then least privilege for the deployment role
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.conversation_runtime_state FROM PUBLIC;
REVOKE ALL ON qf_jarvis.conversation_control_command FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.conversation_runtime_state FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.conversation_control_command FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- `qf_jarvis_runtime` is a DEPLOYMENT role: it does not exist on a laptop or in CI, so the grants are
-- conditional exactly as 0002 and 0007 do it.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;

    -- The state row: read, provision, and update ONLY the four columns an operator command may move.
    -- The Core-derived columns (party_type, data_class, cancelled, subject_status, subject_ref) and
    -- the identity columns are deliberately absent: a future Core-synchronization path will need its
    -- own separately governed grant, and until it exists the runtime CANNOT write business facts.
    -- No DELETE, no TRUNCATE.
    GRANT SELECT, INSERT ON qf_jarvis.conversation_runtime_state TO qf_jarvis_runtime;
    GRANT UPDATE (revision, human_takeover, ai_paused, observed_at)
      ON qf_jarvis.conversation_runtime_state TO qf_jarvis_runtime;

    -- The ledger: read and append. No UPDATE, no DELETE, no TRUNCATE - the trigger refuses them
    -- anyway, and a privilege that is never legitimate should not be granted either.
    GRANT SELECT, INSERT ON qf_jarvis.conversation_control_command TO qf_jarvis_runtime;
  END IF;
END
$grant$;
