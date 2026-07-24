-- 0007_subject_activity_projection.sql
--
-- The SUBJECT ACTIVITY projection foundation (QFJ-P03.09, ADR-0044).
--
-- QFJ-P03.08 (ADR-0043) proved rebuild determinism and, with a synthetic tombstone fixture, that an
-- erasure event's effect survives rebuild — and deferred the SUBJECT-KEYED proof to QFJ-P03.09. This
-- migration adds ONLY what that subject-keyed reference projection needs and nothing else:
--
--   * qf_jarvis.rm_subject_activity — one disposable, non-authoritative row per opaque Core subject
--     (subject_type, subject_id): the activity event count, the first/last activity projection position,
--     the first/last acceptance instant, the last activity event type/version, and the ERASURE state
--     (a permanent minimal tombstone). It holds NO payload, correlation id, event id, source, signature,
--     digest, or free text — only the opaque Phase-2 EntityReference and immutable event metadata, so
--     erasure is representable and survives rebuild (ADR-0022 §8-§9, ADR-0044).
--
--   * The minimum GRANTS the existing projection deployment role qf_jarvis_projection_runtime needs to
--     drive the subject-activity handler: column-level SELECT of ONLY (subject_type, subject_id) on the
--     event log, and SELECT/INSERT/UPDATE on the new read model. NO DELETE/TRUNCATE (a version-bump
--     rebuild destroy is a trusted admin operation, not a runtime grant — exactly as 0004). NO payload
--     or metadata-map access is broadened; no other role grant changes.
--
-- It adds NO trigger, enum, tenant column, index beyond the primary key, queue, job, audit table, event
-- contract, or operator surface. The erasure event it projects (qf.privacy.erasure-recorded) is an
-- EXISTING contract. This is projection erasure ONLY — it makes no claim about source-system deletion,
-- immutable-log retention, or legal/privacy compliance (Phase 11, ADR-0019 §7).
--
-- Managed status is unchanged: 0007 is local/CI only; the managed database still carries only 0001.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- The subject-activity read model (disposable, non-authoritative, subject-keyed)
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.rm_subject_activity (
  -- The opaque Phase-2 EntityReference. Grammar mirrors qf_jarvis.event exactly (migration 0001).
  subject_type                 TEXT        NOT NULL,
  subject_id                   TEXT        NOT NULL,

  -- The number of NON-ERASED activity events applied for this subject. Zero for a pure tombstone.
  activity_event_count         BIGINT      NOT NULL DEFAULT 0,

  -- The first/last gap-free projection POSITION that contributed activity. Both NULL iff count = 0.
  first_activity_position      BIGINT,
  last_activity_position       BIGINT,

  -- The first/last acceptance instant of contributing activity, from event.accepted_at (never a clock).
  first_activity_accepted_at   TIMESTAMPTZ,
  last_activity_accepted_at    TIMESTAMPTZ,

  -- The last contributing activity event's type/version. Both NULL iff count = 0.
  last_activity_event_type     TEXT,
  last_activity_event_version  INTEGER,

  -- The permanent erasure tombstone. Once erased, activity detail is cleared and never repopulated.
  erased                       BOOLEAN     NOT NULL DEFAULT false,
  erased_at_position           BIGINT,
  erased_at                    TIMESTAMPTZ,

  CONSTRAINT rm_subject_activity_pk PRIMARY KEY (subject_type, subject_id),

  -- --- Subject grammar — mirrors 0001's event_subject_type/id CHECKs EXACTLY ----------------------

  CONSTRAINT rm_subject_activity_subject_type_is_machine_token
    CHECK (length(subject_type) BETWEEN 1 AND 64
           AND subject_type ~ '^[a-z0-9]+([-.][a-z0-9]+)*$'),
  CONSTRAINT rm_subject_activity_subject_id_is_opaque_core_reference
    CHECK (length(subject_id) BETWEEN 1 AND 128
           AND subject_id ~ '^[A-Za-z0-9._:-]+$'),

  -- --- Shape invariants ---------------------------------------------------------------------------

  CONSTRAINT rm_subject_activity_count_nonneg CHECK (activity_event_count >= 0),
  CONSTRAINT rm_subject_activity_version_positive
    CHECK (last_activity_event_version IS NULL OR last_activity_event_version > 0),

  -- Activity position/timestamp/type detail columns move together: all NULL or all NOT NULL.
  CONSTRAINT rm_subject_activity_position_pair
    CHECK ((first_activity_position IS NULL) = (last_activity_position IS NULL)),
  CONSTRAINT rm_subject_activity_accepted_pair
    CHECK ((first_activity_accepted_at IS NULL) = (last_activity_accepted_at IS NULL)),
  CONSTRAINT rm_subject_activity_last_event_pair
    CHECK ((last_activity_event_type IS NULL) = (last_activity_event_version IS NULL)),

  -- count = 0  =>  every activity-detail column is NULL.
  CONSTRAINT rm_subject_activity_zero_count_is_empty
    CHECK (activity_event_count <> 0 OR (
      first_activity_position IS NULL
      AND last_activity_position IS NULL
      AND first_activity_accepted_at IS NULL
      AND last_activity_accepted_at IS NULL
      AND last_activity_event_type IS NULL
      AND last_activity_event_version IS NULL
    )),

  -- count > 0  =>  every activity-detail column is present and the positions are ordered.
  CONSTRAINT rm_subject_activity_positive_count_is_full
    CHECK (activity_event_count = 0 OR (
      first_activity_position IS NOT NULL
      AND last_activity_position IS NOT NULL
      AND first_activity_accepted_at IS NOT NULL
      AND last_activity_accepted_at IS NOT NULL
      AND last_activity_event_type IS NOT NULL
      AND last_activity_event_version IS NOT NULL
      AND first_activity_position <= last_activity_position
    )),

  -- erased = true  =>  a pure tombstone: no activity, and the erasure coordinates are present.
  CONSTRAINT rm_subject_activity_erased_is_tombstone
    CHECK (erased = false OR (
      activity_event_count = 0
      AND first_activity_position IS NULL
      AND last_activity_position IS NULL
      AND first_activity_accepted_at IS NULL
      AND last_activity_accepted_at IS NULL
      AND last_activity_event_type IS NULL
      AND last_activity_event_version IS NULL
      AND erased_at_position IS NOT NULL
      AND erased_at IS NOT NULL
    )),

  -- erased = false  =>  no erasure coordinates.
  CONSTRAINT rm_subject_activity_active_has_no_erasure
    CHECK (erased = true OR (erased_at_position IS NULL AND erased_at IS NULL))
);

