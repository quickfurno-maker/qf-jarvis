/**
 * The JAO-7 advanced autonomy coordinator (ADR-0121).
 *
 * ### The control loop, and where it stops
 *
 *   bounded mission
 *     -> static policy-bounded plan
 *     -> bounded evidence / governed specialist work
 *     -> continuous evaluation after every step
 *     -> canonical remediation RecommendationV1
 *     -> canonical POWERLESS ApprovalRequestV1
 *     -> PAUSE
 *     -> externally supplied Core authority artifacts
 *     -> exact approval + execution-intent correlation
 *     -> OFFLINE REVERSIBLE REHEARSAL ONLY
 *     -> verify
 *     -> success OR automatic virtual rollback
 *     -> terminal audited state.
 *
 * ### Nothing progresses on its own
 *
 * Every transition is an explicit call. There is no `setInterval`, no cron entry, no queue consumer,
 * no webhook, no ambient `EventEmitter` subscription and no daemon loop anywhere in this slice. A
 * paused run resumes when somebody resumes it, and a run awaiting authority waits forever if nobody
 * answers -- because silence is never consent and there is no timeout that ripens a request into an
 * approval.
 *
 * ### The three-phase step, and why the transaction is not held across work
 *
 * PHASE A claims the step under a row lock: state, kill, expiry, pause, plan digest, step eligibility
 * and budget, all re-checked under the lock and committed. PHASE B does the bounded work with NO
 * transaction open -- a Riya delegation or a workbench read must never hold a database lock. PHASE C
 * finalises exactly once, records the evaluation, and moves the run.
 *
 * A crash between A and B leaves a visible `CLAIMED` step and a spent budget. That is the
 * conservative direction: a spent budget costs an explicit resume, an unspent one costs a second
 * specialist call nobody authorised.
 *
 * ### Composition is PINNED
 *
 * The public entry points take a `DatabasePool`, a clock and optional content-free telemetry. There
 * is no parameter for a planner, a mission registry, a policy, a recommendation runtime, an approval
 * runtime, an execution-intent runtime, a JAO-2 registry or adapter, a JAO-4 tool implementation, an
 * evaluator, a rehearsal effect, a rollback effect or a raw store. The canonical composition is
 * constructed here from this module's own imports, so there is nothing to displace -- and an
 * optional dependency defaulted with `??` is a pin only until somebody passes a value.
 */
import type { DatabasePool } from '@qf-jarvis/event-backbone';

import {
  createJao2RiyaSpecialistAdapter,
  createJao2SpecialistRegistry,
  runJao2GovernedDelegation,
  type Jao2RunResult,
} from '../governed-specialist-delegation/index.js';
import { runJao4Workbench, type Jao4WorkbenchResult } from '../sandbox-tool-workbench/index.js';

import {
  JAO7_POSTURE,
  Jao7AutonomyError,
  type Jao7EvaluationVerdict,
  type Jao7RunState,
  type Jao7StepType,
} from './contracts.js';
import { correlateJao7Authority, type Jao7AuthorityEvidence } from './authority.js';
import { decideJao7Capacity, jao7CapacityObservationSchema } from './capacity.js';
import { evaluateJao7Step } from './evaluator.js';
import {
  createJao7MissionRegistry,
  jao7MissionDigest,
  jao7PlanDigest,
  jao7PlanFor,
  type Jao7MissionRegistry,
} from './mission-registry.js';
import type { Jao7MissionPolicy } from './mission-policy.js';
import { createJao7PostgresStore } from './postgres-store.js';
import { buildJao7Proposal, type Jao7Proposal } from './proposal.js';
import {
  jao7RehearsalTarget,
  jao7RollbackTarget,
  jao7VerifyRehearsal,
  jao7VerifyRollback,
} from './rehearsal.js';
import {
  jao7AutonomyRequestSchema,
  jao7CreateRunRequestSchema,
  type Jao7AdvanceRequest,
  type Jao7AutonomyResult,
  type Jao7CreateRunRequest as Jao7CreateRequest,
  type Jao7TelemetryHook,
} from './public-contracts.js';
import type { Jao7AutonomyStore, Jao7RunView } from './store-port.js';

/** A clock. Injectable so a test is deterministic; it supplies TIME and states no semantics. */
export interface Jao7Clock {
  nowMs(): number;
}

/** What a PUBLIC entry point needs: trusted infrastructure boundaries only. */
export interface Jao7AutonomyDependencies {
  readonly pool: DatabasePool;
  readonly clock: Jao7Clock;
  readonly telemetry?: Jao7TelemetryHook;
}

/**
 * The INTERNAL composition. Trusted, source-level, and exported from no barrel.
 *
 * Adapter implementations and direct-path tests need to exercise the raw store and count specialist
 * or tool invocations; the public surface must not be able to reach any of it.
 */
