/**
 * The INTERNAL derived projection-health reader (QFJ-P03.07G, ADR-0040).
 *
 * Bounded, READ-ONLY queries over the already-merged schema (migrations 0004/0005/0006) that answer
 * the standing operational questions: what is blocked, what failures are active and in which lifecycle
 * status, how old the oldest one is, and how far behind each projection has fallen. It creates no
 * table, writes nothing, opens no transaction of its own, and takes no lock.
 *
 * ### Why these gauges are read rather than counted
 *
 * The counters in `projection-metrics.ts` are process-local: they reset when the worker restarts.
 * That is correct for rates, and useless for state — after a restart, "is anything blocked right now?"
 * must still answer truthfully. So the state gauges are DERIVED: recomputed from the database on a
 * bounded refresh rather than accumulated in memory. A restarted worker reports the correct blocked
 * set on its first refresh.
 *
 * ### Every query is index-supported
 *
 * QFJ-P03.07C created `projection_failure_by_projection (projection_name, projection_version, status)`
 * and `projection_failure_by_status_created (status, created_at)` and described them as
 * "operator-queue and runner-lookup helpers". They are exactly the indexes these queries need; the
 * active-failure predicate below is character-for-character the predicate of the partial unique index
 * `projection_failure_active_unique`, so it stays sargable.
 *
 * ### The health decision
 *
 * A blocked projection does NOT fail liveness, readiness, or deployment health — it reports DEGRADED
 * projection health and nothing more. See {@link ProjectionHealthReport} for the reasoning; briefly,
 * failing liveness on a block would make an orchestrator restart the worker in a loop, and every
 * restart would re-observe the same block, converting a contained single-projection halt into a crash
 * loop that also stops every healthy projection in the process.
 *
 * Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import type { DatabaseClient } from '../persistence/pool.js';
import type { CanonicalInstant } from '../projections/projection-definition.js';
import {
  isProjectionFailureStatus,
  type ProjectionFailureStatus,
} from '../projections/projection-failure-persistence.js';

import type { ProjectionMetricsRegistry } from './projection-metrics.js';

/**
 * Hard bound on rows returned by any health query. Health is a summary, not an export; an unbounded
 * read against a large failure table inside a worker cycle is exactly the kind of thing that turns an
 * observability feature into an outage.
 */
export const PROJECTION_HEALTH_ROW_LIMIT = 200;

/**
 * The active-failure predicate, character-for-character the predicate of the partial unique index
 * `projection_failure_active_unique`. Kept as one constant so the two can never drift apart.
 */
const ACTIVE_FAILURE_PREDICATE = `status NOT IN ('resolved', 'superseded', 'retired')`;

/** A canonical non-negative integer as PostgreSQL renders a BIGINT. */
const CANONICAL_NONNEGATIVE = /^(0|[1-9][0-9]*)$/;

/** Parse a BIGINT column (returned as text by the driver) into a bigint, or `null` if malformed. */
function parseNonNegativeBigint(value: string | null): bigint | null {
  if (value === null || !CANONICAL_NONNEGATIVE.test(value)) {
    return null;
  }
  return BigInt(value);
}

// --- Result shapes -------------------------------------------------------------------------------

/** One projection halted on a poison event. */
export interface BlockedProjectionState {
  readonly projectionName: string;
  readonly projectionVersion: number;
  readonly blockedPosition: bigint;
  readonly lastSafeErrorCode: string | null;
  readonly failedAttemptCount: number;
}

/** Count of non-terminal failures for one projection, in one lifecycle status. */
export interface ActiveFailureCount {
  readonly projectionName: string;
  readonly projectionVersion: number;
  readonly status: ProjectionFailureStatus;
  readonly count: number;
}

/** Age of the oldest non-terminal failure for one projection. */
export interface OldestActiveFailureAge {
  readonly projectionName: string;
  readonly projectionVersion: number;
  readonly ageSeconds: number;
}

/** How many committed positions a projection has not yet applied. */
export interface ProjectionCheckpointLag {
  readonly projectionName: string;
  readonly projectionVersion: number;
  readonly lagPositions: bigint;
}

