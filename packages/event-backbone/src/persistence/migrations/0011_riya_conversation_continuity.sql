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
-- There is no column here that could express any of them, and adding one would make Jarvis a second
-- authority for a fact Core owns.
--
-- It is NOT a transcript. No message history, no recent turns, no rolling summary, no context window,
-- no free text at all. `discovery` carries ADR-0067's bounded structured snapshot; a second free-text
-- blob would be a transcript with a friendlier name.
--
-- It carries NO channel. WEB and WhatsApp are the same governed Riya (ADR-0092), so a channel column
-- would be the beginning of a second one. It also carries no user id, phone, email, name, browser
-- token, cookie, session, provider message id or credential.
--
-- `conversation_id` is NOT assumed globally unique (ADR-0076 section 3, restated by ADR-0094). The
-- primary key is composite and there is deliberately NO conversation-only unique index: adding one
-- would silently re-impose the global-uniqueness assumption and merge two tenants' conversations into
-- one row.
--
-- WHAT THE CONSTRAINTS BELOW DO AND DO NOT DO. They validate EVIDENCE. The authoritative validator is
-- `createRiyaConversationContinuityState` in @qf-jarvis/riya-conversation-continuity, and the adapter
-- re-proves every row through it on the way in AND on the way out. The full NeedDiscovery and
-- provenance rules are deliberately NOT restated in SQL: a second copy would drift from ADR-0067, and
-- the version that drifted would be the one nobody was reading. RWC-P4 owns phase transition,
-- extraction and provenance merge, and none of it is implemented here.
--
-- Managed status is unchanged: 0011 is LOCAL/CI only. Nothing here is applied to the managed
-- QF-Jarvis database, and this migration authorizes no such application.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. The continuity state
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.riya_conversation_continuity (
  -- The composite identity. Tenant AND conversation, never a conversation alone.
  tenant_id               VARCHAR(128) NOT NULL,
  conversation_id         VARCHAR(128) NOT NULL,

  -- The contract version of the stored state. One value today; present so a future second shape is a
  -- migration rather than a guess about what an untagged row meant.
  version                 SMALLINT     NOT NULL,

  -- The optimistic-concurrency counter for THIS state. Deliberately NOT the conversation-control
  -- revision of 0008: they version different things, advance at different times, and a single shared
  -- counter would make a continuity write appear to a control gate as a control change.
  continuity_revision     BIGINT       NOT NULL,

  -- Where the CONVERSATION has reached. Not a UI step, not a business state, not an authority.
  phase                   TEXT         NOT NULL,

  -- ADR-0067's bounded NeedDiscovery snapshot, and the per-field provenance for the values in it.
  -- JSONB objects, validated structurally here and canonically in TypeScript.
  discovery               JSONB        NOT NULL,
  field_provenance        JSONB        NOT NULL,

  -- A CONVERSATIONAL fact: the client agreed the summary was right. This is NOT consent, and it must
  -- never be read as consent -- consent is Core's, and it is not representable in this table.
  summary_confirmed       BOOLEAN      NOT NULL,

  -- Opaque evidence that a governed confirmation completed. It proves nothing about authority: it does
  -- not mean Jarvis created a lead. NULL unless the conversation has reached COMPLETE.
  completion_evidence_ref VARCHAR(128),

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
  CONSTRAINT riya_conversation_continuity_completion_ref_is_identifier
    CHECK (completion_evidence_ref IS NULL
           OR (length(completion_evidence_ref) BETWEEN 1 AND 128
               AND completion_evidence_ref ~ '^[A-Za-z0-9._:-]+$')),

  -- --- Bounds and closed vocabularies ------------------------------------------------------------

  CONSTRAINT riya_conversation_continuity_version_is_one CHECK (version = 1),

  -- A conversation revision, not an authored version: 0 is the legitimate starting value. Bounded by
  -- the JavaScript safe integer for the reason ADR-0055 records -- a ceiling of one million is a
  -- ceiling a long-lived conversation eventually hits, silently, long after deployment.
  CONSTRAINT riya_conversation_continuity_revision_in_safe_range
    CHECK (continuity_revision >= 0 AND continuity_revision <= 9007199254740991),

  -- Exactly RIYA_CONVERSATION_PHASES, in the order RWC-P0B froze them. A package spec asserts this
  -- list against the frozen vocabulary, so a tenth phase fails loudly here rather than silently
  -- widening what the database will store.
  CONSTRAINT riya_conversation_continuity_phase_known
    CHECK (phase IN ('INTRO', 'NEED', 'LOCATION', 'PROJECT_DETAILS', 'BUDGET_TIMELINE',
                     'SUMMARY', 'CONTACT', 'CONSENT', 'COMPLETE')),

  -- Structural only. That `discovery` is an OBJECT and not an array, a string or a bare number is
  -- worth holding here because a non-object could not be reconstructed into a P2A input at all. What
  -- is INSIDE it is ADR-0067's question, re-proved by `createNeedDiscovery` through the canonical
  -- constructor -- restating those rules here is exactly the drift this constraint refuses to start.
  CONSTRAINT riya_conversation_continuity_discovery_is_object
    CHECK (jsonb_typeof(discovery) = 'object'),
  CONSTRAINT riya_conversation_continuity_provenance_is_object
    CHECK (jsonb_typeof(field_provenance) = 'object'),

  -- --- The two invariants that are safely expressible without a second policy engine -------------
  --
  -- `summaryConfirmed` is bounded from both sides by the phase. Before a summary has been shown it
  -- cannot be true; after the client has moved past it, it cannot be false -- a CONTACT phase with an
  -- unconfirmed summary describes a conversation that skipped the step it depends on. SUMMARY itself
  -- is in neither list and is deliberately unconstrained: that is the phase during which the answer
  -- legitimately changes.
  --
  -- This is a restatement of two frozen membership lists, not a transition rule. It decides nothing
  -- and orders nothing, so it cannot become a second reducer -- and the same two lists are asserted
  -- against PHASES_BEFORE_SUMMARY / PHASES_AFTER_SUMMARY by a package spec, so they cannot drift
  -- apart unnoticed.
  CONSTRAINT riya_conversation_continuity_summary_before
    CHECK (phase NOT IN ('INTRO', 'NEED', 'LOCATION', 'PROJECT_DETAILS', 'BUDGET_TIMELINE')
           OR summary_confirmed = false),
  CONSTRAINT riya_conversation_continuity_summary_after
    CHECK (phase NOT IN ('CONTACT', 'CONSENT', 'COMPLETE')
           OR summary_confirmed = true),

  -- COMPLETE is reached only through a governed confirmation outcome (RWC-P0B), so it must carry the
  -- evidence that one happened -- and no other phase may carry it, because evidence of a completion
  -- that has not happened is the most misleading row this table could hold. IFF, both directions.
  CONSTRAINT riya_conversation_continuity_complete_iff_evidence
    CHECK ((phase = 'COMPLETE') = (completion_evidence_ref IS NOT NULL))

  -- Deliberately ABSENT: the SUMMARY-readiness rule (service/city/budget/timeline present once the
  -- conversation is at or past SUMMARY). It is a real P2A invariant, but expressing it here means
  -- reaching INTO the discovery JSON and restating which four ADR-0067 fields matter and what counts
  -- as present -- a second, independently-drifting copy of the rule, in the one place nobody reads
  -- when ADR-0067 changes. The canonical constructor enforces it on every read and every write, and a
  -- package spec proves a row that violates it cannot survive the adapter boundary.
);

