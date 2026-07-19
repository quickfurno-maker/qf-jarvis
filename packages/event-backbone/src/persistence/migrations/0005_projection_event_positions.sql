-- 0005_projection_event_positions.sql
--
-- Gap-free, commit-ordered PROJECTION POSITIONS (Stage 3.4.3, ADR-0036).
--
-- The Stage 3.4.3 audit reproduced three ways the raw storage identity qf_jarvis.event.sequence
-- (GENERATED ALWAYS AS IDENTITY) is NOT a safe projection cursor:
--   * ON CONFLICT DO NOTHING consumes an identity value with NO committed row (permanent gap);
--   * a rolled-back INSERT permanently skips its identity value (permanent gap);
--   * under READ COMMITTED a later identity can commit and be visible before an earlier one
--     (commit inversion).
-- A projection cursor of `= last + 1` over that identity would therefore stall forever at the first
-- benign duplicate or aborted ingest, and `MIN(sequence) > last` would silently SKIP a late-committing
-- earlier event. The checkpoint contract in 0004 and ADR-0034 §3 assumes a contiguous, commit-ordered
-- cursor that the raw identity cannot provide.
--
-- This migration adds a SEPARATE, gap-free, commit-ordered projection position, allocated
-- transactionally by a DATABASE trigger on EVERY genuine event INSERT (so the guarantee cannot be
-- bypassed by any INSERT path, TypeScript or otherwise):
--
--   * qf_jarvis.projection_event_position_allocator — a private SINGLETON counter row. The trigger
--     serializes on this one row's UPDATE lock, held until the outer event transaction completes, so
--     positions are dense AND assigned in COMMIT order, and roll back with an aborted event insert.
--   * qf_jarvis.projection_event_position — an APPEND-ONLY map position -> event_storage_sequence.
--     UPDATE/DELETE are refused by trigger, exactly as the event/audit/attempt logs.
--
-- qf_jarvis.event.sequence is IMMUTABLE and UNCHANGED: no event row is renumbered, updated, or
-- re-identified. It remains a storage identity only. Migrations 0001-0004 are byte-identical.
--
-- This migration ALSO renames the projection-owned "sequence" vocabulary that 0004 introduced, so the
-- gap-free projection position can never be confused with raw event storage identity
-- (last_sequence -> last_position, etc.). qf_jarvis.event.sequence is deliberately NOT renamed.
--
-- Managed status is unchanged: 0005 is local/CI only; the managed database still carries only 0001,
-- and no managed migration is authorized (ADR-0036).
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. Serialize the backfill + trigger-install window against concurrent INSERTs
-- ---------------------------------------------------------------------------
-- SHARE ROW EXCLUSIVE conflicts with ROW EXCLUSIVE (what INSERT takes), so no event row can be
-- inserted between the backfill and the trigger installation. The lock is held until this migration's
-- transaction commits; after that, every new INSERT fires the allocator trigger. There is therefore
-- NO window in which an event is inserted without receiving a position.
LOCK TABLE qf_jarvis.event IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 2. The private singleton allocator (one counter row, serialized)
-- ---------------------------------------------------------------------------
CREATE TABLE qf_jarvis.projection_event_position_allocator (
  -- Exactly one valid identity: a single TRUE row, enforced by the PK + CHECK together.
  singleton      BOOLEAN NOT NULL DEFAULT TRUE,
  -- The highest projection position allocated so far. Gap-free; advances by exactly 1 per committed
  -- event insert; rolls back with an aborted event transaction.
  last_position  BIGINT  NOT NULL,

  CONSTRAINT projection_event_position_allocator_pk PRIMARY KEY (singleton),
  CONSTRAINT projection_event_position_allocator_singleton CHECK (singleton = TRUE),
  CONSTRAINT projection_event_position_allocator_nonneg CHECK (last_position >= 0)
);

COMMENT ON TABLE qf_jarvis.projection_event_position_allocator IS
  'Private singleton counter for gap-free, commit-ordered projection positions. Exactly one TRUE row. '
  'The allocator trigger serializes on this row''s UPDATE lock (held until the event transaction '
  'completes), which is what makes positions dense and commit-ordered. No payload or personal data.';

