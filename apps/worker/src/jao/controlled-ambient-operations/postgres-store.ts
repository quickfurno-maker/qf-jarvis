/**
 * The JAO-5 PostgreSQL ambient monitor store (ADR-0119).
 *
 * ### The claim commits BEFORE the investigation runs, and no transaction spans inference
 *
 * `claimAmbientRun` opens one transaction, locks the monitor row with `SELECT ... FOR UPDATE`,
 * checks every gate, reserves a budget unit, advances the schedule, inserts the run and commits.
 * Then it returns. JAO-1's capability read and its model call happen with no transaction open and
 * no row locked, and `finalizeAmbientRun` opens a second short transaction afterwards.
 *
 * Holding the lock across the investigation would put a network round trip to a model provider
 * inside a database transaction: one slow provider stalls the row, every other cycle blocks behind
 * it, and a connection pool empties while nothing is wrong with the database. The split is the
 * whole reason these are two methods.
 *
 * ### Duplicate suppression is a database constraint, not a code path
 *
 * `UNIQUE (dedupe_key)` on the run table is the final invariant. If every guard in this file were
 * deleted, two processes still could not both claim one cadence slot or one event id -- which is
 * what makes at-most-one-start true under concurrency and across restart, rather than true of the
 * code that happened to run.
 *
 * ### Connects to nothing on import, reads no environment
 *
 * The pool arrives as a parameter. No module-level pool, no singleton, no `process.env`, no default
 * connection. The one module in this slice that reads `DATABASE_URL` is the test harness, which is
 * excluded from the emitting build.
 *
 * The driver's error is classified by SQLSTATE alone and discarded: a `pg` error carries the SQL,
 * the constraint, the column, the bound parameters, the host and often the user. Database
 * uncertainty NEVER becomes a normal refusal -- "I could not look" and "it is not there" are
 * different facts, and recording a fake `TRIGGER_NOT_DUE` for an unknown durability outcome would
 * be an audit trail that lies.
 */
import { withClient, withTransaction } from '@qf-jarvis/event-backbone';
import type { DatabaseClient, DatabasePool } from '@qf-jarvis/event-backbone';

import {
  Jao5AmbientError,
  jao5EnrollMonitorInputSchema,
  jao5KillMonitorInputSchema,
  jao5MonitorInstanceIdSchema,
  jao5MonitorInstanceSchema,
  type Jao5EnrollMonitorInput,
  type Jao5KillMonitorInput,
  type Jao5MonitorInstance,
  type Jao5OperationResult,
} from './contracts.js';
import {
  assertJao5Budget,
  assertJao5Claimable,
  assertJao5ExpectedRevision,
  jao5BudgetWindowStart,
  jao5InstantFromMs,
  jao5SemanticDigest,
} from './policy.js';
import type {
  Jao5AmbientRunRecord,
  Jao5AmbientStore,
  Jao5Claim,
  Jao5ClaimRequest,
  Jao5FinalizeRequest,
} from './store-port.js';

// ---------------------------------------------------------------------------
// SQL. Internal, fully schema-qualified, parameterized without exception.
// ---------------------------------------------------------------------------

const INSTANT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

const INSTANCE_COLUMNS = `
  monitor_instance_id,
  monitor_id,
  monitor_version,
  definition_digest,
  owner_id,
  mode,
  status,
  to_char(enrolled_at AT TIME ZONE 'UTC', ${INSTANT}) AS enrolled_at,
  to_char(expires_at  AT TIME ZONE 'UTC', ${INSTANT}) AS expires_at,
  to_char(quiet_until AT TIME ZONE 'UTC', ${INSTANT}) AS quiet_until,
  to_char(killed_at   AT TIME ZONE 'UTC', ${INSTANT}) AS killed_at,
  last_claimed_slot,
  revision,
  to_char(created_at AT TIME ZONE 'UTC', ${INSTANT}) AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', ${INSTANT}) AS updated_at
`;

