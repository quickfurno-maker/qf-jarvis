-- 0012_riya_logical_turn_idempotency.sql
--
-- Durable Riya LOGICAL-TURN idempotency (RWC-P8, ADR-0104).
--
-- ADR-0097 gave the private ingress a replay guard keyed on `(caller, requestId)`. That guard protects
-- ONE SIGNED TRANSPORT REQUEST inside its freshness window, and it is process-local. Neither property
-- is what a conversation needs. A trusted caller can re-sign the SAME logical message under a fresh
-- `requestId` -- a retry after a timeout, a queue redelivery, a second replica picking up the same
-- work -- and every transport guard in the deployment would correctly let it through. Riya would then
-- run a second model turn, take a second Core decision, and possibly create a second enquiry about the
-- same sentence.
--
-- So `requestId` is a TRANSPORT identity and is never logical-turn identity. This migration adds the
-- durable APPLICATION layer underneath it:
--
--   * qf_jarvis.riya_logical_turn_claims -- ONE row per (tenant_id, conversation_id, message_id): the
--     record that a particular inbound logical message has been claimed, and how it ended.
--
-- It also gives the coordinator a place to enforce ONE IN-FLIGHT TEXT TURN per canonical conversation
-- across processes. The serialization primitive itself is a PostgreSQL SESSION ADVISORY LOCK held on a
-- dedicated client for the life of one turn -- there is deliberately no table for that, because a lock
-- row would need a lease, an expiry and a sweeper, and all three are ways to accidentally release a
-- lock while the work it guards is still running. A session lock is released by the database when the
-- session ends, which is exactly the semantics a crashed replica needs.
--
-- WHAT THIS TABLE IS NOT.
--
-- It is NOT a transcript, and the absence is structural rather than a policy. There is no column for
-- `normalized_text`, a message body, a reply, a rolling summary or any free text -- and critically,
-- there is no DIGEST of the client's words either. A SHA-256 of a message is still a durable
-- fingerprint of what a person wrote: it identifies the sentence, survives deletion of the sentence,
-- and answers "did this person say exactly this?" for anyone holding a guess. RWC-P8 stores neither.
--
-- The consequence is deliberate and worth stating plainly: if a caller reuses the same logical
-- identifiers with DIFFERENT words, this ledger reports a replay and the new words are never processed.
-- That is the fail-closed direction. Processing them would mean one logical message had produced two
-- different Riya turns, which is precisely what the ledger exists to prevent -- and a caller with new
-- words has a correct move available, which is to mint a new `message_id` and a new source reference.
--
-- It is NOT continuity. RWC-P2A/0011 owns the conversational state, one row per conversation, and that
-- table remains CHANNEL-FREE and unchanged by this migration. A conversation has one continuity row and
-- many small claim rows; they version different things and must never be merged.
--
-- It carries NO contact identity. No phone, email, name, `subject_ref`, cookie, session, browser token,
-- provider message id, signature, credential or `request_id`. `channel_turn_ref` -- the opaque
-- per-channel reference the caller supplies -- is NOT stored raw either: only its non-content digest is,
-- because a raw provider reference is a correlation handle into a provider's own records.
--
-- It carries NO business truth. No consent, opt-out, lead, vendor, package, price, `can_submit`,
-- discovery or Core decision. Nothing here authorizes anything; it only records that a claim was made
-- and how it finished.
--
-- WHY `channel` IS A COLUMN HERE AND NOT IN 0011. Continuity is what Riya knows about a project, and
-- that is identical whether the client typed it in a browser or a chat app -- a channel there would be
-- the beginning of a second Riya. A CLAIM is about one inbound message, which genuinely arrived over
-- one channel, and the same opaque reference string can legitimately exist on two channels without
-- being the same message. The channel is part of the message's identity, not part of the conversation's.
--
-- WHY THERE IS NO GLOBAL UNIQUENESS on message id, conversation id or source digest. `conversation_id`
-- is not globally unique (ADR-0076 section 3), and neither is a caller's message id. Every uniqueness
-- rule below is scoped to `(tenant_id, conversation_id)` for the same reason 0011's primary key is
-- composite: a global index would merge two tenants' messages into one identity.
--
-- WHY NO DELETE, NO RETENTION SWEEPER, NO RETRY COUNTER. A claim that could be deleted is a claim that
-- could be re-run, and "this message is spent" is the whole value of the row. Retention is a separate
-- governed decision with its own erasure semantics, and RWC-P8 does not make it. A retry counter would
-- be a mechanism for exactly the automatic re-execution ADR-0104 forbids.
--
-- Managed status is unchanged: 0012 is LOCAL/CI only. Nothing here is applied to the managed QF-Jarvis
-- database, and this migration authorizes no such application.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. The logical-turn claim
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.riya_logical_turn_claims (
  -- The composite identity of ONE inbound logical message. Tenant AND conversation AND message, never
  -- a message id alone.
  tenant_id            VARCHAR(128) NOT NULL,
  conversation_id      VARCHAR(128) NOT NULL,
  message_id           VARCHAR(128) NOT NULL,

  -- Which surface the message arrived on. Part of the MESSAGE's identity (see the header), and
  -- deliberately absent from the continuity table.
  channel              VARCHAR(16)  NOT NULL,

  -- SHA-256 over `[1, channel, channelTurnRef]` -- the channel-scoped SOURCE identity of the turn.
  --
  -- A digest rather than the reference itself, because a raw provider or web turn reference is a
  -- correlation handle into somebody else's records. The digest answers the only question this table
  -- needs to ask: "is this the same source turn I already claimed?".
  --
  -- It is derived from channel metadata ONLY. No word the client typed contributes to it.
  source_turn_digest   CHAR(64)     NOT NULL,

  -- SHA-256 over the full immutable claim identity: contract version, channel, tenant, conversation,
  -- message, `receivedAt`, the source digest, data class and subject presence.
  --
  -- Its job is to catch a caller that reuses a message id while changing something that must not
  -- change. Same message, later timestamp; same message, upgraded data class; same message, a
  -- different subject -- each is a DIFFERENT claim wearing an existing one's key, and each is refused
  -- as a conflict rather than silently accepted.
  --
  -- Again: no client text contributes to it.
  turn_identity_digest CHAR(64)     NOT NULL,

  -- Where the claim got to. There is no state for "not started": a row exists only once processing has
  -- actually begun, so a turn that failed its preflight leaves no trace and stays retryable.
  claim_state          VARCHAR(16)  NOT NULL,

  -- Stamped by the DATABASE, not by an application clock. Neither is a business time and neither is
  -- part of any identity.
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  finalized_at         TIMESTAMPTZ  NULL,

  CONSTRAINT riya_logical_turn_claims_pk
    PRIMARY KEY (tenant_id, conversation_id, message_id),

  -- --- Identifier grammar -- mirrors the service contract EXACTLY -------------------------------
  --
  -- 1-128 characters of `[A-Za-z0-9._:-]`. No `@`, no `+`, no whitespace, so an email address, an
  -- E.164 number or a sentence cannot become an identifier here even by mistake.
  CONSTRAINT riya_logical_turn_claims_tenant_is_identifier
    CHECK (length(tenant_id) BETWEEN 1 AND 128 AND tenant_id ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT riya_logical_turn_claims_conversation_is_identifier
    CHECK (length(conversation_id) BETWEEN 1 AND 128 AND conversation_id ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT riya_logical_turn_claims_message_is_identifier
    CHECK (length(message_id) BETWEEN 1 AND 128 AND message_id ~ '^[A-Za-z0-9._:-]+$'),

  -- --- Closed vocabularies -----------------------------------------------------------------------
  CONSTRAINT riya_logical_turn_claims_channel_is_known
    CHECK (channel IN ('WEB', 'WHATSAPP')),
  CONSTRAINT riya_logical_turn_claims_state_is_known
    CHECK (claim_state IN ('PROCESSING', 'COMPLETED', 'INDETERMINATE')),

  -- --- Digest grammar ----------------------------------------------------------------------------
  --
  -- Lowercase 64 hex, exactly. Enforced in SQL as well as in the adapter so a hand-written row cannot
  -- introduce an identity the coordinator could never have produced.
  CONSTRAINT riya_logical_turn_claims_source_digest_is_hex
    CHECK (source_turn_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT riya_logical_turn_claims_identity_digest_is_hex
    CHECK (turn_identity_digest ~ '^[0-9a-f]{64}$'),

  -- --- Finalization agrees with state -------------------------------------------------------------
  --
  -- A terminal claim has a finalization instant; an in-flight one does not. Two rows that disagreed
  -- with themselves about whether they had finished would make every crash-recovery decision below
  -- unsound.
  CONSTRAINT riya_logical_turn_claims_finalized_matches_state
    CHECK (
      (claim_state = 'PROCESSING' AND finalized_at IS NULL)
      OR (claim_state <> 'PROCESSING' AND finalized_at IS NOT NULL)
    )
);

-- One SOURCE turn per conversation. The caller's channel reference identifies the inbound turn on its
-- own channel, so two different `message_id`s claiming the same source is a caller defect -- and it is
-- exactly the shape a duplicate delivery takes when a redelivery is given a fresh message id.
--
-- Scoped to the conversation, never global: the same opaque reference may legitimately appear in two
-- different conversations, and on two different channels.
CREATE UNIQUE INDEX riya_logical_turn_claims_source_uq
  ON qf_jarvis.riya_logical_turn_claims (tenant_id, conversation_id, source_turn_digest);

COMMENT ON TABLE qf_jarvis.riya_logical_turn_claims IS
  'One row per (tenant_id, conversation_id, message_id): the durable record that ONE inbound logical '
  'Riya turn was claimed, and how it finished (RWC-P8, ADR-0104). Sits BELOW the ingress transport '
  'replay guard, which protects one signed request and is process-local; this protects one logical '
  'message across replicas and across fresh requestIds. NOT continuity, NOT a transcript, NOT a '
  'message archive and NOT business truth. Stores opaque canonical identifiers, the channel, two '
  'NON-CONTENT digests, a lifecycle state and database timestamps -- and deliberately no message text, '
  'no digest of message text, no reply, no raw channel turn reference, no subject reference, no '
  'contact detail, no provider artifact, no requestId and no Core decision. No DELETE privilege and no '
  'retention sweeper: a claim that could be deleted is a claim that could be re-run.';

-- ---------------------------------------------------------------------------
-- 2. Enforcement -- born PROCESSING, identity immutable, terminal is terminal
-- ---------------------------------------------------------------------------
--
-- These rules are in the database because the coordinator is one caller. A migration, a console
-- session or a future second writer would otherwise be able to insert a row already COMPLETED -- which
-- would mark a message spent that never ran -- or reset a terminal row back to PROCESSING, which would
-- authorize exactly the automatic re-execution ADR-0104 forbids.

CREATE OR REPLACE FUNCTION qf_jarvis.riya_logical_turn_claims_guard()
  RETURNS trigger
  LANGUAGE plpgsql
AS $guard$
BEGIN
  -- A claim is BORN in flight. A row inserted directly as COMPLETED would assert that a turn finished
  -- when nothing ever ran it, and every later begin would replay against that fiction.
  IF TG_OP = 'INSERT' THEN
    IF NEW.claim_state <> 'PROCESSING' THEN
      RAISE EXCEPTION
        'a Riya logical turn claim must be created in the PROCESSING state'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- The identity is the claim. A row that changed tenant, conversation, message, channel or either
  -- digest would be a different message wearing an existing claim's key -- and the new message would
  -- inherit "already spent" without ever having run.
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.conversation_id <> OLD.conversation_id
     OR NEW.message_id <> OLD.message_id
     OR NEW.channel <> OLD.channel
     OR NEW.source_turn_digest <> OLD.source_turn_digest
     OR NEW.turn_identity_digest <> OLD.turn_identity_digest THEN
    RAISE EXCEPTION
      'a Riya logical turn claim identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- TERMINAL IS TERMINAL. A COMPLETED or INDETERMINATE claim never moves again -- not to the other
  -- terminal state, and above all not back to PROCESSING. Re-opening a spent claim is the single
  -- change that would turn this table from a safety mechanism into a duplicate-turn generator.
  IF OLD.claim_state <> 'PROCESSING' THEN
    RAISE EXCEPTION
      'a finalized Riya logical turn claim is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- From PROCESSING there are exactly two legal destinations, and staying put is not one of them: an
  -- update that left the state alone would move `finalized_at` without finalizing anything.
  IF NEW.claim_state NOT IN ('COMPLETED', 'INDETERMINATE') THEN
    RAISE EXCEPTION
      'a Riya logical turn claim may only be finalized as COMPLETED or INDETERMINATE'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.finalized_at IS NULL THEN
    RAISE EXCEPTION
      'a finalized Riya logical turn claim requires a finalization instant'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END
$guard$;

COMMENT ON FUNCTION qf_jarvis.riya_logical_turn_claims_guard() IS
  'BEFORE INSERT OR UPDATE guard: a claim is born PROCESSING, its identity and both digests are '
  'immutable, a terminal claim can never be re-opened, and the only legal transitions are '
  'PROCESSING -> COMPLETED and PROCESSING -> INDETERMINATE with a finalization instant. Defense in '
  'depth for the coordinator; the column grammar and the state/finalization agreement are held by '
  'CHECK constraints.';

CREATE TRIGGER riya_logical_turn_claims_guard_trigger
  BEFORE INSERT OR UPDATE ON qf_jarvis.riya_logical_turn_claims
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.riya_logical_turn_claims_guard();

-- ---------------------------------------------------------------------------
-- 3. Access -- belt-and-braces revokes, then least privilege for the deployment role
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.riya_logical_turn_claims FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.riya_logical_turn_claims FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- `qf_jarvis_runtime` is a DEPLOYMENT role: it does not exist on a laptop or in CI unless a test
-- creates it, so the grants are conditional exactly as 0002, 0007, 0008, 0010 and 0011 do it.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;

    -- Read and claim. NO DELETE and NO TRUNCATE, and this one is not a deferred decision like 0011's:
    -- a deletable claim is a re-runnable message, and the ability to erase the record that a turn was
    -- spent is the ability to spend it twice.
    GRANT SELECT, INSERT ON qf_jarvis.riya_logical_turn_claims TO qf_jarvis_runtime;

    -- UPDATE only the two finalization columns. `tenant_id`, `conversation_id`, `message_id`,
    -- `channel`, both digests and `created_at` are absent, which makes a claim's identity immutable as
    -- a PRIVILEGE as well as by the trigger -- two independent guards rather than one the coordinator
    -- must be trusted not to work around.
    GRANT UPDATE (claim_state, finalized_at)
      ON qf_jarvis.riya_logical_turn_claims TO qf_jarvis_runtime;
  END IF;
END
$grant$;
