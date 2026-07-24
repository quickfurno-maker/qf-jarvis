/**
 * The `subject-activity` real projection handler (QFJ-P03.09, ADR-0044).
 *
 * The deferred `rm_subject_activity` reference projection (ADR-0022 §9): one row per opaque Core subject
 * `(subject_type, subject_id)` with the activity count, first/last projection position, first/last
 * acceptance instant, last activity event type/version, and a PERMANENT erasure tombstone.
 *
 * ### Subject resolution stays narrow
 *
 * The handler receives the metadata-only {@link ProjectionEvent} (no subject) exactly like every other
 * projection. It resolves the opaque subject INTERNALLY, by `event.position`, through the narrow
 * {@link ../projection-subject-reader.readSubjectReferenceAtPosition} — so the live path and the
 * QFJ-P03.08 rebuild path use the same reader and reducer, and the global event contract and the
 * rebuild driver signature are unchanged. Only this handler may import the subject reader (enforced by
 * a restricted-import rule).
 *
 * ### Erasure — a permanent minimal tombstone (ADR-0044, owner-locked)
 *
 * On the EXISTING `qf.privacy.erasure-recorded` contract, the subject's row becomes a minimal tombstone
 * (erased, count 0, all activity detail NULL). The tombstone is PERMANENT: later ordinary events do NOT
 * reactivate it, a second erasure preserves the first tombstone, and an erasure before any activity
 * creates a valid zero-count tombstone. Determinism: every write is projection-position-guarded, so a
 * re-presented event (a rebuild, or a retry after an ambiguous commit) is a no-op.
 *
 * ### Purity
 *
 * Deterministic: it reads no clock (timestamps come from `event.acceptedAt`), no randomness, no
 * environment, and performs no I/O beyond the borrowed transaction client. It never puts a subject
 * value in an error, log, or metric. Not exported from the package root.
 */
import type { DatabaseClient } from '../../persistence/pool.js';
import {
  defineProjection,
  type ProjectionDefinition,
  type ProjectionEvent,
} from '../projection-definition.js';
import { readSubjectReferenceAtPosition } from '../projection-subject-reader.js';

/** The projection identity. Kebab-case name (NOT the `rm_*` table); version matches migration 0007. */
export const SUBJECT_ACTIVITY_PROJECTION_NAME = 'subject-activity';
export const SUBJECT_ACTIVITY_PROJECTION_VERSION = 1;

/**
 * The EXISTING erasure event contract this projection tombstones on (`@qf-jarvis/contracts`
 * `qf.privacy.erasure-recorded`, v1/v2). Held as a literal to avoid a cross-package coupling for a
 * single stable contract name; `qf.privacy.erasure-requested` is deliberately ordinary activity.
 */
export const ERASURE_RECORDED_EVENT_TYPE = 'qf.privacy.erasure-recorded';

/**
 * Ordinary (non-erasure) activity: insert active state on first sight, otherwise advance — but ONLY
 * when the incoming position is strictly beyond the stored `last_activity_position`, and ONLY while the
 * row is not erased (`WHERE NOT rm.erased`). An erased subject is permanently ignored; a re-presented
 * position is a no-op.
 */
const APPLY_ACTIVITY_SQL = `
INSERT INTO qf_jarvis.rm_subject_activity AS rm
  (subject_type, subject_id, activity_event_count,
   first_activity_position, last_activity_position,
   first_activity_accepted_at, last_activity_accepted_at,
   last_activity_event_type, last_activity_event_version, erased)
VALUES ($1, $2, 1, $3::bigint, $3::bigint, $4::timestamptz, $4::timestamptz, $5, $6::integer, false)
ON CONFLICT (subject_type, subject_id) DO UPDATE SET
  activity_event_count        = rm.activity_event_count + 1,
  last_activity_position      = EXCLUDED.last_activity_position,
  last_activity_accepted_at   = EXCLUDED.last_activity_accepted_at,
  last_activity_event_type    = EXCLUDED.last_activity_event_type,
  last_activity_event_version = EXCLUDED.last_activity_event_version
WHERE NOT rm.erased
  AND EXCLUDED.last_activity_position > rm.last_activity_position
`;

/**
 * Erasure: write a minimal tombstone on first sight, otherwise transition an active row to erased — but
 * ONLY while not already erased (`WHERE NOT rm.erased`), so the FIRST tombstone's coordinates are
 * preserved and a repeated erasure is idempotent.
 */
const APPLY_ERASURE_SQL = `
INSERT INTO qf_jarvis.rm_subject_activity AS rm
  (subject_type, subject_id, activity_event_count, erased, erased_at_position, erased_at)
VALUES ($1, $2, 0, true, $3::bigint, $4::timestamptz)
ON CONFLICT (subject_type, subject_id) DO UPDATE SET
  activity_event_count        = 0,
  first_activity_position     = NULL,
  last_activity_position      = NULL,
  first_activity_accepted_at  = NULL,
  last_activity_accepted_at   = NULL,
  last_activity_event_type    = NULL,
  last_activity_event_version = NULL,
  erased                      = true,
  erased_at_position          = EXCLUDED.erased_at_position,
  erased_at                   = EXCLUDED.erased_at
WHERE NOT rm.erased
`;

/**
 * Apply one event to `qf_jarvis.rm_subject_activity`. Resolves the subject by position, then applies the
 * activity or erasure upsert in the borrowed transaction. Signals failure only by rejecting (the runner
 * classifies and records the outcome); it adds no retry, dead-letter, or new failure semantics.
 */
export async function applySubjectActivity(
  client: DatabaseClient,
  event: ProjectionEvent,
): Promise<void> {
  const subject = await readSubjectReferenceAtPosition(client, event.position);

  if (event.eventType === ERASURE_RECORDED_EVENT_TYPE) {
    await client.query(APPLY_ERASURE_SQL, [
      subject.subjectType,
      subject.subjectId,
      event.position.toString(),
      event.acceptedAt,
    ]);
    return;
  }

  await client.query(APPLY_ACTIVITY_SQL, [
    subject.subjectType,
    subject.subjectId,
    event.position.toString(),
    event.acceptedAt,
    event.eventType,
    event.eventVersion,
  ]);
}

/** The immutable, validated production definition for `subject-activity` v1. */
export const subjectActivityProjection: ProjectionDefinition = defineProjection({
  name: SUBJECT_ACTIVITY_PROJECTION_NAME,
  version: SUBJECT_ACTIVITY_PROJECTION_VERSION,
  apply: applySubjectActivity,
});
