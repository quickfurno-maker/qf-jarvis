/**
 * The observation, and the runtime surface (QFJ-P08, ADR-0083).
 *
 * ### The result is an OBSERVATION, and the field set is chosen so it cannot be anything else
 *
 * It says: "this authorization, issued by QuickFurno Core, provably answers this communication
 * request — and when Core said yes, here is the re-proved human approval it rests on."
 *
 * There is deliberately no `canSend`, `canExecute`, `isAuthorized`, `communicationAllowed`,
 * `consentValid`, `eligible`, `permitted`, `permission`, `validUntil`, `authorizedUntil`, `pending`
 * or `status`. Each would be this package converting Core's record into a Jarvis permission, and
 * each would be wrong in the same specific way:
 *
 * - **A permission flag ages.** Core's artifact carries no `validUntil` and no consent snapshot on
 *   purpose — it says what Core decided WHEN it decided. A recipient may withdraw consent between
 *   authorization and the scheduled moment, so Core and the communications runtime re-validate at
 *   EXECUTION time, and that answer is the one that counts (communication-model.md). A boolean here
 *   would be exactly the stale permission slip the contract refuses to issue.
 * - **A permission flag is what a later feature starts trusting.** "Jarvis must not create parallel
 *   consent, preference, suppression, STOP/START or delivery state — not as a flag, not as a list,
 *   not as a cache, and not as a courtesy copy" (communication-model.md). A derived `eligible`
 *   would be the courtesy copy.
 *
 * A caller that wants to know what Core said reads `observation.authorization.outcome`. That is a
 * fact about a record. It is not a grant, and nothing here dresses it up as one.
 */
import type {
  CommunicationAuthorizationV1,
  CommunicationRefusalReason,
  CommunicationRequestV1,
} from '@qf-jarvis/contracts';
import type { ApprovalDecisionCorrelation } from '@qf-jarvis/approval-runtime';

import type { CommunicationAuthorizationValidationInput } from './input.js';

/**
 * One validated, correlated pair — with the approval that supported it, when there was one.
 *
 * Deeply frozen. Both artifacts are returned VERBATIM: Core's answer is evidence, and evidence a
 * caller can edit is not evidence.
 */
export interface CommunicationAuthorizationObservation {
  readonly request: CommunicationRequestV1;
  readonly authorization: CommunicationAuthorizationV1;
  /**
   * The approval runtime's own observation, present whenever evidence was supplied AND held up.
   *
   * Always present on an authorized outcome, because an authorization cannot be observed without
   * one. Optional on a refusal, because Core may refuse before any human has been asked.
   */
  readonly approvalCorrelation?: ApprovalDecisionCorrelation;
  /**
   * The refusal, when it is one of the reasons the architecture NAMES.
   *
   * Present only when the outcome is `rejected` and `reasonCode` is exactly a member of
   * `COMMUNICATION_REFUSAL_REASONS`. For observability, display and evaluation — nothing branches
   * on it here.
   *
   * Its ABSENCE means "Core gave a reason this repository does not have a constant for". It does
   * NOT mean the refusal was weaker, unrecognised or ignorable: `reasonCode` is open because Core
   * owns its own taxonomy, and an unknown refusal is exactly as binding as a known one. The raw
   * `reasonCode` is always preserved verbatim on the authorization itself.
   */
  readonly knownRefusalReason?: CommunicationRefusalReason;
}

/**
 * The correlation runtime.
 *
 * ONE method, synchronous, pure. There is no `authorize`, `approve`, `send`, `execute`, `dispatch`,
 * `deliver`, `consent`, `optIn`, `optOut` or `grant` — not as a method, and not as a capability
 * this package could acquire, because it holds no transport, no store and no clock.
 */
export interface CommunicationAuthorizationRuntime {
  /** Prove the artifacts belong together. Throws a bounded error; returns a frozen observation. */
  validate(input: CommunicationAuthorizationValidationInput): CommunicationAuthorizationObservation;
}