export interface Jao7InternalComposition {
  readonly store: Jao7AutonomyStore;
  readonly clock: Jao7Clock;
  readonly registry: Jao7MissionRegistry;
  readonly telemetry?: Jao7TelemetryHook;
  /** Test seam only. The canonical JAO-2 delegation is used when absent. */
  readonly delegate?: typeof runJao2GovernedDelegation;
  /** Test seam only. The canonical JAO-4 workbench is used when absent. */
  readonly workbench?: typeof runJao4Workbench;
}

function canonicalComposition(dependencies: Jao7AutonomyDependencies): Jao7InternalComposition {
  return {
    store: createJao7PostgresStore(dependencies.pool),
    clock: dependencies.clock,
    registry: createJao7MissionRegistry(),
    ...(dependencies.telemetry === undefined ? {} : { telemetry: dependencies.telemetry }),
  };
}

function resolvePolicy(
  registry: Jao7MissionRegistry,
  missionPolicyId: string,
  missionPolicyVersion: number,
): Jao7MissionPolicy {
  const lookup = registry.lookup(missionPolicyId, missionPolicyVersion);
  if (lookup.found === 'UNKNOWN') {
    throw new Jao7AutonomyError('MISSION_UNKNOWN');
  }
  if (lookup.found === 'VERSION_MISMATCH') {
    throw new Jao7AutonomyError('MISSION_VERSION_MISMATCH');
  }
  // Availability, checked BEFORE any work. A mission nobody activated must not reach the producer,
  // the specialist or the sandbox at all, so "planned" cannot become "ran but was discarded".
  if (lookup.policy.availability !== 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY') {
    throw new Jao7AutonomyError('MISSION_NOT_ACTIVE');
  }
  return lookup.policy;
}

function toRefusal(error: unknown): Jao7AutonomyError {
  return error instanceof Jao7AutonomyError ? error : new Jao7AutonomyError('STORE_FAILED');
}

/** The terminal outcome a run's durable state implies. Derived, never stored as a claim. */
function outcomeFor(view: Jao7RunView): Jao7AutonomyResult['outcome'] {
  switch (view.run.state) {
    case 'KILLED':
      return 'KILLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'PAUSED':
      return 'PAUSED';
    case 'AWAITING_AUTHORITY':
      return 'AWAITING_AUTHORITY';
    case 'FAILED_SAFE':
      return 'FAILED_SAFE';
    case 'COMPLETED':
      return view.rehearsal?.state === 'ROLLED_BACK'
        ? 'ROLLED_BACK_REHEARSAL'
        : 'COMPLETED_REHEARSAL';
    default:
      return 'IN_PROGRESS';
  }
}

function buildResult(
  view: Jao7RunView,
  refusalReason: Jao7AutonomyResult['refusalReason'],
  proposal: Jao7Proposal | null = null,
): Jao7AutonomyResult {
  return Object.freeze({
    runId: view.run.runId,
    missionPolicyId: view.run.missionPolicyId,
    missionPolicyVersion: view.run.missionPolicyVersion,
    missionPolicyDigest: view.run.missionPolicyDigest,
    planDigest: view.run.planDigest,
    state: view.run.state,
    outcome: refusalReason === null ? outcomeFor(view) : 'REFUSED',
    refusalReason,
    currentStepIndex: view.run.currentStepIndex,
    revision: view.run.revision,
    stepsCompleted: view.run.stepsCompleted,
    specialistCalls: view.run.specialistCalls,
    toolCalls: view.run.toolCalls,
    modelCalls: view.run.modelCalls,
    rehearsalApplies: view.run.rehearsalApplies,
    steps: view.steps,
    evaluations: view.evaluations,
    authorityObservation: view.authority,
    rehearsal: view.rehearsal,
    proposal,
    authoritySourcePosture: 'INJECTED_OFFLINE_CORE_FIXTURE' as const,
    posture: JAO7_POSTURE,
  });
}

function emit(
  composition: Jao7InternalComposition,
  view: Jao7RunView,
  stepType: Jao7StepType | null,
  verdict: Jao7EvaluationVerdict | null,
): void {
  const hook = composition.telemetry;
  if (hook === undefined) {
    return;
  }
  // CONTENT-FREE. Ids, codes, digests and counters -- never a specialist's reason string, an
  // artifact excerpt, a raw approval or intent, or a database message.
  hook.record({
    runId: view.run.runId,
    missionPolicyId: view.run.missionPolicyId,
    missionPolicyDigest: view.run.missionPolicyDigest,
    planDigest: view.run.planDigest,
    state: view.run.state,
    stepType,
    verdict,
    stepsCompleted: view.run.stepsCompleted,
    specialistCalls: view.run.specialistCalls,
    toolCalls: view.run.toolCalls,
    modelCalls: view.run.modelCalls,
    rehearsalApplies: view.run.rehearsalApplies,
    businessEffect: false,
    productionMutation: false,
  });
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Jao7AutonomyError('CANCELLED');
  }
}

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINTS.
// ---------------------------------------------------------------------------

