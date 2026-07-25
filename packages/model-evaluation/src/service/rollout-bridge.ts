/**
 * The one-way rollout bridge (QFJ-P04.04, ADR-0052 §N).
 *
 * A PURE, read-only projection of approval evidence into a reference a future rollout composition may
 * cite. It mutates NO gateway or rollout state, promotes nothing, and activates no provider — it only
 * exposes the opaque `evaluationRef`, the target, and the exact release key. Rollout promotion remains
 * a separate, owner-authorized QFJ-P04.01E decision.
 */
import { releaseKey } from '../contracts/binding.js';
import type { ApprovalEvidence } from '../contracts/evidence.js';
import type { EvaluationApprovalTarget } from '../contracts/vocabularies.js';

/** A read-only reference a future rollout step may consume. It grants no authority by itself. */
export interface RolloutApprovalReference {
  readonly evaluationRef: string;
  readonly target: EvaluationApprovalTarget;
  readonly releaseKey: string;
  /** ALWAYS true here: synthetic foundation evidence, never production approval. */
  readonly synthetic: true;
}

/** Project evidence into a rollout reference. Pure; mutates nothing. */
export function toRolloutApprovalReference(evidence: ApprovalEvidence): RolloutApprovalReference {
  return Object.freeze({
    evaluationRef: evidence.evaluationRef,
    target: evidence.target,
    releaseKey: releaseKey(evidence.binding.release),
    synthetic: true,
  });
}
