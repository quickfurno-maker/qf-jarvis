/**
 * The JAO-7 continuous evaluator (ADR-0121).
 *
 * ### What "continuous evaluation" means in this first proof
 *
 * A deterministic evaluation after EVERY significant step, durably recorded. It does not mean an
 * always-on background model loop, and this function has no model call to make and no clock to read.
 *
 * That is a deliberately unglamorous reading of the overlay sentence, and it is the honest one. A
 * background evaluator that could change a run's direction while nobody was watching would be a
 * second autonomous actor inside an autonomy proof -- and the thing JAO-7 is supposed to demonstrate
 * is that every transition is attributable to an explicit call.
 *
 * ### What the evaluator is structurally unable to do
 *
 * It is a pure function from a bounded structured state to a closed verdict. It sees no free text, no
 * specialist prose, no artifact content and no model output. It therefore cannot:
 *
 * - lower an approval level -- it never sees one, and `requiredApproval` comes from the policy;
 * - create a Core decision or an execution intent -- there is no constructor in scope;
 * - override a kill or ignore an expiry -- those are decided before it is called, and the coordinator
 *   does not consult it about them;
 * - turn a failed verification into a success -- `verificationPassed: false` has exactly one branch.
 *
 * The last one is the one worth stating plainly. A verdict function that could return `COMPLETE` on
 * a failed verification would make every other control in this slice decorative.
 */
import { z } from 'zod';

import { JAO7_STEP_TYPES, type Jao7EvaluationVerdict, type Jao7StepType } from './contracts.js';

/**
 * Everything the evaluator may see. Bounded, structured, and closed.
 *
 * Strict, so an added field is a refusal rather than something silently consulted -- which is what
 * stops "just pass the specialist's reason string in" from becoming a one-line change.
 */
export const jao7EvaluationInputSchema = z.strictObject({
  stepType: z.enum(JAO7_STEP_TYPES),
  stepIndex: z.number().int().min(0).max(64),
  isLastStep: z.boolean(),
  stepSucceeded: z.boolean(),

  /** Whether the canonical proposal artifacts exist yet. */
  proposalReady: z.boolean(),
  /** Whether externally supplied Core artifacts have been correlated to THIS action. */
  authorityCorrelated: z.boolean(),
  /** Whether that correlation also proved a matching Core-issued execution intent. */
  executionIntentCorrelated: z.boolean(),

  /** The virtual sandbox, as facts rather than as prose. */
  rehearsalApplied: z.boolean(),
  verificationRan: z.boolean(),
  verificationPassed: z.boolean(),
  rollbackRan: z.boolean(),
  rollbackPassed: z.boolean(),

  /** A caller-requested cooperative pause, honoured only between steps. */
  pauseRequested: z.boolean(),
});

export type Jao7EvaluationInput = z.infer<typeof jao7EvaluationInputSchema>;

/** The verdict plus the closed code that explains it. Both are persisted; neither is free text. */
export interface Jao7Evaluation {
  readonly verdict: Jao7EvaluationVerdict;
  readonly evaluatorCode: string;
}

function verdict(v: Jao7EvaluationVerdict, evaluatorCode: string): Jao7Evaluation {
  return Object.freeze({ verdict: v, evaluatorCode });
}

/**
 * Evaluate one completed step.
 *
 * The order of the branches IS the policy, and the first three are the ones that matter:
 *
 * 1. A failed step never continues.
 * 2. An applied-but-unverified rehearsal that failed verification goes to rollback, always, before
 *    anything else is considered -- including completion and including a pause request.
 * 3. A failed rollback is terminal and safe, never retried in a loop.
 */