/** Create a durable autonomy run. Captures the virtual sandbox before anything can apply. */
export async function createJao7AutonomyRun(
  request: unknown,
  dependencies: Jao7AutonomyDependencies,
): Promise<Jao7AutonomyResult> {
  return createJao7AutonomyRunInternal(request, canonicalComposition(dependencies));
}

/** Advance the run by exactly ONE step. Never more, and never on its own. */
export async function advanceJao7AutonomyRun(
  request: unknown,
  dependencies: Jao7AutonomyDependencies,
  signal?: AbortSignal,
): Promise<Jao7AutonomyResult> {
  return advanceJao7AutonomyRunInternal(request, canonicalComposition(dependencies), signal);
}

/** Resume a paused run, or supply externally issued Core authority artifacts. */
export async function resumeJao7AutonomyRun(
  request: unknown,
  dependencies: Jao7AutonomyDependencies,
  signal?: AbortSignal,
): Promise<Jao7AutonomyResult> {
  return resumeJao7AutonomyRunInternal(request, canonicalComposition(dependencies), signal);
}

/** Pause a run. Durable, and resumed only explicitly. */
export async function pauseJao7AutonomyRun(
  request: unknown,
  dependencies: Jao7AutonomyDependencies,
): Promise<Jao7AutonomyResult> {
  return pauseJao7AutonomyRunInternal(request, canonicalComposition(dependencies));
}

/** Kill a run. Terminal, durable, irreversible. There is no `unkill` anywhere in this slice. */
export async function killJao7AutonomyRun(
  request: unknown,
  dependencies: Jao7AutonomyDependencies,
): Promise<Jao7AutonomyResult> {
  return killJao7AutonomyRunInternal(request, canonicalComposition(dependencies));
}

/** Read the whole run: header, steps, evaluations, authority observation and sandbox. */
export async function readJao7AutonomyRun(
  runId: string,
  dependencies: Jao7AutonomyDependencies,
): Promise<Jao7AutonomyResult> {
  return readJao7AutonomyRunInternal(runId, canonicalComposition(dependencies));
}

// ---------------------------------------------------------------------------
// INTERNAL variants. Same governance; a trusted source-level caller supplies the composition.
// ---------------------------------------------------------------------------

export async function createJao7AutonomyRunInternal(
  request: unknown,
  composition: Jao7InternalComposition,
): Promise<Jao7AutonomyResult> {
  const parsed = jao7CreateRunRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const stated: Jao7CreateRequest = parsed.data;

  const policy = resolvePolicy(
    composition.registry,
    stated.missionPolicyId,
    stated.missionPolicyVersion,
  );

  if (!policy.allowedSubjectTypes.includes(stated.subject.entityType)) {
    throw new Jao7AutonomyError('SUBJECT_NOT_ALLOWED');
  }

  // The sandbox BEFORE state, captured at creation. A rollback target decided later is a rollback
  // target somebody could choose, and the rollback policy says only the captured state may be
  // restored.
  const before =
    policy.rehearsalClass === 'VIRTUAL_OPERATOR_TASK_LEDGER'
      ? { a: 0, b: 0 }
      : { a: stated.initialConcurrency ?? 1, b: null };

  await composition.store.createRun(
    {
      runId: stated.runId,
      operationId: stated.operationId,
      missionPolicyId: policy.missionPolicyId,
      missionPolicyVersion: policy.missionPolicyVersion,
      missionPolicyDigest: jao7MissionDigest(policy),
      planDigest: jao7PlanDigest(policy),
      subjectType: stated.subject.entityType,
      subjectId: stated.subject.entityId,
      lifetimeSeconds: policy.maxLifetimeSeconds,
      rehearsalClass: policy.rehearsalClass,
      beforeIntegerA: before.a,
      beforeIntegerB: before.b,
    },
    composition.clock.nowMs(),
  );

  const view = await composition.store.readRun(stated.runId);
  emit(composition, view, null, null);
  return buildResult(view, null);
}

export async function advanceJao7AutonomyRunInternal(
  request: unknown,
  composition: Jao7InternalComposition,
  signal?: AbortSignal,
): Promise<Jao7AutonomyResult> {
  const parsed = jao7AutonomyRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const stated: Jao7AdvanceRequest = parsed.data;

  const view = await composition.store.readRun(stated.runId);
  if (view.run.state === 'AWAITING_AUTHORITY') {
    // Forward progress from here requires externally supplied Core artifacts, and those arrive
    // through `resume`. Advancing past this state would be JAO-7 deciding it had authority.
    throw new Jao7AutonomyError('STATE_CONFLICT');
  }
  if (view.run.state === 'PAUSED') {
    throw new Jao7AutonomyError('RUN_PAUSED');
  }
  return runOneStep(stated, composition, signal, undefined);
}

