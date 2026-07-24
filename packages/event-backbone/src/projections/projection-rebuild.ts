/**
 * The INTERNAL, bounded, single-threaded projection REBUILD driver (QFJ-P03.08, ADR-0043).
 *
 * ### What it is
 *
 * A library-only proof primitive: given a frozen {@link ProjectionDefinition}, a captured horizon, and
 * an ALREADY-BORROWED {@link DatabaseClient} pointed at an isolated target, it reconstructs the read
 * model from the immutable log by walking the gap-free projection POSITION map in ascending order and
 * calling the definition's pure `apply` once per position.
 *
 * ### What it is NOT
 *
 * It is NOT the live runner. It does not open a transaction, take the live advisory lock, advance a
 * checkpoint, record an attempt, create a failure aggregate, touch the action ledger, quarantine, or
 * replay — the caller owns the transaction and the isolated target, and the QFJ-P03.07 lifecycle
 * remains authoritative for the LIVE runtime and is never invoked here. There is no retry/backoff: a
 * rebuild over an already-accepted prefix must be deterministic, so a handler rejection or an
 * infrastructure error ABORTS the rebuild fail-closed (a re-application that fails signals
 * non-determinism, not a transient fault).
 *
 * ### Ordering and privacy
 *
 * It reads only the metadata-only {@link ProjectionEvent} via {@link readEventAtPosition} — position,
 * event type/version, and the canonical acceptance instant — never `event.sequence` and never a
 * payload/subject. Positions are dense and commit-ordered (ADR-0036), so `[1..horizon]` is a stable
 * contiguous prefix; a missing position inside it is a gap and fails closed.
 *
 * Not exported from the package root — internal projection vocabulary (the barrel is unchanged).
 */
import type { DatabaseClient } from '../persistence/pool.js';
import { isProjectionVersion, type ProjectionDefinition } from './projection-definition.js';
import { readEventAtPosition } from './projection-event-reader.js';
import { isProjectionName } from './projection-name.js';
import { ProjectionRebuildError } from './projection-rebuild-errors.js';

/** The position-map table the horizon is read from (the gap-free commit-ordered cursor, ADR-0036). */
const PROJECTION_EVENT_POSITION_TABLE = 'qf_jarvis.projection_event_position';

/**
 * Capture the rebuild HORIZON exactly once: the maximum assigned projection position, or `0n` when no
 * event has been ingested. Because positions are dense and commit-ordered, `[1..horizon]` is a stable
 * prefix; events committed after this read receive positions beyond the horizon and are excluded from
 * the run. Reads `MAX(position)` only — it takes no lock and does not block ingestion.
 */
export async function captureRebuildHorizon(client: DatabaseClient): Promise<bigint> {
  let raw: unknown;
  try {
    const result = await client.query<{ horizon: string | null }>(
      `SELECT COALESCE(MAX(position), 0)::text AS horizon FROM ${PROJECTION_EVENT_POSITION_TABLE}`,
    );
    raw = result.rows[0]?.horizon ?? '0';
  } catch {
    throw new ProjectionRebuildError('projection-rebuild-horizon-failed');
  }
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new ProjectionRebuildError('projection-rebuild-horizon-failed');
  }
  return BigInt(raw);
}

/** A rebuild request. `client` is an already-borrowed client pointed at an isolated target. */
export interface RebuildProjectionInput {
  readonly client: DatabaseClient;
  readonly definition: ProjectionDefinition;
  readonly horizon: bigint;
}

/** The bounded, non-identifying outcome of a rebuild — safe summary counts only, never row content. */
export interface RebuildProjectionResult {
  readonly horizon: bigint;
  readonly appliedPositions: bigint;
}

/**
 * Validate the request shape fail-closed, without retaining or echoing any caller value.
 *
 * Read through an `unknown` view so a hostile caller that `as`-cast a malformed object into
 * {@link RebuildProjectionInput} is still rejected at runtime (the static type is not a runtime
 * guarantee — the same discipline the definition layer applies).
 */
function validateRequest(input: RebuildProjectionInput): void {
  const raw = input as {
    readonly client?: unknown;
    readonly definition?: unknown;
    readonly horizon?: unknown;
  };
  const definition = raw.definition as
    | { readonly name?: unknown; readonly version?: unknown; readonly apply?: unknown }
    | null
    | undefined;
  if (
    typeof raw.client !== 'object' ||
    raw.client === null ||
    typeof definition !== 'object' ||
    definition === null ||
    !isProjectionName(definition.name) ||
    !isProjectionVersion(definition.version) ||
    typeof definition.apply !== 'function' ||
    typeof raw.horizon !== 'bigint' ||
    raw.horizon < 0n
  ) {
    throw new ProjectionRebuildError('projection-rebuild-invalid-request');
  }
}

/**
 * Rebuild a projection's read model over `[1..horizon]` into the borrowed client's target.
 *
 * Single-threaded and strictly ascending: for each position it reads the metadata-only event and calls
 * `definition.apply(client, event)` exactly once. A missing position within the horizon, a read
 * failure, or a handler rejection ABORTS with a bounded {@link ProjectionRebuildError} whose original
 * cause is discarded. `horizon = 0n` is a successful no-op (`appliedPositions = 0n`). Mutates only what
 * the definition's `apply` writes to the borrowed target — never a checkpoint, attempt, or failure row.
 */
export async function rebuildProjection(
  input: RebuildProjectionInput,
): Promise<RebuildProjectionResult> {
  validateRequest(input);
  const { client, definition, horizon } = input;

  let applied = 0n;
  for (let position = 1n; position <= horizon; position += 1n) {
    let event;
    try {
      event = await readEventAtPosition(client, position);
    } catch {
      throw new ProjectionRebuildError('projection-rebuild-read-failed');
    }
    if (event === null) {
      throw new ProjectionRebuildError('projection-rebuild-position-missing');
    }
    try {
      await definition.apply(client, event);
    } catch {
      throw new ProjectionRebuildError('projection-rebuild-handler-failed');
    }
    applied += 1n;
  }

  return Object.freeze({ horizon, appliedPositions: applied });
}