export function evaluateJao7Step(input: unknown): Jao7Evaluation {
  const parsed = jao7EvaluationInputSchema.safeParse(input);
  if (!parsed.success) {
    // An evaluator that cannot understand its own input must not guess. Failing safe here means the
    // run stops with its virtual state intact, which is always recoverable by explicit action.
    return verdict('FAIL_SAFE', 'EVALUATION_INPUT_INVALID');
  }
  const state: Jao7EvaluationInput = parsed.data;

  // 1. A step that did not succeed never continues forward.
  if (!state.stepSucceeded) {
    // If synthetic state is already applied, the only safe direction is back.
    return state.rehearsalApplied && !state.rollbackRan
      ? verdict('ROLLBACK', 'STEP_FAILED_WITH_APPLIED_REHEARSAL')
      : verdict('FAIL_SAFE', 'STEP_FAILED');
  }

  // 2. Rollback outcomes are read before anything else, because a run that has already been rolled
  //    back has nowhere forward to go.
  if (state.rollbackRan) {
    return state.rollbackPassed
      ? verdict('COMPLETE', 'ROLLED_BACK_CLEANLY')
      : verdict('FAIL_SAFE', 'ROLLBACK_DID_NOT_RESTORE_CAPTURED_STATE');
  }

  // 3. A failed verification takes rollback. There is no branch in which it does not.
  if (state.verificationRan && !state.verificationPassed) {
    return verdict('ROLLBACK', 'VERIFICATION_FAILED');
  }

  // 4. A cooperative pause is honoured only once the run is in a safe place: never while synthetic
  //    state is applied and unverified, because a pause there would strand it.
  if (state.pauseRequested && !(state.rehearsalApplied && !state.verificationRan)) {
    return verdict('PAUSE', 'PAUSE_REQUESTED');
  }

  switch (state.stepType) {
    case 'BUILD_REMEDIATION_PROPOSAL':
      // A proposal exists, so the plan moves to its dedicated AWAIT_AUTHORITY step -- which is where
      // the run actually stops. Stopping here instead would make the gate implicit, and an implicit
      // gate is one a later plan could omit without anything objecting.
      return state.proposalReady
        ? verdict('CONTINUE', 'PROPOSAL_READY')
        : verdict('FAIL_SAFE', 'PROPOSAL_MISSING');

    case 'AWAIT_AUTHORITY':
      return verdict('REQUIRE_AUTHORITY', 'AWAITING_EXTERNAL_AUTHORITY');

    case 'VALIDATE_AUTHORITY_EVIDENCE':
      if (!state.authorityCorrelated) {
        return verdict('REQUIRE_AUTHORITY', 'AUTHORITY_NOT_CORRELATED');
      }
      // Correlated approval WITHOUT a matching Core-issued execution intent is not enough to
      // rehearse the execution chain. It is a real state, and it stops here.
      return state.executionIntentCorrelated
        ? verdict('CONTINUE', 'AUTHORITY_CHAIN_CORRELATED')
        : verdict('REQUIRE_AUTHORITY', 'EXECUTION_INTENT_NOT_CORRELATED');

    case 'REHEARSE_REVERSIBLE_EFFECT':
      return state.rehearsalApplied
        ? verdict('VERIFY', 'REHEARSAL_APPLIED_VERIFY_REQUIRED')
        : verdict('FAIL_SAFE', 'REHEARSAL_NOT_APPLIED');

    case 'VERIFY_REHEARSAL':
      if (!state.verificationRan) {
        return verdict('FAIL_SAFE', 'VERIFICATION_DID_NOT_RUN');
      }
      // A FAILED verification never reaches here -- the branch above takes it to ROLLBACK, always.
      return verdict('CONTINUE', 'REHEARSAL_VERIFIED');

    case 'ROLLBACK_REHEARSAL':
      // Reached only when the rollback step itself completed without recording an outcome, which
      // the branch above already covers. Fail safe rather than assume.
      return verdict('FAIL_SAFE', 'ROLLBACK_OUTCOME_UNRECORDED');

    case 'COMPLETE':
      return verdict('COMPLETE', 'PLAN_COMPLETE');

    case 'VALIDATE_INPUT':
    case 'GATHER_VIRTUAL_EVIDENCE':
    case 'DELEGATE_RIYA_ANALYSIS':
    case 'ANALYZE_CAPACITY':
      return state.isLastStep
        ? verdict('COMPLETE', 'PLAN_COMPLETE')
        : verdict('CONTINUE', 'STEP_COMPLETED');
  }
}

/** The step types after which an evaluation is mandatory. Every one of them, which is the point. */
export const JAO7_EVALUATED_STEP_TYPES: readonly Jao7StepType[] = Object.freeze([
  ...JAO7_STEP_TYPES,
]);
