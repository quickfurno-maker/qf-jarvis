/**
 * `@qf-jarvis/riya-quality-evaluation` — the RWC-P10 Riya quality, evaluation and sales-optimization
 * layer (ADR-0106).
 *
 * ### What it is
 *
 * A Riya-SPECIFIC leaf evaluator sitting ABOVE `@qf-jarvis/model-evaluation`, which remains the
 * generic safety and red-team authority. A quality candidate binding can only be DERIVED from an
 * existing ACTIVE/SHADOW/CANARY approval evidence, so quality literally cannot exist without generic
 * safety evidence, and no amount of sales quality can compensate for its absence.
 *
 * ### What it never does
 *
 * It calls no model. No gateway, no provider, no local inference, no HTTP, no LLM-as-judge, no model
 * voting, no scoring prompt, no embeddings. Objective correctness is checked against pre-supplied
 * normalized observations; subjective sales quality comes from exactly two independent HUMAN reviews.
 * It edits no prompt, changes no runtime binding, selects no provider, activates nothing and deploys
 * nothing.
 *
 * ### The honest limit
 *
 * This package makes Riya quality MEASURABLE. It does not, by existing, establish that any real model
 * or prompt has passed the suite — that requires candidate outputs and human reviews produced outside
 * this repository and fed in.
 *
 * ### The public surface
 *
 * Closed vocabularies, the factories, the evaluator, the evidence gate and the comparator. The
 * schemas, the digest preimages, the per-case evaluator and the comparator's internals are NOT
 * exported: exporting a schema invites a caller to build a scenario the constructor never checked,
 * and exporting the case evaluator invites a second evaluation loop beside the suite one.
 *
 * The synthetic golden corpus and its builders live under `./testing`, so raw synthetic conversation
 * text can never be reached from a production import path.
 */

// Closed vocabularies.
export {
  RIYA_QUALITY_LANGUAGE_MODES,
  RIYA_QUALITY_INTERACTION_KINDS,
  RIYA_QUALITY_DIMENSIONS,
  RIYA_QUALITY_CASE_OUTCOMES,
  RIYA_QUALITY_COMPARISON_OUTCOMES,
  RIYA_QUALITY_OBJECTIVE_FAILURE_CODES,
  RIYA_QUALITY_DISCOVERY_FIELDS,
  RIYA_QUALITY_EXPECTABLE_PROVENANCES,
} from './contracts/vocabularies.js';
export type {
  RiyaQualityLanguageMode,
  RiyaQualityInteractionKind,
  RiyaQualityDimension,
  RiyaQualityCaseOutcome,
  RiyaQualityComparisonOutcome,
  RiyaQualityObjectiveFailureCode,
  RiyaQualityDiscoveryField,
  RiyaQualityExpectableProvenance,
} from './contracts/vocabularies.js';

// Errors.
export { RIYA_QUALITY_ERROR_CODES, RiyaQualityEvaluationError } from './contracts/errors.js';
export type { RiyaQualityErrorCode } from './contracts/errors.js';

// Human review.
export { createRiyaQualityHumanReview } from './contracts/human-review.js';
export type {
  RiyaQualityHumanReviewV1,
  RiyaQualityHumanReviewInput,
} from './contracts/human-review.js';

// Observation.
export { createRiyaQualityObservation } from './contracts/observation.js';
export type {
  RiyaQualityObservationV1,
  RiyaQualityObservationInput,
  RiyaQualityCitation,
} from './contracts/observation.js';

// Scenario.
export { createRiyaQualityScenario } from './contracts/scenario.js';
export type {
  RiyaQualityScenarioV1,
  RiyaQualityScenarioInput,
  RiyaQualityExpectation,
  RiyaQualityExpectedObservation,
} from './contracts/scenario.js';

// Thresholds.
export {
  createRiyaQualityThresholds,
  RIYA_QUALITY_CANONICAL_THRESHOLDS_V1,
  RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
} from './contracts/thresholds.js';
export type {
  RiyaQualityThresholdsV1,
  RiyaQualityThresholdsInput,
} from './contracts/thresholds.js';

// Candidate binding, derived from generic safety evidence.
export {
  createRiyaQualityCandidateBinding,
  RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS,
  RIYA_QUALITY_EVALUATOR_IMPL_ID,
  RIYA_QUALITY_EVALUATOR_IMPL_VERSION,
} from './contracts/binding.js';
export type {
  RiyaQualityCandidateBindingV1,
  RiyaQualityCandidateBindingInput,
  RiyaQualityReleaseRef,
} from './contracts/binding.js';

// Suite.
export { createRiyaQualitySuite, RIYA_QUALITY_MAX_SCENARIOS } from './contracts/suite.js';
export type { RiyaQualitySuiteV1, RiyaQualitySuiteInput } from './contracts/suite.js';

// Results and evidence.
export type {
  RiyaQualityCaseResultV1,
  RiyaQualitySuiteResultV1,
  RiyaQualityThresholdBreach,
  RiyaQualityEvidenceV1,
  RiyaQualityDimensionDelta,
  RiyaQualityComparisonResultV1,
} from './contracts/results.js';

// Services.
export { evaluateRiyaQualitySuite } from './service/evaluate-suite.js';
export { createRiyaQualityEvidence } from './service/create-evidence.js';
export type {
  CreateRiyaQualityEvidenceOptions,
  RiyaQualityEvidenceResult,
} from './service/create-evidence.js';
export {
  compareRiyaQualityCandidates,
  createRiyaQualityComparisonPolicy,
  RIYA_QUALITY_CANONICAL_COMPARISON_POLICY_V1,
} from './service/compare-candidates.js';
export type {
  RiyaQualityComparisonPolicyV1,
  RiyaQualityComparisonPolicyInput,
} from './service/compare-candidates.js';
