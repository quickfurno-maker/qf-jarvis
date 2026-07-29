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
  /**
   * Whether the evidence came from synthetic fixtures rather than a real evaluation run.
   *
   * QFJ-S2-C-B widened this from the literal `true` to a validated boolean so a future non-synthetic
   * production-evidence path can exist at all (ADR-0063 §4). `createApprovalEvidence` still emits
   * `true` — it scores synthetic fixtures — and this slice manufactures NO production artifact.
   */
  readonly synthetic: boolean;
  /**
   * Whether the evidence constitutes production rollout approval.
   *
   * `synthetic: true` together with `productionApproval: true` is INVALID: evidence cannot be both
   * synthetic and production-approved. CANARY and ACTIVE require `synthetic: false` AND
   * `productionApproval: true`; the rule is enforced where untrusted evidence enters, in the
   * composition registry.
   */
  readonly productionApproval: boolean;
}
