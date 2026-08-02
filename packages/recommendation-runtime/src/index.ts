/**
 * `@qf-jarvis/recommendation-runtime` — the governed recommendation runtime (QFJ-P05.05, ADR-0079).
 *
 * `RecommendationV1`, `ProposedAction`, `ApprovalRequestV1` and `ActionFingerprint` have existed in
 * `@qf-jarvis/contracts` since Phase 2. What did not exist was a PRODUCER: nothing in the repository
 * built a validated recommendation, and nothing computed the SHA-256 `actionFingerprint` that
 * `ApprovalRequestV1` requires and the contracts package deliberately declines to compute. The
 * approval runtime therefore had a prerequisite with no implementation. This package is it.
 *
 * It does two things:
 *
 * 1. `createRecommendationRuntime(...).create(input)` — validate explicit semantics, stamp the
 *    identities and the literal `producingSystem`, validate the assembled artifact against the real
 *    contract, and return it deeply frozen alongside one action binding per proposed action.
 * 2. `fingerprintProposedAction(action)` — the canonical content digest, exposed on its own so a
 *    later phase can verify a fingerprint without rebuilding a recommendation.
 *
 * **The recommendation is inert, and this package has no authority.** It infers no risk and no
 * approval level; it creates no approval request; it decides, executes, sends, delivers, persists
 * and emits nothing. Core, not Jarvis, emits `qf.recommendation.created` after Core records the
 * submission. The fingerprint is a content binding — unkeyed, publicly computable — and is not a
 * signature, a MAC, an authorization or a proof of origin.
 *
 * Jarvis recommends. QuickFurno Core authorizes. n8n executes. Providers deliver. Results return to
 * Core.
 *
 * Four root runtime symbols. Every schema, canonicalizer, identity helper and freezer stays internal.
 */
export {
  RECOMMENDATION_RUNTIME_ERROR_CODES,
  RecommendationRuntimeError,
} from './contracts/errors.js';
export type { RecommendationRuntimeErrorCode } from './contracts/errors.js';

export { createRecommendationRuntime } from './create-recommendation-runtime.js';

export { fingerprintProposedAction } from './internal/fingerprint.js';

export type { ProposedActionDraft, RecommendationRuntimeInput } from './contracts/input.js';
export type {
  RecommendationActionBinding,
  RecommendationRuntime,
  RecommendationRuntimeIdentityPort,
  RecommendationRuntimeResult,
} from './contracts/result.js';