/** The full derived snapshot. */
export interface ProjectionHealthSnapshot {
  readonly blocked: readonly BlockedProjectionState[];
  readonly activeFailures: readonly ActiveFailureCount[];
  readonly oldestActiveFailureAges: readonly OldestActiveFailureAge[];
  readonly lags: readonly ProjectionCheckpointLag[];
}

// --- Queries -------------------------------------------------------------------------------------

/**
 * Blocked checkpoints. Reads only cursor/status columns — never an event payload, subject, type, or
 * any sender-controlled value.
 */
export async function readBlockedProjections(
  client: DatabaseClient,
  limit: number = PROJECTION_HEALTH_ROW_LIMIT,
): Promise<readonly BlockedProjectionState[]> {
  const result = await client.query<{
    projection_name: string;
    projection_version: number;
    blocked_position: string | null;
    last_safe_error_code: string | null;
    failed_attempt_count: number;
  }>(
    `SELECT projection_name, projection_version, blocked_position,
            last_safe_error_code, failed_attempt_count
       FROM qf_jarvis.projection_checkpoint
      WHERE status = 'blocked'
      ORDER BY projection_name, projection_version
      LIMIT $1`,
    [limit],
  );

  const states: BlockedProjectionState[] = [];
  for (const row of result.rows) {
    const blockedPosition = parseNonNegativeBigint(row.blocked_position);
    if (blockedPosition === null) {
      // A blocked checkpoint with no blocked position is a divergence the runner already fails closed
      // on. Health reporting must not crash on it; it is simply not summarised here.
      continue;
    }
    states.push(
      Object.freeze({
        projectionName: row.projection_name,
        projectionVersion: row.projection_version,
        blockedPosition,
        lastSafeErrorCode: row.last_safe_error_code,
        failedAttemptCount: row.failed_attempt_count,
      }),
    );
  }
  return Object.freeze(states);
}

/** Non-terminal failure counts, grouped by projection and lifecycle status. */
export async function readActiveFailureCounts(
  client: DatabaseClient,
  limit: number = PROJECTION_HEALTH_ROW_LIMIT,
): Promise<readonly ActiveFailureCount[]> {
  const result = await client.query<{
    projection_name: string;
    projection_version: number;
    status: string;
    count: string;
  }>(
    `SELECT projection_name, projection_version, status, COUNT(*)::text AS count
       FROM qf_jarvis.projection_failure
      WHERE ${ACTIVE_FAILURE_PREDICATE}
      GROUP BY projection_name, projection_version, status
      ORDER BY projection_name, projection_version, status
      LIMIT $1`,
    [limit],
  );

  const counts: ActiveFailureCount[] = [];
  for (const row of result.rows) {
    if (!isProjectionFailureStatus(row.status)) {
      // The CHECK constraint makes this unreachable; skipping rather than throwing keeps a health read
      // from being the thing that breaks during an incident.
      continue;
    }
    const parsed = Number.parseInt(row.count, 10);
    if (!Number.isSafeInteger(parsed)) {
      continue;
    }
    counts.push(
      Object.freeze({
        projectionName: row.projection_name,
        projectionVersion: row.projection_version,
        status: row.status,
        count: parsed,
      }),
    );
  }
  return Object.freeze(counts);
}

/**
 * Age in seconds of the oldest non-terminal failure per projection, measured against the INJECTED
 * instant rather than `now()` — the whole subsystem reads one injected clock, and a health gauge that
 * silently used database time would be the only exception.
 */
export async function readOldestActiveFailureAges(
  client: DatabaseClient,
  now: CanonicalInstant,
  limit: number = PROJECTION_HEALTH_ROW_LIMIT,
): Promise<readonly OldestActiveFailureAge[]> {
  const result = await client.query<{
    projection_name: string;
    projection_version: number;
    age_seconds: string | null;
  }>(
    `SELECT projection_name, projection_version,
            EXTRACT(EPOCH FROM ($1::timestamptz - MIN(created_at)))::text AS age_seconds
       FROM qf_jarvis.projection_failure
      WHERE ${ACTIVE_FAILURE_PREDICATE}
      GROUP BY projection_name, projection_version
      ORDER BY projection_name, projection_version
      LIMIT $2`,
    [now, limit],
  );

  const ages: OldestActiveFailureAge[] = [];
  for (const row of result.rows) {
    if (row.age_seconds === null) {
      continue;
    }
    const parsed = Number.parseFloat(row.age_seconds);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    ages.push(
      Object.freeze({
        projectionName: row.projection_name,
        projectionVersion: row.projection_version,
        // A clock skew that puts `now` behind the row is reported as zero, never as negative age.
        ageSeconds: Math.max(parsed, 0),
      }),
    );
  }
  return Object.freeze(ages);
}

