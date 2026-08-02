/**
 * The correlation observation and the runtime surface (QFJ-P08, ADR-0080).
 *
 * ### The result is an OBSERVATION, not a permission
 *
 * `ApprovalDecisionCorrelation` says: "this decision, issued by Core, provably describes this
 * request, this recommendation and this exact action content." It says nothing else, and the field
 * set is chosen so that it CANNOT say anything else.
 *
 * There is deliberately no `isAuthorized`, `canExecute`, `canSend`, `communicationAllowed` or
 * `consentValid`. Each of those would be this package converting Core's decision into a permission,
 * and each would be wrong for a different reason:
 *
 * - **`canExecute`** — Core creates execution intents from its own recorded decision. Jarvis holding
 *   a boolean that says "this may run" puts a piece of the authorization state back inside Jarvis,
 *   which is the one place it may never be (ADR-0002).
 * - **`canSend` / `communicationAllowed`** — an approval is not a communication authorization. Even
 *   a founder-approved action may not reach a recipient who has opted out, is inside quiet hours, or
 *   has exhausted attempt limits. `CommunicationAuthorizationV1` is a separate contract with
 *   separate inputs, and collapsing the two is how an approval quietly becomes consent.
 *
 * A caller that wants to know what Core said reads `decision.outcome` and `actionDecision.decision`.
 * That is a fact about a record. It is not a grant, and nothing here dresses it up as one.
 */
import type {
  ActionDecision,
  ActionFingerprint,
  ActionId,
  ApprovalDecisionV1,
  ApprovalRequestId,
  ApprovalRequestV1,
  RecommendationId,
} from '@qf-jarvis/contracts';

/**
 * One validated, correlated Core decision, tied to one request.
 *
 * Deeply frozen. `actionDecision` is the entry for THIS request's action — which, under partial
 * approval, may be `rejected` while the overall `outcome` is `approved`. The per-action verdict is
 * what describes the action; the overall outcome describes the recommendation.
 */
export interface ApprovalDecisionCorrelation {
  readonly approvalRequestId: ApprovalRequestId;
  readonly recommendationId: RecommendationId;
  readonly proposedActionId: ActionId;
  /** The digest that was re-proved against the currently supplied action content. */
  readonly actionFingerprint: ActionFingerprint;
  readonly decision: ApprovalDecisionV1;
  /** The exact `actionDecisions` entry whose `actionId` is this request's action. */
  readonly actionDecision: ActionDecision;
}

/**
 * Supplies the identity the runtime stamps onto the requests it creates.
 *
 * Injectable so a test can be deterministic. It supplies IDENTITY only: it sees no recommendation,
 * no action and no policy, and cannot influence what is asked or of whom. Whatever it returns is
 * validated against `approvalRequestIdSchema` before use — an injected port is untrusted input.
 */
export interface ApprovalRuntimeIdentityPort {
  nextApprovalRequestId(): string;
}

/**
 * The runtime. Two synchronous methods, and no third.
 *
 * Neither reads a clock — every instant is caller-stated — and neither touches I/O, so there is
 * nothing to await. There is no `approve`, `decide`, `submit`, `execute`, `send`, `persist`,
 * `enqueue` or `emit`: Jarvis asks, QuickFurno Core decides, and the asking is powerless by
 * construction.
 */
export interface ApprovalRuntime {
  /** Build a powerless `ApprovalRequestV1` for one exact proposed action. */
  createRequest(input: unknown): ApprovalRequestV1;
  /** Correlate a decision Core has ALREADY issued against that request. Obtains nothing. */
  validateDecision(input: unknown): ApprovalDecisionCorrelation;
}
