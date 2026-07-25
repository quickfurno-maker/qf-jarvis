/**
 * Immutable approval evidence (QFJ-P04.04, ADR-0052 §N).
 *
 * Evidence is created ONLY when every gate passes. It is content-free, carries an opaque stable
 * `evaluationRef` for future rollout composition, and is explicitly marked SYNTHETIC foundation
 * evidence — it is never a real Groq/local approval, never promotes a rollout, and never fabricates
 * model quality. It authorizes and executes nothing.
 */
import type { EvaluationBinding } from './binding.js';
import type { EvaluationApprovalTarget } from './vocabularies.js';

/** The immutable evidence that a release passed a suite for one approval target. */
export interface ApprovalEvidence {
  /** A stable opaque reference future rollout composition may cite. */
  readonly evaluationRef: string;
  readonly target: EvaluationApprovalTarget;
  readonly binding: EvaluationBinding;
  readonly suiteResultDigest: string;
  readonly caseSetDigest: string;
  readonly createdAt: string;
  /** ALWAYS true in this foundation slice: the evidence is synthetic, not production approval. */
  readonly synthetic: true;
  /** ALWAYS false: this evidence never constitutes production rollout approval on its own. */
  readonly productionApproval: false;
}