/**
 * Positions committed but not yet applied, per projection.
 *
 * The ceiling is `MAX(position)` over the append-only position map — the same gap-free, commit-ordered
 * authority the runner reads through — never `event.sequence`, which is storage identity only and
 * would produce a wrong lag whenever the two diverge.
 */
export async function readProjectionCheckpointLags(
  client: DatabaseClient,
  limit: number = PROJECTION_HEALTH_ROW_LIMIT,
): Promise<readonly ProjectionCheckpointLag[]> {
  const result = await client.query<{
    projection_name: string;
    projection_version: number;
    lag_positions: string | null;
  }>(
    `SELECT c.projection_name, c.projection_version,
            GREATEST(COALESCE(m.max_position, 0) - c.last_position, 0)::text AS lag_positions
       FROM qf_jarvis.projection_checkpoint AS c
       CROSS JOIN (
         SELECT COALESCE(MAX(position), 0) AS max_position
           FROM qf_jarvis.projection_event_position
       ) AS m
      ORDER BY c.projection_name, c.projection_version
      LIMIT $1`,
    [limit],
  );

  const lags: ProjectionCheckpointLag[] = [];
  for (const row of result.rows) {
    const lag = parseNonNegativeBigint(row.lag_positions);
    if (lag === null) {
      continue;
    }
    lags.push(
      Object.freeze({
        projectionName: row.projection_name,
        projectionVersion: row.projection_version,
        lagPositions: lag,
      }),
    );
  }
  return Object.freeze(lags);
}

/** Read the whole derived snapshot. Four bounded reads; no transaction, no lock, no write. */
export async function readProjectionHealthSnapshot(
  client: DatabaseClient,
  now: CanonicalInstant,
  limit: number = PROJECTION_HEALTH_ROW_LIMIT,
): Promise<ProjectionHealthSnapshot> {
  const blocked = await readBlockedProjections(client, limit);
  const activeFailures = await readActiveFailureCounts(client, limit);
  const oldestActiveFailureAges = await readOldestActiveFailureAges(client, now, limit);
  const lags = await readProjectionCheckpointLags(client, limit);
  return Object.freeze({ blocked, activeFailures, oldestActiveFailureAges, lags });
}

// --- Health decision -----------------------------------------------------------------------------

/** Closed projection-health status. `degraded` is the only state a blocked projection can produce. */
export const PROJECTION_HEALTH_STATUSES = ['healthy', 'degraded'] as const;
export type ProjectionHealthStatus = (typeof PROJECTION_HEALTH_STATUSES)[number];

/**
 * The health verdict.
 *
 * The three process-level booleans are deliberately INDEPENDENT of `status`:
 *
 * - `processLive` — a blocked projection is a correct, deliberate, durable state, not a fault. The
 *   process is functioning. Failing liveness would cause a restart loop in which each restart
 *   re-observes the same block, taking down every other healthy projection in the process and
 *   violating the ADR-0040 containment invariant that one poison event must not affect unrelated
 *   projections.
 * - `processReady` — same reasoning, plus the worker serves no traffic for readiness to gate.
 * - `deploymentHealthy` — a pre-existing block must never fail a deploy; that would couple an
 *   unrelated release to an open incident.
 *
 * Only `status` degrades, and it is what alerting keys on.
 */
export interface ProjectionHealthReport {
  readonly status: ProjectionHealthStatus;
  readonly blockedCount: number;
  readonly activeFailureCount: number;
  readonly processLive: boolean;
  readonly processReady: boolean;
  readonly deploymentHealthy: boolean;
  readonly snapshot: ProjectionHealthSnapshot;
}

