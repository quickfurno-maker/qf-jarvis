/**
 * `@qf-jarvis/riya-intelligence-dataset` — the RID-F1 dataset foundation and leakage firewall
 * (ADR-0107).
 *
 * ### What it is
 *
 * The OFFLINE dataset factory for Riya post-training. The canonical record is a multi-turn
 * TRAJECTORY — state, customer message, simulated authoritative context, assistant decision,
 * objective and expected observation — and model-specific training rows are DERIVED from it. The
 * corpus teaches a strategy, not a set of sentences.
 *
 * ### What it never does
 *
 * It trains nothing and invokes nothing: no model, provider, gateway, local inference, HTTP,
 * LLM-as-judge, embedding, vector store, tokenizer, training framework, checkpoint or job. No dataset
 * item can start a run, and release evidence is always `trainingApproval: false`.
 *
 * It also cannot represent a real conversation. Source kinds are synthetic only, so live chat, CRM
 * and WhatsApp exports have no spelling in this contract.
 *
 * ### The firewalls
 *
 * Splits are isolated by LINEAGE, so a synthetic variant cannot cross into the split its parent is
 * scored in. The RWC-P10 golden corpus is protected EXAM data rather than a split: exact copies are
 * rejected and near copies quarantined, by deterministic token overlap and never by a model. Privacy
 * gates reject email, phone, API key, bearer and service-role tokens, private keys, UPI-like handles,
 * URLs and governed production names — reporting the location and the kind, never the text. And an
 * assistant turn asserting a price, availability, policy or warranty must cite a fact an EARLIER
 * authoritative context supplied, so volatile business truth stays out of the weights.
 *
 * ### The public surface
 *
 * Vocabularies, factories, the validator, the manifest, the release gate, the SFT derivation and the
 * JSONL helpers. The regexes, the schemas, the near-match internals, the digest preimages and any
 * protected-corpus content are NOT exported: a caller holding the near-match helper would tune it,
 * and a caller holding a schema would build a record the constructor never checked.
 */

// Closed vocabularies.
export {
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_QUALITY_DIMENSIONS,
  RIYA_DATASET_DISCOVERY_FIELDS,
  RIYA_DATASET_SPLITS,
  RIYA_DATASET_PERSONAS,
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_RISK_CLASSES,
  RIYA_DATASET_SOURCE_KINDS,
  RIYA_DATASET_TURN_TYPES,
  RIYA_DATASET_CONTEXT_AUTHORITIES,
  RIYA_DATASET_FACT_CLASSES,
  RIYA_DATASET_ASSISTANT_DECISIONS,
  RIYA_DATASET_RESPONSE_OBJECTIVES,
  RIYA_DATASET_REVIEW_DECISIONS,
  RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS,
  RIYA_DATASET_OBJECTION_REVIEW_DIMENSIONS,
  RIYA_DATASET_REQUIRED_REVIEWS,
} from './contracts/vocabularies.js';
export type {
  RiyaDatasetLanguageMode,
  RiyaDatasetInteractionKind,
  RiyaDatasetQualityDimension,
  RiyaDatasetDiscoveryField,
  RiyaDatasetSplit,
  RiyaDatasetPersona,
  RiyaDatasetDifficulty,
  RiyaDatasetRiskClass,
  RiyaDatasetSourceKind,
  RiyaDatasetTurnType,
  RiyaDatasetContextAuthority,
  RiyaDatasetFactClass,
  RiyaDatasetAssistantDecision,
  RiyaDatasetResponseObjective,
  RiyaDatasetReviewDecision,
} from './contracts/vocabularies.js';

// Errors.
export { RIYA_DATASET_ERROR_CODES, RiyaDatasetError } from './contracts/errors.js';
export type { RiyaDatasetErrorCode } from './contracts/errors.js';

// Training state.
export { createRiyaTrainingState } from './contracts/training-state.js';
export type { RiyaTrainingStateV1, RiyaTrainingStateInput } from './contracts/training-state.js';

