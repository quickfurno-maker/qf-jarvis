/**
 * The JAO-7 durable PostgreSQL adapter (ADR-0121).
 *
 * ### The three rules this file exists to enforce
 *
 * 1. **Every mutation is compare-and-set AND idempotent by operation id.** The replay guard runs
 *    before the row lock and again after it: two callers retrying the same operation can both pass
 *    the pre-lock check, and without the re-check the loser would serialise behind the winner and
 *    then fail as a false `REVISION_CONFLICT` -- turning an honest retry into an error. That is
 *    JAO-5's owner-review lesson, applied from the start here.
 * 2. **A restart resets nothing.** Budgets, kill, expiry, the plan digest, the step count and the
 *    virtual sandbox all live in rows, because a budget a restart forgets is a budget an unstable
 *    system silently removes -- and an unstable system restarts most.
 * 3. **Nothing reusable is persisted.** Authority is stored as digests and identities. There is no
 *    column into which a raw `ApprovalDecisionV1`, a raw `ExecutionIntentV1` or an `approved`
 *    boolean could go, so a later reader cannot mistake history for permission.
 *
 * ### Strict decoding, not casting
 *
 * Every row is parsed by its contract on the way out. A cast is not a check: a row the database can
 * still hold but the domain no longer accepts would otherwise come back typed as governed state and
 * be acted on. An audit record that reads correctly and is wrong is worse than one that refuses to
 * be read, so a non-conforming row is a `PERSISTED_STATE_INVALID` refusal.
 */
import { withClient, withTransaction } from '@qf-jarvis/event-backbone';
import type { DatabaseClient, DatabasePool } from '@qf-jarvis/event-backbone';

import {
  Jao7AutonomyError,
  jao7AuthorityObservationRecordSchema,
  jao7EvaluationRecordSchema,
  jao7IdSchema,
  jao7InstantSchema,
  jao7RehearsalRecordSchema,
  jao7RunRecordSchema,
  jao7StepRecordSchema,
  type Jao7AuthorityObservationRecord,
  type Jao7EvaluationRecord,
  type Jao7Instant,
  type Jao7RehearsalRecord,
  type Jao7RunRecord,
  type Jao7StepRecord,
} from './contracts.js';
import { jao7Digest } from './mission-registry.js';
import type {
  Jao7AutonomyStore,
  Jao7ClaimStepRequest,
  Jao7ClaimedStep,
  Jao7CreateRunRequest,
  Jao7FinalizeStepRequest,
  Jao7OperationEnvelope,
  Jao7OperationResult,
  Jao7RecordAuthorityRequest,
  Jao7RehearsalMutationRequest,
  Jao7RunView,
} from './store-port.js';

const SCHEMA = 'qf_jarvis_jao7';

/** A UTC instant from a clock reading, refused rather than coerced if the clock is unusable. */
export function jao7InstantFromMs(nowMs: number): Jao7Instant {
  if (!Number.isFinite(nowMs)) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const parsed = jao7InstantSchema.safeParse(new Date(nowMs).toISOString());
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  return parsed.data;
}

/**
 * Normalise a thrown database object.
 *
 * The error is never read for its message: a driver error can quote a parameter value, and the whole
 * point of the governed columns is that their contents do not reach a log line.
 */