export async function resumeJao7AutonomyRunInternal(
  request: unknown,
  composition: Jao7InternalComposition,
  signal?: AbortSignal,
): Promise<Jao7AutonomyResult> {
  const parsed = jao7AutonomyRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const stated: Jao7AdvanceRequest = parsed.data;

  const view = await composition.store.readRun(stated.runId);
  const policy = resolvePolicy(
    composition.registry,
    view.run.missionPolicyId,
    view.run.missionPolicyVersion,
  );

  if (view.run.state === 'PAUSED') {
    await composition.store.resumeRun(
      {
        runId: stated.runId,
        operationId: `${stated.operationId}.resume`,
        expectedRevision: view.run.revision,
        maxResumes: policy.maxResumes,
      },
      composition.clock.nowMs(),
    );
    const resumed = await composition.store.readRun(stated.runId);
    emit(composition, resumed, null, null);
    return buildResult(resumed, null);
  }

  // AWAITING_AUTHORITY resumes by CARRYING the externally issued artifacts, and by nothing else.
  return runOneStep(stated, composition, signal, stated.authority);
}

export async function pauseJao7AutonomyRunInternal(
  request: unknown,
  composition: Jao7InternalComposition,
): Promise<Jao7AutonomyResult> {
  const parsed = jao7AutonomyRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const view = await composition.store.readRun(parsed.data.runId);
  await composition.store.pauseRun(
    {
      runId: parsed.data.runId,
      operationId: parsed.data.operationId,
      expectedRevision: view.run.revision,
    },
    composition.clock.nowMs(),
  );
  const paused = await composition.store.readRun(parsed.data.runId);
  emit(composition, paused, null, null);
  return buildResult(paused, null);
}

export async function killJao7AutonomyRunInternal(
  request: unknown,
  composition: Jao7InternalComposition,
): Promise<Jao7AutonomyResult> {
  const parsed = jao7AutonomyRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const view = await composition.store.readRun(parsed.data.runId);
  await composition.store.killRun(
    {
      runId: parsed.data.runId,
      operationId: parsed.data.operationId,
      expectedRevision: view.run.revision,
    },
    composition.clock.nowMs(),
  );
  const killed = await composition.store.readRun(parsed.data.runId);
  emit(composition, killed, null, null);
  return buildResult(killed, null);
}

export async function readJao7AutonomyRunInternal(
  runId: string,
  composition: Jao7InternalComposition,
): Promise<Jao7AutonomyResult> {
  return buildResult(await composition.store.readRun(runId), null);
}

// ---------------------------------------------------------------------------
// The three-phase step.
// ---------------------------------------------------------------------------

interface StepWork {
  readonly succeeded: boolean;
  readonly outcomeCode: string;
  readonly proposal?: Jao7Proposal;
  readonly authorityCorrelated?: boolean;
  readonly executionIntentCorrelated?: boolean;
  readonly rehearsalApplied?: boolean;
  readonly verificationRan?: boolean;
  readonly verificationPassed?: boolean;
  readonly rollbackRan?: boolean;
  readonly rollbackPassed?: boolean;
  readonly proposalBinding?: {
    readonly recommendationId: string;
    readonly proposedActionId: string;
    readonly actionFingerprint: string;
  };
}

