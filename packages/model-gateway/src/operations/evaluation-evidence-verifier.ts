/**
 * The injected evaluation-evidence verifier seam (QFJ-S2-C-B, ADR-0063 §1).
 *
 * TYPE-ONLY. This module declares no runtime value, so it adds nothing to the package-root export
 * count, and — critically — it imports NOTHING from `@qf-jarvis/model-evaluation`. The gateway stays
 * locked to `dependencies: ["zod"]` and stays provider-neutral; the implementation lives in
 * `@qf-jarvis/model-gateway-composition`, the one layer that may see both packages.
 *
 * The request carries only what a verifier needs to answer "is this attestation backed by registered,
 * passing, correctly bound evidence for THIS mode?" — identifiers, a digest, and an enum. The
 * `approvalTarget` is a bounded string rather than an imported union precisely because importing the
 * evaluation vocabulary here would create the dependency this seam exists to avoid.
 *
 * The result is a closed union carrying an existing {@link RolloutRefusalReason} and nothing else: no
 * message, no cause, no stack, no evidence payload.
 */
import type { GatewayMode } from '../contracts/enums.js';
import type { ProviderReleaseRef } from './provider-release.js';
import type { RolloutRefusalReason } from './rollout-reasons.js';

/** What the rollout layer asks a verifier to confirm. Identifiers, one digest, one mode — no payload. */
export interface EvidenceVerificationRequest {
  /** The opaque reference the attestation cites. */
  readonly evaluationRef: string;
  /** The digest the attestation claims. A verifier RECOMPUTES; it never trusts this value. */
  readonly evidenceDigest: string;
  /** The approval target the attestation claims, as a bounded string (see the module note). */
  readonly approvalTarget: string;
  /** The exact candidate release the transition would serve. */
  readonly release: ProviderReleaseRef;
  /** The exact capability profile the approval was granted against. */
  readonly capabilityProfileRef: string;
  /** The rollout mode being requested. `OFF` never reaches a verifier — it needs no evidence. */
  readonly mode: GatewayMode;
}

/** A verification outcome: permitted, or a closed refusal reason. Never a message or a payload. */
export type EvidenceVerificationResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: RolloutRefusalReason };

/**
 * Confirms that an attestation is backed by registered evidence. Pure and synchronous: a verifier reads
 * a frozen in-memory snapshot, so it performs no I/O and cannot fail for an environmental reason.
 */
export interface EvaluationEvidenceVerifier {
  verify(request: EvidenceVerificationRequest): EvidenceVerificationResult;
}
