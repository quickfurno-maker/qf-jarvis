-- 0017_quickfurno_durable_turn_spool.sql
--
-- SCALE-P05: durable QuickFurno -> Jarvis turn ingress without application-host disk.
--
-- This table stores ONLY opaque routing/identity facts already present in the historical
-- filesystem spool. It stores no normalized message text, reply, prompt, provider payload,
-- contact detail, lead truth, consent truth or Core decision.
--
-- PostgreSQL is the durable authority for this queue. Redis/object storage are deliberately
-- not used for correctness: claiming requires an atomic state transition and crash recovery.

CREATE TABLE qf_jarvis.quickfurno_turn_spool (
  inbound_message_id       UUID        NOT NULL,
  request_id               UUID        NULL,
  conversation_id          UUID        NOT NULL,
  conversation_revision    BIGINT      NOT NULL,
  received_at              TIMESTAMPTZ NOT NULL,
  assigned_actor           VARCHAR(16) NOT NULL,
  subject_type             VARCHAR(16) NOT NULL,
  turn_purpose             VARCHAR(32) NULL,
  qualification_request_id UUID        NULL,
  accepted_at              TIMESTAMPTZ NOT NULL,
  state                    VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  processing_started_at    TIMESTAMPTZ NULL,
  finalized_at             TIMESTAMPTZ NULL,

  CONSTRAINT quickfurno_turn_spool_pk PRIMARY KEY (inbound_message_id),
  CONSTRAINT quickfurno_turn_spool_revision_nonnegative
    CHECK (conversation_revision >= 0),
  CONSTRAINT quickfurno_turn_spool_actor_known
    CHECK (assigned_actor IN ('AAROHI', 'ANISHA', 'RIYA')),
  CONSTRAINT quickfurno_turn_spool_subject_known
    CHECK (subject_type IN ('unknown', 'prospect', 'client', 'vendor')),
  CONSTRAINT quickfurno_turn_spool_purpose_shape
    CHECK (
      (turn_purpose IS NULL AND qualification_request_id IS NULL)
      OR
      (turn_purpose = 'lead_qualification'
       AND assigned_actor = 'RIYA'
       AND qualification_request_id IS NOT NULL)
    ),
  CONSTRAINT quickfurno_turn_spool_state_known
    CHECK (state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT quickfurno_turn_spool_state_timestamps
    CHECK (
      (state = 'PENDING' AND processing_started_at IS NULL AND finalized_at IS NULL)
      OR
      (state = 'PROCESSING' AND processing_started_at IS NOT NULL AND finalized_at IS NULL)
      OR
      (state IN ('COMPLETED', 'FAILED')
       AND processing_started_at IS NOT NULL
       AND finalized_at IS NOT NULL)
    )
);

CREATE INDEX quickfurno_turn_spool_pending_order_idx
  ON qf_jarvis.quickfurno_turn_spool
  (accepted_at, received_at, conversation_revision, inbound_message_id)
  WHERE state = 'PENDING';

CREATE INDEX quickfurno_turn_spool_processing_stale_idx
  ON qf_jarvis.quickfurno_turn_spool (processing_started_at)
  WHERE state = 'PROCESSING';

CREATE OR REPLACE FUNCTION qf_jarvis.quickfurno_turn_spool_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING'
       OR NEW.processing_started_at IS NOT NULL
       OR NEW.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'a QuickFurno turn must be born PENDING'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.inbound_message_id <> OLD.inbound_message_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.conversation_id <> OLD.conversation_id
     OR NEW.conversation_revision <> OLD.conversation_revision
     OR NEW.received_at <> OLD.received_at
     OR NEW.assigned_actor <> OLD.assigned_actor
     OR NEW.subject_type <> OLD.subject_type
     OR NEW.turn_purpose IS DISTINCT FROM OLD.turn_purpose
     OR NEW.qualification_request_id IS DISTINCT FROM OLD.qualification_request_id
     OR NEW.accepted_at <> OLD.accepted_at THEN
    RAISE EXCEPTION 'QuickFurno turn identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.state = 'PENDING' AND NEW.state = 'PROCESSING' THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'PROCESSING' AND NEW.state IN ('PENDING', 'COMPLETED', 'FAILED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid QuickFurno turn state transition: % -> %', OLD.state, NEW.state
    USING ERRCODE = 'restrict_violation';
END
$guard$;

CREATE TRIGGER quickfurno_turn_spool_guard_trigger
  BEFORE INSERT OR UPDATE ON qf_jarvis.quickfurno_turn_spool
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.quickfurno_turn_spool_guard();

REVOKE ALL ON qf_jarvis.quickfurno_turn_spool FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.quickfurno_turn_spool FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;
    GRANT SELECT, INSERT ON qf_jarvis.quickfurno_turn_spool TO qf_jarvis_runtime;
    GRANT UPDATE (state, processing_started_at, finalized_at)
      ON qf_jarvis.quickfurno_turn_spool TO qf_jarvis_runtime;
  END IF;
END
$grant$;

COMMENT ON TABLE qf_jarvis.quickfurno_turn_spool IS
  'Durable opaque QuickFurno->Jarvis turn ingress. Replaces application-host filesystem '
  'spool correctness state. Contains routing/identity metadata only; no message text or '
  'business authority. Runtime role has no DELETE/TRUNCATE and may update lifecycle columns only.';
