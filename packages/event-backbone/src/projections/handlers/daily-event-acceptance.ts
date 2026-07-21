/**
 * The `daily-event-acceptance` real projection handler (Stage 3.4.5B, ADR-0038 §deferrals).
 *
 * **Projection name vs. table name (audit correction C3).** The projection IDENTITY is the kebab-case
 * `daily-event-acceptance` (the merged Stage 3.4.4 lock-key/backoff fixed vectors bind this exact
 * name; see `projection-lock-key.ts`). `qf_jarvis.rm_daily_event_acceptance` is the read-model TABLE
 * this handler writes — the write target, never the projection name.
 *
 * It maintains one row per **UTC calendar day** (derived from the event's canonical `acceptedAt`): the
 * accepted-event count and the first/last gap-free projection position. It reads ONLY `position` and
 * `acceptedAt` from the runner-provided {@link ProjectionEvent} and writes ONLY its own `rm_*` table
 * through the borrowed client. It never opens a transaction, takes a lock, advances a checkpoint,
 * appends an attempt, reads a wall clock, uses randomness, reads the environment, or touches any
 * external system.
 *
 * **UTC date derivation.** `acceptedAt` is an immutable canonical UTC instant `YYYY-MM-DDTHH:MM:SS.sssZ`
 * (validated upstream by the runner's event reader). The UTC calendar date is exactly its first ten
 * characters — a pure, timezone-independent string slice, never a `Date`, `AT TIME ZONE`, or session
 * timezone. Deriving the date in the application (not with a server-timezone cast) guarantees the same
 * bytes on every machine (rebuild determinism, ADR-0022 §3).
 *
 * **Idempotency.** As with `event-type-activity`, `ON CONFLICT ... DO UPDATE` is not idempotent for a
 * counter, so the increment is guarded by a strict projection-position predicate: the update fires only
 * when the incoming position is strictly greater than the row's stored `last_event_position`. A
 * re-presented (equal or lower) position is a NO-OP.
 *
 * Not exported from the package root — internal projection vocabulary (the barrel is unchanged).
 */
import type { DatabaseClient } from '../../persistence/pool.js';
import {
  defineProjection,
  type ProjectionDefinition,
  type ProjectionEvent,
} from '../projection-definition.js';

/** The projection identity. Kebab-case name (NOT the `rm_*` table name); version matches migration 0004. */
export const DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME = 'daily-event-acceptance';
export const DAILY_EVENT_ACCEPTANCE_PROJECTION_VERSION = 1;

/** The number of leading characters of a canonical instant that form its UTC calendar date. */
const UTC_DATE_LENGTH = 10; // "YYYY-MM-DD"

/**
 * The single deterministic, projection-position-guarded upsert. The `DO UPDATE` fires ONLY when the
 * incoming position is strictly beyond the stored `last_event_position`; `first_event_position` is
 * written on insert only.
 */
const UPSERT_SQL = `
INSERT INTO qf_jarvis.rm_daily_event_acceptance AS rm
  (accepted_date, event_count, first_event_position, last_event_position)
VALUES ($1::date, 1, $2::bigint, $2::bigint)
ON CONFLICT (accepted_date) DO UPDATE SET
  event_count         = rm.event_count + 1,
  last_event_position = EXCLUDED.last_event_position
WHERE EXCLUDED.last_event_position > rm.last_event_position
`;

/**
 * The UTC calendar date (`YYYY-MM-DD`) of a canonical UTC instant. A pure slice of the immutable
 * instant string — no `Date`, no timezone, no wall clock.
 */
export function utcDateOf(acceptedAt: string): string {
  return acceptedAt.slice(0, UTC_DATE_LENGTH);
}

/**
 * Apply one event to `qf_jarvis.rm_daily_event_acceptance`. Deterministic; writes ONLY through the
 * borrowed client; signals failure only by rejecting.
 */
export async function applyDailyEventAcceptance(
  client: DatabaseClient,
  event: ProjectionEvent,
): Promise<void> {
  await client.query(UPSERT_SQL, [utcDateOf(event.acceptedAt), event.position.toString()]);
}

/** The immutable, validated production definition for `daily-event-acceptance` v1. */
export const dailyEventAcceptanceProjection: ProjectionDefinition = defineProjection({
  name: DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME,
  version: DAILY_EVENT_ACCEPTANCE_PROJECTION_VERSION,
  apply: applyDailyEventAcceptance,
});