const SELECT_INSTANCE = `
  SELECT ${INSTANCE_COLUMNS} FROM qf_jarvis_jao5.ambient_monitor_instance
  WHERE monitor_instance_id = $1
`;

const SELECT_INSTANCE_FOR_UPDATE = `${SELECT_INSTANCE} FOR UPDATE`;

const INSERT_INSTANCE = `
  INSERT INTO qf_jarvis_jao5.ambient_monitor_instance (
    monitor_instance_id, monitor_id, monitor_version, definition_digest, owner_id,
    mode, status, enrolled_at, expires_at, quiet_until, killed_at, last_claimed_slot,
    revision, created_at, updated_at
  )
  VALUES ($1, $2, '1', $3, $4, 'SHADOW', 'ACTIVE', $5, $6, NULL, NULL, NULL, 1, $5, $5)
  ON CONFLICT DO NOTHING
  RETURNING ${INSTANCE_COLUMNS}
`;

/** Terminal. There is no counterpart statement anywhere in this file. */
const KILL_INSTANCE = `
  UPDATE qf_jarvis_jao5.ambient_monitor_instance
  SET status = 'KILLED', killed_at = $3, revision = revision + 1, updated_at = $3
  WHERE monitor_instance_id = $1 AND revision = $2 AND status <> 'KILLED'
  RETURNING ${INSTANCE_COLUMNS}
`;

const UPSERT_BUDGET_WINDOW = `
  INSERT INTO qf_jarvis_jao5.ambient_budget_window
    (monitor_instance_id, window_start_epoch, window_seconds, investigations_claimed,
     created_at, updated_at)
  VALUES ($1, $2, $3, 0, $4, $4)
  ON CONFLICT DO NOTHING
`;

const SELECT_BUDGET_WINDOW = `
  SELECT investigations_claimed
  FROM qf_jarvis_jao5.ambient_budget_window
  WHERE monitor_instance_id = $1 AND window_start_epoch = $2
  FOR UPDATE
`;

/**
 * The budget reservation. `AND investigations_claimed < $4` is the predicate that decides a race.
 *
 * Zero rows cannot mean "no such window": it was created and locked moments earlier in this same
 * transaction. It means the budget is full.
 */
const RESERVE_BUDGET_UNIT = `
  UPDATE qf_jarvis_jao5.ambient_budget_window
  SET investigations_claimed = investigations_claimed + 1, updated_at = $5
  WHERE monitor_instance_id = $1 AND window_start_epoch = $2 AND window_seconds = $3
    AND investigations_claimed < $4
  RETURNING investigations_claimed
`;

const COUNT_BUDGET_WINDOW = `
  SELECT investigations_claimed
  FROM qf_jarvis_jao5.ambient_budget_window
  WHERE monitor_instance_id = $1 AND window_start_epoch = $2
`;

/**
 * The claim insert. `ON CONFLICT DO NOTHING` on the dedupe key is the arbitration.
 *
 * Untargeted rather than naming the constraint: any uniqueness collision means somebody already
 * claimed this trigger identity, and either way the observable result here is the same -- zero rows
 * returned, and a `DUPLICATE_TRIGGER` refusal instead of a driver exception that would abort the
 * whole transaction.
 */
const INSERT_CLAIM = `
  INSERT INTO qf_jarvis_jao5.ambient_investigation_run (
    ambient_run_id, monitor_instance_id, trigger_kind, trigger_ref, dedupe_key,
    scheduled_slot, event_id, cycle_run_id, claimed_at, status, jao1_run_id,
    capability_calls, model_calls
  )
  VALUES ($1, $2, $3, $4, $5, $6::bigint, $7::text, $8, $9, 'CLAIMED', $10, 0, 0)
  ON CONFLICT DO NOTHING
  RETURNING ambient_run_id
`;

const ADVANCE_INSTANCE_FOR_CLAIM = `
  UPDATE qf_jarvis_jao5.ambient_monitor_instance
  SET revision = revision + 1,
      updated_at = $3,
      last_claimed_slot = COALESCE($2::bigint, last_claimed_slot)
  WHERE monitor_instance_id = $1
  RETURNING revision
`;

