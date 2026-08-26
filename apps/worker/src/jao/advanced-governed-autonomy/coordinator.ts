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
import { evaluateJao7Step, jao7PlanProgressionFor } from './evaluator.js';
import {
  createJao7MissionRegistry,
  jao7CanonicalJson,
  jao7Digest,
  jao7MissionDigest,
  jao7PlanDigest,
  jao7PlanFor,
  type Jao7MissionRegistry,
} from './mission-registry.js';
import { jao7RemediationFor, type Jao7MissionPolicy } from './mission-policy.js';
import { createJao7PostgresStore } from './postgres-store.js';
import { buildJao7Proposal, jao7ValidateCarriedProposal, type Jao7Proposal } from './proposal.js';
import {
  jao7RehearsalTarget,
  jao7RollbackTarget,
  jao7VerifyRehearsal,
  jao7VerifyRollback,
} from './rehearsal.js';
import {
  jao7AutonomyRequestSchema,
  jao7AutonomyResultSchema,
  jao7CreateRunRequestSchema,
  jao7SafetyRollbackRequestSchema,
  type Jao7AdvanceRequest,
  type Jao7AutonomyResult,
  type Jao7CreateRunRequest as Jao7CreateRequest,
  type Jao7ResultProposal,
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
  /**
   * INTERNAL failure fixtures, so the recovery paths are exercised over REAL durable state.
   *
   * They used to be `corruptRehearsalObservation` and `corruptRollback` on the PUBLIC request
   * schema, which meant the shipped surface carried two switches whose only purpose was to make a
   * verification fail and a rollback not restore. Neither could ever grant anything -- they corrupt
   * an OBSERVATION, exactly as a partial failure would -- but a public knob that exists to break a
   * safety check is a public knob somebody eventually flips, and a reviewer has to read the whole
   * slice to satisfy themselves it cannot matter. They belong beside the store and the clock.
   */
  readonly faultInjection?: {
    readonly corruptRehearsalObservation?: boolean;
    readonly corruptRollback?: boolean;
  };
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

/**
 * Assemble the result, and PROVE it before handing it over.
 *
 * `jao7AutonomyResultSchema` existed and was never run: `buildResult` constructed an object and
 * returned it, so the schema was documentation with a `parse` method nobody called. Five of its
 * fields were `z.unknown()` besides, which meant even a caller who did run it proved nothing about
 * the durable facts the result reports. Both halves are fixed here -- the fields are declared, and
 * this is the one place a result is built, so parsing here is parsing everywhere.
 */
function buildResult(
  view: Jao7RunView,
  refusalReason: Jao7AutonomyResult['refusalReason'],
  proposal: Jao7Proposal | null = null,
): Jao7AutonomyResult {
  const carried: Jao7ResultProposal | null =
    proposal === null
      ? null
      : Object.freeze({
          recommendation: proposal.recommendation,
          actionBindings: proposal.actionBindings,
          approvalRequest: proposal.approvalRequest,
        });
  const assembled = Object.freeze({
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
    proposal: carried,
    authoritySourcePosture: 'INJECTED_OFFLINE_CORE_FIXTURE' as const,
    posture: JAO7_POSTURE,
  });

  if (!jao7AutonomyResultSchema.safeParse(assembled).success) {
    // A result that contradicts its own contract is worse than no result: it reads correctly and is
    // wrong, and everything downstream trusts it. Refuse instead.
    throw new Jao7AutonomyError('RESULT_INVALID');
  }
  return assembled;
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

/**
 * SAFETY CLEANUP: restore the virtual sandbox to its captured BEFORE state.
 *
 * ### Why this is on the public surface
 *
 * Because the guarantee it backs is a public one. A kill is terminal and an expiry blocks forward
 * work, and both can leave synthetic state APPLIED -- so "safety rollback is superior to kill and
 * expiry" is only true if somebody outside can actually ask for it. It could not: the only rollback
 * path was a plan recovery branch reached by a run that was still moving, and the proof that a
 * killed run's sandbox could be cleaned reached through the RAW store, which no public caller has.
 * A guarantee that only an internal test can exercise is not a guarantee.
 *
 * ### What it cannot do
 *
 * It takes a run id and an operation id. It cannot name a value, a target or a state; it can only
 * ever restore what was captured before anything applied; it is bounded to ONE attempt by a durable
 * counter and a database CHECK; and it resurrects nothing -- a terminal run stays terminal, with a
 * clean sandbox instead of a dirty one.
 */
export async function rollbackJao7AutonomyRehearsal(
  request: unknown,
  dependencies: Jao7AutonomyDependencies,
): Promise<Jao7AutonomyResult> {
  return rollbackJao7AutonomyRehearsalInternal(request, canonicalComposition(dependencies));
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

export async function rollbackJao7AutonomyRehearsalInternal(
  request: unknown,
  composition: Jao7InternalComposition,
): Promise<Jao7AutonomyResult> {
  const parsed = jao7SafetyRollbackRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }

  const view = await composition.store.readRun(parsed.data.runId);
  const policy = resolvePolicy(
    composition.registry,
    view.run.missionPolicyId,
    view.run.missionPolicyVersion,
  );

  // Only APPLIED synthetic state can be restored. The store enforces this again under its own lock;
  // refusing here as well means a caller asking about a sandbox that never applied gets the honest
  // answer rather than a rollback that silently did nothing.
  const state = view.rehearsal?.state;
  if (state !== 'APPLIED' && state !== 'ROLLBACK_REQUIRED') {
    throw new Jao7AutonomyError('ROLLBACK_NOT_ELIGIBLE');
  }

  await rollbackSandbox(
    parsed.data.runId,
    parsed.data.operationId,
    view.run.revision,
    policy,
    composition,
  );

  const cleaned = await composition.store.readRun(parsed.data.runId);
  emit(composition, cleaned, 'ROLLBACK_REHEARSAL', null);
  return buildResult(cleaned, null);
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
  /** The remediation the specialist's bounded conclusion was mapped to, plus its advisory digest. */
  readonly specialistObservation?: {
    readonly taskReasonCode: string;
    readonly taskClass: string;
    readonly dueWindowCode: string;
    readonly priorityBand: string;
    readonly advisoryDigest: string;
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

  // A REPLAYED CLAIM STOPS HERE, before Phase B.
  //
  // The claim already committed once under this exact operation id, and committing it charged the
  // budget. Performing the work again would call the specialist a second time on a single charged
  // call -- and `claimed.replayed` was previously ignored entirely, so that is what happened. What a
  // retry is owed is the state its claim committed, which is what is returned.
  //
  // A step left CLAIMED by a crash therefore stays claimed until somebody decides explicitly what to
  // do about it. That is the conservative direction: a stranded step costs a governed decision, and
  // silently re-running a specialist call nobody re-authorised costs the property this slice exists
  // to demonstrate.
  if (claimed.replayed) {
    const replayed = await composition.store.readRun(stated.runId);
    emit(composition, replayed, stepType, null);
    return buildResult(replayed, null);
  }

  // ---- PHASE B: the bounded work. NO transaction is open here. ---------------------------------
  let work: StepWork;
  try {
    work = await performStep(
      stepType,
      stated,
      policy,
      composition,
      claimed.run,
      claimed.priorState,
      authority,
      signal,
    );
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
        planProgression: 'RETAIN',
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
      // THE GATE. A step that completed is not automatically progress: an authority validation that
      // correlated nothing has completed and proved nothing, and advancing past it would leave the
      // run pointing at the rehearsal it is supposed to be waiting in front of. The decision is a
      // total function of the closed verdict vocabulary, so a new verdict cannot inherit `ADVANCE`.
      planProgression: jao7PlanProgressionFor(stepType, evaluation.verdict),
      ...(work.proposalBinding === undefined ? {} : { proposalBinding: work.proposalBinding }),
      ...(work.specialistObservation === undefined
        ? {}
        : { specialistObservation: work.specialistObservation }),
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
  /** The state the claim moved the run OUT of. See `Jao7ClaimedStep.priorState`. */
  priorState: Jao7RunState,
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
      const delegation = await delegateToRiya(stated, composition, signal);
      if (delegation.outcome !== 'DELEGATION_COMPLETED' || delegation.advisory === null) {
        throw new Jao7AutonomyError('SPECIALIST_REFUSED');
      }
      const advisory = delegation.advisory;

      // THE SPECIALIST'S CONCLUSION DECIDES THE REMEDIATION.
      //
      // This step used to end at the line above: the advisory was required, then thrown away, and
      // the proposal was built from `operatorTask` parameters the CALLER had supplied. Changing what
      // Riya concluded changed nothing about what was proposed, which made a mandatory governed
      // delegation ceremonial. JAO-2 already proved a specialist can be CALLED; JAO-7 is supposed to
      // prove one CONTRIBUTES.
      //
      // The mapping is total over reviewed vocabularies and fails closed outside them. Riya gains no
      // authority by it: every value she can cause to appear in the action is a member of a closed
      // enum somebody reviewed, and she still cannot propose, approve, execute or send.
      const lookup = jao7RemediationFor({
        disposition: advisory.disposition,
        intent: advisory.intent,
        reason: advisory.reason,
      });
      if (lookup.found === 'UNREVIEWED') {
        // A conclusion outside the reviewed maps. A remediation nobody reviewed is not a remediation.
        throw new Jao7AutonomyError('SPECIALIST_ADVISORY_UNREVIEWED');
      }
      if (lookup.decision === 'NO_GOVERNED_REMEDIATION') {
        // Riya declined the turn, or was structurally prevented from analysing it. Proposing an
        // internal task anyway would be JAO-7 inventing a conclusion the specialist did not reach.
        throw new Jao7AutonomyError('SPECIALIST_ADVISORY_WITHOUT_REMEDIATION');
      }

      return {
        succeeded: true,
        outcomeCode: 'RIYA_ADVISORY_RECEIVED',
        specialistObservation: {
          ...lookup.decision,
          // WHICH advisory concluded it. A digest of the bounded result -- closed tokens, counters
          // and literals -- so the derivation is auditable without any of it being durable prose.
          advisoryDigest: jao7Digest(['JAO7_ADVISORY_V1', jao7CanonicalJson(advisory)]),
        },
      };
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
      // Re-read, because the specialist observation was written by an EARLIER step and the header
      // this call was handed is the one the claim committed. Building from a stale copy would be
      // building from a run that had not yet concluded anything.
      const current = await composition.store.readRun(stated.runId);
      const proposal = buildProposalFor(stated, policy, current.run);
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
      const proposal = carriedProposal(stated, policy, run);
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
      // A REHEARSAL IS ELIGIBLE ONLY OFF A JUST-PROVEN EXACT CHAIN.
      //
      // The plan position alone used to be enough, and the plan position used to advance past a
      // validation that had proved nothing. Three things are now required together, and each is
      // checked against durable state rather than against what this call was told:
      //
      //   1. the run was in the state a SUCCESSFUL validation produces, read under the claim's own
      //      lock -- which is what makes the proof "just" rather than "at some point";
      //   2. a successful chain is actually recorded for this run;
      //   3. that chain is bound to THIS run's proposal identity.
      if (priorState !== 'AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL') {
        throw new Jao7AutonomyError('REHEARSAL_NOT_ELIGIBLE');
      }
      const proven = await composition.store.readRun(stated.runId);
      const observed = proven.authority;
      if (observed?.observationCode !== 'CORRELATED_APPROVED_ACTION_AND_INTENT') {
        throw new Jao7AutonomyError('REHEARSAL_NOT_ELIGIBLE');
      }
      if (
        observed.recommendationId !== run.proposalRecommendationId ||
        observed.proposedActionId !== run.proposalActionId ||
        observed.actionFingerprint !== run.proposalActionFingerprint
      ) {
        throw new Jao7AutonomyError('AUTHORITY_BINDING_MISMATCH');
      }

      // The exact approved action, as SIMULATION INPUT, after correlation. This simulates what the
      // action would do; it does not execute the Core-issued intent, whose executor is n8n.
      const proposal = carriedProposal(stated, policy, run);
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
          maxRollbackAttempts: policy.maxRollbackAttempts,
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
      const proposal = carriedProposal(stated, policy, run);
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
      // The INTERNAL failure fixture corrupts the sandbox observation between apply and verify,
      // exactly as a real partial failure would. It cannot make a verification pass.
      const corrupt = composition.faultInjection?.corruptRehearsalObservation === true;
      const observedA = corrupt ? null : rehearsal.afterIntegerA;
      const observedB = corrupt ? null : rehearsal.afterIntegerB;
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
          maxRollbackAttempts: policy.maxRollbackAttempts,
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
      const passed = await rollbackSandbox(
        stated.runId,
        `${stated.operationId}.rollback`,
        run.revision,
        policy,
        composition,
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
 * Restore the virtual sandbox to its CAPTURED BEFORE STATE, and report whether it worked.
 *
 * The one place a rollback happens, shared by the plan's recovery branch and by the public safety
 * entry point. There is no parameter through which a caller could name a rollback target: a rollback
 * that could be aimed somewhere new would be a second apply wearing a safer word.
 *
 * A failed attempt is DURABLE. `rollback_attempted_at` and `rolled_back_at` are separate columns for
 * exactly this reason -- they used to be one, and the consistency CHECK then made a `ROLLBACK_FAILED`
 * row unwritable, so the failure state could not be persisted at all. A failure state that cannot be
 * persisted is a failure state that does not exist, which is the opposite of failing safe.
 */
async function rollbackSandbox(
  runId: string,
  operationId: string,
  expectedRevision: number,
  policy: Jao7MissionPolicy,
  composition: Jao7InternalComposition,
): Promise<boolean> {
  const view = await composition.store.readRun(runId);
  const rehearsal = view.rehearsal;
  if (rehearsal === null) {
    throw new Jao7AutonomyError('ROLLBACK_NOT_ELIGIBLE');
  }
  // ONLY the captured BEFORE state.
  const target = jao7RollbackTarget(rehearsal.beforeIntegerA, rehearsal.beforeIntegerB);
  const corrupt = composition.faultInjection?.corruptRollback === true;
  const restoredA = corrupt ? target.afterIntegerA + 1 : target.afterIntegerA;
  const restoredB = target.afterIntegerB;
  const passed = jao7VerifyRollback(
    restoredA,
    restoredB,
    rehearsal.beforeIntegerA,
    rehearsal.beforeIntegerB,
  );

  await composition.store.mutateRehearsal(
    {
      runId,
      operationId,
      expectedRevision,
      operationKind: 'ROLLBACK_REHEARSAL',
      nextRehearsalState: passed ? 'ROLLED_BACK' : 'ROLLBACK_FAILED',
      afterIntegerA: null,
      afterIntegerB: null,
      // What was OBSERVED, whether or not it restored anything. Whether it is recorded as a
      // restored value is the adapter's decision, and the database's after that -- deciding it
      // twice, in two places, would mean neither decision could be proved by breaking it.
      rollbackIntegerA: restoredA,
      rollbackIntegerB: restoredB,
      maxRehearsalApplies: policy.maxRehearsalApplies,
      maxRollbackAttempts: policy.maxRollbackAttempts,
    },
    composition.clock.nowMs(),
  );
  return passed;
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
 * The proposal the caller CARRIED BACK, re-proved from its own bytes.
 *
 * This is the whole reason the binding exists. The canonical artifacts are not persisted, so the only
 * thing standing between "a caller holding a proposal" and "a caller holding THIS run's proposal" is
 * a row written when the proposal step committed.
 *
 * The check used to be three string comparisons over an object CAST to `Jao7Proposal` after a single
 * `typeof` test -- no canonical parse, and the fingerprint read out of the carried object rather than
 * recomputed from it. `jao7ValidateCarriedProposal` is where that is now done properly, and this
 * wrapper exists only to keep the refusal for a missing artifact separate from the refusal for a
 * wrong one.
 */
function carriedProposal(
  stated: Jao7AdvanceRequest,
  policy: Jao7MissionPolicy,
  run: Jao7RunView['run'],
): Jao7Proposal {
  if (stated.proposal === undefined) {
    throw new Jao7AutonomyError('REQUEST_INVALID');
  }
  return jao7ValidateCarriedProposal(stated.proposal, policy, {
    recommendationId: run.proposalRecommendationId,
    proposedActionId: run.proposalActionId,
    actionFingerprint: run.proposalActionFingerprint,
  });
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
      : operatorTaskParameters(run);

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

/**
 * Mission A's action parameters, DERIVED from the specialist's durable conclusion.
 *
 * They used to come from `stated.operatorTask` -- a caller-supplied field on the public request --
 * which is what made the mandatory Riya delegation ceremonial. They now come from the columns the
 * specialist step wrote when it committed, so the remediation a human is asked to approve is the one
 * the advisory actually concluded, and it survives a restart because it is a row rather than an
 * argument.
 *
 * A missing observation is a refusal, never a default: the proposal step cannot be reached without
 * the specialist step having committed, and if it somehow were, there would be no conclusion to
 * propose.
 */
function operatorTaskParameters(run: Jao7RunView['run']): Record<string, unknown> {
  if (
    run.specialistTaskReasonCode === null ||
    run.specialistTaskClass === null ||
    run.specialistDueWindowCode === null ||
    run.specialistPriorityBand === null
  ) {
    throw new Jao7AutonomyError('SPECIALIST_OBSERVATION_MISSING');
  }
  return {
    taskReasonCode: run.specialistTaskReasonCode,
    taskClass: run.specialistTaskClass,
    dueWindowCode: run.specialistDueWindowCode,
    priorityBand: run.specialistPriorityBand,
  };
}
