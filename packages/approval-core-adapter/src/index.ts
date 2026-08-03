/**
 * `@qf-jarvis/approval-core-adapter` — Core approval submission (QFJ-P08, ADR-0082).
 *
 * The repository already generates a governed `RecommendationV1`, builds a POWERLESS
 * `ApprovalRequestV1`, validates and correlates an `ApprovalDecisionV1`, and stores all three
 * durably with at most one active ask per action. What it could not do was let a human ACT on one of
 * those asks.
 *
 * This package is the missing verb, and it is deliberately a small one.
 *
 * `ApprovalRequestV1` carries no approve/reject field, and `ApprovalDecisionV1` is Core's answer
 * rather than Jarvis's, so a click needs a third artifact: a POWERLESS statement of human intent, in
 * transit only. `submit` serializes that intent into a versioned wire command, hands it to an
 * INJECTED transport together with an opaque authorization proof Core validates independently, and
 * correlates whatever comes back through the public approval runtime.
 *
 * **Jarvis asks. QuickFurno Core decides** (ADR-0002, ADR-0007). A button click inside Jarvis is a
 * request for authorization, never an authorization — Core re-checks identity, authority, current
 * state, risk policy, expiry and eligibility against its own truth, and may refuse the intent the
 * human just expressed. This package holds no approved state and has no field in which one could be
 * expressed; `APPROVE` may lawfully come back rejected, and a `REJECT` or `REQUEST_CHANGES` that
 * came back as an approval of the selected action fails closed.
 *
 * It defines no endpoint, no URL, no header, no credential format and no Core-side behaviour: the
 * protocol here is PROPOSED until Core adopts it. It persists nothing, retries nothing, emits no
 * event, creates no execution intent, reads no clock and opens no socket. And a correlated approval
 * still is not permission to contact anyone: `CommunicationAuthorizationV1` is a separate contract,
 * and founder approval does not override an opt-out.
 *
 * Three root runtime symbols. The wire schema, the canonical serializer, the idempotency digest and
 * the faithfulness proof all stay internal — the command shape is a proposal, and a proposal that
 * something else can import is a proposal that has already been adopted by accident.
 */
export { APPROVAL_CORE_ADAPTER_ERROR_CODES, ApprovalCoreAdapterError } from './contracts/errors.js';
export type { ApprovalCoreAdapterErrorCode } from './contracts/errors.js';

export { createApprovalCoreAdapter } from './adapter/create-adapter.js';

export type {
  ApprovalCoreAdapter,
  ApprovalCoreAuthorizationProof,
  ApprovalCoreSubmissionInput,
  ApprovalCoreSubmissionResult,
  ApprovalCoreTransport,
  ApprovalOperatorAction,
  ApprovalOperatorActor,
  ApprovalRecommendationSource,
} from './contracts/api.js';