const SELECT_RUN_FOR_UPDATE = `
  SELECT ambient_run_id, monitor_instance_id, status
  FROM qf_jarvis_jao5.ambient_investigation_run
  WHERE ambient_run_id = $1
  FOR UPDATE
`;

const FINALIZE_RUN = `
  UPDATE qf_jarvis_jao5.ambient_investigation_run
  SET status = 'FINALIZED',
      finalized_at = $2,
      outcome = $3,
      attention_present = $4,
      refusal_code = $5::text,
      capability_calls = $6,
      model_calls = $7
  WHERE ambient_run_id = $1 AND status = 'CLAIMED'
  RETURNING ambient_run_id
`;

/**
 * Quieting after an investigation.
 *
 * `AND status <> 'KILLED'` is load-bearing: a monitor killed while its already-claimed
 * investigation was running must stay killed. Finalizing must never resurrect one.
 */
const APPLY_QUIET = `
  UPDATE qf_jarvis_jao5.ambient_monitor_instance
  SET quiet_until = $2::timestamptz,
      status = CASE WHEN $2::timestamptz IS NULL THEN 'ACTIVE' ELSE 'QUIETED' END,
      revision = revision + 1,
      updated_at = $3
  WHERE monitor_instance_id = $1 AND status <> 'KILLED'
`;

const SELECT_RUNS = `
  SELECT ambient_run_id, monitor_instance_id, trigger_kind, trigger_ref, dedupe_key,
         scheduled_slot, event_id, jao1_run_id, status, outcome, refusal_code,
         attention_present, capability_calls, model_calls
  FROM qf_jarvis_jao5.ambient_investigation_run
  WHERE monitor_instance_id = $1
  ORDER BY claimed_at ASC, ambient_run_id ASC
`;

const SELECT_REPLAY = `
  SELECT operation_id, monitor_instance_id, operation_kind, semantic_digest,
         committed_revision, committed_status,
         to_char(committed_at AT TIME ZONE 'UTC', ${INSTANT}) AS committed_at
  FROM qf_jarvis_jao5.ambient_operation_replay
  WHERE operation_id = $1
`;

const INSERT_REPLAY = `
  INSERT INTO qf_jarvis_jao5.ambient_operation_replay
    (operation_id, monitor_instance_id, operation_kind, semantic_digest,
     committed_revision, committed_status, committed_at, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
`;

// ---------------------------------------------------------------------------
// Error classification.
// ---------------------------------------------------------------------------

/**
 * Is this a SQLSTATE, or a Node socket errno wearing the same property name?
 *
 * `pg` puts the server's SQLSTATE on `error.code`, but a connection that never reached a server
 * carries a Node errno there instead. Reading an errno as a server rejection would report corrupt
 * durable state when nothing was ever reached.
 */
