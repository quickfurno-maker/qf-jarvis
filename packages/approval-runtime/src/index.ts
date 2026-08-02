/**
 * `@qf-jarvis/approval-runtime` — the approval runtime foundation (QFJ-P08, ADR-0080).
 *
 * QFJ-P05.05 supplied the missing producer: a governed `RecommendationV1` and, per proposed action,
 * the `{ recommendationId, proposedActionId, actionFingerprint }` triple `ApprovalRequestV1`
 * requires. This package is what consumes that triple.
 *
 * Two responsibilities:
 *
 * 1. `createRequest(input)` — build a **powerless** `ApprovalRequestV1` about ONE exact proposed
 *    action. `risk` and `requestedAuthority` are DERIVED from the recommendation, never restated by
 *    the caller, so an existing recommendation's governance cannot be rewritten at ask time.
 * 2. `validateDecision(input)` — correlate an `ApprovalDecisionV1` that QuickFurno Core has ALREADY
 *    issued against that request, that recommendation, that action, and a **recomputed** fingerprint.
 *
 * **Jarvis asks. QuickFurno Core decides.** This package approves nothing, decides nothing, persists
 * nothing, queues nothing, calls Core, emits no event, creates no execution intent, and holds no
 * pending or approved state. The correlation result is an OBSERVATION: it carries no
 * `isAuthorized`, `canExecute`, `canSend` or `consentValid`, because an approval is not a
 * communication authorization and founder approval does not override an opt-out.
 *
 * Nor does it second-guess Core. Once a structurally valid, correctly correlated decision arrives,
 * whether the decider had sufficient organizational authority is Core's question — there is no
 * founder list, admin list, role lookup or authority cache here.
 *
 * Three root runtime symbols. Every schema, validator, identity helper and freezer stays internal.
 */
export { APPROVAL_RUNTIME_ERROR_CODES, ApprovalRuntimeError } from './contracts/errors.js';
export type { ApprovalRuntimeErrorCode } from './contracts/errors.js';

export { createApprovalRuntime } from './create-approval-runtime.js';

export type {
  ApprovalDecisionValidationInput,
  ApprovalRequestRuntimeInput,
} from './contracts/input.js';
export type {
  ApprovalDecisionCorrelation,
  ApprovalRuntime,
  ApprovalRuntimeIdentityPort,
} from './contracts/result.js';