-- ---------------------------------------------------------------------------
-- 3. The append-only map: projection position -> event storage sequence
-- ---------------------------------------------------------------------------
CREATE TABLE qf_jarvis.projection_event_position (
  -- The gap-free, commit-ordered projection cursor value. Dense 1..N over committed events.
  position                BIGINT NOT NULL,
  -- The immutable raw storage identity of the event this position maps to.
  event_storage_sequence  BIGINT NOT NULL,

  CONSTRAINT projection_event_position_pk PRIMARY KEY (position),
  -- One position per event, one event per position. The UNIQUE index on event_storage_sequence is
  -- ALSO the index for the foreign-key / join direction (map -> event); it is not duplicated.
  CONSTRAINT projection_event_position_event_seq_unique UNIQUE (event_storage_sequence),
  CONSTRAINT projection_event_position_positive CHECK (position > 0),
  CONSTRAINT projection_event_position_event_fk
    FOREIGN KEY (event_storage_sequence) REFERENCES qf_jarvis.event (sequence)
);

COMMENT ON TABLE qf_jarvis.projection_event_position IS
  'Append-only map from the gap-free, commit-ordered projection position to the immutable raw event '
  'storage identity (qf_jarvis.event.sequence). UPDATE and DELETE are refused by trigger. Metadata '
  'only: no payload, event id, subject, correlation id, or free text. The projection runner reads '
  'position order here; it never treats event.sequence as the cursor.';

-- ---------------------------------------------------------------------------
-- 4. One-time deterministic backfill of events accepted BEFORE this migration
-- ---------------------------------------------------------------------------
-- Historical rows receive a deterministic, dense, BEST-AVAILABLE one-time order by immutable raw
-- storage identity. This is NOT reconstructed commit order: the Stage 3.4.3 audit proved the raw
-- identity can contain gaps and commit inversions, so pre-0005 commit order is UNKNOWABLE from the
-- stored schema. The backfill defines a single deterministic historical order (dense 1..N by raw
-- `event.sequence`); it does not claim to be the order in which those rows committed. No event row is
-- updated (ADR-0036, "the pre-0005 backfill limitation").
INSERT INTO qf_jarvis.projection_event_position (position, event_storage_sequence)
SELECT row_number() OVER (ORDER BY e.sequence ASC), e.sequence
FROM qf_jarvis.event AS e;

-- Seed the allocator to exactly N (0 if the log is empty). The next committed event becomes N+1.
INSERT INTO qf_jarvis.projection_event_position_allocator (singleton, last_position)
VALUES (TRUE, (SELECT count(*) FROM qf_jarvis.projection_event_position));

-- ---------------------------------------------------------------------------
-- 5. The allocator trigger — fires ONLY on a genuine event INSERT
-- ---------------------------------------------------------------------------
-- A row-level AFTER INSERT trigger fires only when a row was actually inserted, so a duplicate handled
-- by ON CONFLICT DO NOTHING (which inserts no row) allocates NO position. SECURITY DEFINER is used
-- narrowly so the least-privilege ingestion role never needs direct allocator/mapping write privilege:
-- the trigger runs as the function owner (the migration role that owns these tables), never as the
-- inserting role. It uses no dynamic SQL, fully-qualified names, and a locked search_path, and raises
-- only fixed, non-caller text.
CREATE FUNCTION qf_jarvis.assign_projection_event_position() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $assign$
DECLARE
  allocated_position bigint;
BEGIN
  -- Atomically claim the next position. The UPDATE takes the singleton row's lock, serializing every
  -- concurrent event insert until this transaction completes — dense AND commit-ordered.
  UPDATE qf_jarvis.projection_event_position_allocator
     SET last_position = last_position + 1
   WHERE singleton = TRUE
   RETURNING last_position INTO allocated_position;

  -- Missing or corrupt allocator state fails the event INSERT (the whole transaction rolls back).
  IF allocated_position IS NULL THEN
    RAISE EXCEPTION 'projection position allocator singleton row is missing or unreadable'
      USING ERRCODE = 'internal_error';
  END IF;

  INSERT INTO qf_jarvis.projection_event_position (position, event_storage_sequence)
  VALUES (allocated_position, NEW.sequence);

  RETURN NULL;  -- AFTER trigger: the return value is ignored.
END;
$assign$;