export function classifyJao7DatabaseError(error: unknown): Jao7AutonomyError {
  return error instanceof Jao7AutonomyError ? error : new Jao7AutonomyError('STORE_FAILED');
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

interface RunRow {
  readonly run_id: string;
  readonly mission_policy_id: string;
  readonly mission_policy_version: number;
  readonly mission_policy_digest: string;
  readonly plan_digest: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly state: string;
  readonly current_step_index: number;
  readonly revision: number;
  readonly enrolled_at: string;
  readonly expires_at: string;
  readonly killed_at: string | null;
  readonly paused_at: string | null;
  readonly resume_count: number;
  readonly steps_completed: number;
  readonly specialist_calls: number;
  readonly tool_calls: number;
  readonly model_calls: number;
  readonly rehearsal_applies: number;
  readonly proposal_recommendation_id: string | null;
  readonly proposal_action_id: string | null;
  readonly proposal_action_fingerprint: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface StepRow {
  readonly step_index: number;
  readonly step_type: string;
  readonly step_status: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly outcome_code: string | null;
}

interface EvaluationRow {
  readonly evaluation_index: number;
  readonly step_index: number;
  readonly evaluator_code: string;
  readonly verdict: string;
  readonly observed_at: string;
}

interface AuthorityRow {
  readonly approval_decision_digest: string;
  readonly execution_intent_digest: string | null;
  readonly recommendation_id: string;
  readonly proposed_action_id: string;
  readonly action_fingerprint: string;
  readonly observation_code: string;
  readonly observed_at: string;
}

interface RehearsalRow {
  readonly rehearsal_class: string;
  readonly before_integer_a: number;
  readonly before_integer_b: number | null;
  readonly after_integer_a: number | null;
  readonly after_integer_b: number | null;
  readonly rollback_integer_a: number | null;
  readonly rollback_integer_b: number | null;
  readonly state: string;
  readonly applied_at: string | null;
  readonly verified_at: string | null;
  readonly rolled_back_at: string | null;
  readonly revision: number;
}

interface ReplayRow {
  readonly operation_kind: string;
  readonly run_id: string;
  readonly semantic_digest: string;
  readonly committed_run_revision: number;
  readonly result_code: string;
}

// ---------------------------------------------------------------------------
// Strict decoders. Every one refuses rather than coerces.
// ---------------------------------------------------------------------------

function toInstant(value: string): string {
  return new Date(value).toISOString();
}

function toNullableInstant(value: string | null): string | null {
  return value === null ? null : toInstant(value);
}

function decodeRun(row: RunRow): Jao7RunRecord {
  const parsed = jao7RunRecordSchema.safeParse({
    runId: row.run_id,
    missionPolicyId: row.mission_policy_id,
    missionPolicyVersion: row.mission_policy_version,
    missionPolicyDigest: row.mission_policy_digest,
    planDigest: row.plan_digest,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    state: row.state,
    currentStepIndex: row.current_step_index,
    revision: row.revision,
    enrolledAt: toInstant(row.enrolled_at),
    expiresAt: toInstant(row.expires_at),
    killedAt: toNullableInstant(row.killed_at),
    pausedAt: toNullableInstant(row.paused_at),
    resumeCount: row.resume_count,
    stepsCompleted: row.steps_completed,
    specialistCalls: row.specialist_calls,
    toolCalls: row.tool_calls,
    modelCalls: row.model_calls,
    rehearsalApplies: row.rehearsal_applies,
    proposalRecommendationId: row.proposal_recommendation_id,
    proposalActionId: row.proposal_action_id,
    proposalActionFingerprint: row.proposal_action_fingerprint,
    createdAt: toInstant(row.created_at),
    updatedAt: toInstant(row.updated_at),
  });
  if (!parsed.success) {
    throw new Jao7AutonomyError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

function decodeStep(row: StepRow): Jao7StepRecord {
  const parsed = jao7StepRecordSchema.safeParse({
    stepIndex: row.step_index,
    stepType: row.step_type,
    stepStatus: row.step_status,
    startedAt: toInstant(row.started_at),
    completedAt: toNullableInstant(row.completed_at),
    outcomeCode: row.outcome_code,
  });
  if (!parsed.success) {
    throw new Jao7AutonomyError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

function decodeEvaluation(row: EvaluationRow): Jao7EvaluationRecord {
  const parsed = jao7EvaluationRecordSchema.safeParse({
    evaluationIndex: row.evaluation_index,
    stepIndex: row.step_index,
    evaluatorCode: row.evaluator_code,
    verdict: row.verdict,
    observedAt: toInstant(row.observed_at),
  });
  if (!parsed.success) {
    throw new Jao7AutonomyError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

function decodeAuthority(row: AuthorityRow): Jao7AuthorityObservationRecord {
  const parsed = jao7AuthorityObservationRecordSchema.safeParse({
    approvalDecisionDigest: row.approval_decision_digest,
    executionIntentDigest: row.execution_intent_digest,
    recommendationId: row.recommendation_id,
    proposedActionId: row.proposed_action_id,
    actionFingerprint: row.action_fingerprint,
    observationCode: row.observation_code,
    observedAt: toInstant(row.observed_at),
  });
  if (!parsed.success) {
    throw new Jao7AutonomyError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

function decodeRehearsal(row: RehearsalRow): Jao7RehearsalRecord {
  const parsed = jao7RehearsalRecordSchema.safeParse({
    rehearsalClass: row.rehearsal_class,
    beforeIntegerA: row.before_integer_a,
    beforeIntegerB: row.before_integer_b,
    afterIntegerA: row.after_integer_a,
    afterIntegerB: row.after_integer_b,
    rollbackIntegerA: row.rollback_integer_a,
    rollbackIntegerB: row.rollback_integer_b,
    state: row.state,
    appliedAt: toNullableInstant(row.applied_at),
    verifiedAt: toNullableInstant(row.verified_at),
    rolledBackAt: toNullableInstant(row.rolled_back_at),
    revision: row.revision,
  });
  if (!parsed.success) {
    throw new Jao7AutonomyError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

// ---------------------------------------------------------------------------
// SQL.
// ---------------------------------------------------------------------------

const SELECT_RUN_FOR_UPDATE = `
  SELECT * FROM ${SCHEMA}.autonomy_run WHERE run_id = $1 FOR UPDATE
`;

const SELECT_REPLAY = `
  SELECT operation_kind, run_id, semantic_digest, committed_run_revision, result_code
    FROM ${SCHEMA}.autonomy_operation_replay
   WHERE operation_id = $1
`;

const INSERT_REPLAY = `
  INSERT INTO ${SCHEMA}.autonomy_operation_replay
    (operation_id, operation_kind, run_id, semantic_digest, committed_run_revision, result_code,
     created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
`;

const INSERT_RUN = `
  INSERT INTO ${SCHEMA}.autonomy_run
    (run_id, mission_policy_id, mission_policy_version, mission_policy_digest, plan_digest,
     subject_type, subject_id, state, current_step_index, revision, enrolled_at, expires_at,
     killed_at, paused_at, resume_count, steps_completed, specialist_calls, tool_calls,
     model_calls, rehearsal_applies, created_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, 'PLANNED', 0, 1, $8::timestamptz, $9::timestamptz,
          NULL, NULL, 0, 0, 0, 0, 0, 0, $8::timestamptz, $8::timestamptz)
  ON CONFLICT (run_id) DO NOTHING
  RETURNING *
`;

const INSERT_REHEARSAL = `
  INSERT INTO ${SCHEMA}.virtual_rehearsal_state
    (run_id, rehearsal_class, before_integer_a, before_integer_b, state, revision)
  VALUES ($1, $2, $3, $4::integer, 'CAPTURED', 1)
  ON CONFLICT (run_id) DO NOTHING
`;

const INSERT_STEP = `
  INSERT INTO ${SCHEMA}.autonomy_step
    (run_id, step_index, step_type, step_status, operation_id, started_at)
  VALUES ($1, $2, $3, 'CLAIMED', $4, $5::timestamptz)
  ON CONFLICT (run_id, step_index) DO NOTHING
  RETURNING step_index, step_type, step_status, started_at, completed_at, outcome_code
`;

const SELECT_STEP = `
  SELECT step_index, step_type, step_status, started_at, completed_at, outcome_code
    FROM ${SCHEMA}.autonomy_step WHERE run_id = $1 AND step_index = $2
`;

const FINALIZE_STEP = `
  UPDATE ${SCHEMA}.autonomy_step
     SET step_status = $3, completed_at = $4::timestamptz, outcome_code = $5
   WHERE run_id = $1 AND step_index = $2 AND step_status = 'CLAIMED'
`;

const INSERT_EVALUATION = `
  INSERT INTO ${SCHEMA}.autonomy_evaluation
    (run_id, evaluation_index, step_index, evaluator_code, verdict, observed_at)
  VALUES ($1,
          (SELECT coalesce(max(evaluation_index) + 1, 0)
             FROM ${SCHEMA}.autonomy_evaluation WHERE run_id = $1),
          $2, $3, $4, $5::timestamptz)
`;

const SELECT_STEPS = `
  SELECT step_index, step_type, step_status, started_at, completed_at, outcome_code
    FROM ${SCHEMA}.autonomy_step WHERE run_id = $1 ORDER BY step_index
`;

const SELECT_EVALUATIONS = `
  SELECT evaluation_index, step_index, evaluator_code, verdict, observed_at
    FROM ${SCHEMA}.autonomy_evaluation WHERE run_id = $1 ORDER BY evaluation_index
`;

const SELECT_AUTHORITY = `
  SELECT approval_decision_digest, execution_intent_digest, recommendation_id, proposed_action_id,
         action_fingerprint, observation_code, observed_at
    FROM ${SCHEMA}.authority_observation WHERE run_id = $1
`;

const SELECT_REHEARSAL = `
  SELECT rehearsal_class, before_integer_a, before_integer_b, after_integer_a, after_integer_b,
         rollback_integer_a, rollback_integer_b, state, applied_at, verified_at, rolled_back_at,
         revision
    FROM ${SCHEMA}.virtual_rehearsal_state WHERE run_id = $1
`;

const SELECT_REHEARSAL_FOR_UPDATE = `${SELECT_REHEARSAL} FOR UPDATE`;

const INSERT_AUTHORITY = `
  INSERT INTO ${SCHEMA}.authority_observation
    (run_id, approval_decision_digest, execution_intent_digest, recommendation_id,
     proposed_action_id, action_fingerprint, observation_code, observed_at)
  VALUES ($1, $2, $3::text, $4, $5, $6, $7, $8::timestamptz)
  ON CONFLICT (run_id) DO NOTHING
`;

// ---------------------------------------------------------------------------
// Shared transaction helpers.
// ---------------------------------------------------------------------------

async function loadRunForUpdate(client: DatabaseClient, runId: string): Promise<Jao7RunRecord> {
  const found = await client.query<RunRow>(SELECT_RUN_FOR_UPDATE, [runId]);
  const row = found.rows[0];
  if (row === undefined) {
    throw new Jao7AutonomyError('RUN_NOT_FOUND');
  }
  return decodeRun(row);
}

/**
 * The replay guard.
 *
 * A prior record with the SAME semantic digest is an exact replay and returns what it committed. A
 * prior record with a DIFFERENT digest is the same id being reused to mean something else, and that
 * is refused with zero writes -- which is what makes an operation id a promise rather than a label.
 */
async function replayGuard(
  client: DatabaseClient,
  operationId: string,
  operationKind: string,
  runId: string,
  digest: string,
): Promise<Jao7OperationResult | null> {
  const found = await client.query<ReplayRow>(SELECT_REPLAY, [operationId]);
  const prior = found.rows[0];
  if (prior === undefined) {
    return null;
  }
  if (
    prior.operation_kind !== operationKind ||
    prior.run_id !== runId ||
    prior.semantic_digest !== digest
  ) {
    throw new Jao7AutonomyError('OPERATION_CONFLICT');
  }
  // Read back from the replay record rather than from the live header, which has moved on. That is
  // JAO-3's temporal-replay lesson: a durable result must carry only immutable committed identity.
  const state = jao7RunRecordSchema.shape.state.safeParse(
    prior.result_code.startsWith('STATE_')
      ? prior.result_code.slice('STATE_'.length)
      : prior.result_code,
  );
  return Object.freeze({
    runId: prior.run_id,
    committedRevision: prior.committed_run_revision,
    committedState: state.success ? state.data : 'FAILED_SAFE',
    resultCode: prior.result_code,
    replayed: true,
  });
}

function assertRevision(run: Jao7RunRecord, expected: number): void {
  if (run.revision !== expected) {
    throw new Jao7AutonomyError('REVISION_CONFLICT');
  }
}

/**
 * The gate every FORWARD transition passes.
 *
 * Order matters and is chosen deliberately: kill first, then expiry, then pause. A killed run is
 * killed whatever else is true of it, and reporting "paused" for a killed run would be a smaller
 * truth standing in front of a larger one.
 *
 * Safety cleanup does NOT come through here. Rolling back synthetic state that was already applied
 * is superior to kill and expiry, because refusing it would leave the sandbox dirty -- and a control
 * that strands state it created is not a control.
 */
function assertForwardEligible(run: Jao7RunRecord, nowMs: number): void {
  if (run.state === 'KILLED' || run.killedAt !== null) {
    throw new Jao7AutonomyError('RUN_KILLED');
  }
  if (nowMs >= Date.parse(run.expiresAt) || run.state === 'EXPIRED') {
    throw new Jao7AutonomyError('RUN_EXPIRED');
  }
  if (run.state === 'PAUSED') {
    throw new Jao7AutonomyError('RUN_PAUSED');
  }
  if (run.state === 'COMPLETED' || run.state === 'FAILED_SAFE') {
    throw new Jao7AutonomyError('STATE_CONFLICT');
  }
}

async function bumpRun(
  client: DatabaseClient,
  runId: string,
  expectedRevision: number,
  assignments: string,
  params: readonly unknown[],
  at: string,
): Promise<Jao7RunRecord> {
  const updated = await client.query<RunRow>(
    `UPDATE ${SCHEMA}.autonomy_run
        SET revision = revision + 1, updated_at = $2::timestamptz${assignments === '' ? '' : `, ${assignments}`}
      WHERE run_id = $1 AND revision = $3
      RETURNING *`,
    [runId, at, expectedRevision, ...params],
  );
  const row = updated.rows[0];
  if (row === undefined) {
    throw new Jao7AutonomyError('REVISION_CONFLICT');
  }
  return decodeRun(row);
}

async function writeReplay(
  client: DatabaseClient,
  operationId: string,
  operationKind: string,
  runId: string,
  digest: string,
  run: Jao7RunRecord,
  at: string,
): Promise<Jao7OperationResult> {
  await client.query(INSERT_REPLAY, [
    operationId,
    operationKind,
    runId,
    digest,
    run.revision,
    `STATE_${run.state}`,
    at,
  ]);
  return Object.freeze({
    runId,
    committedRevision: run.revision,
    committedState: run.state,
    resultCode: `STATE_${run.state}`,
    replayed: false,
  });
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

export function createJao7PostgresStore(pool: DatabasePool): Jao7AutonomyStore {
  return Object.freeze({
    async createRun(request: Jao7CreateRunRequest, nowMs: number): Promise<Jao7OperationResult> {
      const at = jao7InstantFromMs(nowMs);
      const expiresAt = jao7InstantFromMs(nowMs + request.lifetimeSeconds * 1_000);
      const digest = jao7Digest([
        'CREATE_RUN',
        request.runId,
        request.missionPolicyId,
        String(request.missionPolicyVersion),
        request.missionPolicyDigest,
        request.planDigest,
        request.subjectType,
        request.subjectId,
      ]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            'CREATE_RUN',
            request.runId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }

          const inserted = await client.query<RunRow>(INSERT_RUN, [
            request.runId,
            request.missionPolicyId,
            request.missionPolicyVersion,
            request.missionPolicyDigest,
            request.planDigest,
            request.subjectType,
            request.subjectId,
            at,
            expiresAt,
          ]);
          const row = inserted.rows[0];
          if (row === undefined) {
            // The primary key arbitrated: a run with this identity already exists and was NOT
            // created by this operation id. Two different missions sharing a run id is exactly the
            // collision that would let one run's authority observation describe another's action.
            throw new Jao7AutonomyError('RUN_ALREADY_EXISTS');
          }
          const run = decodeRun(row);

          // The sandbox is captured at creation, so a BEFORE state exists before anything can apply.
          // A rollback target decided later is a rollback target somebody could choose.
          await client.query(INSERT_REHEARSAL, [
            request.runId,
            request.rehearsalClass,
            request.beforeIntegerA,
            request.beforeIntegerB,
          ]);

          return await writeReplay(
            client,
            request.operationId,
            'CREATE_RUN',
            request.runId,
            digest,
            run,
            at,
          );
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async claimStep(request: Jao7ClaimStepRequest, nowMs: number): Promise<Jao7ClaimedStep> {
      const at = jao7InstantFromMs(nowMs);

      try {
        return await withTransaction(pool, async (client) => {
          // THE LOCK. Everything below happens with the run row held, so a concurrent claim, kill or
          // finalize for the same run serialises here rather than racing.
          const run = await loadRunForUpdate(client, request.runId);

          // An already-claimed step is a REPLAY, not a conflict: the same operation id retrying the
          // same step must be able to pick the work back up after a crash.
          const existing = await client.query<StepRow>(SELECT_STEP, [
            request.runId,
            request.stepIndex,
          ]);
          const existingRow = existing.rows[0];
          if (existingRow !== undefined) {
            const step = decodeStep(existingRow);
            if (step.stepStatus !== 'CLAIMED') {
              throw new Jao7AutonomyError('STEP_NOT_ELIGIBLE');
            }
            return Object.freeze({ run, step, replayed: true });
          }

          assertRevision(run, request.expectedRevision);
          assertForwardEligible(run, nowMs);

          // The plan the run was enrolled against, re-proved. A policy edited mid-flight stops the
          // run rather than silently re-scoping it.
          if (run.planDigest !== request.planDigest) {
            throw new Jao7AutonomyError('PLAN_MISMATCH');
          }
          if (run.currentStepIndex !== request.stepIndex) {
            throw new Jao7AutonomyError('STEP_NOT_ELIGIBLE');
          }
          if (run.stepsCompleted >= request.maxSteps) {
            throw new Jao7AutonomyError('BUDGET_EXHAUSTED');
          }

          // Budgets are charged INSIDE the claim transaction, so a crash between charge and work
          // leaves the budget spent. That is the conservative direction: a spent budget costs a
          // retry, an unspent one costs a second specialist call nobody authorised.
          let assignments = '';
          const params: unknown[] = [];
          if (request.charge === 'SPECIALIST') {
            if (run.specialistCalls + 1 > request.maxSpecialistCalls) {
              throw new Jao7AutonomyError('BUDGET_EXHAUSTED');
            }
            assignments = 'specialist_calls = specialist_calls + 1';
          } else if (request.charge === 'TOOL') {
            if (run.toolCalls + request.toolCallCount > request.maxToolCalls) {
              throw new Jao7AutonomyError('BUDGET_EXHAUSTED');
            }
            assignments = 'tool_calls = tool_calls + $4';
            params.push(request.toolCallCount);
          }

          const claimed = await client.query<StepRow>(INSERT_STEP, [
            request.runId,
            request.stepIndex,
            request.stepType,
            request.operationId,
            at,
          ]);
          const claimedRow = claimed.rows[0];
          if (claimedRow === undefined) {
            // The unique constraint arbitrated: another transaction claimed it first.
            throw new Jao7AutonomyError('STEP_ALREADY_CLAIMED');
          }

          const moved = await bumpRun(
            client,
            request.runId,
            request.expectedRevision,
            [assignments, "state = 'IN_PROGRESS'"].filter((part) => part !== '').join(', '),
            params,
            at,
          );

          return Object.freeze({ run: moved, step: decodeStep(claimedRow), replayed: false });
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async finalizeStep(
      request: Jao7FinalizeStepRequest,
      nowMs: number,
    ): Promise<Jao7OperationResult> {
      const at = jao7InstantFromMs(nowMs);
      const digest = jao7Digest([
        'FINALIZE_STEP',
        request.runId,
        String(request.stepIndex),
        request.stepStatus,
        request.outcomeCode,
        request.verdict,
        request.nextState,
      ]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            'FINALIZE_STEP',
            request.runId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }

          const run = await loadRunForUpdate(client, request.runId);

          const raced = await replayGuard(
            client,
            request.operationId,
            'FINALIZE_STEP',
            request.runId,
            digest,
          );
          if (raced !== null) {
            return raced;
          }

          assertRevision(run, request.expectedRevision);

          const finalized = await client.query(FINALIZE_STEP, [
            request.runId,
            request.stepIndex,
            request.stepStatus,
            at,
            request.outcomeCode,
          ]);
          if (finalized.rowCount !== 1) {
            // A finalized step is a fact about something that already happened. Rewriting it would
            // make the audit trail a draft.
            throw new Jao7AutonomyError('STEP_NOT_ELIGIBLE');
          }

          // Continuous evaluation, durably. Never overwritten, never summarised away.
          await client.query(INSERT_EVALUATION, [
            request.runId,
            request.stepIndex,
            request.evaluatorCode,
            request.verdict,
            at,
          ]);

          const parts = ['state = $4'];
          const params: unknown[] = [request.nextState];
          if (request.stepStatus === 'COMPLETED') {
            parts.push('steps_completed = steps_completed + 1');
          }
          if (request.advanceStepIndex) {
            parts.push('current_step_index = current_step_index + 1');
          }
          if (request.nextState === 'PAUSED') {
            parts.push('paused_at = $2::timestamptz');
          } else {
            parts.push('paused_at = NULL');
          }
          const binding = request.proposalBinding;
          if (binding !== undefined) {
            // Written once. The run row already refuses a half-written binding, and the coordinator
            // refuses a second proposal, so this cannot quietly re-point an in-flight run.
            if (run.proposalActionFingerprint !== null) {
              throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
            }
            parts.push(
              `proposal_recommendation_id = $${String(params.length + 4)}`,
              `proposal_action_id = $${String(params.length + 5)}`,
              `proposal_action_fingerprint = $${String(params.length + 6)}`,
            );
            params.push(
              binding.recommendationId,
              binding.proposedActionId,
              binding.actionFingerprint,
            );
          }

          const moved = await bumpRun(
            client,
            request.runId,
            request.expectedRevision,
            parts.join(', '),
            params,
            at,
          );

          return await writeReplay(
            client,
            request.operationId,
            'FINALIZE_STEP',
            request.runId,
            digest,
            moved,
            at,
          );
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async pauseRun(
      request: Jao7OperationEnvelope & { readonly runId: string },
      nowMs: number,
    ): Promise<Jao7OperationResult> {
      const at = jao7InstantFromMs(nowMs);
      const digest = jao7Digest(['PAUSE_RUN', request.runId, String(request.expectedRevision)]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            'PAUSE_RUN',
            request.runId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }
          const run = await loadRunForUpdate(client, request.runId);
          const raced = await replayGuard(
            client,
            request.operationId,
            'PAUSE_RUN',
            request.runId,
            digest,
          );
          if (raced !== null) {
            return raced;
          }

          assertRevision(run, request.expectedRevision);
          assertForwardEligible(run, nowMs);

          const moved = await bumpRun(
            client,
            request.runId,
            request.expectedRevision,
            "state = 'PAUSED', paused_at = $2::timestamptz",
            [],
            at,
          );
          return await writeReplay(
            client,
            request.operationId,
            'PAUSE_RUN',
            request.runId,
            digest,
            moved,
            at,
          );
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async resumeRun(
      request: Jao7OperationEnvelope & { readonly runId: string; readonly maxResumes: number },
      nowMs: number,
    ): Promise<Jao7OperationResult> {
      const at = jao7InstantFromMs(nowMs);
      const digest = jao7Digest(['RESUME_RUN', request.runId, String(request.expectedRevision)]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            'RESUME_RUN',
            request.runId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }
          const run = await loadRunForUpdate(client, request.runId);
          const raced = await replayGuard(
            client,
            request.operationId,
            'RESUME_RUN',
            request.runId,
            digest,
          );
          if (raced !== null) {
            return raced;
          }

          assertRevision(run, request.expectedRevision);
          // Kill and expiry are superior to a resume. A paused run that was killed stays killed.
          if (run.state === 'KILLED' || run.killedAt !== null) {
            throw new Jao7AutonomyError('RUN_KILLED');
          }
          if (nowMs >= Date.parse(run.expiresAt)) {
            throw new Jao7AutonomyError('RUN_EXPIRED');
          }
          if (run.state !== 'PAUSED' && run.state !== 'AWAITING_AUTHORITY') {
            throw new Jao7AutonomyError('STATE_CONFLICT');
          }
          if (run.resumeCount + 1 > request.maxResumes) {
            throw new Jao7AutonomyError('BUDGET_EXHAUSTED');
          }

          const moved = await bumpRun(
            client,
            request.runId,
            request.expectedRevision,
            "state = 'IN_PROGRESS', paused_at = NULL, resume_count = resume_count + 1",
            [],
            at,
          );
          return await writeReplay(
            client,
            request.operationId,
            'RESUME_RUN',
            request.runId,
            digest,
            moved,
            at,
          );
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async killRun(
      request: Jao7OperationEnvelope & { readonly runId: string },
      nowMs: number,
    ): Promise<Jao7OperationResult> {
      const at = jao7InstantFromMs(nowMs);
      const digest = jao7Digest(['KILL_RUN', request.runId, String(request.expectedRevision)]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            'KILL_RUN',
            request.runId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }
          const run = await loadRunForUpdate(client, request.runId);
          const raced = await replayGuard(
            client,
            request.operationId,
            'KILL_RUN',
            request.runId,
            digest,
          );
          if (raced !== null) {
            return raced;
          }

          // The compare-and-set runs FIRST and ALWAYS, terminal row included. Returning early on
          // KILLED would let a NEW operation id report success without matching the revision and
          // without writing a replay record -- breaking both declared properties at once, on the one
          // path the kill switch exists for. That is JAO-5's Finding 2, and it is not repeated here.
          assertRevision(run, request.expectedRevision);

          if (run.state === 'KILLED') {
            // Already terminal: a durable TERMINAL NO-OP. `killed_at` is not overwritten, and the
            // replay row makes this operation id idempotent from here on.
            return await writeReplay(
              client,
              request.operationId,
              'KILL_RUN',
              request.runId,
              digest,
              run,
              at,
            );
          }

          const moved = await bumpRun(
            client,
            request.runId,
            request.expectedRevision,
            "state = 'KILLED', killed_at = $2::timestamptz, paused_at = NULL",
            [],
            at,
          );
          return await writeReplay(
            client,
            request.operationId,
            'KILL_RUN',
            request.runId,
            digest,
            moved,
            at,
          );
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async recordAuthorityObservation(
      request: Jao7RecordAuthorityRequest,
      nowMs: number,
    ): Promise<Jao7OperationResult> {
      const at = jao7InstantFromMs(nowMs);
      const digest = jao7Digest([
        'RECORD_AUTHORITY',
        request.runId,
        request.approvalDecisionDigest,
        request.executionIntentDigest ?? '',
        request.recommendationId,
        request.proposedActionId,
        request.actionFingerprint,
        request.observationCode,
      ]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            'FINALIZE_STEP',
            request.runId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }
          const run = await loadRunForUpdate(client, request.runId);
          const raced = await replayGuard(
            client,
            request.operationId,
            'FINALIZE_STEP',
            request.runId,
            digest,
          );
          if (raced !== null) {
            return raced;
          }

          assertRevision(run, request.expectedRevision);
          assertForwardEligible(run, nowMs);

          // ON CONFLICT DO NOTHING plus a primary key on run_id: one observation per run, ever. A
          // second correlation binding a DIFFERENT action to the same run is exactly the
          // substitution this whole slice exists to prevent, and the database refuses it.
          const inserted = await client.query(INSERT_AUTHORITY, [
            request.runId,
            request.approvalDecisionDigest,
            request.executionIntentDigest,
            request.recommendationId,
            request.proposedActionId,
            request.actionFingerprint,
            request.observationCode,
            at,
          ]);
          if (inserted.rowCount !== 1) {
            throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
          }

          const moved = await bumpRun(
            client,
            request.runId,
            request.expectedRevision,
            'state = $4',
            [
              request.observationCode === 'CORRELATED_APPROVED_ACTION_AND_INTENT'
                ? 'AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL'
                : 'AWAITING_AUTHORITY',
            ],
            at,
          );
          return await writeReplay(
            client,
            request.operationId,
            'FINALIZE_STEP',
            request.runId,
            digest,
            moved,
            at,
          );
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async mutateRehearsal(
      request: Jao7RehearsalMutationRequest,
      nowMs: number,
    ): Promise<Jao7OperationResult> {
      const at = jao7InstantFromMs(nowMs);
      const digest = jao7Digest([
        request.operationKind,
        request.runId,
        request.nextRehearsalState,
        String(request.afterIntegerA ?? -1),
        String(request.afterIntegerB ?? -1),
        String(request.rollbackIntegerA ?? -1),
        String(request.rollbackIntegerB ?? -1),
      ]);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            request.operationKind,
            request.runId,
            digest,
          );
          if (replayed !== null) {
            return replayed;
          }
          const run = await loadRunForUpdate(client, request.runId);
          const raced = await replayGuard(
            client,
            request.operationId,
            request.operationKind,
            request.runId,
            digest,
          );
          if (raced !== null) {
            return raced;
          }

          assertRevision(run, request.expectedRevision);

          // ROLLBACK IS SAFETY CLEANUP, and safety cleanup is superior to kill and expiry.
          //
          // Applying or verifying is forward work and stops at a kill. Rolling back synthetic state
          // that was already applied does not: refusing it would leave the sandbox dirty with no
          // path back, and a control that strands the state it created is not a control. It can only
          // ever restore the captured BEFORE value, so being superior costs nothing.
          if (request.operationKind !== 'ROLLBACK_REHEARSAL') {
            assertForwardEligible(run, nowMs);
          }

          const found = await client.query<RehearsalRow>(SELECT_REHEARSAL_FOR_UPDATE, [
            request.runId,
          ]);
          const row = found.rows[0];
          if (row === undefined) {
            throw new Jao7AutonomyError('REHEARSAL_APPLY_FAILED');
          }
          const rehearsal = decodeRehearsal(row);

          if (request.operationKind === 'APPLY_REHEARSAL') {
            if (rehearsal.state !== 'CAPTURED') {
              // At most one apply, ever. A second apply over an applied sandbox would make the
              // captured BEFORE value a lie, and the rollback target with it.
              throw new Jao7AutonomyError('STATE_CONFLICT');
            }
            if (run.rehearsalApplies + 1 > request.maxRehearsalApplies) {
              throw new Jao7AutonomyError('BUDGET_EXHAUSTED');
            }
          }
          if (request.operationKind === 'VERIFY_REHEARSAL' && rehearsal.state !== 'APPLIED') {
            throw new Jao7AutonomyError('STATE_CONFLICT');
          }
          if (
            request.operationKind === 'ROLLBACK_REHEARSAL' &&
            rehearsal.state !== 'APPLIED' &&
            rehearsal.state !== 'ROLLBACK_REQUIRED'
          ) {
            throw new Jao7AutonomyError('STATE_CONFLICT');
          }

          const sets = ['state = $2', 'revision = revision + 1'];
          const params: unknown[] = [request.nextRehearsalState];
          let index = 3;
          if (request.operationKind === 'APPLY_REHEARSAL') {
            sets.push(`after_integer_a = $${String(index)}::integer`);
            params.push(request.afterIntegerA);
            index += 1;
            sets.push(`after_integer_b = $${String(index)}::integer`);
            params.push(request.afterIntegerB);
            index += 1;
            sets.push(`applied_at = $${String(index)}::timestamptz`);
            params.push(at);
            index += 1;
          } else if (request.operationKind === 'VERIFY_REHEARSAL') {
            sets.push(`verified_at = $${String(index)}::timestamptz`);
            params.push(at);
            index += 1;
          } else {
            sets.push(`rollback_integer_a = $${String(index)}::integer`);
            params.push(request.rollbackIntegerA);
            index += 1;
            sets.push(`rollback_integer_b = $${String(index)}::integer`);
            params.push(request.rollbackIntegerB);
            index += 1;
            sets.push(`rolled_back_at = $${String(index)}::timestamptz`);
            params.push(at);
            index += 1;
          }

          const mutated = await client.query(
            `UPDATE ${SCHEMA}.virtual_rehearsal_state
                SET ${sets.join(', ')}
              WHERE run_id = $1 AND revision = $${String(index)}`,
            [request.runId, ...params, rehearsal.revision],
          );
          if (mutated.rowCount !== 1) {
            throw new Jao7AutonomyError('STATE_CONFLICT');
          }

          // A TERMINAL run keeps its terminal state. A safety rollback cleans the sandbox up; it
          // does not resurrect the run, and moving a killed run to ROLLING_BACK would contradict
          // the kill-consistency constraint as well as the meaning of the word.
          const terminal =
            run.state === 'KILLED' || run.state === 'EXPIRED' || run.state === 'COMPLETED';
          const nextRunState =
            request.operationKind === 'APPLY_REHEARSAL'
              ? 'REHEARSAL_APPLIED'
              : request.operationKind === 'VERIFY_REHEARSAL'
                ? 'VERIFYING'
                : 'ROLLING_BACK';
          const runSets = terminal
            ? request.operationKind === 'APPLY_REHEARSAL'
              ? 'rehearsal_applies = rehearsal_applies + 1'
              : ''
            : request.operationKind === 'APPLY_REHEARSAL'
              ? 'state = $4, rehearsal_applies = rehearsal_applies + 1'
              : 'state = $4';

          const moved = await bumpRun(
            client,
            request.runId,
            request.expectedRevision,
            runSets,
            terminal ? [] : [nextRunState],
            at,
          );

          return await writeReplay(
            client,
            request.operationId,
            request.operationKind,
            request.runId,
            digest,
            moved,
            at,
          );
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },

    async readRun(runId: string): Promise<Jao7RunView> {
      // Parsed BEFORE a connection is borrowed. Parameterized SQL makes a malformed id safe, which
      // is not the same as the adapter having checked its own domain boundary.
      const id = jao7IdSchema.safeParse(runId);
      if (!id.success) {
        throw new Jao7AutonomyError('REQUEST_INVALID');
      }

      try {
        return await withClient(pool, async (client) => {
          const runRows = await client.query<RunRow>(
            `SELECT * FROM ${SCHEMA}.autonomy_run WHERE run_id = $1`,
            [id.data],
          );
          const runRow = runRows.rows[0];
          if (runRow === undefined) {
            throw new Jao7AutonomyError('RUN_NOT_FOUND');
          }
          const steps = await client.query<StepRow>(SELECT_STEPS, [id.data]);
          const evaluations = await client.query<EvaluationRow>(SELECT_EVALUATIONS, [id.data]);
          const authority = await client.query<AuthorityRow>(SELECT_AUTHORITY, [id.data]);
          const rehearsal = await client.query<RehearsalRow>(SELECT_REHEARSAL, [id.data]);

          const authorityRow = authority.rows[0];
          const rehearsalRow = rehearsal.rows[0];

          return Object.freeze({
            run: decodeRun(runRow),
            steps: Object.freeze(steps.rows.map(decodeStep)),
            evaluations: Object.freeze(evaluations.rows.map(decodeEvaluation)),
            authority: authorityRow === undefined ? null : decodeAuthority(authorityRow),
            rehearsal: rehearsalRow === undefined ? null : decodeRehearsal(rehearsalRow),
          });
        });
      } catch (error) {
        throw classifyJao7DatabaseError(error);
      }
    },
  });
}