COMMENT ON TABLE qf_jarvis.rm_subject_activity IS
  'Disposable, non-authoritative read model: one row per opaque Core subject (subject_type, subject_id) '
  'with the activity count, first/last projection position and acceptance instant, last activity event '
  'type/version, and a PERMANENT erasure tombstone. Opaque EntityReference + immutable event metadata '
  'only — no payload, correlation id, event id, source, signature, digest, or free text. Rebuildable '
  'from the log at any time; erasure survives rebuild. Projection erasure only — no legal-deletion claim.';

-- ---------------------------------------------------------------------------
-- Access — belt-and-braces PUBLIC / managed-alias revokes, and projection-role least privilege
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.rm_subject_activity FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_subject_activity FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- The EXISTING projection deployment role gains ONLY the minimum for the subject-activity handler:
-- column-level SELECT of the two subject columns on the event log (the metadata columns it already
-- reads were granted by 0004), and upsert on the new read model. No DELETE/TRUNCATE; no other change.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN
    -- The event log: add ONLY the opaque subject columns. Payload, correlation/causation ids,
    -- event id, source, and signature/digest columns remain ungranted to this role.
    GRANT SELECT (subject_type, subject_id) ON qf_jarvis.event TO qf_jarvis_projection_runtime;

    -- The read model: upsert. SELECT/INSERT/UPDATE; no DELETE/TRUNCATE (rebuild destroy is admin-only).
    GRANT SELECT, INSERT, UPDATE ON qf_jarvis.rm_subject_activity TO qf_jarvis_projection_runtime;
  END IF;
END
$grant$;
