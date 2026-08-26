/**
 * The JAO-7 durable store port (ADR-0121).
 *
 * ### Why this is INTERNAL and reaches no barrel
 *
 * Every method here takes governance values as caller-supplied arguments: the plan digest a claim is
 * checked against, the budget a step is charged to, the revision a mutation expects. The adapter
 * re-checks all of them against the locked row -- but it cannot reconstruct canonical mission policy,
 * so it cannot know whether the plan digest it was handed is the reviewed one, or whether the budget
 * numbers are the ones somebody approved.
 *
 * A public caller holding one of these could therefore claim steps under bounds of its own choosing,
 * or supply an implementation that recorded whatever it liked. That is JAO-5's Finding 1 and JAO-6's
 * Finding 1, and the answer is the same both times: the public surface takes a `DatabasePool` -- the
 * trusted persistence infrastructure boundary -- and constructs the canonical store itself. This port
 * is exported from its module and from no barrel.
 */
import type {
  Jao7AuthorityObservation,
  Jao7AuthorityObservationRecord,
  Jao7EvaluationRecord,
  Jao7EvaluationVerdict,
  Jao7OperationKind,
  Jao7RehearsalClass,
  Jao7RehearsalRecord,
  Jao7RehearsalState,
  Jao7RunRecord,
  Jao7RunState,
  Jao7StepRecord,
  Jao7StepType,
} from './contracts.js';

/** What a mutation must state before it is allowed to change anything. */
export interface Jao7OperationEnvelope {
  readonly operationId: string;
  readonly expectedRevision: number;
}

/** Creating a run. Every governance value is stamped from the canonical policy by the caller. */
export interface Jao7CreateRunRequest {
  readonly runId: string;
  readonly operationId: string;
  readonly missionPolicyId: string;
  readonly missionPolicyVersion: number;
  readonly missionPolicyDigest: string;
  readonly planDigest: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly lifetimeSeconds: number;
  /** The sandbox is captured at creation, so a "before" state exists before anything can apply. */
  readonly rehearsalClass: Jao7RehearsalClass;
  readonly beforeIntegerA: number;
  readonly beforeIntegerB: number | null;
}

/** Claiming the next step. The plan digest and budgets are re-checked under the row lock. */
export interface Jao7ClaimStepRequest extends Jao7OperationEnvelope {
  readonly runId: string;
  readonly planDigest: string;
  readonly stepIndex: number;
  readonly stepType: Jao7StepType;
  /** Which budget this step spends, if any. Charged inside the claim transaction. */
  readonly charge: 'NONE' | 'SPECIALIST' | 'TOOL';
  readonly toolCallCount: number;
  readonly maxSpecialistCalls: number;
  readonly maxToolCalls: number;
  readonly maxSteps: number;
}

/** Finalising a claimed step, recording its evaluation, and moving the run. */
export interface Jao7FinalizeStepRequest extends Jao7OperationEnvelope {
  readonly runId: string;
  readonly stepIndex: number;
  readonly stepStatus: 'COMPLETED' | 'REFUSED' | 'CANCELLED';
  readonly outcomeCode: string;
  readonly evaluatorCode: string;
  readonly verdict: Jao7EvaluationVerdict;
  readonly nextState: Jao7RunState;
  readonly advanceStepIndex: boolean;
  /**
   * Written exactly once, when the proposal step commits.
   *
   * The canonical artifacts are not persisted; this is the identity a later authority correlation
   * must match, so a caller returning with a DIFFERENT proposal is refused by a row rather than
   * trusted because it happened to be holding one.
   */
  readonly proposalBinding?: {
    readonly recommendationId: string;
    readonly proposedActionId: string;
    readonly actionFingerprint: string;
  };
}

/** What a claim produced: the locked run as it now stands, plus the step that was claimed. */
export interface Jao7ClaimedStep {
  readonly run: Jao7RunRecord;
  readonly step: Jao7StepRecord;
  /** True when this operation id had already claimed this exact step. */
  readonly replayed: boolean;
}

/** What a mutation committed. Read back from the replay record, never from a moved-on header. */
export interface Jao7OperationResult {
  readonly runId: string;
  readonly committedRevision: number;
  readonly committedState: Jao7RunState;
  readonly resultCode: string;
  readonly replayed: boolean;
}

/** Recording the authority correlation. Digests and identities; nothing reusable. */
export interface Jao7RecordAuthorityRequest extends Jao7OperationEnvelope {
  readonly runId: string;
  readonly approvalDecisionDigest: string;
  readonly executionIntentDigest: string | null;
  readonly recommendationId: string;
  readonly proposedActionId: string;
  readonly actionFingerprint: string;
  readonly observationCode: Jao7AuthorityObservation;
}

/** One virtual sandbox mutation. The caller supplies the values; the adapter enforces the rules. */
export interface Jao7RehearsalMutationRequest extends Jao7OperationEnvelope {
  readonly runId: string;
  readonly operationKind: Extract<
    Jao7OperationKind,
    'APPLY_REHEARSAL' | 'VERIFY_REHEARSAL' | 'ROLLBACK_REHEARSAL'
  >;
  readonly nextRehearsalState: Jao7RehearsalState;
  readonly afterIntegerA: number | null;
  readonly afterIntegerB: number | null;
  readonly rollbackIntegerA: number | null;
  readonly rollbackIntegerB: number | null;
  readonly maxRehearsalApplies: number;
}

/** A whole run, as a reader sees it. Strictly decoded; no artifact and no permission in sight. */
export interface Jao7RunView {
  readonly run: Jao7RunRecord;
  readonly steps: readonly Jao7StepRecord[];
  readonly evaluations: readonly Jao7EvaluationRecord[];
  readonly authority: Jao7AuthorityObservationRecord | null;
  readonly rehearsal: Jao7RehearsalRecord | null;
}

/**
 * The durable store.
 *
 * There is deliberately no `update`, no `setState`, no `deleteRun` and no `unkill`. Every method is
 * a named governed transition, so the set of things that can happen to a run is the set of methods
 * on this interface -- which is a thing a reviewer can finish reading.
 */
export interface Jao7AutonomyStore {
  createRun(request: Jao7CreateRunRequest, nowMs: number): Promise<Jao7OperationResult>;
  claimStep(request: Jao7ClaimStepRequest, nowMs: number): Promise<Jao7ClaimedStep>;
  finalizeStep(request: Jao7FinalizeStepRequest, nowMs: number): Promise<Jao7OperationResult>;
  pauseRun(
    request: Jao7OperationEnvelope & { readonly runId: string },
    nowMs: number,
  ): Promise<Jao7OperationResult>;
  resumeRun(
    request: Jao7OperationEnvelope & { readonly runId: string; readonly maxResumes: number },
    nowMs: number,
  ): Promise<Jao7OperationResult>;
  killRun(
    request: Jao7OperationEnvelope & { readonly runId: string },
    nowMs: number,
  ): Promise<Jao7OperationResult>;
  recordAuthorityObservation(
    request: Jao7RecordAuthorityRequest,
    nowMs: number,
  ): Promise<Jao7OperationResult>;
  mutateRehearsal(
    request: Jao7RehearsalMutationRequest,
    nowMs: number,
  ): Promise<Jao7OperationResult>;
  readRun(runId: string): Promise<Jao7RunView>;
}
