-- 0018_scale_phase09_data_lifecycle.sql
--
-- SCALE-P09: partition/readiness indexes plus bounded operational retention.
--
-- Canonical qf_jarvis.event is NEVER deleted by this migration. It is an
-- append-only audit/business ledger and requires archival policy before any
-- future retention deletion is introduced.

CREATE INDEX IF NOT EXISTS event_accepted_at_brin
  ON qf_jarvis.event USING brin (accepted_at)
  WITH (pages_per_range = 128);

CREATE INDEX IF NOT EXISTS quickfurno_turn_spool_finalized_retention_idx
  ON qf_jarvis.quickfurno_turn_spool (finalized_at, inbound_message_id)
  WHERE state IN ('COMPLETED','FAILED');

CREATE OR REPLACE FUNCTION qf_jarvis.prune_finalized_turn_spool(
  p_before timestamptz,
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, qf_jarvis, pg_temp
SET statement_timeout = '5000ms'
AS $body$
DECLARE
  v_limit integer;
  v_deleted integer := 0;
BEGIN
  IF p_before IS NULL OR p_before > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'unsafe turn-spool prune cutoff'
      USING ERRCODE = '22023';
  END IF;

  v_limit := least(greatest(coalesce(p_limit,500),1),1000);

  WITH doomed AS (
    SELECT s.inbound_message_id
    FROM qf_jarvis.quickfurno_turn_spool s
    WHERE s.state IN ('COMPLETED','FAILED')
      AND s.finalized_at IS NOT NULL
      AND s.finalized_at < p_before
    ORDER BY s.finalized_at,s.inbound_message_id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM qf_jarvis.quickfurno_turn_spool s
  USING doomed d
  WHERE s.inbound_message_id=d.inbound_message_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$body$;

REVOKE ALL ON FUNCTION qf_jarvis.prune_finalized_turn_spool(timestamptz,integer) FROM PUBLIC;

DO $acl$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon','authenticated','service_role','qf_jarvis_runtime'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=managed_role) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION qf_jarvis.prune_finalized_turn_spool(timestamptz,integer) FROM %I',
        managed_role
      );
    END IF;
  END LOOP;

  -- Maintenance privilege is opt-in. Production runtime never gets delete
  -- authority merely because this migration exists.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='qf_jarvis_maintenance') THEN
    GRANT EXECUTE ON FUNCTION qf_jarvis.prune_finalized_turn_spool(timestamptz,integer)
      TO qf_jarvis_maintenance;
  END IF;
END
$acl$;

COMMENT ON FUNCTION qf_jarvis.prune_finalized_turn_spool(timestamptz,integer) IS
  'SCALE-P09 bounded maintenance-only pruning for terminal opaque turn-spool metadata. Max 1000 rows. Canonical event ledger is not a deletion target.';

DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'qf_jarvis.prune_finalized_turn_spool(timestamptz,integer)'::regprocedure
  ) INTO v_def;

  IF v_def ~* 'delete[[:space:]]+from[[:space:]]+qf_jarvis\.event' THEN
    RAISE EXCEPTION 'SCALE-P09 aborted: canonical event ledger entered prune authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='qf_jarvis'
      AND tablename='event'
      AND indexname='event_accepted_at_brin'
      AND indexdef ILIKE '%using brin%'
  ) THEN
    RAISE EXCEPTION 'SCALE-P09 aborted: event lifecycle BRIN missing';
  END IF;
END
$verify$;
