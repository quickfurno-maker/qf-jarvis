/**
 * The single evidence gate for any candidate-bearing rollout state (QFJ-S2-C-B amendment, ADR-0063 §10).
 *
 * The first S2-C-B revision gated only TRANSITIONS. A caller could seed a controller with an initial
 * SHADOW/CANARY/ACTIVE policy — or hand the gateway a foreign `ProviderRolloutController` whose
 * `snapshot()` returns one — and reach provider execution without ever passing a transition. This
 * module is the one implementation all three call sites share, so a fourth call site cannot invent a
 * weaker rule:
 *
 *   1. `validateTransition`      — a proposed transition above OFF;
 *   2. `createProviderRolloutController` — the INITIAL policy it is seeded with;
 *   3. the gateway serving boundary — the CURRENT policy, before any provider is consulted.
 *
 * It takes the pieces it needs rather than a whole policy, so it introduces no module cycle and cannot
 * be handed a partially-built object. It is pure and synchronous; the verifier reads a frozen in-memory
 * snapshot, so this performs no I/O.
 */
import type { GatewayMode } from '../contracts/enums.js';
import type { EvaluationEvidenceVerifier } from './evaluation-evidence-verifier.js';
import type { ProviderReleaseRef } from './provider-release.js';
import { approvalEvidenceClaim, type RolloutApprovalAttestation } from './rollout-approval.js';
import type { RolloutRefusalReason } from './rollout-reasons.js';

/** Permitted, or a closed refusal reason. Never a message, cause, stack or evidence payload. */
export type PolicyEvidenceCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: RolloutRefusalReason };

const PERMITTED: PolicyEvidenceCheck = Object.freeze({ ok: true as const });

/**
 * Prove that a candidate-bearing rollout state is backed by registered evaluation evidence.
 *
 * `OFF`, and any state without a candidate, needs no evidence and is permitted. Everything else must
 * present a complete evidence claim AND satisfy the injected verifier. Nothing the caller supplies is
 * trusted on its own: `evaluationRef`, `evidenceDigest`, `approvalTarget`, `approvedModeCeiling`,
 * `releaseId` and `configDigest` are all CLAIMS, checked against what the frozen registry actually holds.
 */
export function verifyCandidateEvidence(args: {
  readonly mode: GatewayMode;
  readonly candidate: ProviderReleaseRef | undefined;
  readonly approval: RolloutApprovalAttestation | undefined;
  readonly verifier: EvaluationEvidenceVerifier | undefined;
}): PolicyEvidenceCheck {
  const { mode, candidate, approval, verifier } = args;
  if (mode === 'OFF' || candidate === undefined) {
    return PERMITTED;
  }
  if (approval === undefined) {
    return { ok: false, reason: 'approval-missing' };
  }
  // Without a verifier nothing can be proved, so nothing is permitted. An absent gate is not an open one.
  if (verifier === undefined) {
    return { ok: false, reason: 'evidence-verifier-unavailable' };
  }
  const claim = approvalEvidenceClaim(approval);
  if (claim === undefined) {
    // A pre-S2-C-B attestation carrying only `evaluationRef` cannot back a candidate-bearing state.
    return { ok: false, reason: 'evidence-missing' };
  }
  const verification = verifier.verify({
    evaluationRef: approval.evaluationRef,
    evidenceDigest: claim.evidenceDigest,
    approvalTarget: claim.approvalTarget,
    release: candidate,
    capabilityProfileRef: claim.capabilityProfileRef,
    mode,
  });
  return verification.ok ? PERMITTED : { ok: false, reason: verification.reason };
}
