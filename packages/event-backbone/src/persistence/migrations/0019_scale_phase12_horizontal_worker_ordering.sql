-- 0019_scale_phase12_horizontal_worker_ordering.sql
--
-- SCALE-P12: horizontal worker and agent scaling.
--
-- The runtime claim query already serializes by durable queue order. This index is
-- the database-enforced final fence: no two replicas may hold PROCESSING turns for
-- the same conversation at the same time, even if a future claimant regresses.
--
-- Deployment must fail closed if pre-existing data violates this invariant.

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT conversation_id
      FROM qf_jarvis.quickfurno_turn_spool
     WHERE state = 'PROCESSING'
     GROUP BY conversation_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'SCALE-P12 refused: multiple PROCESSING turns already exist for one conversation'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX quickfurno_turn_spool_one_processing_per_conversation
  ON qf_jarvis.quickfurno_turn_spool (conversation_id)
  WHERE state = 'PROCESSING';

COMMENT ON INDEX qf_jarvis.quickfurno_turn_spool_one_processing_per_conversation IS
  'SCALE-P12 shared ordering fence. Across all worker replicas, a conversation may have at most one PROCESSING turn.';

CREATE INDEX quickfurno_turn_spool_pending_conversation_order_idx
  ON qf_jarvis.quickfurno_turn_spool
  (conversation_id, accepted_at, received_at, conversation_revision, inbound_message_id)
  WHERE state = 'PENDING';

COMMENT ON INDEX qf_jarvis.quickfurno_turn_spool_pending_conversation_order_idx IS
  'SCALE-P12 supports head-of-line checks so dedicated RIYA/ANISHA/AAROHI replicas cannot overtake an earlier turn in the same conversation.';
