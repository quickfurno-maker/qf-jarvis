/**
 * The INTERNAL projection-event metadata reader (Stage 3.4.3, ADR-0036).
 *
 * Given a gap-free, commit-ordered PROJECTION POSITION, resolve it to the metadata-only
 * {@link ProjectionEvent} the future runner will hand a projection handler. It reads the append-only
 * position map (`qf_jarvis.projection_event_position`) and joins to `qf_jarvis.event` through the raw
 * storage identity — but the storage identity is used ONLY for the join and is never returned. The
 * handler sees the projection position, never the raw `event.sequence`.
 *
 * Metadata only, by construction: the SELECT lists exactly `position`, `event_type`, `event_version`,
 * and `accepted_at`. It never reads a payload, event id, subject, correlation id, causation id, source,
 * signature, or any digest. Every stored value is parsed FAIL-CLOSED with a typed
 * {@link ProjectionStoredDataError}; `accepted_at` is converted through the same intrinsic canonical
 * instant used everywhere else, so an impossible stored timestamp is refused rather than trusted.
 *
 * It operates on an already-borrowed {@link DatabaseClient}: it opens no transaction, takes no advisory
 * lock, and writes nothing. Not exported from the package root (ADR-0036).
 */
import type { DatabaseClient } from '../persistence/pool.js';
import { toCanonicalInstant, type ProjectionEvent } from './projection-definition.js';
import { ProjectionInputError, ProjectionStoredDataError } from './projection-errors.js';

/** The raw joined row. Only metadata columns are selected. */
interface RawProjectionEventRow {
  readonly position: string;
  readonly event_type: unknown;
  readonly event_version: unknown;
  readonly accepted_at: unknown;
}

const SELECT_BY_POSITION_SQL = `
SELECT m.position, e.event_type, e.event_version, e.accepted_at
FROM qf_jarvis.projection_event_position AS m
JOIN qf_jarvis.event AS e ON e.sequence = m.event_storage_sequence
WHERE m.position = $1
`;

/**
 * The event-log's machine-token grammar (mirrors `event_type_is_machine_token` in migration 0001):
 * lowercase alphanumerics in `.`/`-`-separated segments, length 1–64.
 */
const EVENT_TYPE_PATTERN = /^[a-z0-9]+([-.][a-z0-9]+)*$/;

/** The stored `event_version` contract from 0001 (`event_version_is_positive_and_bounded`). */
const MIN_EVENT_VERSION = 1;
const MAX_EVENT_VERSION = 1000;

/**
 * Parse a stored `position` value, requiring it be the CANONICAL positive-decimal string for the
 * requested position — nothing more permissive. `BigInt()` alone would accept `true`, `' 1 '`, `'+1'`,
 * `'0x1'`, `'1.0'` (throws), etc.; a plain numeric-string equality is exact and rejects leading zeroes,
 * whitespace, signs, decimals, and any value that differs from what was asked for.
 */
function requireCanonicalStoredPosition(value: unknown, requested: bigint): bigint {
  if (typeof value !== 'string') {
    throw new ProjectionStoredDataError('A stored projection position is not a string.');
  }
  // Canonical positive decimal only: a leading 1-9 then digits (so "0", "01", "+1", " 1", "1.0" fail).
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ProjectionStoredDataError(
      'A stored projection position is not a canonical positive decimal.',
    );
  }
  const parsed = BigInt(value);
  if (parsed !== requested) {
    throw new ProjectionStoredDataError('A stored projection position does not match the request.');
  }
  return parsed;
}

/**
 * Read the metadata-only {@link ProjectionEvent} at `position`, or `null` if no event maps there yet.
 *
 * Rejects a non-positive-bigint input position BEFORE any SQL. Every returned field is treated as
 * runtime-untrusted and validated against the ACTUAL event-log contract (position canonical + equal to
 * the request; `event_type` a 1–64 machine token; `event_version` a safe integer in 1–1000; and
 * `accepted_at` a canonical UTC instant via the captured intrinsic). Any malformed stored row fails
 * closed with a fresh {@link ProjectionStoredDataError} whose message is fixed repository-owned text —
 * no raw value, cause, or marker is retained. Never surfaces a native error.
 */
export async function readEventAtPosition(
  client: DatabaseClient,
  position: bigint,
): Promise<ProjectionEvent | null> {
  if (typeof position !== 'bigint' || position <= 0n) {
    throw new ProjectionInputError('projection position must be a positive integer position.');
  }

  const result = await client.query<RawProjectionEventRow>(SELECT_BY_POSITION_SQL, [
    position.toString(),
  ]);
  const raw = result.rows[0];
  if (raw === undefined) {
    return null;
  }

  // position — canonical positive decimal string, exactly equal to the requested position.
  const parsedPosition = requireCanonicalStoredPosition(raw.position, position);

  // event_type — a 1–64 lowercase machine token, per the 0001 CHECK.
  if (
    typeof raw.event_type !== 'string' ||
    raw.event_type.length < 1 ||
    raw.event_type.length > 64 ||
    !EVENT_TYPE_PATTERN.test(raw.event_type)
  ) {
    throw new ProjectionStoredDataError('A stored event type is not a valid machine token.');
  }

  // event_version — a safe integer in 1..1000, per the 0001 CHECK.
  if (
    typeof raw.event_version !== 'number' ||
    !Number.isSafeInteger(raw.event_version) ||
    raw.event_version < MIN_EVENT_VERSION ||
    raw.event_version > MAX_EVENT_VERSION
  ) {
    throw new ProjectionStoredDataError('A stored event version is out of the contract range.');
  }

  // accepted_at — convert through the intrinsic canonical instant; an impossible value throws
  // ProjectionDefinitionError, which we re-classify as stored-data-invalid (fail closed).
  let acceptedAt;
  try {
    acceptedAt = toCanonicalInstant(raw.accepted_at);
  } catch {
    throw new ProjectionStoredDataError(
      'A stored acceptance instant is not a valid canonical UTC instant.',
    );
  }

  return Object.freeze({
    position: parsedPosition,
    eventType: raw.event_type,
    eventVersion: raw.event_version,
    acceptedAt,
  });
}
