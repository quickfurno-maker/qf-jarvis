/**
 * `@qf-jarvis/riya-intelligence-dataset/ai-synthetic` — the AI-synthetic lane (AS1, ADR-0143).
 *
 * ### OFFLINE, like everything else in this package
 *
 * A separate subpath so nothing on a production import path can reach the generation plan or the
 * automated gate, and so the package root keeps meaning exactly what it meant before AS1. The root
 * surface is unchanged by this slice: no symbol moved, none was renamed, and none changed behaviour.
 *
 * ### What is here
 *
 * The scenario contract (a generation PLAN with nowhere to put a sentence), generation provenance,
 * the critic verdict, the versioned acceptance and diversity policies, per-trajectory acceptance
 * evidence, the candidate state machine, deterministic diversity metrics, the automated validator and
 * its own release evidence identity.
 *
 * AS1-B adds a second, explicit provenance mode for candidates generated OUTSIDE this repository, and
 * a deterministic verifier run record that binds identity, scope, verdict and report digest. Neither
 * changes the in-repo mode, weakens a critic requirement or reduces the required quality dimensions;
 * the external mode is asked for more, not less.
 *
 * ### What is NOT here
 *
 * Any generated conversation. AS1 makes the lane representable and gateable; AS2 builds the offline
 * generation harness and AS3 produces the corpus. **Nothing in this subpath calls a model, a
 * provider, a gateway or an embedding** — the acceptance gate is deterministic token overlap and
 * counting, and the containment suite proves it.
 *
 * And no human review is faked. A corpus on this lane carries automated acceptance evidence and an
 * empty `review` array; ADR-0108 §1 is untouched, and a human-authored trajectory cannot enter here
 * at all.
 */

// Vocabularies.
export {
  RIYA_AI_SYNTHETIC_REVIEW_MODES,
  RIYA_AI_SYNTHETIC_BEHAVIOR_CODES,
  RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS,
  RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS,
  RIYA_AI_SYNTHETIC_ACCEPTANCE_STATES,
  RIYA_AI_SYNTHETIC_PROGRESSION,
  RIYA_AI_SYNTHETIC_TERMINAL_STATES,
  RIYA_AI_SYNTHETIC_FINDING_KINDS,
  RIYA_AI_SYNTHETIC_PROVENANCE_MODES,
  RIYA_AI_SYNTHETIC_VERIFIER_VERDICTS,
  RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS,
  RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS,
  RIYA_AI_SYNTHETIC_BASIS_POINTS_MAX,
} from './contracts/vocabularies.js';
export type {
  RiyaAiSyntheticReviewMode,
  RiyaAiSyntheticBehaviorCode,
  RiyaAiSyntheticConversationEvent,
  RiyaAiSyntheticForbiddenBehavior,
  RiyaAiSyntheticAcceptanceState,
  RiyaAiSyntheticFindingKind,
  RiyaAiSyntheticProvenanceMode,
  RiyaAiSyntheticVerifierVerdict,
} from './contracts/vocabularies.js';

// The generation plan.
export {
  createRiyaAiSyntheticScenario,
  riyaAiSyntheticScenarioSha256,
} from './contracts/scenario.js';
export type {
  RiyaAiSyntheticScenarioV1,
  RiyaAiSyntheticScenarioInput,
  RiyaAiSyntheticPlannedFactV1,
} from './contracts/scenario.js';

// Who generated it.
export {
  createRiyaAiSyntheticGenerationProvenance,
  riyaAiSyntheticProvenanceSha256,
} from './contracts/generation-provenance.js';
export type {
  RiyaAiSyntheticGenerationProvenanceV1,
  RiyaAiSyntheticGenerationProvenanceInput,
} from './contracts/generation-provenance.js';

// Who generated it, when it was NOT generated here (AS1-B).
//
// A sibling mode, not a replacement. The in-repo record above is untouched, and the two are mutually
// unconstructible -- an external record cannot claim an AS2 role allocation, and an in-repo record
// cannot carry the external discriminant.
export {
  createRiyaAiSyntheticExternalIntakeProvenance,
  riyaAiSyntheticExternalIntakeProvenanceSha256,
  riyaAiSyntheticProvenanceMode,
  isRiyaAiSyntheticExternalIntakeProvenance,
} from './contracts/external-intake-provenance.js';
export type {
  RiyaAiSyntheticExternalIntakeProvenanceV1,
  RiyaAiSyntheticExternalIntakeProvenanceInput,
  RiyaAiSyntheticProvenanceV1,
} from './contracts/external-intake-provenance.js';

