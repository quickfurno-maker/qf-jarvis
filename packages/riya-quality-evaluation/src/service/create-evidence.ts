/**
 * Riya quality evidence (RWC-P10, ADR-0106 §18).
 *
 * ### It is evidence, and only evidence
 *
 * There is no rollout bridge here, and its absence is deliberate. `@qf-jarvis/model-evaluation` has
 * `toRolloutApprovalReference` because generic safety evidence is what a rollout ladder consumes.
 * Sales quality is not, and must not become, an activation signal: a Riya that is measurably warmer
 * is not thereby authorized to serve anybody. Promotion stays a human decision made in a separate
 * PR, reading this evidence as one input among several.
 *
 * ### Always synthetic, never a production approval
 *
 * `synthetic: true` and `productionApproval: false` are literals in the type, not fields a caller
 * can set. The corpus is synthetic and the reviews are annotations on synthetic fixtures; evidence
 * that could claim otherwise would be a production artifact this slice has no basis to manufacture.
 */
import { contentDigest } from '@qf-jarvis/model-evaluation';

import type { RiyaQualityErrorCode } from '../contracts/errors.js';
import type { RiyaQualityEvidenceV1, RiyaQualitySuiteResultV1 } from '../contracts/results.js';
import { recomputeRiyaQualityCaseSetDigest } from './evaluate-suite.js';

export interface CreateRiyaQualityEvidenceOptions {
  /** Overrides the timestamp stamped into the evidence. Canonical UTC instant. */
  readonly createdAt?: string;
}

/** Created evidence, or a closed refusal code. Never a partially-formed artifact. */
export type RiyaQualityEvidenceResult =
  | { readonly ok: true; readonly evidence: RiyaQualityEvidenceV1 }
  | { readonly ok: false; readonly code: RiyaQualityErrorCode };

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Attempt to create quality evidence. Fails CLOSED with a code.
 *
 * Two gates, in order. The digest must validate — a result whose case list was edited after
 * evaluation is not evidence of anything, and checking it here is what makes the artifact worth
 * storing. Then the suite must be eligible: evidence for a run that breached a threshold would be a
 * record of a failure wearing the shape of an approval.
 */
export function createRiyaQualityEvidence(
  result: RiyaQualitySuiteResultV1,
  options?: CreateRiyaQualityEvidenceOptions,
): RiyaQualityEvidenceResult {
  if (recomputeRiyaQualityCaseSetDigest(result) !== result.caseSetDigest) {
    return { ok: false, code: 'quality-digest-invalid' };
  }
  if (!result.qualityEligible) {
    return { ok: false, code: 'quality-not-eligible' };
  }

  const createdAt = options?.createdAt ?? result.binding.createdAt;
  if (!CANONICAL_INSTANT.test(createdAt)) {
    return { ok: false, code: 'quality-digest-invalid' };
  }

  // Derived, not random: the same eligible result always yields the same reference, so two runs of
  // the same evaluation cannot look like two different attestations.
  const qualityRef = `rqe.${contentDigest([
    result.binding.qualitySuiteId,
    result.binding.qualitySuiteVersion,
    result.binding.fixtureManifestId,
    result.binding.fixtureManifestVersion,
    result.binding.thresholdsId,
    result.binding.thresholdsVersion,
    result.binding.release.releaseId,
    result.binding.promptDigest,
    result.binding.safetyEvaluationRef,
    result.resultDigest,
    createdAt,
  ])}`;

  return {
    ok: true,
    evidence: Object.freeze({
      version: 1 as const,
      qualityRef,
      candidateBinding: result.binding,
      resultDigest: result.resultDigest,
      caseSetDigest: result.caseSetDigest,
      createdAt,
      synthetic: true as const,
      productionApproval: false as const,
    }),
  };
}