COMMENT ON FUNCTION qf_jarvis.assign_projection_event_position() IS
  'AFTER INSERT trigger on qf_jarvis.event: allocates exactly one gap-free, commit-ordered projection '
  'position per genuinely inserted event (ON CONFLICT DO NOTHING allocates none). SECURITY DEFINER so '
  'the least-privilege ingestion role needs no allocator/mapping write grant; fixed search_path; no '
  'dynamic SQL; no caller-controlled error text. Not callable directly (EXECUTE revoked).';

-- Trigger functions do NOT require EXECUTE by the firing role, so revoking EXECUTE blocks DIRECT
-- invocation (which would abuse the SECURITY DEFINER rights) without breaking the trigger path.
REVOKE ALL ON FUNCTION qf_jarvis.assign_projection_event_position() FROM PUBLIC;

CREATE TRIGGER event_assign_projection_position
  AFTER INSERT ON qf_jarvis.event
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.assign_projection_event_position();

-- ---------------------------------------------------------------------------
-- 6. Make the position map append-only (owner path included, as 0003/0004)
-- ---------------------------------------------------------------------------
CREATE FUNCTION qf_jarvis.projection_event_position_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $reject$
BEGIN
  RAISE EXCEPTION
    'The projection-event-position map is append-only: % is not permitted on table '
    '"qf_jarvis.projection_event_position". Position assignments are immutable facts.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$reject$;

COMMENT ON FUNCTION qf_jarvis.projection_event_position_reject_mutation() IS
  'Refuses UPDATE and DELETE on the projection-event-position map. Fires for every role, including the owner.';

CREATE TRIGGER projection_event_position_is_immutable
  BEFORE UPDATE OR DELETE ON qf_jarvis.projection_event_position
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.projection_event_position_reject_mutation();

-- ---------------------------------------------------------------------------
-- 7. Rename the projection-owned "sequence" vocabulary from 0004 to "position"
-- ---------------------------------------------------------------------------
-- These are the PROJECTION cursor columns, never the raw event storage identity. RENAME COLUMN keeps
-- every dependent CHECK/constraint expression valid (PostgreSQL updates the stored references), and
-- column-level GRANTs track the column, so privileges are preserved across the rename.
ALTER TABLE qf_jarvis.projection_checkpoint RENAME COLUMN last_sequence TO last_position;
ALTER TABLE qf_jarvis.projection_checkpoint RENAME COLUMN blocked_sequence TO blocked_position;
ALTER TABLE qf_jarvis.projection_checkpoint
  RENAME CONSTRAINT projection_checkpoint_last_sequence_nonneg TO projection_checkpoint_last_position_nonneg;
ALTER TABLE qf_jarvis.projection_checkpoint
  RENAME CONSTRAINT projection_checkpoint_active_no_blocked_sequence TO projection_checkpoint_active_no_blocked_position;

ALTER TABLE qf_jarvis.projection_attempt RENAME COLUMN event_sequence TO event_position;
ALTER TABLE qf_jarvis.projection_attempt
  RENAME CONSTRAINT projection_attempt_event_sequence_positive TO projection_attempt_event_position_positive;
ALTER INDEX qf_jarvis.projection_attempt_by_projection_event
  RENAME TO projection_attempt_by_projection_position;

ALTER TABLE qf_jarvis.rm_event_type_activity RENAME COLUMN first_event_sequence TO first_event_position;
ALTER TABLE qf_jarvis.rm_event_type_activity RENAME COLUMN last_event_sequence TO last_event_position;
ALTER TABLE qf_jarvis.rm_event_type_activity
  RENAME CONSTRAINT rm_event_type_activity_first_seq_positive TO rm_event_type_activity_first_pos_positive;
ALTER TABLE qf_jarvis.rm_event_type_activity
  RENAME CONSTRAINT rm_event_type_activity_seq_order TO rm_event_type_activity_pos_order;

ALTER TABLE qf_jarvis.rm_daily_event_acceptance RENAME COLUMN first_event_sequence TO first_event_position;
ALTER TABLE qf_jarvis.rm_daily_event_acceptance RENAME COLUMN last_event_sequence TO last_event_position;
ALTER TABLE qf_jarvis.rm_daily_event_acceptance
  RENAME CONSTRAINT rm_daily_event_acceptance_first_seq_positive TO rm_daily_event_acceptance_first_pos_positive;
ALTER TABLE qf_jarvis.rm_daily_event_acceptance
  RENAME CONSTRAINT rm_daily_event_acceptance_seq_order TO rm_daily_event_acceptance_pos_order;