// Turns.
export {
  createRiyaDatasetUserTurn,
  createRiyaDatasetAuthoritativeContextTurn,
  createRiyaDatasetAssistantTurn,
} from './contracts/turns.js';
export type {
  RiyaDatasetTurnV1,
  RiyaDatasetUserTurnV1,
  RiyaDatasetContextTurnV1,
  RiyaDatasetAssistantTurnV1,
  RiyaDatasetAssistantAnnotationV1,
  RiyaDatasetAuthoritativeFactV1,
} from './contracts/turns.js';

// Review.
export { createRiyaTrainingReview } from './contracts/review.js';
export type { RiyaTrainingReviewV1, RiyaTrainingReviewInput } from './contracts/review.js';

// Trajectory.
export {
  createRiyaIntelligenceTrajectory,
  RIYA_DATASET_MAX_TURNS,
  RIYA_DATASET_MAX_ASSISTANT_TURNS,
} from './contracts/trajectory.js';
export type {
  RiyaIntelligenceTrajectoryV1,
  RiyaIntelligenceTrajectoryInput,
  RiyaDatasetSourceV1,
} from './contracts/trajectory.js';

// Coverage and release policy.
export { createRiyaDatasetCoveragePolicy } from './contracts/coverage-policy.js';
export type {
  RiyaDatasetCoveragePolicyV1,
  RiyaDatasetCoveragePolicyInput,
} from './contracts/coverage-policy.js';
export { createRiyaDatasetReleasePolicy } from './contracts/release-policy.js';
export type {
  RiyaDatasetReleasePolicyV1,
  RiyaDatasetReleasePolicyInput,
} from './contracts/release-policy.js';

// Manifest.
export {
  createRiyaIntelligenceDatasetManifest,
  riyaDatasetManifestIntegrityHolds,
} from './contracts/manifest.js';
export type {
  RiyaIntelligenceDatasetManifestV1,
  RiyaIntelligenceDatasetManifestInput,
  RiyaDatasetManifestRecordV1,
} from './contracts/manifest.js';
export {
  buildRiyaIntelligenceDatasetManifest,
  RIYA_DATASET_SCHEMA_VERSION,
} from './service/create-manifest.js';
export type { BuildRiyaDatasetManifestInput } from './service/create-manifest.js';

// Report and release evidence.
export type {
  RiyaDatasetReleaseReportV1,
  RiyaDatasetReleaseEvidenceV1,
  RiyaDatasetFindingLocation,
  RiyaDatasetReleaseBindingFailure,
} from './contracts/report.js';
export { riyaDatasetReportIntegrityHolds } from './internal/report-integrity.js';
export { validateRiyaIntelligenceDataset } from './service/validate-dataset.js';
export type { ValidateRiyaDatasetOptions } from './service/validate-dataset.js';
export { createRiyaDatasetReleaseEvidence } from './service/create-release-evidence.js';
export type {
  CreateRiyaDatasetReleaseEvidenceInput,
  RiyaDatasetReleaseEvidenceResult,
} from './service/create-release-evidence.js';

// The protected-exam firewall. The INDEX is built from strings the caller supplies; this package
// ships no protected content of its own.
export { createProtectedTextIndex } from './internal/leakage.js';
export type { ProtectedTextIndex, ProtectedTextEntry } from './internal/leakage.js';

// Derived SFT samples.
export {
  deriveRiyaSftSamples,
  deriveRiyaSftSamplesForDataset,
} from './service/derive-sft-samples.js';
export type {
  RiyaSftSampleV1,
  RiyaSftTargetV1,
  RiyaSftPrefixTurnV1,
  RiyaSftContextFactV1,
} from './service/derive-sft-samples.js';

// JSONL interchange.
export { serializeRiyaTrajectoryJsonlLine, parseRiyaTrajectoryJsonlLine } from './service/jsonl.js';