/** Derive the health verdict from a snapshot. Pure. */
export function evaluateProjectionHealth(
  snapshot: ProjectionHealthSnapshot,
): ProjectionHealthReport {
  const blockedCount = snapshot.blocked.length;
  const activeFailureCount = snapshot.activeFailures.reduce((total, row) => total + row.count, 0);
  return Object.freeze({
    status: blockedCount > 0 || activeFailureCount > 0 ? 'degraded' : 'healthy',
    blockedCount,
    activeFailureCount,
    // Invariant, by design: never derived from the block count. See the interface docs.
    processLive: true,
    processReady: true,
    deploymentHealthy: true,
    snapshot,
  });
}

// --- Metric projection ---------------------------------------------------------------------------

/**
 * Push a snapshot into the derived gauges.
 *
 * Uses `replaceGauge` rather than `setGauge` so that a projection which is NO LONGER blocked has its
 * series removed instead of lingering forever at its last observed value — a stale "1" on a resolved
 * projection would keep the blocked-projection alert firing after the incident closed.
 */
export function applyProjectionHealthToMetrics(
  metrics: ProjectionMetricsRegistry,
  snapshot: ProjectionHealthSnapshot,
): void {
  metrics.replaceGauge(
    'projection_blocked_checkpoints',
    snapshot.blocked.map((row) => ({
      labels: {
        projection_name: row.projectionName,
        projection_version: row.projectionVersion,
      },
      value: 1,
    })),
  );

  metrics.replaceGauge(
    'projection_active_failures',
    snapshot.activeFailures.map((row) => ({
      labels: {
        projection_name: row.projectionName,
        projection_version: row.projectionVersion,
        status: row.status,
      },
      value: row.count,
    })),
  );

  metrics.replaceGauge(
    'projection_oldest_active_failure_age_seconds',
    snapshot.oldestActiveFailureAges.map((row) => ({
      labels: {
        projection_name: row.projectionName,
        projection_version: row.projectionVersion,
      },
      value: row.ageSeconds,
    })),
  );

  metrics.replaceGauge(
    'projection_checkpoint_lag_positions',
    snapshot.lags.map((row) => ({
      labels: {
        projection_name: row.projectionName,
        projection_version: row.projectionVersion,
      },
      // A lag beyond Number.MAX_SAFE_INTEGER is not reachable in practice; clamping keeps the gauge a
      // finite number rather than risking a precision surprise.
      value: Number(
        row.lagPositions > BigInt(Number.MAX_SAFE_INTEGER)
          ? BigInt(Number.MAX_SAFE_INTEGER)
          : row.lagPositions,
      ),
    })),
  );
}

// --- Schema presence gate ------------------------------------------------------------------------

/** The relations the projection-failure runtime requires. Absence means the migrations are behind. */
export const REQUIRED_PROJECTION_FAILURE_RELATIONS = [
  'projection_checkpoint',
  'projection_attempt',
  'projection_event_position',
  'projection_failure',
  'projection_failure_action',
  'projection_replay_authorization',
  'projection_replay_attempt',
] as const;

/** The outcome of the startup schema probe. */
export interface ProjectionSchemaProbe {
  readonly present: boolean;
  readonly missing: readonly string[];
}

/**
 * Check that every required relation exists in `qf_jarvis`.
 *
 * This is the one health condition that SHOULD block startup: if migration 0006's objects are absent,
 * the retry-exhaustion seam cannot record a failure at all, and running anyway would mean processing
 * events with a silently broken failure path. Reads `pg_catalog` only — no user data.
 */
export async function probeProjectionFailureSchema(
  client: DatabaseClient,
): Promise<ProjectionSchemaProbe> {
  const result = await client.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_catalog.pg_class AS c
       JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'qf_jarvis'
        AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])`,
    [[...REQUIRED_PROJECTION_FAILURE_RELATIONS]],
  );

  const found = new Set(result.rows.map((row) => row.relname));
  const missing = REQUIRED_PROJECTION_FAILURE_RELATIONS.filter((name) => !found.has(name));
  return Object.freeze({ present: missing.length === 0, missing: Object.freeze([...missing]) });
}