function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && /^([0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/u.test(value);
}

/**
 * Reduce an unknown thrown value to one closed code, discarding everything else.
 *
 * A `Jao5AmbientError` passes through unchanged; it already carries the precise answer.
 * Everything else becomes `STORE_FAILED`, which is deliberately NOT a governance refusal: a caller
 * that cannot tell "the monitor was not due" from "the database did not answer" would record the
 * second as the first and believe governance had spoken.
 */
export function classifyJao5DatabaseError(error: unknown): Jao5AmbientError {
  if (error instanceof Jao5AmbientError) {
    return error;
  }
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  void isSqlState(code);
  return new Jao5AmbientError('STORE_FAILED');
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

interface InstanceRow {
  readonly monitor_instance_id: string;
  readonly monitor_id: string;
  readonly monitor_version: string;
  readonly definition_digest: string;
  readonly owner_id: string;
  readonly mode: string;
  readonly status: string;
  readonly enrolled_at: string;
  readonly expires_at: string;
  readonly quiet_until: string | null;
  readonly killed_at: string | null;
  readonly last_claimed_slot: string | null;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RunRow {
  readonly ambient_run_id: string;
  readonly monitor_instance_id: string;
  readonly trigger_kind: string;
  readonly trigger_ref: string;
  readonly dedupe_key: string;
  readonly scheduled_slot: string | null;
  readonly event_id: string | null;
  readonly jao1_run_id: string;
  readonly status: string;
  readonly outcome: string | null;
  readonly refusal_code: string | null;
  readonly attention_present: boolean | null;
  readonly capability_calls: number;
  readonly model_calls: number;
}

interface ReplayRow {
  readonly operation_id: string;
  readonly monitor_instance_id: string;
  readonly operation_kind: string;
  readonly semantic_digest: string;
  readonly committed_revision: number;
  readonly committed_status: string;
  readonly committed_at: string;
}

/** `bigint` comes back from `pg` as a string. Parsed, never coerced by accident. */
function toSlot(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Jao5AmbientError('STORE_FAILED');
  }
  return parsed;
}

/** A row becomes a record only once something has checked that it still is one. */
function toInstance(row: InstanceRow): Jao5MonitorInstance {
  const parsed = jao5MonitorInstanceSchema.safeParse({
    monitorInstanceId: row.monitor_instance_id,
    monitorId: row.monitor_id,
    monitorVersion: row.monitor_version,
    definitionDigest: row.definition_digest,
    ownerId: row.owner_id,
    mode: row.mode,
    status: row.status,
    enrolledAt: row.enrolled_at,
    expiresAt: row.expires_at,
    quietUntil: row.quiet_until,
    killedAt: row.killed_at,
    lastClaimedSlot: toSlot(row.last_claimed_slot),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) {
    throw new Jao5AmbientError('STORE_FAILED');
  }
  return Object.freeze(parsed.data);
}

async function loadForUpdate(
  client: DatabaseClient,
  monitorInstanceId: string,
): Promise<Jao5MonitorInstance> {
  const found = await client.query<InstanceRow>(SELECT_INSTANCE_FOR_UPDATE, [monitorInstanceId]);
  const row = found.rows[0];
  if (row === undefined) {
    throw new Jao5AmbientError('MONITOR_NOT_ENROLLED');
  }
  return toInstance(row);
}

/** The immutable committed identity a retryable operation returns. Never a mutable header. */
function toOperationResult(instance: Jao5MonitorInstance, replayed: boolean): Jao5OperationResult {
  return Object.freeze({
    monitorInstanceId: instance.monitorInstanceId,
    committedRevision: instance.revision,
    committedStatus: instance.status,
    committedAt: instance.updatedAt,
    replayed,
  });
}

/**
 * Check the replay table before doing the work.
 *
 * A caller that lost its connection does not know whether its operation committed. Same id and same
 * payload returns the committed identity; same id with a different payload fails closed rather than
 * letting one id mean two things.
 */
async function replayGuard(
  client: DatabaseClient,
  operationId: string,
  operationKind: 'ENROLL_MONITOR' | 'KILL_MONITOR',
  monitorInstanceId: string,
  digest: string,
): Promise<Jao5OperationResult | null> {
  const found = await client.query<ReplayRow>(SELECT_REPLAY, [operationId]);
  const prior = found.rows[0];
  if (prior === undefined) {
    return null;
  }
  if (
    prior.operation_kind !== operationKind ||
    prior.monitor_instance_id !== monitorInstanceId ||
    prior.semantic_digest !== digest
  ) {
    throw new Jao5AmbientError('OPERATION_CONFLICT');
  }
  const status = prior.committed_status;
  if (status !== 'ACTIVE' && status !== 'QUIETED' && status !== 'KILLED' && status !== 'EXPIRED') {
    throw new Jao5AmbientError('STORE_FAILED');
  }
  // The revision and status this operation ACTUALLY committed at, read back from the replay record
  // rather than from a header that has moved on since. The JAO-3 temporal-replay lesson.
  return Object.freeze({
    monitorInstanceId: prior.monitor_instance_id,
    committedRevision: prior.committed_revision,
    committedStatus: status,
    committedAt: prior.committed_at,
    replayed: true,
  });
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

export function createJao5PostgresStore(pool: DatabasePool): Jao5AmbientStore {
  return Object.freeze({
    async enrollMonitor(
      rawInput: Jao5EnrollMonitorInput,
      definitionDigest: string,
      ownerId: string,
      nowMs: number,
    ): Promise<Jao5OperationResult> {
      const parsed = jao5EnrollMonitorInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new Jao5AmbientError('REQUEST_INVALID');
      }
      const input = parsed.data;
      const enrolledAt = jao5InstantFromMs(nowMs);
      const expiresAt = jao5InstantFromMs(nowMs + input.enrollmentSeconds * 1_000);
      const digest = jao5SemanticDigest([
        'ENROLL_MONITOR',
        input.monitorInstanceId,
        input.monitorId,
        input.monitorVersion,
        definitionDigest,
        ownerId,
        String(input.enrollmentSeconds),
      ]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            input.operationId,
            'ENROLL_MONITOR',
            input.monitorInstanceId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }

          const inserted = await client.query<InstanceRow>(INSERT_INSTANCE, [
            input.monitorInstanceId,
            input.monitorId,
            definitionDigest,
            ownerId,
            enrolledAt,
            expiresAt,
          ]);
          const row = inserted.rows[0];
          if (row === undefined) {
            // An instance with that identity already exists under a DIFFERENT operation. Never an
            // overwrite: an enrollment is a durable record with its own expiry and kill state.
            throw new Jao5AmbientError('OPERATION_CONFLICT');
          }
          const instance = toInstance(row);
          await client.query(INSERT_REPLAY, [
            input.operationId,
            instance.monitorInstanceId,
            'ENROLL_MONITOR',
            digest,
            instance.revision,
            instance.status,
            instance.updatedAt,
          ]);
          return toOperationResult(instance, false);
        });
      } catch (error) {
        throw classifyJao5DatabaseError(error);
      }
    },

    async readMonitorInstance(monitorInstanceId: string): Promise<Jao5MonitorInstance> {
      // Parsed BEFORE a connection is borrowed. Parameterized SQL makes a malformed id safe, which
      // is not the same as the adapter having checked its own domain boundary.
      const id = jao5MonitorInstanceIdSchema.safeParse(monitorInstanceId);
      if (!id.success) {
        throw new Jao5AmbientError('REQUEST_INVALID');
      }
      try {
        return await withClient(pool, async (client) => {
          const found = await client.query<InstanceRow>(SELECT_INSTANCE, [id.data]);
          const row = found.rows[0];
          if (row === undefined) {
            throw new Jao5AmbientError('MONITOR_NOT_ENROLLED');
          }
          return toInstance(row);
        });
      } catch (error) {
        throw classifyJao5DatabaseError(error);
      }
    },

    async killMonitor(rawInput: Jao5KillMonitorInput, nowMs: number): Promise<Jao5OperationResult> {
      const parsed = jao5KillMonitorInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new Jao5AmbientError('REQUEST_INVALID');
      }
      const input = parsed.data;
      const killedAt = jao5InstantFromMs(nowMs);
      const digest = jao5SemanticDigest([
        'KILL_MONITOR',
        input.monitorInstanceId,
        String(input.expectedRevision),
      ]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            input.operationId,
            'KILL_MONITOR',
            input.monitorInstanceId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }

          const instance = await loadForUpdate(client, input.monitorInstanceId);
          if (instance.status === 'KILLED') {
            // Already terminal. Killing again is not an error and must not overwrite the instant
            // that records when it actually happened.
            return toOperationResult(instance, false);
          }
          assertJao5ExpectedRevision(instance, input.expectedRevision);

          const killed = await client.query<InstanceRow>(KILL_INSTANCE, [
            input.monitorInstanceId,
            input.expectedRevision,
            killedAt,
          ]);
          const row = killed.rows[0];
          if (row === undefined) {
            throw new Jao5AmbientError('REVISION_CONFLICT');
          }
          const committed = toInstance(row);
          await client.query(INSERT_REPLAY, [
            input.operationId,
            committed.monitorInstanceId,
            'KILL_MONITOR',
            digest,
            committed.revision,
            committed.status,
            committed.updatedAt,
          ]);
          return toOperationResult(committed, false);
        });
      } catch (error) {
        throw classifyJao5DatabaseError(error);
      }
    },

    async claimAmbientRun(request: Jao5ClaimRequest, nowMs: number): Promise<Jao5Claim> {
      const claimedAt = jao5InstantFromMs(nowMs);
      const windowStart = jao5BudgetWindowStart(nowMs, request.budgetWindowSeconds);

      try {
        return await withTransaction(pool, async (client) => {
          // THE LOCK. Everything below happens with this row held, so a concurrent kill, claim or
          // finalize for the same monitor serialises here rather than racing.
          const instance = await loadForUpdate(client, request.monitorInstanceId);

          // Bound to the exact definition the caller evaluated. A definition edited in between no
          // longer matches, and the claim fails closed rather than running under unreviewed bounds.
          if (instance.definitionDigest !== request.definitionDigest) {
            throw new Jao5AmbientError('MONITOR_VERSION_MISMATCH');
          }

          // Kill, expiry, status and quiet -- re-checked under the lock, not merely before it.
          assertJao5Claimable(instance, nowMs);

          if (
            request.scheduledSlot !== null &&
            instance.lastClaimedSlot !== null &&
            request.scheduledSlot <= instance.lastClaimedSlot
          ) {
            throw new Jao5AmbientError('DUPLICATE_TRIGGER');
          }

          await client.query(UPSERT_BUDGET_WINDOW, [
            request.monitorInstanceId,
            windowStart,
            request.budgetWindowSeconds,
            claimedAt,
          ]);
          const windowRow = await client.query<{ readonly investigations_claimed: number }>(
            SELECT_BUDGET_WINDOW,
            [request.monitorInstanceId, windowStart],
          );
          const claimedSoFar = windowRow.rows[0]?.investigations_claimed ?? 0;
          // Read from the DURABLE window row, never from process memory: usage a process holds is
          // usage a restart forgets, and a budget a restart resets is a budget an unstable system
          // silently removes.
          assertJao5Budget(claimedSoFar, request.maxInvestigationsPerWindow);

          const reserved = await client.query(RESERVE_BUDGET_UNIT, [
            request.monitorInstanceId,
            windowStart,
            request.budgetWindowSeconds,
            request.maxInvestigationsPerWindow,
            claimedAt,
          ]);
          if (reserved.rowCount !== 1) {
            throw new Jao5AmbientError('BUDGET_EXHAUSTED');
          }

          const claimed = await client.query<{ readonly ambient_run_id: string }>(INSERT_CLAIM, [
            request.ambientRunId,
            request.monitorInstanceId,
            request.triggerKind,
            request.triggerRef,
            request.dedupeKey,
            request.scheduledSlot,
            request.eventId,
            request.cycleRunId,
            claimedAt,
            request.jao1RunId,
          ]);
          if (claimed.rowCount !== 1) {
            // The uniqueness constraint arbitrated: this trigger identity is already claimed.
            throw new Jao5AmbientError('DUPLICATE_TRIGGER');
          }

          const advanced = await client.query<{ readonly revision: number }>(
            ADVANCE_INSTANCE_FOR_CLAIM,
            [request.monitorInstanceId, request.scheduledSlot, claimedAt],
          );
          const committedRevision = advanced.rows[0]?.revision;
          if (committedRevision === undefined) {
            throw new Jao5AmbientError('CLAIM_CONFLICT');
          }

          return Object.freeze({
            ambientRunId: request.ambientRunId,
            monitorInstanceId: instance.monitorInstanceId,
            monitorId: instance.monitorId,
            monitorVersion: instance.monitorVersion,
            triggerKind: request.triggerKind,
            triggerRef: request.triggerRef,
            dedupeKey: request.dedupeKey,
            committedRevision,
          });
        });
      } catch (error) {
        throw classifyJao5DatabaseError(error);
      }
    },

    async finalizeAmbientRun(request: Jao5FinalizeRequest, nowMs: number): Promise<void> {
      const finalizedAt = jao5InstantFromMs(nowMs);
      const quietUntil =
        request.quietUntilMs === null ? null : jao5InstantFromMs(request.quietUntilMs);

      try {
        await withTransaction(pool, async (client) => {
          const found = await client.query<{
            readonly ambient_run_id: string;
            readonly monitor_instance_id: string;
            readonly status: string;
          }>(SELECT_RUN_FOR_UPDATE, [request.ambientRunId]);
          const row = found.rows[0];
          if (row === undefined) {
            throw new Jao5AmbientError('CLAIM_NOT_FOUND');
          }
          if (row.status === 'FINALIZED') {
            // A finalized run is a fact about something that already happened. Rewriting it would
            // make the audit trail a draft.
            throw new Jao5AmbientError('CLAIM_ALREADY_FINALIZED');
          }

          const finalized = await client.query(FINALIZE_RUN, [
            request.ambientRunId,
            finalizedAt,
            request.outcome,
            request.attentionPresent,
            request.refusalCode,
            request.capabilityCalls,
            request.modelCalls,
          ]);
          if (finalized.rowCount !== 1) {
            throw new Jao5AmbientError('CLAIM_ALREADY_FINALIZED');
          }

          // Quieting, and NEVER a resurrection: a monitor killed while this investigation was
          // running stays killed.
          await client.query(APPLY_QUIET, [row.monitor_instance_id, quietUntil, finalizedAt]);
        });
      } catch (error) {
        throw classifyJao5DatabaseError(error);
      }
    },

    async countClaimedInWindow(
      monitorInstanceId: string,
      windowStartEpoch: number,
    ): Promise<number> {
      try {
        return await withClient(pool, async (client) => {
          const found = await client.query<{ readonly investigations_claimed: number }>(
            COUNT_BUDGET_WINDOW,
            [monitorInstanceId, windowStartEpoch],
          );
          return found.rows[0]?.investigations_claimed ?? 0;
        });
      } catch (error) {
        throw classifyJao5DatabaseError(error);
      }
    },

    async listAmbientRuns(monitorInstanceId: string): Promise<readonly Jao5AmbientRunRecord[]> {
      try {
        return await withClient(pool, async (client) => {
          const found = await client.query<RunRow>(SELECT_RUNS, [monitorInstanceId]);
          return Object.freeze(
            found.rows.map((row) =>
              Object.freeze({
                ambientRunId: row.ambient_run_id,
                monitorInstanceId: row.monitor_instance_id,
                triggerKind:
                  row.trigger_kind === 'APPROVED_EVENT' ? 'APPROVED_EVENT' : 'SCHEDULED_INTERVAL',
                triggerRef: row.trigger_ref,
                dedupeKey: row.dedupe_key,
                scheduledSlot: toSlot(row.scheduled_slot),
                eventId: row.event_id,
                jao1RunId: row.jao1_run_id,
                status: row.status === 'FINALIZED' ? 'FINALIZED' : 'CLAIMED',
                outcome:
                  row.outcome === 'NO_ANOMALY' ||
                  row.outcome === 'ATTENTION_CREATED' ||
                  row.outcome === 'REFUSED'
                    ? row.outcome
                    : null,
                refusalCode: null,
                attentionPresent: row.attention_present,
                capabilityCalls: row.capability_calls,
                modelCalls: row.model_calls,
              } satisfies Jao5AmbientRunRecord),
            ),
          );
        });
      } catch (error) {
        throw classifyJao5DatabaseError(error);
      }
    },
  });
}