COMMENT ON TABLE qf_jarvis.riya_conversation_continuity IS
  'One row per (tenant_id, conversation_id): the working conversational state Riya carries between '
  'turns (RWC-P2A/P2B, ADR-0093/ADR-0095). NOT ADR-0016 agent memory, NOT a transcript, NOT a customer '
  'profile, NOT a CRM record, NOT training data and NOT business truth. Content-free apart from the '
  'bounded ADR-0067 discovery snapshot: no message, transcript, rolling summary, channel, user id, '
  'phone, email, name, browser or session token, provider message id, consent, canSubmit, lead, '
  'vendor, city authority, price or package. summary_confirmed is a CONVERSATIONAL fact and is never '
  'consent. The authoritative validator is createRiyaConversationContinuityState; these constraints '
  'validate evidence and are not a second decision engine.';

-- ---------------------------------------------------------------------------
-- 2. Access -- belt-and-braces revokes, then least privilege for the deployment role
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

    -- UPDATE only the columns a compare-and-set replaces. `tenant_id`, `conversation_id` and
    -- `version` are absent, which makes the identity of a stored conversation immutable as a
    -- PRIVILEGE rather than as a trigger the adapter has to be trusted not to work around.
    GRANT UPDATE (continuity_revision, phase, discovery, field_provenance,
                  summary_confirmed, completion_evidence_ref)
      ON qf_jarvis.riya_conversation_continuity TO qf_jarvis_runtime;
  END IF;
END
$grant$;
