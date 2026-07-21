/**
 * The `event-type-activity` real projection handler (Stage 3.4.5B, ADR-0038 §deferrals).
 *
 * **Projection name vs. table name (audit correction C3).** The projection IDENTITY — the name that
 * keys the checkpoint, the advisory lock, and the deterministic backoff — is the lowercase kebab-case
 * `event-type-activity` (an underscore-bearing `rm_*` string is NOT a valid {@link ProjectionName};
 * see `projection-name.ts`). `qf_jarvis.rm_event_type_activity` is the read-model TABLE this handler
 * writes; it is the write target, never the projection name. The merged Stage 3.4.4 lock-key and
 * backoff fixed vectors already bind the name `event-type-activity` (see `projection-lock-key.ts`).
 *
 * It maintains one row per `(event_type, event_version)`: the running event count, the first and last
 * gap-free projection position, and the last acceptance instant. It reads ONLY the immutable event
 * metadata the runner contract provides ({@link ProjectionEvent}: position, eventType, eventVersion,
 * acceptedAt) and writes ONLY its own `rm_*` table through the borrowed transaction client. It never
 * opens a transaction, takes a lock, advances a checkpoint, appends an attempt, reads the clock, uses
 * randomness, reads the environment, or touches any external system — the Stage 3.4.4 runner owns all
 * of that (`projection-authoring-guide.md`).
 *
 * **Idempotency (authoring guide "Idempotency is not free").** `ON CONFLICT ... DO UPDATE` alone is
 * NOT idempotent for a counter: applying the same event twice would increment twice. So the counter
 * increment is guarded by a strict **projection-position** predicate — the update fires only when the
 * incoming event's position is strictly greater than the row's stored `last_event_position`. A
 * re-presented event (a rebuild, or a retry after an ambiguous commit) whose position is at or below
 * the stored watermark is a NO-OP. Positions are dense and commit-ordered (ADR-0036), so under normal
 * traversal each event is applied exactly once; the guard makes any re-presentation harmless.
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
export const EVENT_TYPE_ACTIVITY_PROJECTION_NAME = 'event-type-activity';
export const EVENT_TYPE_ACTIVITY_PROJECTION_VERSION = 1;

/**
 * The single deterministic, projection-position-guarded upsert. The `DO UPDATE` fires ONLY when the
 * incoming position is strictly beyond the stored `last_event_position`, so a re-presented (equal or
 * lower) position increments nothing. `first_event_position` is written on insert only and never
 * changed thereafter; `last_event_position`/`last_accepted_at` advance to the current event.
 */
const UPSERT_SQL = `
INSERT INTO qf_jarvis.rm_event_type_activity AS rm
  (event_type, event_version, event_count, first_event_position, last_event_position, last_accepted_at)
VALUES ($1, $2::integer, 1, $3::bigint, $3::bigint, $4::timestamptz)
ON CONFLICT (event_type, event_version) DO UPDATE SET
  event_count         = rm.event_count + 1,
  last_event_position = EXCLUDED.last_event_position,
  last_accepted_at    = EXCLUDED.last_accepted_at
WHERE EXCLUDED.last_event_position > rm.last_event_position
`;

/**
 * Apply one event to `qf_jarvis.rm_event_type_activity`. Deterministic: the same event at the same
 * read-model state produces the same write on every machine. Writes ONLY through the borrowed client;
 * signals failure only by rejecting (the runner classifies and records the outcome).
 */
export async function applyEventTypeActivity(
  client: DatabaseClient,
  event: ProjectionEvent,
): Promise<void> {
  await client.query(UPSERT_SQL, [
    event.eventType,
    event.eventVersion,
    // A `bigint` is bound as its decimal string and cast to `bigint` server-side — never through a JS
    // number, which cannot hold the full range (mirrors the event reader / runner convention).
    event.position.toString(),
    // The acceptance instant is the event's own immutable canonical UTC string — never a wall clock.
    event.acceptedAt,
  ]);
}

/** The immutable, validated production definition for `event-type-activity` v1. */
export const eventTypeActivityProjection: ProjectionDefinition = defineProjection({
  name: EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
  version: EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
  apply: applyEventTypeActivity,
});