async function runOneStep(
  stated: Jao7AdvanceRequest,
  composition: Jao7InternalComposition,
  signal: AbortSignal | undefined,
  authority: Jao7AuthorityEvidence | undefined,
): Promise<Jao7AutonomyResult> {
  // Cancellation BEFORE the claim costs nothing: no step, no budget, no work.
  assertNotCancelled(signal);

  const opening = await composition.store.readRun(stated.runId);
  const policy = resolvePolicy(
    composition.registry,
    opening.run.missionPolicyId,
    opening.run.missionPolicyVersion,
  );

  // The plan the run was enrolled against, re-proved before anything else.
  const planDigest = jao7PlanDigest(policy);
  if (opening.run.planDigest !== planDigest) {
    throw new Jao7AutonomyError('PLAN_MISMATCH');
  }
  const plan = jao7PlanFor(policy);
  const stepIndex = opening.run.currentStepIndex;

  // ROLLBACK IS A RECOVERY BRANCH, not a plan step.
  //
  // The reviewed plan is the happy path, and keeping it that way is what lets a reader see at a
  // glance what a mission does. When a verification fails the run enters ROLLING_BACK, and the next
  // claimed step is the rollback regardless of what the plan says next -- recorded in the step table
  // under its own type, so the audit trail shows the branch that was actually taken.
  const planned = plan[stepIndex];
  const stepType: Jao7StepType | undefined =
    opening.run.state === 'ROLLING_BACK' ? 'ROLLBACK_REHEARSAL' : planned;
  if (stepType === undefined) {
    throw new Jao7AutonomyError('STEP_NOT_ELIGIBLE');
  }

  // ---- PHASE A: the claim. Under a row lock, committed, then released. --------------------------
  const charge: 'NONE' | 'SPECIALIST' | 'TOOL' =
    stepType === 'DELEGATE_RIYA_ANALYSIS'
      ? 'SPECIALIST'
      : stepType === 'GATHER_VIRTUAL_EVIDENCE'
        ? 'TOOL'
        : 'NONE';

  const claimed = await composition.store.claimStep(
    {
      runId: stated.runId,
      operationId: `${stated.operationId}.claim`,
      expectedRevision: opening.run.revision,
      planDigest,
      stepIndex,
      stepType,
      charge,
      toolCallCount: charge === 'TOOL' ? 1 : 0,
      maxSpecialistCalls: policy.maxSpecialistCalls,
      maxToolCalls: policy.maxToolCalls,
      maxSteps: policy.maxSteps,
    },
    composition.clock.nowMs(),
  );

  // ---- PHASE B: the bounded work. NO transaction is open here. ---------------------------------
  let work: StepWork;
  try {
    work = await performStep(stepType, stated, policy, composition, claimed.run, authority, signal);
  } catch (error) {
    const refusal = toRefusal(error);
    // Cancellation after the claim consumes the claim and finalises it safely rather than leaving a
    // dangling CLAIMED row that a later reader could not distinguish from work in flight.
    await composition.store.finalizeStep(
      {
        runId: stated.runId,
        operationId: `${stated.operationId}.finalize`,
        expectedRevision: claimed.run.revision,
        stepIndex,
        stepStatus: refusal.code === 'CANCELLED' ? 'CANCELLED' : 'REFUSED',
        outcomeCode: refusal.code,
        evaluatorCode: 'STEP_REFUSED',
        verdict: 'FAIL_SAFE',
        nextState: 'FAILED_SAFE',
        advanceStepIndex: false,
      },
      composition.clock.nowMs(),
    );
    const failed = await composition.store.readRun(stated.runId);
    emit(composition, failed, stepType, 'FAIL_SAFE');
    return buildResult(failed, refusal.code);
  }

  // ---- Continuous evaluation. Deterministic, after EVERY step, and durably recorded. ------------
  const current = await composition.store.readRun(stated.runId);
  const evaluation = evaluateJao7Step({
    stepType,
    stepIndex,
    isLastStep: stepIndex === plan.length - 1,
    stepSucceeded: work.succeeded,
    proposalReady: work.proposal !== undefined || current.run.proposalActionFingerprint !== null,
    authorityCorrelated: work.authorityCorrelated ?? current.authority !== null,
    executionIntentCorrelated:
      work.executionIntentCorrelated ??
      current.authority?.observationCode === 'CORRELATED_APPROVED_ACTION_AND_INTENT',
    rehearsalApplied: work.rehearsalApplied ?? current.rehearsal?.state !== 'CAPTURED',
    verificationRan: work.verificationRan ?? false,
    verificationPassed: work.verificationPassed ?? false,
    rollbackRan: work.rollbackRan ?? false,
    rollbackPassed: work.rollbackPassed ?? false,
    pauseRequested: stated.pauseRequested ?? false,
  });

  const nextState = nextStateFor(evaluation.verdict, stepType);

  // ---- PHASE C: finalise exactly once. --------------------------------------------------------
  await composition.store.finalizeStep(
    {
      runId: stated.runId,
      operationId: `${stated.operationId}.finalize`,
      expectedRevision: current.run.revision,
      stepIndex,
      stepStatus: 'COMPLETED',
      outcomeCode: work.outcomeCode,
      evaluatorCode: evaluation.evaluatorCode,
      verdict: evaluation.verdict,
      nextState,
      // A step that COMPLETED is done, so the index always moves on. It is the STATE that decides
      // whether anything may claim the next one -- which is why AWAITING_AUTHORITY blocks `advance`
      // while leaving `resume` a way through, and PAUSED blocks both until somebody resumes.
      advanceStepIndex: true,
      ...(work.proposalBinding === undefined ? {} : { proposalBinding: work.proposalBinding }),
    },
    composition.clock.nowMs(),
  );

  const finished = await composition.store.readRun(stated.runId);
  emit(composition, finished, stepType, evaluation.verdict);
  return buildResult(finished, null, work.proposal ?? null);
}

function nextStateFor(verdict: Jao7EvaluationVerdict, stepType: Jao7StepType): Jao7RunState {
  switch (verdict) {
    case 'PAUSE':
      return 'PAUSED';
    case 'REQUIRE_AUTHORITY':
      return 'AWAITING_AUTHORITY';
    case 'VERIFY':
      return 'REHEARSAL_APPLIED';
    case 'ROLLBACK':
      return 'ROLLING_BACK';
    case 'COMPLETE':
      return 'COMPLETED';
    case 'FAIL_SAFE':
      return 'FAILED_SAFE';
    case 'CONTINUE':
      return stepType === 'VALIDATE_AUTHORITY_EVIDENCE'
        ? 'AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL'
        : 'IN_PROGRESS';
  }
}

export { runOneStep as runJao7StepInternal, performStep as performJao7StepInternal };

// ---------------------------------------------------------------------------
// The work each step does. Bounded, and never inside a transaction.
// ---------------------------------------------------------------------------

