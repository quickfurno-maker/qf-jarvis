-- 0013_communication_state_projection.sql
--
-- The COMMUNICATION-STATE projection read model (QFJ-P09 D5, ADR-0142).
--
-- D3 (ADR-0141) published `CommunicationStateRecordV2` for exactly six durable, evidence-bearing
-- states. D4 (ADR-0140) published the trusted, position-keyed evidence reader. Neither had a place to
-- put a record: no migration defines any communication-state table, and the existing read models
-- (rm_subject_activity, rm_event_type_activity, rm_daily_event_acceptance) carry unrelated semantics.
-- This migration adds ONLY what the D5 projection needs, and nothing else:
--
--   * qf_jarvis.rm_communication_state — one disposable, non-authoritative CURRENT row per
--     `communication_id`, holding exactly the minimised V2 record: state, contract version, the
--     evidence instant, the reason code, the correlation id, optional prior-state context, the
--     minimised Tier-C evidence, and the projection position that produced the row.
--
--   * Upsert on that read model for the existing projection deployment role
--     qf_jarvis_projection_runtime. NO DELETE/TRUNCATE (a version-bump rebuild destroy is a trusted
--     admin operation, not a runtime grant — exactly as 0004 and 0007). No other role grant changes,
--     and NO EXISTING GRANT IS BROADENED.
--
-- ### The event-log payload grant is DELIBERATELY NOT here
--
-- The D4 reader selects `event_id`, `source` and the version-gated `payload`, and the projection role
-- holds none of those (0004 granted `sequence, event_type, event_version`; 0007 added `subject_type,
-- subject_id`). Granting them would hand the projection role SELECT on the payload column of the WHOLE
-- event log — and three existing least-privilege tests assert precisely that it must never have it.
--
-- D5 is implemented OFFLINE and is NOT in the production registry, so nothing runs as that role today.
-- Broadening a production role now, for a projection that is not activated, would buy nothing and give
-- up a boundary that is currently proven. **That grant belongs to the activation slice**, alongside the
-- registry entry, where the exposure can be reviewed against a runtime that actually needs it.
--
-- ### One CURRENT row, not a history table
--
-- A local append-only communication history would create a SECOND ordering domain, which ADR-0139
-- rejected for Tier A/B and which is no better here: the accepted Core event-position stream already
-- orders these facts, and history is replayable from the log itself. Duplicating it locally would add
-- a store that can disagree with its own source. So the key is `communication_id` alone, and
-- `last_position` records which projection position produced the current row.
--
-- ### NO erasure tombstone — an owner decision, recorded (ADR-0142)
--
-- rm_subject_activity carries a tombstone lawfully because it is keyed by a real subject reference and
-- is driven by the EXISTING durable `qf.privacy.erasure-recorded` evidence. This table has no
-- subject_type, no subject_id, no accepted communication-erasure event, and no durable evidence
-- mapping an erasure request to a `communication_id`. Adding an `erased` flag here would invent BOTH
-- an identity relation that is not established AND a durable erasure fact this evidence stream does not
-- contain — which would break D5's rebuild rule, because a rebuild could not reproduce it.
--
-- Therefore this table has NO erased, erased_at, erased_at_position, deleted, tombstone,
-- erasure_request_id, or subject reference. **This omission makes NO legal or privacy deletion claim.**
-- The row is disposable, non-authoritative, minimised, and rebuildable from lawful source evidence. A
-- future privacy slice may design communication-level erasure once a durable authoritative relation
-- exists.
--
-- ### What it deliberately cannot hold
--
-- No recipient, phone, email or contact data. No purpose code, explanation, policy, approval decision
-- id, execution intent/result id, provider reference, provider timestamps or provider payload. No
-- failure category or description. No signature or digest. No free text. No wall-clock created_at or
-- updated_at — every instant stored here comes from the evidence, never from a clock. No generic
-- status, can_send, can_execute or authorized boolean. No second cursor and no second ordering column.
--
-- The `evidence` JSONB deliberately does NOT re-encode the V2 discriminated union in SQL: the canonical
-- `communicationStateRecordV2Schema` is the application-side validation boundary and stays the single
-- definition of what is valid. The CHECKs below constrain only what SQL can state honestly.
--
-- It adds NO trigger, enum, tenant column, index beyond the primary key, queue, job, audit table, event
-- contract, or operator surface. It registers no projection and activates nothing.
--
-- Managed status is unchanged: 0013 is local/CI only; the managed database still carries only 0001.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- The communication-state read model (disposable, non-authoritative, current-row)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.rm_communication_state (
  -- The communication this row describes. One CURRENT row per communication.
  communication_id   UUID        NOT NULL,

  -- The V2 state. Exactly the six durable, evidence-bearing states — never the wider 18-state
  -- vocabulary, which stays the domain language and is not what this projection can evidence.
  state              TEXT        NOT NULL,

  -- The record contract version. A different axis from the canonical event wire version (@2) and from
  -- the embedded artifact version (V1).
  contract_version   SMALLINT    NOT NULL,

  -- The instant the underlying fact was recorded: the authorization's decidedAt, or the result's
  -- recordedAt. NEVER a wall clock, never the projection's execution time, never accepted_at.
  recorded_at        TIMESTAMPTZ NOT NULL,

  -- Why this state was recorded. An OPEN Core machine token — the grammar is constrained, the
  -- vocabulary is not, because Core's refusal taxonomy is Core's and a closed local copy would drop a
  -- reason Jarvis had never heard of.
  reason_code        TEXT        NOT NULL,

  correlation_id     UUID        NOT NULL,

  -- Optional CONTEXT only: the state this row replaced. Never evidence, never authority, and never
  -- used to decide whether the incoming fact is true. NULL on first insert.
  previous_state     TEXT,

  -- The minimised Tier-C evidence, exactly as the V2 contract defines it.
  evidence           JSONB       NOT NULL,

  -- The gap-free projection POSITION that produced this row. The upsert guard compares against it, so
  -- a replay or a stale position is a no-op and ordering never rests on a timestamp.
  last_position      BIGINT      NOT NULL,

  CONSTRAINT rm_communication_state_pk PRIMARY KEY (communication_id),

  -- --- The closed six-state set --------------------------------------------------------------------

  CONSTRAINT rm_communication_state_state_is_durable_v2_state
    CHECK (state IN ('rejected', 'authorized', 'provider-accepted', 'delivered', 'read', 'failed')),

  CONSTRAINT rm_communication_state_previous_state_is_durable_v2_state
    CHECK (previous_state IS NULL
           OR previous_state IN ('rejected', 'authorized', 'provider-accepted', 'delivered', 'read',
                                 'failed')),

  -- --- Shape invariants ----------------------------------------------------------------------------

  -- This table stores V2 and only V2.
  CONSTRAINT rm_communication_state_contract_version_is_v2 CHECK (contract_version = 2),

  -- Mirrors the canonical reason-code grammar (machine token), not a closed vocabulary.
  CONSTRAINT rm_communication_state_reason_code_is_machine_token
    CHECK (length(reason_code) BETWEEN 1 AND 64
           AND reason_code ~ '^[a-z0-9]+([-.][a-z0-9]+)*$'),

  -- Positions are positive, exactly as the gap-free projection position is defined.
  CONSTRAINT rm_communication_state_last_position_positive CHECK (last_position > 0),

  -- The evidence is a JSON object, never a scalar or array. Its INTERNAL shape is the canonical V2
  -- schema's business, validated in the application before this row is written.
  CONSTRAINT rm_communication_state_evidence_is_object
    CHECK (jsonb_typeof(evidence) = 'object')
);

COMMENT ON TABLE qf_jarvis.rm_communication_state IS
  'Disposable, non-authoritative read model: one CURRENT row per communication_id holding the minimised '
  'CommunicationStateRecordV2 for the six durable evidence-bearing states, plus the projection position '
  'that produced it. No recipient, contact data, free text, provider reference, execution ids, '
  'signature or digest; no wall-clock column. No erasure tombstone — no durable communication-erasure '
  'evidence exists, so one would be invented rather than rebuilt (ADR-0142); this implies NO legal '
  'deletion claim. Rebuildable from the accepted event-position stream at any time.';

-- ---------------------------------------------------------------------------
-- Access — belt-and-braces PUBLIC / managed-alias revokes, and projection-role least privilege
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.rm_communication_state FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_communication_state FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- The EXISTING projection deployment role gains upsert on the NEW read model, and nothing else.
--
-- No grant on qf_jarvis.event is added or broadened here — see the header. No DELETE/TRUNCATE: a
-- rebuild destroy stays a trusted admin operation, exactly as 0004 and 0007 established.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.rm_communication_state TO qf_jarvis_projection_runtime;
  END IF;
END
$grant$;