// What deterministically checked it (AS1-B). Identity AND run evidence, never a bare ref.
export {
  createRiyaAiSyntheticDeterministicVerifierRun,
  riyaAiSyntheticDeterministicVerifierRunSha256,
} from './contracts/deterministic-verifier.js';
export type {
  RiyaAiSyntheticDeterministicVerifierRunV1,
  RiyaAiSyntheticDeterministicVerifierRunInput,
} from './contracts/deterministic-verifier.js';

// Who judged it.
export {
  createRiyaAiSyntheticCriticVerdict,
  riyaAiSyntheticCriticVerdictSha256,
} from './contracts/critic.js';
export type {
  RiyaAiSyntheticCriticVerdictV1,
  RiyaAiSyntheticCriticVerdictInput,
} from './contracts/critic.js';

// Policies.
export {
  createRiyaAiSyntheticDiversityPolicy,
  riyaAiSyntheticDiversityPolicySha256,
} from './contracts/diversity-policy.js';
export type {
  RiyaAiSyntheticDiversityPolicyV1,
  RiyaAiSyntheticDiversityPolicyInput,
} from './contracts/diversity-policy.js';
export {
  createRiyaAiSyntheticAcceptancePolicy,
  riyaAiSyntheticAcceptancePolicySha256,
} from './contracts/acceptance-policy.js';
export type {
  RiyaAiSyntheticAcceptancePolicyV1,
  RiyaAiSyntheticAcceptancePolicyInput,
  RiyaAiSyntheticCriticPolicyV1,
} from './contracts/acceptance-policy.js';

// Evidence.
export {
  createRiyaAiSyntheticTrajectoryAcceptanceEvidence,
  riyaAiSyntheticEvidenceSha256,
} from './contracts/acceptance-evidence.js';
export type {
  RiyaAiSyntheticTrajectoryAcceptanceEvidenceV1,
  RiyaAiSyntheticTrajectoryAcceptanceEvidenceInput,
} from './contracts/acceptance-evidence.js';

// The candidate lifecycle.
export {
  createRiyaAiSyntheticCandidateState,
  advanceRiyaAiSyntheticCandidate,
  riyaAiSyntheticTransitionAllowed,
  RIYA_AI_SYNTHETIC_INITIAL_STATE,
} from './contracts/state.js';
export type {
  RiyaAiSyntheticCandidateStateV1,
  RiyaAiSyntheticCandidateStateInput,
} from './contracts/state.js';

// Reports and evidence identity.
export {
  riyaAiSyntheticReportSha256,
  riyaAiSyntheticReportIntegrityHolds,
} from './contracts/report.js';
export type {
  RiyaAiSyntheticAcceptanceReportV1,
  RiyaAiSyntheticReleaseEvidenceV1,
  RiyaAiSyntheticFindingV1,
  RiyaAiSyntheticDiversityMetricsV1,
} from './contracts/report.js';

// The canonical trajectory digests evidence binds to.
//
// Re-exported on THIS subpath, never on the root -- the root surface deliberately exposes no digest
// helper. AS2 needs them to construct acceptance evidence, and the alternative is a second
// implementation of trajectory identity in the generation package. That copy would drift, and the
// day it did, the validator would recompute a digest the harness could never match and every
// candidate would fail for a reason nothing could explain.
export {
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '../internal/trajectory-digest.js';

// Services.
export {
  riyaAiSyntheticDiversityMetrics,
  RIYA_AI_SYNTHETIC_DEPTH_BANDS,
  RIYA_AI_SYNTHETIC_EDGE_TOKENS,
  RIYA_AI_SYNTHETIC_MIN_TOKENS_FOR_EDGE_METRIC,
} from './service/diversity.js';
export { validateRiyaAiSyntheticCorpus } from './service/validate-automated-synthetic.js';
export type {
  ValidateRiyaAiSyntheticOptions,
  RiyaAiSyntheticValidationResult,
} from './service/validate-automated-synthetic.js';
export { createRiyaAiSyntheticReleaseEvidence } from './service/create-release-evidence.js';
export type {
  CreateRiyaAiSyntheticReleaseEvidenceInput,
  RiyaAiSyntheticReleaseEvidenceResult,
} from './service/create-release-evidence.js';