-- Update the 0004 table comments to the final vocabulary (they described "sequence").
COMMENT ON TABLE qf_jarvis.projection_checkpoint IS
  'One checkpoint per (projection_name, projection_version): highest applied projection POSITION, '
  'active/blocked status, and bounded retry metadata. Mutable state (advances forward only, one '
  'position at a time); timestamps are repository-supplied from an injected clock. No personal data.';
COMMENT ON TABLE qf_jarvis.rm_event_type_activity IS
  'Disposable, non-authoritative read model: per event type+version, the count and the first/last '
  'projection POSITION and last acceptance instant. IMMUTABLE EVENT METADATA ONLY — no payload, '
  'subject, correlation id, event id, or free text. Rebuildable from the log at any time.';
COMMENT ON TABLE qf_jarvis.rm_daily_event_acceptance IS
  'Disposable, non-authoritative read model: per UTC calendar day (derived from event.accepted_at), '
  'the accepted-event count and the first/last projection POSITION. IMMUTABLE EVENT METADATA ONLY — '
  'no payload, subject, correlation id, event id, or free text. Rebuildable from the log at any time.';

-- ---------------------------------------------------------------------------
-- 8. Access — PUBLIC / managed-alias / runtime denials, projection-role least privilege
-- ---------------------------------------------------------------------------
REVOKE ALL ON qf_jarvis.projection_event_position_allocator FROM PUBLIC;
REVOKE ALL ON qf_jarvis.projection_event_position           FROM PUBLIC;

-- Managed aliases: no access to the new objects (Supabase only; conditional + idempotent).
DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_event_position_allocator FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.projection_event_position FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON FUNCTION qf_jarvis.assign_projection_event_position() FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON FUNCTION qf_jarvis.projection_event_position_reject_mutation() FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- The ingestion role: NO direct allocator/mapping access, and NO direct EXECUTE of the definer
-- function. Its INSERT on qf_jarvis.event (granted by 0003) fires the trigger, which does the writes
-- as the definer. It never touches the allocator or the map itself.
DO $ingest$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    REVOKE ALL ON qf_jarvis.projection_event_position_allocator FROM qf_jarvis_runtime;
    REVOKE ALL ON qf_jarvis.projection_event_position           FROM qf_jarvis_runtime;
    REVOKE ALL ON FUNCTION qf_jarvis.assign_projection_event_position()          FROM qf_jarvis_runtime;
    REVOKE ALL ON FUNCTION qf_jarvis.projection_event_position_reject_mutation() FROM qf_jarvis_runtime;
  END IF;
END
$ingest$;

-- The projection role: SAFE COLUMN-LEVEL SELECT on the MAP ONLY (to resolve a position to its event
-- storage sequence, then read the already-granted event metadata). NO allocator access of any kind,
-- and NO direct EXECUTE of the definer function.
DO $proj$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN
    -- Clean-slate reassertion for the new objects only (does not touch 0004's grants).
    REVOKE ALL ON qf_jarvis.projection_event_position_allocator FROM qf_jarvis_projection_runtime;
    REVOKE ALL ON qf_jarvis.projection_event_position           FROM qf_jarvis_projection_runtime;
    REVOKE ALL ON FUNCTION qf_jarvis.assign_projection_event_position()          FROM qf_jarvis_projection_runtime;
    REVOKE ALL ON FUNCTION qf_jarvis.projection_event_position_reject_mutation() FROM qf_jarvis_projection_runtime;

    GRANT SELECT (position, event_storage_sequence)
      ON qf_jarvis.projection_event_position TO qf_jarvis_projection_runtime;

    -- Re-assert the renamed attempt column grants with the FINAL column name (event_position), so the
    -- stored grant text matches the final vocabulary exactly. Column grants tracked the rename, so this
    -- is idempotent belt-and-braces.
    GRANT INSERT (projection_name, projection_version, event_position, attempt_number, outcome,
                  safe_error_code, started_at, completed_at)
      ON qf_jarvis.projection_attempt TO qf_jarvis_projection_runtime;
    GRANT SELECT (sequence, projection_name, projection_version, event_position, attempt_number,
                  outcome, safe_error_code, started_at, completed_at, recorded_at)
      ON qf_jarvis.projection_attempt TO qf_jarvis_projection_runtime;
  END IF;
END
$proj$;