async function performStep(
  stepType: Jao7StepType,
  stated: Jao7AdvanceRequest,
  policy: Jao7MissionPolicy,
  composition: Jao7InternalComposition,
  run: Jao7RunView['run'],
  authority: Jao7AuthorityEvidence | undefined,
  signal: AbortSignal | undefined,
): Promise<StepWork> {
  assertNotCancelled(signal);

  switch (stepType) {
    case 'VALIDATE_INPUT': {
      if (policy.missionClass === 'SYNTHETIC_CAPACITY_REMEDIATION') {
        if (!jao7CapacityObservationSchema.safeParse(stated.capacityObservation).success) {
          throw new Jao7AutonomyError('REQUEST_INVALID');
        }
      } else if (stated.clientSalesSignals === undefined) {
        throw new Jao7AutonomyError('REQUEST_INVALID');
      }
      return { succeeded: true, outcomeCode: 'INPUT_VALIDATED' };
    }

    case 'DELEGATE_RIYA_ANALYSIS': {
      const advisory = await delegateToRiya(stated, composition, signal);
      if (advisory.outcome !== 'DELEGATION_COMPLETED' || advisory.advisory === null) {
        throw new Jao7AutonomyError('SPECIALIST_REFUSED');
      }
      return { succeeded: true, outcomeCode: 'RIYA_ADVISORY_RECEIVED' };
    }

    case 'GATHER_VIRTUAL_EVIDENCE': {
      const result = gatherVirtualEvidence(stated, composition);
      if (result.outcome !== 'COMPLETED') {
        throw new Jao7AutonomyError('TOOL_REFUSED');
      }
      return { succeeded: true, outcomeCode: 'VIRTUAL_EVIDENCE_GATHERED' };
    }

    case 'ANALYZE_CAPACITY': {
      const parsed = jao7CapacityObservationSchema.safeParse(stated.capacityObservation);
      if (!parsed.success) {
        throw new Jao7AutonomyError('REQUEST_INVALID');
      }
      decideJao7Capacity(parsed.data);
      return { succeeded: true, outcomeCode: 'CAPACITY_ANALYZED' };
    }

    case 'BUILD_REMEDIATION_PROPOSAL': {
      const proposal = buildProposalFor(stated, policy, run);
      const binding = proposal.actionBindings[0];
      return {
        succeeded: true,
        outcomeCode: 'PROPOSAL_BUILT',
        proposal,
        proposalBinding: {
          recommendationId: binding.recommendationId,
          proposedActionId: binding.proposedActionId,
          actionFingerprint: binding.actionFingerprint,
        },
      };
    }

    case 'AWAIT_AUTHORITY':
      // No work. The run stops here until somebody supplies externally issued Core artifacts.
      return { succeeded: true, outcomeCode: 'AWAITING_EXTERNAL_AUTHORITY' };

    case 'VALIDATE_AUTHORITY_EVIDENCE': {
      if (authority === undefined) {
        return {
          succeeded: true,
          outcomeCode: 'NO_AUTHORITY_SUPPLIED',
          authorityCorrelated: false,
          executionIntentCorrelated: false,
        };
      }
      const proposal = carriedProposal(stated, run);
      const correlation = correlateJao7Authority(proposal, authority);
      await composition.store.recordAuthorityObservation(
        {
          runId: stated.runId,
          operationId: `${stated.operationId}.authority`,
          expectedRevision: run.revision,
          approvalDecisionDigest: correlation.approvalDecisionDigest,
          executionIntentDigest: correlation.executionIntentDigest,
          recommendationId: correlation.recommendationId,
          proposedActionId: correlation.proposedActionId,
          actionFingerprint: correlation.actionFingerprint,
          observationCode: correlation.observationCode,
        },
        composition.clock.nowMs(),
      );
      return {
        succeeded: true,
        outcomeCode: correlation.executionChainCorrelated
          ? 'AUTHORITY_CHAIN_CORRELATED'
          : 'AUTHORITY_INCOMPLETE',
        authorityCorrelated: correlation.observationCode !== 'DECISION_NOT_APPROVING_THIS_ACTION',
        executionIntentCorrelated: correlation.executionChainCorrelated,
      };
    }

    case 'REHEARSE_REVERSIBLE_EFFECT': {
      // The exact approved action, as SIMULATION INPUT, after correlation. This simulates what the
      // action would do; it does not execute the Core-issued intent, whose executor is n8n.
      const proposal = carriedProposal(stated, run);
      const action = proposal.recommendation.proposedActions[0];
      const binding = proposal.actionBindings[0];
      if (action === undefined) {
        throw new Jao7AutonomyError('REHEARSAL_APPLY_FAILED');
      }
      const target = jao7RehearsalTarget(
        policy.rehearsalClass,
        action.parameters,
        binding.actionFingerprint,
      );
      await composition.store.mutateRehearsal(
        {
          runId: stated.runId,
          operationId: `${stated.operationId}.apply`,
          expectedRevision: run.revision,
          operationKind: 'APPLY_REHEARSAL',
          nextRehearsalState: 'APPLIED',
          afterIntegerA: target.afterIntegerA,
          afterIntegerB: target.afterIntegerB,
          rollbackIntegerA: null,
          rollbackIntegerB: null,
          maxRehearsalApplies: policy.maxRehearsalApplies,
        },
        composition.clock.nowMs(),
      );
      return { succeeded: true, outcomeCode: 'REHEARSAL_APPLIED', rehearsalApplied: true };
    }

    case 'VERIFY_REHEARSAL': {
      const view = await composition.store.readRun(stated.runId);
      const rehearsal = view.rehearsal;
      if (rehearsal === null) {
        throw new Jao7AutonomyError('REHEARSAL_VERIFY_FAILED');
      }
      const proposal = carriedProposal(stated, run);
      const action = proposal.recommendation.proposedActions[0];
      const binding = proposal.actionBindings[0];
      if (action === undefined) {
        throw new Jao7AutonomyError('REHEARSAL_VERIFY_FAILED');
      }
      const target = jao7RehearsalTarget(
        policy.rehearsalClass,
        action.parameters,
        binding.actionFingerprint,
      );
      // The injected failure fixture corrupts the sandbox between apply and verify, exactly as a
      // real partial failure would.
      const observedA =
        stated.corruptRehearsalObservation === true ? null : rehearsal.afterIntegerA;
      const observedB =
        stated.corruptRehearsalObservation === true ? null : rehearsal.afterIntegerB;
      const passed = jao7VerifyRehearsal(policy.rehearsalClass, observedA, observedB, target);

      await composition.store.mutateRehearsal(
        {
          runId: stated.runId,
          operationId: `${stated.operationId}.verify`,
          expectedRevision: run.revision,
          operationKind: 'VERIFY_REHEARSAL',
          nextRehearsalState: passed ? 'VERIFIED' : 'ROLLBACK_REQUIRED',
          afterIntegerA: null,
          afterIntegerB: null,
          rollbackIntegerA: null,
          rollbackIntegerB: null,
          maxRehearsalApplies: policy.maxRehearsalApplies,
        },
        composition.clock.nowMs(),
      );
      return {
        succeeded: true,
        outcomeCode: passed ? 'REHEARSAL_VERIFIED' : 'REHEARSAL_VERIFY_FAILED',
        rehearsalApplied: true,
        verificationRan: true,
        verificationPassed: passed,
      };
    }

    case 'ROLLBACK_REHEARSAL': {
      const view = await composition.store.readRun(stated.runId);
      const rehearsal = view.rehearsal;
      if (rehearsal === null) {
        throw new Jao7AutonomyError('ROLLBACK_FAILED');
      }
      // ONLY the captured BEFORE state. There is no parameter through which a caller could name a
      // rollback target, and a rollback that could be aimed somewhere new would be a second apply.
      const target = jao7RollbackTarget(rehearsal.beforeIntegerA, rehearsal.beforeIntegerB);
      const restoredA =
        stated.corruptRollback === true ? target.afterIntegerA + 1 : target.afterIntegerA;
      const restoredB = target.afterIntegerB;
      const passed = jao7VerifyRollback(
        restoredA,
        restoredB,
        rehearsal.beforeIntegerA,
        rehearsal.beforeIntegerB,
      );

      await composition.store.mutateRehearsal(
        {
          runId: stated.runId,
          operationId: `${stated.operationId}.rollback`,
          expectedRevision: run.revision,
          operationKind: 'ROLLBACK_REHEARSAL',
          nextRehearsalState: passed ? 'ROLLED_BACK' : 'ROLLBACK_FAILED',
          afterIntegerA: null,
          afterIntegerB: null,
          rollbackIntegerA: restoredA,
          rollbackIntegerB: restoredB,
          maxRehearsalApplies: policy.maxRehearsalApplies,
        },
        composition.clock.nowMs(),
      );
      return {
        succeeded: true,
        outcomeCode: passed ? 'ROLLED_BACK' : 'ROLLBACK_FAILED',
        rehearsalApplied: true,
        rollbackRan: true,
        rollbackPassed: passed,
      };
    }

    case 'COMPLETE':
      return { succeeded: true, outcomeCode: 'PLAN_COMPLETE' };
  }
}

