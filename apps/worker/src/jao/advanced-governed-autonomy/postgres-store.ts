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
  type Jao7OperationKind,
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
  readonly specialist_task_reason_code: string | null;
  readonly specialist_task_class: string | null;
  readonly specialist_due_window_code: string | null;
  readonly specialist_priority_band: string | null;
  readonly specialist_advisory_digest: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface StepRow {
  readonly step_index: number;
  readonly attempt_index: number;
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
  readonly attempt_index: number;
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
  readonly rollback_attempted_at: string | null;
  readonly rolled_back_at: string | null;
  readonly rollback_attempts: number;
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
    specialistTaskReasonCode: row.specialist_task_reason_code,
    specialistTaskClass: row.specialist_task_class,
    specialistDueWindowCode: row.specialist_due_window_code,
    specialistPriorityBand: row.specialist_priority_band,
    specialistAdvisoryDigest: row.specialist_advisory_digest,
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
    attemptIndex: row.attempt_index,
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
    attemptIndex: row.attempt_index,
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
    rollbackAttemptedAt: toNullableInstant(row.rollback_attempted_at),
    rolledBackAt: toNullableInstant(row.rolled_back_at),
    rollbackAttempts: row.rollback_attempts,
    revision: row.revision,
  });
  if (!parsed.success) {
    throw new Jao7AutonomyError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

// ---------------------------------------------------------------------------
// Semantic digests.
// ---------------------------------------------------------------------------

/**
 * THE canonical semantic digest of one mutation.
 *
 * ### What it is for
 *
 * An operation id is a PROMISE: "this id means this exact change". The replay guard keeps that
 * promise by comparing a digest, so the digest has to cover everything the change is made of. The
 * digests it replaced covered a subset -- `CREATE_RUN` omitted the lifetime, the rehearsal class and
 * the captured before-state; `FINALIZE_STEP` omitted the expected revision, the evaluator code, the
 * plan progression and the proposal binding; `RESUME_RUN` omitted the resume bound; `CLAIM_STEP` had
 * no digest at all. Every omitted field was a field an operation id could be reused to change while
 * the guard reported an exact replay and returned the FIRST call's committed result.
 *
 * ### The two deliberate exclusions
 *
 * `nowMs` is excluded because a retry legitimately happens at a different instant, and a digest that
 * moved with the clock would turn every honest replay into a conflict. The operation id itself is
 * excluded because it is the KEY the digest is stored under: hashing the key into the value would
 * make every lookup match itself and prove nothing.
 *
 * `expectedRevision` is INCLUDED. The same id used at a different revision is the same id meaning a
 * different change to a different state of the run, and that is exactly what a conflict is.
 *
 * Field NAMES are hashed alongside their values and the pairs are sorted, so adding a field changes
 * the digest even when its value is empty, and reordering the call site changes nothing.
 */
function semanticDigest(
  kind: Jao7OperationKind,
  runId: string,
  fields: readonly (readonly [string, string])[],
): string {
  const sorted = [...fields].sort((left, right) => (left[0] < right[0] ? -1 : 1));
  const parts: string[] = ['JAO7_SEMANTIC_V1', kind, runId];
  for (const [name, value] of sorted) {
    parts.push(name, value);
  }
  return jao7Digest(parts);
}

function optional(value: string | null | undefined): string {
  return value === null || value === undefined ? 'ABSENT' : `PRESENT:${value}`;
}

function integer(value: number | null | undefined): string {
  return value === null || value === undefined ? 'ABSENT' : `PRESENT:${String(value)}`;
}

/** INTERNAL, and exported so a spec can prove every governing field is actually covered. */
export function jao7CreateRunDigest(request: Jao7CreateRunRequest): string {
  return semanticDigest('CREATE_RUN', request.runId, [
    ['missionPolicyId', request.missionPolicyId],
    ['missionPolicyVersion', String(request.missionPolicyVersion)],
    ['missionPolicyDigest', request.missionPolicyDigest],
    ['planDigest', request.planDigest],
    ['subjectType', request.subjectType],
    ['subjectId', request.subjectId],
    ['lifetimeSeconds', String(request.lifetimeSeconds)],
    ['rehearsalClass', request.rehearsalClass],
    ['beforeIntegerA', String(request.beforeIntegerA)],
    ['beforeIntegerB', integer(request.beforeIntegerB)],
  ]);
}

/**
 * The claim is the ONE mutation whose digest omits `expectedRevision`, and it omits it deliberately.
 *
 * A claim is committed separately from the work it authorises -- that is the whole three-phase
 * design -- so a process lost between the two leaves a claim that DID commit and a revision that DID
 * move. A retry under the same operation id re-reads the run, sees the higher revision, and would
 * compute a different digest: an honest retry would be refused as a conflict, and the replay this
 * finding exists to make possible could never be served. The revision is the precondition that
 * decides whether a claim may proceed, and it is still checked under the lock; it is not part of
 * what the operation id promises.
 *
 * What the id promises is fully covered: this run, this plan position, this step type, this plan
 * digest, this charge and these bounds. There is no field left through which the same id could be
 * made to claim something else.
 */
export function jao7ClaimStepDigest(request: Jao7ClaimStepRequest): string {
  return semanticDigest('CLAIM_STEP', request.runId, [
    ['planDigest', request.planDigest],
    ['stepIndex', String(request.stepIndex)],
    ['stepType', request.stepType],
    ['charge', request.charge],
    ['toolCallCount', String(request.toolCallCount)],
    ['maxSpecialistCalls', String(request.maxSpecialistCalls)],
    ['maxToolCalls', String(request.maxToolCalls)],
    ['maxSteps', String(request.maxSteps)],
  ]);
}

export function jao7FinalizeStepDigest(request: Jao7FinalizeStepRequest): string {
  const binding = request.proposalBinding;
  const observation = request.specialistObservation;
  return semanticDigest('FINALIZE_STEP', request.runId, [
    ['expectedRevision', String(request.expectedRevision)],
    ['stepIndex', String(request.stepIndex)],
    ['stepStatus', request.stepStatus],
    ['outcomeCode', request.outcomeCode],
    ['evaluatorCode', request.evaluatorCode],
    ['verdict', request.verdict],
    ['nextState', request.nextState],
    ['planProgression', request.planProgression],
    ['bindingRecommendationId', optional(binding?.recommendationId)],
    ['bindingProposedActionId', optional(binding?.proposedActionId)],
    ['bindingActionFingerprint', optional(binding?.actionFingerprint)],
    ['specialistTaskReasonCode', optional(observation?.taskReasonCode)],
    ['specialistTaskClass', optional(observation?.taskClass)],
    ['specialistDueWindowCode', optional(observation?.dueWindowCode)],
    ['specialistPriorityBand', optional(observation?.priorityBand)],
    ['specialistAdvisoryDigest', optional(observation?.advisoryDigest)],
  ]);
}

export function jao7RecordAuthorityDigest(request: Jao7RecordAuthorityRequest): string {
  return semanticDigest('RECORD_AUTHORITY', request.runId, [
    ['expectedRevision', String(request.expectedRevision)],
    ['approvalDecisionDigest', request.approvalDecisionDigest],
    ['executionIntentDigest', optional(request.executionIntentDigest)],
    ['recommendationId', request.recommendationId],
    ['proposedActionId', request.proposedActionId],
    ['actionFingerprint', request.actionFingerprint],
    ['observationCode', request.observationCode],
  ]);
}

export function jao7PauseRunDigest(request: Jao7OperationEnvelope & { runId: string }): string {
  return semanticDigest('PAUSE_RUN', request.runId, [
    ['expectedRevision', String(request.expectedRevision)],
  ]);
}

export function jao7ResumeRunDigest(
  request: Jao7OperationEnvelope & { runId: string; maxResumes: number },
): string {
  return semanticDigest('RESUME_RUN', request.runId, [
    ['expectedRevision', String(request.expectedRevision)],
    ['maxResumes', String(request.maxResumes)],
  ]);
}

export function jao7KillRunDigest(request: Jao7OperationEnvelope & { runId: string }): string {
  return semanticDigest('KILL_RUN', request.runId, [
    ['expectedRevision', String(request.expectedRevision)],
  ]);
}

export function jao7RehearsalDigest(request: Jao7RehearsalMutationRequest): string {
  return semanticDigest(request.operationKind, request.runId, [
    ['expectedRevision', String(request.expectedRevision)],
    ['nextRehearsalState', request.nextRehearsalState],
    ['afterIntegerA', integer(request.afterIntegerA)],
    ['afterIntegerB', integer(request.afterIntegerB)],
    ['rollbackIntegerA', integer(request.rollbackIntegerA)],
    ['rollbackIntegerB', integer(request.rollbackIntegerB)],
    ['maxRehearsalApplies', String(request.maxRehearsalApplies)],
    ['maxRollbackAttempts', String(request.maxRollbackAttempts)],
  ]);
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
    (run_id, step_index, attempt_index, step_type, step_status, operation_id, started_at)
  VALUES ($1, $2, $3, $4, 'CLAIMED', $5, $6::timestamptz)
  ON CONFLICT DO NOTHING
  RETURNING step_index, attempt_index, step_type, step_status, started_at, completed_at,
         outcome_code
`;

/** The latest attempt at one plan position, whatever became of it. */
const SELECT_LATEST_ATTEMPT = `
  SELECT step_index, attempt_index, step_type, step_status, started_at, completed_at,
         outcome_code
    FROM ${SCHEMA}.autonomy_step
   WHERE run_id = $1 AND step_index = $2
   ORDER BY attempt_index DESC
   LIMIT 1
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
  SELECT step_index, attempt_index, step_type, step_status, started_at, completed_at,
         outcome_code
    FROM ${SCHEMA}.autonomy_step WHERE run_id = $1 ORDER BY step_index, attempt_index
`;

const SELECT_EVALUATIONS = `
  SELECT evaluation_index, step_index, evaluator_code, verdict, observed_at
    FROM ${SCHEMA}.autonomy_evaluation WHERE run_id = $1 ORDER BY evaluation_index
`;

/**
 * The AUTHORITATIVE observation for a run.
 *
 * A successful chain if one was ever recorded, otherwise the most recent attempt. Ordering the
 * success first is not cosmetic: at most one can exist, by a partial unique index, and it is the row
 * every eligibility decision is made against. Reporting a later failed attempt as the run's
 * observation would hide the fact that the chain HAD been proven.
 */
const SELECT_AUTHORITY = `
  SELECT attempt_index, approval_decision_digest, execution_intent_digest, recommendation_id,
         proposed_action_id, action_fingerprint, observation_code, observed_at
    FROM ${SCHEMA}.authority_observation
   WHERE run_id = $1
   ORDER BY (observation_code = 'CORRELATED_APPROVED_ACTION_AND_INTENT') DESC, attempt_index DESC
   LIMIT 1
`;

const SELECT_NEXT_AUTHORITY_ATTEMPT = `
  SELECT coalesce(max(attempt_index) + 1, 0) AS next_attempt
    FROM ${SCHEMA}.authority_observation WHERE run_id = $1
`;

const SELECT_REHEARSAL = `
  SELECT rehearsal_class, before_integer_a, before_integer_b, after_integer_a, after_integer_b,
         rollback_integer_a, rollback_integer_b, state, applied_at, verified_at,
         rollback_attempted_at, rolled_back_at, rollback_attempts, revision
    FROM ${SCHEMA}.virtual_rehearsal_state WHERE run_id = $1
`;

const SELECT_REHEARSAL_FOR_UPDATE = `${SELECT_REHEARSAL} FOR UPDATE`;

/**
 * One row per attempt.
 *
 * `ON CONFLICT DO NOTHING` now catches BOTH arbitration constraints: the per-attempt primary key,
 * and the partial unique index that permits at most one successful chain per run. A second success
 * therefore writes nothing and is refused, while a second INCOMPLETE attempt is recorded -- which is
 * the whole point, because the first incomplete attempt used to consume the only slot and lock the
 * run out of ever recording the exact chain it was waiting for.
 */
const INSERT_AUTHORITY = `
  INSERT INTO ${SCHEMA}.authority_observation
    (run_id, attempt_index, approval_decision_digest, execution_intent_digest, recommendation_id,
     proposed_action_id, action_fingerprint, observation_code, observed_at)
  VALUES ($1, $2, $3, $4::text, $5, $6, $7, $8, $9::timestamptz)
  ON CONFLICT DO NOTHING
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

async function loadRun(client: DatabaseClient, runId: string): Promise<Jao7RunRecord> {
  const found = await client.query<RunRow>(
    `SELECT * FROM ${SCHEMA}.autonomy_run WHERE run_id = $1`,
    [runId],
  );
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

/**
 * Serve a claim that THIS operation id already committed.
 *
 * The replay record is the authority, not the presence of a step row. A `CLAIMED` row created by a
 * DIFFERENT operation id is another caller's in-flight work and must be refused, and a record whose
 * digest disagrees is the same id being reused to mean something else.
 *
 * The run is returned as it stood when the claim committed -- read back through the replay record's
 * revision, never from a header that has moved on -- and `priorState` reports the state the claim
 * moved the run OUT of, which is what a later eligibility check needs.
 */
async function replayedClaim(
  client: DatabaseClient,
  request: Jao7ClaimStepRequest,
  digest: string,
  locked: boolean,
): Promise<Jao7ClaimedStep | null> {
  const found = await client.query<ReplayRow>(SELECT_REPLAY, [request.operationId]);
  const prior = found.rows[0];
  if (prior === undefined) {
    return null;
  }
  if (
    prior.operation_kind !== 'CLAIM_STEP' ||
    prior.run_id !== request.runId ||
    prior.semantic_digest !== digest
  ) {
    throw new Jao7AutonomyError('OPERATION_CONFLICT');
  }

  const run = locked
    ? await loadRunForUpdate(client, request.runId)
    : await loadRun(client, request.runId);

  // The attempt this id claimed is the one whose revision the replay record names. The claim bumped
  // the run by exactly one, so the attempt that existed before it is the one below that.
  const attempt = await client.query<StepRow>(SELECT_LATEST_ATTEMPT, [
    request.runId,
    request.stepIndex,
  ]);
  const row = attempt.rows[0];
  if (row === undefined) {
    // A replay record without its step is a contradiction the same transaction wrote atomically.
    throw new Jao7AutonomyError('PERSISTED_STATE_INVALID');
  }

  return Object.freeze({
    run,
    step: decodeStep(row),
    // The claim commits `IN_PROGRESS`, so the state the run was moved out of is not readable from
    // the header any more. `PLANNED` is never the answer for a replay -- the claim already ran --
    // and reporting the live state would let a replayed claim inherit an eligibility it never had.
    priorState: 'IN_PROGRESS' as const,
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
      const digest = jao7CreateRunDigest(request);

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
      const digest = jao7ClaimStepDigest(request);

      try {
        return await withTransaction(pool, async (client) => {
          // The replay guard runs BEFORE the lock, as it does for every other mutation: two callers
          // retrying the same claim can both pass here, and without the re-check below the loser
          // would serialise behind the winner and then fail as a false `REVISION_CONFLICT`.
          const early = await replayedClaim(client, request, digest, false);
          if (early !== null) {
            return early;
          }

          // THE LOCK. Everything below happens with the run row held, so a concurrent claim, kill or
          // finalize for the same run serialises here rather than racing.
          const run = await loadRunForUpdate(client, request.runId);

          const raced = await replayedClaim(client, request, digest, true);
          if (raced !== null) {
            return raced;
          }

          // Governance FIRST, and all of it. This is the ordering that was wrong: an existing
          // `CLAIMED` row used to return `replayed: true` before any of these ran, whatever
          // operation id had created it -- so a killed, expired, superseded or plan-drifted run
          // handed back a claim, and the coordinator went on to do the step's work again.
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

          // WHICH ATTEMPT THIS IS, decided from what the table actually contains rather than from
          // anything the caller believes. A plan position is re-attemptable only when the previous
          // attempt FINISHED and the finalize deliberately RETAINED the position -- an unfinished
          // attempt belongs to somebody else's operation id, and this one is not it.
          const latest = await client.query<StepRow>(SELECT_LATEST_ATTEMPT, [
            request.runId,
            request.stepIndex,
          ]);
          const latestRow = latest.rows[0];
          if (latestRow?.step_status === 'CLAIMED') {
            throw new Jao7AutonomyError('STEP_ALREADY_CLAIMED');
          }
          const attemptIndex = latestRow === undefined ? 0 : latestRow.attempt_index + 1;

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
            attemptIndex,
            request.stepType,
            request.operationId,
            at,
          ]);
          const claimedRow = claimed.rows[0];
          if (claimedRow === undefined) {
            // An arbitration constraint decided: either the per-attempt primary key, or the partial
            // unique index that permits at most one unfinished attempt per plan position.
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

          // The claim writes a replay record like every other mutation. That record is what makes
          // the operation id a promise about THIS step: a retry replays it, and the same id used for
          // a different step, revision or budget is `OPERATION_CONFLICT` with zero further writes.
          await writeReplay(
            client,
            request.operationId,
            'CLAIM_STEP',
            request.runId,
            digest,
            moved,
            at,
          );

          return Object.freeze({
            run: moved,
            step: decodeStep(claimedRow),
            priorState: run.state,
            replayed: false,
          });
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
      const digest = jao7FinalizeStepDigest(request);

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
          if (request.planProgression === 'ADVANCE') {
            parts.push('current_step_index = current_step_index + 1');
          }
          if (request.nextState === 'PAUSED') {
            parts.push('paused_at = $2::timestamptz');
          } else {
            parts.push('paused_at = NULL');
          }
          // THE DERIVED SPECIALIST OBSERVATION, written exactly once with the step that produced
          // it. Writing it here rather than in its own mutation is what makes it atomic with the
          // step: a run cannot end up with a committed specialist step and no conclusion, or a
          // conclusion attributed to a step that was rolled back.
          const observation = request.specialistObservation;
          if (observation !== undefined) {
            if (run.specialistAdvisoryDigest !== null) {
              throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
            }
            parts.push(
              `specialist_task_reason_code = $${String(params.length + 4)}`,
              `specialist_task_class = $${String(params.length + 5)}`,
              `specialist_due_window_code = $${String(params.length + 6)}`,
              `specialist_priority_band = $${String(params.length + 7)}`,
              `specialist_advisory_digest = $${String(params.length + 8)}`,
            );
            params.push(
              observation.taskReasonCode,
              observation.taskClass,
              observation.dueWindowCode,
              observation.priorityBand,
              observation.advisoryDigest,
            );
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
      const digest = jao7PauseRunDigest(request);

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

          // A PAUSE MAY NOT STRAND APPLIED SYNTHETIC STATE.
          //
          // The evaluator already refuses a cooperative pause between an apply and its verification,
          // but `pauseRun` is a separate public entry point that did not consult the sandbox at all
          // -- so a caller could pause a run whose virtual state was applied and unverified, and
          // leave it that way indefinitely. A control that strands the state it created is not a
          // control. Verify it or roll it back; both are explicit calls, and both are available.
          const sandbox = await client.query<RehearsalRow>(SELECT_REHEARSAL, [request.runId]);
          const sandboxRow = sandbox.rows[0];
          if (
            sandboxRow !== undefined &&
            (sandboxRow.state === 'APPLIED' || sandboxRow.state === 'ROLLBACK_REQUIRED')
          ) {
            throw new Jao7AutonomyError('STATE_CONFLICT');
          }

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
      const digest = jao7ResumeRunDigest(request);

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
      const digest = jao7KillRunDigest(request);

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
      const digest = jao7RecordAuthorityDigest(request);

      try {
        return await withTransaction(pool, async (client) => {
          const replayed = await replayGuard(
            client,
            request.operationId,
            'RECORD_AUTHORITY',
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
            'RECORD_AUTHORITY',
            request.runId,
            digest,
          );
          if (raced !== null) {
            return raced;
          }

          assertRevision(run, request.expectedRevision);
          assertForwardEligible(run, nowMs);

          // ONE ROW PER ATTEMPT, and at most ONE successful chain per run.
          //
          // The table used to be keyed by `run_id` alone, so the FIRST attempt -- incomplete,
          // rejected, whatever it was -- consumed the only slot, and a run still legitimately
          // awaiting authority could never record the exact chain when it finally arrived. The
          // arbitration that actually matters is narrower and now lives in a partial unique index:
          // a second correlation binding a DIFFERENT action to the same run as a SUCCESS is the
          // substitution this whole slice exists to prevent, and the database refuses that.
          const nextAttempt = await client.query<{ readonly next_attempt: number }>(
            SELECT_NEXT_AUTHORITY_ATTEMPT,
            [request.runId],
          );
          const attemptIndex = nextAttempt.rows[0]?.next_attempt ?? 0;

          const inserted = await client.query(INSERT_AUTHORITY, [
            request.runId,
            attemptIndex,
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
            'RECORD_AUTHORITY',
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
      const digest = jao7RehearsalDigest(request);

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
          if (request.operationKind === 'ROLLBACK_REHEARSAL') {
            // Only applied synthetic state can be restored. A sandbox that was never applied, or was
            // already rolled back, or whose one attempt already failed, has nothing to restore --
            // and a rollback that ran anyway would be a write dressed as a cleanup.
            if (rehearsal.state !== 'APPLIED' && rehearsal.state !== 'ROLLBACK_REQUIRED') {
              throw new Jao7AutonomyError('ROLLBACK_NOT_ELIGIBLE');
            }
            // ONE ATTEMPT, counted in the row and bounded by the reviewed policy AND by a database
            // CHECK. `maxRollbackAttempts` used to live on the policy and nowhere else, which made
            // it a documented number rather than a control: a restart forgot it entirely.
            if (rehearsal.rollbackAttempts + 1 > request.maxRollbackAttempts) {
              throw new Jao7AutonomyError('BUDGET_EXHAUSTED');
            }
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
            // ATTEMPTED and SUCCEEDED are separate facts, and only a SUCCESSFUL rollback records a
            // restored value. Writing the observed value on a failure would say the captured state
            // had been restored when it had not -- and the row would then violate its own CHECK,
            // which is how `ROLLBACK_FAILED` came to be a state that could not be persisted at all.
            sets.push(`rollback_attempted_at = $${String(index)}::timestamptz`);
            params.push(at);
            index += 1;
            sets.push('rollback_attempts = rollback_attempts + 1');
            if (request.nextRehearsalState === 'ROLLED_BACK') {
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
                : request.nextRehearsalState === 'ROLLED_BACK'
                  ? 'ROLLING_BACK'
                  : // A rollback that did NOT restore the captured state is terminal and safe. There
                    // is no second attempt to schedule, and leaving the run mid-rollback would
                    // describe a cleanup that is still in progress when nothing further will happen.
                    'FAILED_SAFE';
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
