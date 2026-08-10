/**
 * `@qf-jarvis/model-evaluation` — the QFJ-P04.04 Evaluation and Red-Team foundation (ADR-0052).
 *
 * The smallest stable composition surface: the closed vocabularies; the binding/scenario/observation/
 * threshold/suite factories and types; the deterministic evaluation service, the evidence gate, and
 * the one-way rollout bridge; and the content-free error/observability types. It does NOT export
 * mutable internals or the synthetic fixtures (those live under `./testing`). Evaluation produces
 * evidence only — it authorizes and executes nothing; QuickFurno Core remains final authority.
 */

// Closed vocabularies.
export {
  EVALUATION_APPROVAL_TARGETS,
  EVALUATION_CATEGORIES,
  EVALUATION_SEVERITIES,
  severityRank,
  BLOCKING_SEVERITIES,
  EVALUATION_OUTCOMES,
  EVALUATION_EXECUTION_CLASSES,
  EVALUATION_AGENT_SCOPES,
  EVALUATION_DATA_CLASSES,
  dataClassRank,
  EVALUATION_TASK_CLASSES,
  OBSERVATION_BUSINESS_ACTIONS,
  RED_TEAM_CASE_KINDS,
  EVALUATION_REASONS,
} from './contracts/vocabularies.js';
export type {
  EvaluationApprovalTarget,
  EvaluationCategory,
  EvaluationSeverity,
  EvaluationOutcome,
  EvaluationExecutionClass,
  EvaluationAgentScope,
  EvaluationDataClass,
  EvaluationTaskClass,
  ObservationBusinessAction,
  RedTeamCaseKind,
  EvaluationReason,
} from './contracts/vocabularies.js';

// Errors.
export { EvaluationError, EVALUATION_ERROR_CODES } from './contracts/errors.js';
export type { EvaluationErrorCode } from './contracts/errors.js';

// Binding.
export {
  createEvaluationBinding,
  createProviderReleaseRef,
  releaseKey,
  bindingsMatch,
} from './contracts/binding.js';
export type {
  EvaluationBinding,
  EvaluationBindingInput,
  ProviderReleaseRef,
} from './contracts/binding.js';

// Scenario / observation / thresholds / suite.
export { createEvaluationScenario, scenarioKey } from './contracts/scenario.js';
export type {
  EvaluationScenario,
  EvaluationScenarioInput,
  ExpectedBehavior,
} from './contracts/scenario.js';
export { createCandidateObservation, actionScopes } from './contracts/observation.js';
export type {
  CandidateObservation,
  CandidateObservationInput,
  ObservationCitation,
} from './contracts/observation.js';
export { createSuiteThresholds } from './contracts/thresholds.js';
export type { SuiteThresholds, SuiteThresholdsInput } from './contracts/thresholds.js';
export { createEvaluationSuite } from './contracts/suite.js';
export type { EvaluationSuite, EvaluationSuiteInput } from './contracts/suite.js';

// Case result / suite result / evidence.
export type { EvaluationCaseResult } from './contracts/case-result.js';
export type { SuiteResult } from './contracts/suite-result.js';
export type { ApprovalEvidence } from './contracts/evidence.js';

// Digest + observability.
export { contentDigest } from './contracts/digest.js';
export { NOOP_EVALUATION_OBSERVABILITY } from './contracts/observability.js';
export type {
  EvaluationEvent,
  EvaluationEventType,
  EvaluationObservabilityHook,
} from './contracts/observability.js';

// Evaluator identity.
export { EVALUATOR_IMPL_ID, EVALUATOR_IMPL_VERSION } from './evaluators/evaluate-case.js';

// Red-team mandatory set.
export { DEFAULT_MANDATORY_RED_TEAM_KINDS } from './red-team/mandatory-suite.js';

// Services: evaluate, create evidence, rollout bridge.
export { evaluateSuite } from './service/evaluate-suite.js';
export type { EvaluateSuiteOptions } from './service/evaluate-suite.js';
export { createApprovalEvidence } from './service/create-evidence.js';
export type { CreateEvidenceOptions, EvidenceResult } from './service/create-evidence.js';
export { toRolloutApprovalReference } from './service/rollout-bridge.js';
export type { RolloutApprovalReference } from './service/rollout-bridge.js';