/**
 * The governed Riya delegation, through the CANONICAL JAO-2 boundary.
 *
 * The registry, the adapter and the workflow are constructed here from this module's own imports.
 * There is no public parameter for any of them, so a public caller cannot substitute a specialist,
 * and Riya's input is built from CLIENT SALES SIGNALS only -- no vendor data and no capacity data
 * reaches it, because Riya's governed behaviour is scoped to client sales and nothing else.
 */
async function delegateToRiya(
  stated: Jao7AdvanceRequest,
  composition: Jao7InternalComposition,
  signal: AbortSignal | undefined,
): Promise<Jao2RunResult> {
  const signals = stated.clientSalesSignals;
  if (signals === undefined) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const delegate = composition.delegate ?? runJao2GovernedDelegation;
  const runId = `${stated.runId}.riya`;
  return delegate(
    {
      runId,
      envelope: {
        delegationId: `${stated.runId}.delegation`,
        runId,
        specialistId: 'RIYA',
        capabilityId: 'riya.analyze-client-sales-signals',
        requestedAutonomyLevel: 'L0_REASON',
        parentAutonomyLevel: 'L1_READ',
        businessEffectAllowed: false,
        maxCalls: 1,
        input: {
          partyType: 'CLIENT',
          currentActor: 'RIYA',
          signals,
          promptRef: 'riya.client-sales.v1',
          humanTakeover: false,
          aiPaused: false,
        },
      },
    },
    {
      registry: createJao2SpecialistRegistry(),
      specialist: createJao2RiyaSpecialistAdapter(),
      clock: { nowMs: () => composition.clock.nowMs() },
    },
    signal,
  );
}

