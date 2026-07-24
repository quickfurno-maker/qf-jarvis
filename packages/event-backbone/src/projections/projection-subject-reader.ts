/**
 * The NARROW, internal subject reader for the subject-activity projection (QFJ-P03.09, ADR-0044).
 *
 * Given a gap-free projection POSITION, resolve ONLY the opaque Phase-2 EntityReference
 * (`subject_type`, `subject_id`) of the event at that position — nothing else. It reads the append-only
 * position map (`qf_jarvis.projection_event_position`) and joins to `qf_jarvis.event` through the raw
 * storage identity, but the storage identity is used ONLY for the join and is never returned, exactly
 * as {@link ./projection-event-reader.readEventAtPosition} does for metadata.
 *
 * ### Least privilege by module boundary
 *
 * This reader is the ONLY code that selects the subject columns. It is deliberately NOT part of the
 * global {@link ./projection-definition.ProjectionEvent} — widening that would give every projection
 * subject visibility. A restricted-import ESLint rule (eslint.config.mjs) permits ONLY the
 * subject-activity handler to import this module; the metadata projections remain subject-blind in
 * code. Not exported from the package root.
 *
 * ### Opaque, non-personal, fail-closed
 *
 * The SELECT lists exactly `subject_type` and `subject_id`. It reads no payload, event id, correlation
 * id, causation id, source, signature, digest, or acceptance instant. Both values are validated against
 * the canonical grammar from migration 0001 and returned frozen. Any anomaly — a non-positive input
 * position, a missing position (which at handler time means corruption, since the runner already
 * resolved this position), a malformed stored value, or a query failure — fails closed with a typed,
 * fixed-message error; no raw subject value ever reaches an error message, log, or metric.
 */
import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionInputError, ProjectionStoredDataError } from './projection-errors.js';

/** The opaque Phase-2 EntityReference resolved for a position. Internal — not a public/global type. */
export interface SubjectReference {
  readonly subjectType: string;
  readonly subjectId: string;
}

interface RawSubjectRow {
  readonly subject_type: unknown;
  readonly subject_id: unknown;
}

const SELECT_SUBJECT_BY_POSITION_SQL = `
SELECT e.subject_type, e.subject_id
FROM qf_jarvis.projection_event_position AS m
JOIN qf_jarvis.event AS e ON e.sequence = m.event_storage_sequence
WHERE m.position = $1
`;

/** The subject-type grammar from migration 0001 (`event_subject_type_is_machine_token`). */
const SUBJECT_TYPE_PATTERN = /^[a-z0-9]+([-.][a-z0-9]+)*$/;
/** The subject-id grammar from migration 0001 (`event_subject_id_is_opaque_core_reference`). */
const SUBJECT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_SUBJECT_TYPE_LENGTH = 64;
const MAX_SUBJECT_ID_LENGTH = 128;

/**
 * Resolve the opaque subject reference at `position`, or FAIL CLOSED.
 *
 * Rejects a non-positive-bigint input before any SQL. Requires exactly one row (a missing position at
 * handler time is corruption, not a benign absence, because the runner already resolved this position
 * to an event). Every returned value is treated as runtime-untrusted and validated against the ACTUAL
 * event-log subject grammar. Any malformed stored value fails closed with a fresh
 * {@link ProjectionStoredDataError} whose message is fixed repository-owned text — never the raw value.
 */
export async function readSubjectReferenceAtPosition(
  client: DatabaseClient,
  position: bigint,
): Promise<SubjectReference> {
  if (typeof position !== 'bigint' || position <= 0n) {
    throw new ProjectionInputError('projection position must be a positive integer position.');
  }

  const result = await client.query<RawSubjectRow>(SELECT_SUBJECT_BY_POSITION_SQL, [
    position.toString(),
  ]);
  const raw = result.rows[0];
  if (raw === undefined) {
    throw new ProjectionStoredDataError('No event maps to the requested projection position.');
  }

  if (
    typeof raw.subject_type !== 'string' ||
    raw.subject_type.length < 1 ||
    raw.subject_type.length > MAX_SUBJECT_TYPE_LENGTH ||
    !SUBJECT_TYPE_PATTERN.test(raw.subject_type)
  ) {
    throw new ProjectionStoredDataError('A stored subject type is not a valid opaque reference.');
  }
  if (
    typeof raw.subject_id !== 'string' ||
    raw.subject_id.length < 1 ||
    raw.subject_id.length > MAX_SUBJECT_ID_LENGTH ||
    !SUBJECT_ID_PATTERN.test(raw.subject_id)
  ) {
    throw new ProjectionStoredDataError('A stored subject id is not a valid opaque reference.');
  }

  return Object.freeze({ subjectType: raw.subject_type, subjectId: raw.subject_id });
}
