/**
 * The observation, and the runtime surface (QFJ-P09.01, ADR-0084).
 *
 * ### What the result says, stated exactly
 *
 * > This Core-issued execution intent faithfully names this approved proposed action.
 *
 * Same recommendation, same Core approval decision, same action id, same action type, same action
 * contract version, and structurally identical governed parameters — with the approval evidence
 * re-proved independently rather than taken on trust.
 *
 * ### What it does NOT say
 *
 * > Execute it now.
 *
 * There is deliberately no `canExecute`, `canSend`, `isAuthorized`, `approved`, `authorized`,
 * `valid`, `fresh`, `isFresh`, `currentlyValid`, `freshUntil`, `consentValid`,
 * `communicationAllowed`, `retryAllowed`, `isIdempotent`, `status`, `pending`, `executed` or
 * `delivered`. Three separate reasons, and each matters on its own:
 *
 * - **This reads no clock.** Every check here is a relationship BETWEEN artifacts, so the result is
 *   a statement about provenance that is true whenever it is evaluated. A `fresh` flag would be a
 *   claim about *now*, computed by something with no *now*. Dispatch-time freshness belongs to a
 *   later execution-side check against a trusted execution-side clock.
 * - **A communication needs a second yes.** Core's action authorization does not establish that a
 *   recipient may be contacted — consent, opt-out, suppression, STOP and quiet hours are revalidated
 *   at execution time by Core and the communications runtime (ADR-0083). A `canSend` here would
 *   quietly answer a question this package never asked.
 * - **Jarvis does not authorize execution.** Core issues intents from its own recorded
 *   authorization, n8n validates and executes. A permission flag inside Jarvis would put a piece of
 *   that authority back on the wrong side of the boundary (ADR-0002).
 *
 * A caller that wants Core's terms reads them off `observation.intent`. That is a fact about a
 * record Core issued. It is not a grant, and nothing here dresses it up as one.
 */
import type { ExecutionIntentV1, ProposedAction } from '@qf-jarvis/contracts';
import type { ApprovalDecisionCorrelation } from '@qf-jarvis/approval-runtime';

import type { ExecutionIntentValidationInput } from './input.js';

/**
 * One validated, correlated execution intent.
 *
 * Deeply frozen. All three values are returned verbatim: they are evidence, and evidence a caller
 * can edit is not evidence.
 */
export interface ExecutionIntentObservation {
  /**
   * Core's artifact, exactly as it was issued.
   *
   * It already carries `idempotencyKey` and `deliverySemantics: 'at-most-once'`. This package
   * OBSERVES both and derives nothing from either: it generates no key, reserves none, consumes
   * none, keeps no used-key set, and makes no duplicate-prevention claim. One-effect semantics are
   * enforced by the execution side, which is the only place they can be.
   */
  readonly intent: ExecutionIntentV1;
  /**
   * The re-proved approval evidence.
   *
   * Its `proposedActionId` is checked to EQUAL `intent.approvedActionId`, so here — unlike in the
   * communication-authorization observation, where no such field exists to compare — the action
   * identity is genuinely established rather than assumed.
   */
  readonly approvalCorrelation: ApprovalDecisionCorrelation;
  /**
   * The approved action itself, taken from the re-proved recommendation.
   *
   * The intent's `actionType`, `actionContractVersion` and `parameters` were proved structurally
   * identical to this action's. It is returned so a caller can see WHAT was approved without going
   * back to the source, and it is frozen so it cannot be edited into something else afterwards.
   */
  readonly approvedAction: ProposedAction;
}

/**
 * The execution intent correlation runtime.
 *
 * ONE method, synchronous, pure. There is no `issue`, `createIntent`, `authorize`, `approve`,
 * `execute`, `dispatch`, `send`, `deliver`, `retry`, `submit`, `enqueue` or `publish` — not as a
 * method and not as a capability this package could acquire, because it holds no transport, no
 * store, no credential and no clock.
 */
export interface ExecutionIntentRuntime {
  /** Prove the intent reproduces the approved action. Throws a bounded error; returns frozen. */
  validate(input: ExecutionIntentValidationInput): ExecutionIntentObservation;
}