/** One bounded read over an injected synthetic bundle, through the CANONICAL JAO-4 workbench. */
function gatherVirtualEvidence(
  stated: Jao7AdvanceRequest,
  composition: Jao7InternalComposition,
): Jao4WorkbenchResult {
  const bundle = stated.artifactBundle;
  if (bundle === undefined) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const workbench = composition.workbench ?? runJao4Workbench;
  return workbench(
    {
      sessionId: `${stated.runId}.workbench`,
      runId: `${stated.runId}.evidence`,
      mode: 'SHADOW',
      parentAutonomyLevel: 'L1_READ',
      requestedAutonomyLevel: 'L1_READ',
      businessEffectAllowed: false,
      artifactBundleId: (bundle as { bundleId: string }).bundleId,
      artifactBundle: bundle,
      calls: stated.artifactCalls ?? [],
    },
    { clock: { nowMs: () => composition.clock.nowMs() } },
  );
}

/**
 * The proposal the caller CARRIED BACK, checked against the run's durable binding.
 *
 * This is the whole reason the binding exists. The canonical artifacts are not persisted, so the
 * only thing standing between "a caller holding a proposal" and "a caller holding THIS run's
 * proposal" is a row written when the proposal step committed -- and a mismatch is refused rather
 * than tolerated because the artifact happened to be well-formed.
 */
function carriedProposal(stated: Jao7AdvanceRequest, run: Jao7RunView['run']): Jao7Proposal {
  // UNKNOWN until it is checked. A cast straight to `Jao7Proposal` would be this function deciding
  // the caller supplied a proposal because the caller said so, which is the judgement the binding
  // below exists to make instead.
  const supplied: unknown = stated.proposal;
  if (typeof supplied !== 'object' || supplied === null) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  const carried = supplied as Jao7Proposal;
  const bindings: unknown = carried.actionBindings;
  const binding = Array.isArray(bindings) ? carried.actionBindings[0] : undefined;
  if (binding === undefined || typeof carried.recommendation !== 'object') {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  if (
    run.proposalActionFingerprint === null ||
    run.proposalRecommendationId === null ||
    run.proposalActionId === null
  ) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }
  if (
    binding.actionFingerprint !== run.proposalActionFingerprint ||
    binding.recommendationId !== run.proposalRecommendationId ||
    binding.proposedActionId !== run.proposalActionId ||
    carried.recommendation.recommendationId !== run.proposalRecommendationId
  ) {
    throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
  }
  return carried;
}

/** Build the canonical proposal from closed inputs and the reviewed policy. */
function buildProposalFor(
  stated: Jao7AdvanceRequest,
  policy: Jao7MissionPolicy,
  run: Jao7RunView['run'],
): Jao7Proposal {
  const parameters =
    policy.missionClass === 'SYNTHETIC_CAPACITY_REMEDIATION'
      ? capacityParameters(stated)
      : operatorTaskParameters(stated);

  return buildJao7Proposal({
    policy,
    subject: { entityType: run.subjectType, entityId: run.subjectId },
    summary: stated.summary,
    rationale: stated.rationale,
    evidence: stated.evidence,
    parameters,
    confidence: stated.confidence,
    createdAt: run.enrolledAt,
    expiresAt: run.expiresAt,
    correlationId: stated.correlationId,
  });
}

function capacityParameters(stated: Jao7AdvanceRequest): Record<string, unknown> {
  const parsed = jao7CapacityObservationSchema.safeParse(stated.capacityObservation);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  // COMPUTED. There is no `targetConcurrency` field on the request, so there is nothing to smuggle.
  const decision = decideJao7Capacity(parsed.data);
  return {
    poolCode: decision.poolCode,
    currentConcurrency: decision.currentConcurrency,
    targetConcurrency: decision.targetConcurrency,
    adjustmentReasonCode: decision.adjustmentReasonCode,
  };
}

function operatorTaskParameters(stated: Jao7AdvanceRequest): Record<string, unknown> {
  const task = stated.operatorTask;
  if (task === undefined) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  return {
    taskReasonCode: task.taskReasonCode,
    taskClass: task.taskClass,
    dueWindowCode: task.dueWindowCode,
    priorityBand: task.priorityBand,
  };
}
