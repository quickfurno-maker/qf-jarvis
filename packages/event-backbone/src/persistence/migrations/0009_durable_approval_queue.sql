-- 0009_durable_approval_queue.sql
--
-- Durable approval queue and audit (QFJ-P08, ADR-0081).
--
-- QFJ-P08's approval-runtime slice made asking and correlating POWERLESS and correct, but kept both
-- in memory: a request died with the process, and nothing stopped two overlapping asks about the
-- same action. This migration adds the durability, and it adds exactly one coordination invariant.
--
-- WHY THE COORDINATION INVARIANT EXISTS. `ApprovalDecisionV1` is recommendation-level and carries
-- NO `approvalRequestId` -- deliberately, because Core answers about a recommendation's actions, not
-- about Jarvis's bookkeeping. That is correct, and it has one consequence: if two unanswered
-- requests for the SAME (recommendation, action) could be open at once, a single arriving decision
-- would be ambiguous between them, and nothing in the artifacts could resolve it. So the ambiguity
-- is made unrepresentable rather than resolved later: at most ONE active ask per
-- (recommendation_id, proposed_action_id).
--
-- WHAT THIS IS NOT. There is no `status`, no `pending`, no `approved`, no `outcome` and no
-- `authorized` column anywhere below, and no trigger derives one. Approval authority lives ONLY in
-- the immutable Core `ApprovalDecisionV1` stored verbatim. The model is:
--
--     a REQUEST exists; a DECISION may exist; a LINK between them may exist.
--
-- "Active" is not a stored state either -- it is a QUESTION asked at an observation instant:
-- the slot points at the request, no link exists, and `expires_at` is still in the future. Storing
-- it as a column would create a value that goes stale silently, and a stale `pending` flag in
-- Jarvis is precisely the piece of authorization state ADR-0002 puts in Core.
--
-- Five tables, all append-only except one nullable coordination pointer:
--
--   * approval_request_record  -- the exact ApprovalRequestV1 and a canonical source snapshot
--   * approval_active_slot     -- at most one active ask per (recommendation, action). Coordination.
--   * approval_decision_record -- the exact Core ApprovalDecisionV1, verbatim
--   * approval_request_decision_link -- one request answered by one decision; one decision may
--                                       answer several requests of the same recommendation
--   * approval_queue_audit     -- content-free, append-only, three closed event types
--
-- It adds NO consent, opt-out, communication-authorization, execution-intent, operator, transport or
-- Core-integration object; NO recipient, credential, prompt, model or free-text content; and no
-- column in which an authority could be asserted.
--
-- Managed status is unchanged: 0009 is local/CI only; the managed database still carries only 0001.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. The request record -- the exact ask, plus the exact thing it asks about
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.approval_request_record (
  -- Append order. Not a business time and never read as one.
  sequence              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The idempotency identity. An exact replay of the same ask returns this row unchanged.
  approval_request_id   UUID        NOT NULL UNIQUE,

  -- Denormalized from the payload so the coordination key, the expiry sweep and the audit join do
  -- not have to reach inside JSONB. The CHECKs below prove they still agree with the payload.
  recommendation_id     UUID        NOT NULL,
  proposed_action_id    UUID        NOT NULL,
  action_fingerprint    CHAR(64)    NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,

  -- The ApprovalRequestV1 verbatim, and the CANONICAL source it was built from: the validated
  -- RecommendationV1 plus rebuilt action bindings. Storing the source is what lets a later decision
  -- be re-proved against the same content the request was made about -- including the fingerprint,
  -- recomputed rather than trusted.
  request_payload       JSONB       NOT NULL,
  source_snapshot       JSONB       NOT NULL,

  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  -- The target of the slot's COMPOSITE foreign key, and the reason it can exist.
  --
  -- `approval_request_id` is already unique on its own, so a single-column FK from the slot would
  -- resolve. It would also be too weak to carry the invariant: the runtime role legitimately holds
  -- UPDATE (active_approval_request_id), so it could point action A's slot at action B's request and
  -- the database would accept the row. That silently transfers an outstanding ask to a different
  -- action -- exactly what the slot key's immutability trigger exists to prevent, defeated through
  -- the one column the trigger deliberately lets move. Widening the reference to include the action
  -- identity makes the pointer's membership in its own slot a structural fact rather than a promise
  -- the writing adapter keeps.
  CONSTRAINT approval_request_record_action_request_key
    UNIQUE (recommendation_id, proposed_action_id, approval_request_id),

  CONSTRAINT approval_request_record_expires_after_created
    CHECK (created_at < expires_at),
  -- Lowercase hex only. An uppercase digest is a different string that means the same thing, and a
  -- fingerprint comparison that depended on case would be a comparison that sometimes lies.
  CONSTRAINT approval_request_record_fingerprint_is_lowercase_sha256
    CHECK (action_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT approval_request_record_payload_is_object
    CHECK (jsonb_typeof(request_payload) = 'object'),
  CONSTRAINT approval_request_record_source_is_object
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
  -- The denormalized columns are not a second source of truth: they must equal the payload.
  CONSTRAINT approval_request_record_columns_match_payload
    CHECK (
      request_payload ->> 'approvalRequestId' = approval_request_id::text
      AND request_payload ->> 'recommendationId' = recommendation_id::text
      AND request_payload ->> 'proposedActionId' = proposed_action_id::text
      AND request_payload ->> 'actionFingerprint' = action_fingerprint
    )
);

COMMENT ON TABLE qf_jarvis.approval_request_record IS
  'Append-only. One row per approval ask: the exact ApprovalRequestV1 and the canonical source it '
  'was built from. Powerless by construction - there is no status, outcome or approved column, and '
  'authority lives only in the Core decision record. Content-free beyond the governed contracts: no '
  'recipient, credential, prompt, model or transport field.';

-- Audit reads for one action, in append order.
CREATE INDEX approval_request_record_by_action
  ON qf_jarvis.approval_request_record (recommendation_id, proposed_action_id, sequence);
-- Supports the caller-instant expiry comparison in the active-queue read.
CREATE INDEX approval_request_record_by_expiry
  ON qf_jarvis.approval_request_record (expires_at);

-- ---------------------------------------------------------------------------
-- 2. The active slot -- coordination, and emphatically not authority
-- ---------------------------------------------------------------------------
--
-- One row per (recommendation, action), holding at most one pointer. The composite PRIMARY KEY is
-- the whole mechanism: two concurrent enqueues for the same action contend on ONE row, and two
-- enqueues for DIFFERENT actions never touch each other -- so the invariant costs nothing in
-- throughput and needs no global or advisory lock.
--
-- `active_approval_request_id` is NULLABLE and is the ONLY mutable column in this migration. NULL
-- means "no ask is currently outstanding for this action", which is a coordination fact. It is not
-- "rejected", not "approved", and not "done".
--
-- THE POINTER'S REFERENCE IS COMPOSITE, and that is not decoration. A foreign key on the request id
-- alone would resolve perfectly well and still let the one mutable column in this migration point
-- action A's slot at action B's request -- the slot-key trigger below refuses to move the KEY, so a
-- weak pointer reference is precisely the way around it. Naming (recommendation, action, request) on
-- both sides means a non-null pointer must belong to the exact action this slot coordinates, proved
-- by the database rather than by whoever wrote the UPDATE.
--
-- NULL still means no outstanding pointer: under the default MATCH SIMPLE a composite foreign key
-- with any NULL column is satisfied, and the other two columns are NOT NULL, so the only way to
-- reach that case is the intended one.

CREATE TABLE qf_jarvis.approval_active_slot (
  recommendation_id          UUID NOT NULL,
  proposed_action_id         UUID NOT NULL,
  active_approval_request_id UUID,

  CONSTRAINT approval_active_slot_pk
    PRIMARY KEY (recommendation_id, proposed_action_id),
  CONSTRAINT approval_active_slot_request_fk
    FOREIGN KEY (recommendation_id, proposed_action_id, active_approval_request_id)
    REFERENCES qf_jarvis.approval_request_record
      (recommendation_id, proposed_action_id, approval_request_id)
);

COMMENT ON TABLE qf_jarvis.approval_active_slot IS
  'Coordination only, never authority. At most ONE active ask per (recommendation, action), because '
  'ApprovalDecisionV1 carries no approvalRequestId and two overlapping asks would make an arriving '
  'decision ambiguous. The pointer''s foreign key is COMPOSITE, so a non-null pointer must name a '
  'request belonging to this exact action - the runtime role may move the pointer but cannot move it '
  'elsewhere. NULL means no outstanding ask - it does not mean approved, rejected or done.';

-- ---------------------------------------------------------------------------
-- 3. The decision record -- Core's artifact, verbatim
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.approval_decision_record (
  sequence          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- One row per Core decision. A decision answering several actions of one recommendation is stored
  -- ONCE and linked several times; duplicating it per request would create copies free to diverge.
  decision_id       UUID        NOT NULL UNIQUE,
  recommendation_id UUID        NOT NULL,
  decided_at        TIMESTAMPTZ NOT NULL,

  -- The ApprovalDecisionV1 verbatim. Not reinterpreted, not normalized, not summarized into a
  -- boolean: whatever a reviewer later needs to understand the authorization is exactly what Core
  -- issued, byte for byte.
  decision_payload  JSONB       NOT NULL,

  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT approval_decision_record_payload_is_object
    CHECK (jsonb_typeof(decision_payload) = 'object'),
  CONSTRAINT approval_decision_record_columns_match_payload
    CHECK (
      decision_payload ->> 'decisionId' = decision_id::text
      AND decision_payload ->> 'recommendationId' = recommendation_id::text
    ),
  -- Structurally refuses anything Core could not have issued. The full contract is enforced in the
  -- adapter through `approvalDecisionV1Schema`; this is the storage layer refusing to hold a row
  -- that contradicts the one fact that makes a decision authoritative at all.
  CONSTRAINT approval_decision_record_issuer_is_core
    CHECK (decision_payload ->> 'issuer' = 'quickfurno-core'),
  CONSTRAINT approval_decision_record_outcome_known
    CHECK (decision_payload ->> 'outcome' IN ('approved', 'rejected', 'changes-requested'))
);

COMMENT ON TABLE qf_jarvis.approval_decision_record IS
  'Append-only. The authoritative Core ApprovalDecisionV1, stored verbatim and never reinterpreted. '
  'One row per decision even when it answers several actions - copies could diverge. This is the '
  'ONLY place approval authority is represented anywhere in Jarvis.';

CREATE INDEX approval_decision_record_by_recommendation
  ON qf_jarvis.approval_decision_record (recommendation_id, sequence);

-- ---------------------------------------------------------------------------
-- 4. The link -- which ask this decision answered
-- ---------------------------------------------------------------------------
--
-- Separate from both artifacts on purpose. `ApprovalDecisionV1` has no `approvalRequestId` and must
-- not grow one; `ApprovalRequestV1` has no outcome and must not grow one. The correspondence is a
-- third fact, recorded once, without editing either side.
--
-- UNIQUE on `approval_request_id`: one ask is answered at most once. NOT unique on `decision_id`:
-- one Core decision covering actions A and B legitimately answers two asks.

CREATE TABLE qf_jarvis.approval_request_decision_link (
  sequence                 BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  approval_request_id      UUID        NOT NULL UNIQUE,
  decision_id              UUID        NOT NULL,

  -- The per-action verdict for THIS request's action, copied out for reading. Under partial
  -- approval an overall `approved` decision may reject this very action, so the outcome cannot
  -- stand in for it. It is a projection of the stored decision, not an independent authority, and
  -- the adapter re-derives it from the payload rather than trusting this column.
  selected_action_decision TEXT        NOT NULL,

  linked_at                TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT approval_request_decision_link_request_fk
    FOREIGN KEY (approval_request_id)
    REFERENCES qf_jarvis.approval_request_record (approval_request_id),
  CONSTRAINT approval_request_decision_link_decision_fk
    FOREIGN KEY (decision_id)
    REFERENCES qf_jarvis.approval_decision_record (decision_id),
  -- Only ever approved or rejected. There is no middle state, and in particular no 'pending'.
  CONSTRAINT approval_request_decision_link_verdict_known
    CHECK (selected_action_decision IN ('approved', 'rejected'))
);

COMMENT ON TABLE qf_jarvis.approval_request_decision_link IS
  'Append-only. Records WHICH ask a decision answered, without editing either artifact. One request '
  'is answered at most once (UNIQUE); one decision may answer several requests of the same '
  'recommendation (not unique). selected_action_decision is a projection of the stored decision.';

CREATE INDEX approval_request_decision_link_by_decision
  ON qf_jarvis.approval_request_decision_link (decision_id, sequence);

-- ---------------------------------------------------------------------------
-- 5. The audit -- content-free, append-only, three closed events
-- ---------------------------------------------------------------------------
--
-- References only. No summary, policy, rationale, evidence, action parameters, fingerprint, decider
-- or explanation: the artifacts already hold those under their own governance, and an audit trail
-- that copied them would be a second place a privacy rule has to be enforced.

CREATE TABLE qf_jarvis.approval_queue_audit (
  sequence            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  event_type          TEXT        NOT NULL,

  approval_request_id UUID        NOT NULL,
  decision_id         UUID,
  recommendation_id   UUID        NOT NULL,
  proposed_action_id  UUID        NOT NULL,

  record_version      SMALLINT    NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT approval_queue_audit_event_type_known
    CHECK (event_type IN ('REQUEST_ENQUEUED', 'REQUEST_EXPIRY_OBSERVED', 'DECISION_LINKED')),
  CONSTRAINT approval_queue_audit_record_version_is_one
    CHECK (record_version = 1),
  -- A decision id belongs to exactly one event type, and must be absent from the other two.
  CONSTRAINT approval_queue_audit_decision_id_pairing
    CHECK (
      (event_type = 'DECISION_LINKED' AND decision_id IS NOT NULL)
      OR (event_type <> 'DECISION_LINKED' AND decision_id IS NULL)
    ),
  CONSTRAINT approval_queue_audit_request_fk
    FOREIGN KEY (approval_request_id)
    REFERENCES qf_jarvis.approval_request_record (approval_request_id)
);

COMMENT ON TABLE qf_jarvis.approval_queue_audit IS
  'Append-only, content-free. Three closed event types and opaque references only: no summary, '
  'policy, rationale, evidence, action parameters, fingerprint, decider or explanation. An exact '
  'replay of an already-recorded request or decision appends nothing.';

CREATE INDEX approval_queue_audit_by_request
  ON qf_jarvis.approval_queue_audit (approval_request_id, sequence);

-- ---------------------------------------------------------------------------
-- 6. Enforcement -- append-only everywhere, and one narrowly mutable pointer
-- ---------------------------------------------------------------------------
--
-- These rules are in the database rather than only in the adapter because the adapter is one
-- caller. A console session, a future second writer or a migration could otherwise edit a stored
-- decision -- and a decision that can be edited after the fact is not an authorization record.

CREATE OR REPLACE FUNCTION qf_jarvis.approval_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
AS $append_only$
BEGIN
  RAISE EXCEPTION
    'qf_jarvis.% is append-only', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$append_only$;

COMMENT ON FUNCTION qf_jarvis.approval_append_only() IS
  'Refuses UPDATE and DELETE. A request, a decision, a link and an audit row are all statements '
  'about what happened; none is corrected by a silent edit.';

CREATE TRIGGER approval_request_record_append_only_trigger
  BEFORE UPDATE OR DELETE ON qf_jarvis.approval_request_record
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.approval_append_only();

CREATE TRIGGER approval_decision_record_append_only_trigger
  BEFORE UPDATE OR DELETE ON qf_jarvis.approval_decision_record
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.approval_append_only();

CREATE TRIGGER approval_request_decision_link_append_only_trigger
  BEFORE UPDATE OR DELETE ON qf_jarvis.approval_request_decision_link
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.approval_append_only();

CREATE TRIGGER approval_queue_audit_append_only_trigger
  BEFORE UPDATE OR DELETE ON qf_jarvis.approval_queue_audit
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.approval_append_only();

-- The slot is the one exception, and it is exactly one column wide.
CREATE OR REPLACE FUNCTION qf_jarvis.approval_active_slot_guard()
  RETURNS trigger
  LANGUAGE plpgsql
AS $slot_guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'qf_jarvis.approval_active_slot is not deletable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- The key identifies which action this slot coordinates. Letting it move would silently
    -- transfer an outstanding ask to a different action.
    IF NEW.recommendation_id <> OLD.recommendation_id
       OR NEW.proposed_action_id <> OLD.proposed_action_id THEN
      RAISE EXCEPTION
        'the approval active slot key is immutable'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$slot_guard$;

COMMENT ON FUNCTION qf_jarvis.approval_active_slot_guard() IS
  'Refuses DELETE and refuses any change to the (recommendation, action) key. Only '
  'active_approval_request_id may move, and the runtime role is granted UPDATE on that column alone.';

CREATE TRIGGER approval_active_slot_guard_trigger
  BEFORE UPDATE OR DELETE ON qf_jarvis.approval_active_slot
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.approval_active_slot_guard();

-- ---------------------------------------------------------------------------
-- 7. Access -- belt-and-braces revokes, then least privilege
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.approval_request_record FROM PUBLIC;
REVOKE ALL ON qf_jarvis.approval_active_slot FROM PUBLIC;
REVOKE ALL ON qf_jarvis.approval_decision_record FROM PUBLIC;
REVOKE ALL ON qf_jarvis.approval_request_decision_link FROM PUBLIC;
REVOKE ALL ON qf_jarvis.approval_queue_audit FROM PUBLIC;

DO $deny$
DECLARE
  managed_role text;
  approval_table text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      FOREACH approval_table IN ARRAY ARRAY[
        'approval_request_record',
        'approval_active_slot',
        'approval_decision_record',
        'approval_request_decision_link',
        'approval_queue_audit'
      ] LOOP
        EXECUTE format('REVOKE ALL ON qf_jarvis.%I FROM %I', approval_table, managed_role);
      END LOOP;
    END IF;
  END LOOP;
END
$deny$;

-- `qf_jarvis_runtime` is a DEPLOYMENT role: it does not exist on a laptop or in CI, so the grants
-- are conditional exactly as 0002, 0007 and 0008 do it.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;

    -- Read and append. No UPDATE anywhere except the one slot pointer below, and no DELETE or
    -- TRUNCATE at all -- the triggers refuse them, and a privilege that is never legitimate should
    -- not be granted either.
    GRANT SELECT, INSERT ON qf_jarvis.approval_request_record TO qf_jarvis_runtime;
    GRANT SELECT, INSERT ON qf_jarvis.approval_decision_record TO qf_jarvis_runtime;
    GRANT SELECT, INSERT ON qf_jarvis.approval_request_decision_link TO qf_jarvis_runtime;
    GRANT SELECT, INSERT ON qf_jarvis.approval_queue_audit TO qf_jarvis_runtime;

    -- The slot: read, create, and move ONLY the pointer. The key columns are deliberately absent
    -- from the column-level grant, so the runtime cannot re-point a slot at a different action even
    -- if the trigger above were ever dropped.
    GRANT SELECT, INSERT ON qf_jarvis.approval_active_slot TO qf_jarvis_runtime;
    GRANT UPDATE (active_approval_request_id)
      ON qf_jarvis.approval_active_slot TO qf_jarvis_runtime;
  END IF;
END
$grant$;
