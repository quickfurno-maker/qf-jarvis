/**
 * The runtime result and its action bindings (QFJ-P05.05, ADR-0079).
 *
 * ### Why bindings exist as a separate array
 *
 * `ApprovalRequestV1` requires three things together: a `recommendationId`, a `proposedActionId`,
 * and an `actionFingerprint`. The first two live on the recommendation; the third is computed and
 * belongs nowhere on `RecommendationV1` — deliberately, because a fingerprint stored inside the
 * object it fingerprints is a value that can disagree with its own subject.
 *
 * So the runtime returns the triples alongside the artifact. Each binding is exactly the tuple the
 * next phase needs to build one approval request, already assembled and already checked: one per
 * proposed action, in the same order, with `recommendationId` equal to the recommendation's own and
 * `proposedActionId` equal to that action's.
 *
 * This is the entire bridge to the P08 approval runtime. Nothing here requests, records or grants
 * an approval — it supplies the values a later, separately governed phase will need.
 */
import type { ActionFingerprint, RecommendationV1 } from '@qf-jarvis/contracts';

/** The exact triple `ApprovalRequestV1` needs, for ONE proposed action. */
export interface RecommendationActionBinding {
  readonly recommendationId: string;
  readonly proposedActionId: string;
  /** The canonical SHA-256 content digest. A content binding, never a signature or an authority. */
  readonly actionFingerprint: ActionFingerprint;
}

/**
 * One created recommendation and its bindings.
 *
 * Deeply frozen. `actionBindings` is empty exactly when `recommendation.proposedActions` is empty —
 * which, by `RecommendationV1`'s own invariants, is exactly when the recommendation is
 * informational and therefore executes nothing.
 */
export interface RecommendationRuntimeResult {
  readonly recommendation: RecommendationV1;
  readonly actionBindings: readonly RecommendationActionBinding[];
}

/**
 * Supplies the identities the runtime stamps onto artifacts it creates.
 *
 * Injectable so a test can be deterministic, and so a future caller can source identifiers from
 * somewhere other than this process. It supplies IDENTITY only: it sees no input, states no
 * semantics, and cannot influence risk, approval, evidence or content.
 *
 * Whatever it returns is validated against the contract UUID schemas before use. An injected port
 * is still untrusted input.
 */
export interface RecommendationRuntimeIdentityPort {
  nextRecommendationId(): string;
  nextActionId(): string;
}

/**
 * The runtime.
 *
 * ONE synchronous method. It reads no clock — `createdAt` and `expiresAt` are caller-stated — and
 * touches no I/O, so there is nothing to await.
 *
 * There is deliberately no `createApprovalRequest`, no `approve`, no `decide`, no `execute`, no
 * `send` and no `emit`. Jarvis recommends; QuickFurno Core authorizes; n8n executes.
 */
export interface RecommendationRuntime {
  create(input: unknown): RecommendationRuntimeResult;
}
