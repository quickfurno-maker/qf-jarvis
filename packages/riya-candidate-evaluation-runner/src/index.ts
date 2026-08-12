/**
 * `@qf-jarvis/riya-candidate-evaluation-runner` — the offline candidate evaluation BRIDGE (MVP-P2A.1).
 *
 * ### What was missing, and only that
 *
 * `@qf-jarvis/model-evaluation` owns safety. `@qf-jarvis/riya-quality-evaluation` owns P10 quality.
 * Both are pure authorities: they judge observations that arrive from somewhere else. Nothing in this
 * repository could produce those observations from a real candidate, so neither gate had ever been
 * run against a model. This package is that missing step and nothing more — it schedules synthetic
 * cases through an injected port, turns what happened into the authorities' own observation types, and
 * hands them over.
 *
 * ### Dependency direction
 *
 * The bridge depends on the authorities. The authorities do not, and must not, depend on the bridge —
 * an evaluator that could reach a provider is an evaluator that can be pointed at one under deadline.
 *
 * ### It runs nothing real, and authorizes nothing
 *
 * Execution happens only through `RiyaCandidateExecutionPort` / `RiyaQualityCandidatePort`, and every
 * candidate this package has run against is a deterministic fake. There is no provider SDK, no HTTP,
 * no credential, no retry, no endpoint and no price table — all of that already exists behind the
 * model gateway, and a second copy would be a second thing to keep correct. No production runtime
 * imports this package; a spec proves it.
 *
 * Evidence authorizes nothing. Safety before quality, quality before operational benchmark, and an
 * owner chooses at the end. There is no composite score anywhere in this package.
 */

// Errors.
export { RiyaCandidateRunnerError, RIYA_CANDIDATE_RUNNER_ERROR_CODES } from './contracts/errors.js';
export type { RiyaCandidateRunnerErrorCode } from './contracts/errors.js';

// The provider-neutral safety execution port.
export {
  CANDIDATE_EXECUTION_OUTCOMES,
  CANDIDATE_KNOWLEDGE_USES,
  CANDIDATE_CLAIM_KINDS,
  CANDIDATE_AUTHORITY_TREATMENTS,
  CANDIDATE_KNOWLEDGE_INPUT_STATES,
  MAX_CANDIDATE_GROUNDED_RECORDS,
  createCandidateGroundedKnowledgeInput,
} from './contracts/candidate-port.js';
export type {
  RiyaCandidateExecutionPort,
  RiyaCandidateRequest,
  RiyaCandidateExecutionRecord,
  CandidateExecutionOutcome,
  CandidateKnowledgeUse,
  CandidateClaimKind,
  CandidateAuthorityTreatment,
  CandidateCitationFact,
  CandidateKnowledgeInputState,
  CandidateGroundedKnowledgeInput,
  CandidateGroundedKnowledgeRecordInput,
} from './contracts/candidate-port.js';

// Safety: fixtures, extraction, runner.
export {
  RIYA_SAFETY_FIXTURES,
  RIYA_SAFETY_FIXTURE_MANIFEST_ID,
  RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
  RIYA_SAFETY_SUITE_ID,
  RIYA_SAFETY_SUITE_VERSION,
  RIYA_SAFETY_FIXTURE_PROVENANCE,
  RIYA_SAFETY_SENTINEL_SECRET,
  RIYA_SAFETY_SENTINEL_SYSTEM_LINE,
  RIYA_SAFETY_EXECUTION_EXPECTATIONS,
} from './safety/fixtures.js';
export type { RiyaSafetyFixtureV1, RiyaSafetyExecutionExpectation } from './safety/fixtures.js';
export {
  extractSafetyObservation,
  SAFETY_INCOMPLETE_REASONS,
} from './safety/extract-observation.js';
export type {
  SafetyObservationResult,
  SafetyIncompleteReason,
} from './safety/extract-observation.js';
export { runRiyaSafetyCandidate } from './safety/run-safety.js';
export type {
  RunRiyaSafetyCandidateOptions,
  RunRiyaSafetyCandidateResult,
  RiyaSafetyBlockedCase,
} from './safety/run-safety.js';

// P10: capture, blinded bundle, external write, review ingest.
export {
  captureRiyaQualityCandidates,
  QUALITY_CAPTURE_INCOMPLETE_REASONS,
} from './quality/capture.js';
export type {
  RiyaQualityCandidatePort,
  RiyaQualityCandidateRequest,
  RiyaQualityCandidateRecord,
  RiyaQualityCandidateCapture,
  RiyaQualityCaptureResult,
  RiyaQualityCaptureIncomplete,
  QualityCaptureIncompleteReason,
} from './quality/capture.js';
export { riyaReviewCaseDigest, RIYA_REVIEW_CASE_DIGEST_DOMAIN } from './quality/case-digest.js';
export type { RiyaReviewCaseDigestInput } from './quality/case-digest.js';
export {
  buildRiyaQualityReviewBundle,
  RIYA_REVIEW_BUNDLE_VERSION,
} from './quality/review-bundle.js';
export type { RiyaQualityReviewBundle, RiyaQualityReviewCase } from './quality/review-bundle.js';
export { writeRiyaQualityReviewBundle } from './quality/write-bundle.js';
export type { RiyaReviewBundleWriteReceipt } from './quality/write-bundle.js';
export {
  ingestRiyaQualityReviews,
  evaluateRiyaQualityFromReviews,
  REVIEW_REJECTION_REASONS,
} from './quality/ingest-reviews.js';
export type {
  RiyaQualityCaseReviews,
  RiyaQualityIngestResult,
  RiyaQualityReviewRejection,
  ReviewRejectionReason,
} from './quality/ingest-reviews.js';
