/**
 * `@qf-jarvis/riya-candidate-evidence-live` — the bounded candidate evidence OPERATOR (MVP-P2A.2).
 *
 * ### The one composition allowed to touch both halves
 *
 * Producing evidence about a hosted model needs execution (a gateway, a provider, a prompt) and
 * evaluation (fixtures, authorities, a review bundle). Nothing else in this repository is permitted
 * to depend on both, because a package that can evaluate and execute can certify itself. This leaf
 * exists so that combination lives in exactly one reviewable place, off the serving path.
 *
 * ### What it reuses, and what it therefore is not
 *
 * The gateway routes, the Groq provider speaks the wire, the M4 adapter owns the single call, the
 * bridge owns the fixtures, `governed-knowledge` decides what a model may be shown, and the two
 * authorities own every verdict. This package schedules them and counts what happened. It implements
 * no HTTP, holds no credential beyond one masked read per phase, retries nothing, and has a hard
 * ceiling of 83 provider requests and USD 5.00.
 *
 * ### It authorizes nothing
 *
 * A complete run ends at `AWAITING_P10_HUMAN_REVIEW` — a written bundle and two humans who have not
 * read it yet. There is no exit code that means approved, no rollout transition, no production write,
 * and no path from here to a served conversation. A spec proves nothing imports this package.
 */

// The candidate identity everything else in a run is bound to.
export {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_CATALOG_SNAPSHOT,
  CANDIDATE_CONFIG_CANONICAL,
  CANDIDATE_CONFIG_DIGEST,
  CANDIDATE_DATA_CONTROLS_REF,
  CANDIDATE_EXECUTION_CLASS,
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
  CANDIDATE_POLICY_REVISION,
  CANDIDATE_PROVIDER_ID,
  CANDIDATE_RELEASE,
  CANDIDATE_RELEASE_ID,
  RIYA_CLIENT_PROMPT_DIGEST,
} from './candidate-release.js';

// MVP-P2A.2 HF4-R8. The Groq HTTP-400 DIFFERENTIAL CANARY harness: eight contracts that vary one
// request axis at a time, and the pure function that reads their outcomes. Exported because a spec
// must be able to assert the matrix and the classifier directly — S9 and S10 each spent a live
// authorization learning only that something was rejected, and a classifier nobody can check before
// the run is a classifier that spends the next one too.
export {
  CANARY_ANYOF_NULLABLE_SCHEMA,
  CANARY_CAP_PAIRS,
  CANARY_COMPLETION_CAP_CLASSES,
  CANARY_HIGH_COMPLETION_CAP,
  CANARY_LOW_COMPLETION_CAP,
  CANARY_MESSAGE_SOURCES,
  CANARY_MINIMAL_SCHEMA,
  CANARY_NUMERIC_ENUM_SCHEMA,
  CANARY_REQUEST_CLASSES,
  CANARY_SCHEMA_SOURCES,
  CANARY_SYNTHETIC_SYSTEM_MESSAGE,
  CANARY_SYNTHETIC_USER_MESSAGE,
  canaryById,
  DIAGNOSTIC_CANARIES,
  DIAGNOSTIC_CANARY_IDS,
} from './diagnostic-canaries.js';
export type {
  CanaryCompletionCapClass,
  CanaryMessageSource,
  CanaryRequestClass,
  CanarySchemaSource,
  DiagnosticCanary,
  DiagnosticCanaryId,
} from './diagnostic-canaries.js';
export { createDiagnosticCanaryPort, SYNTHETIC_CANARY_MESSAGES } from './diagnostic-canary-port.js';

// POST-S11 REQUEST-CONTRACT REPAIR. The full reading of a matrix, not just its single token. S11
// carried two independent findings and the classifier reported one; a caller that can see the
// findings can no longer be misled by the summary.
export {
  analyseDiagnosticCanaries,
  classifyDiagnosticCanaries,
  DIAGNOSTIC_CLASSIFICATIONS,
} from './internal/diagnostic-classification.js';
export type {
  CanaryOutcome,
  DiagnosticAnalysis,
  DiagnosticClassification,
} from './internal/diagnostic-classification.js';

// MVP-P2A.2 HF4-R8-R1. The LIVE composition the executable itself uses, and the production-safe
// helper that captures the exact Riya request D7/D8 carry. Exported because the owner review found
// the opposite arrangement — a reviewed port that `bin.ts` never bound — and the only durable fix is
// a composition a spec can drive end to end rather than a textual assertion about a call site.
export {
  captureProductionRiyaCanaryRequest,
  createDiagnosticCanaryMaterials,
  DIAGNOSTIC_CAPTURE_INSTANT,
  diagnosticRepresentativeCaseId,
} from './diagnostic-canary-materials.js';
export type {
  CapturedProductionRiyaRequest,
  DiagnosticCanaryMaterials,
} from './diagnostic-canary-materials.js';
export {
  createLiveDiagnosticCanaryComposition,
  openLiveDiagnosticCanaryRunner,
} from './live-diagnostic-canary-composition.js';
export type {
  LiveDiagnosticCanaryComposition,
  LiveDiagnosticCanaryDeps,
} from './live-diagnostic-canary-composition.js';
export type {
  CanaryInvocationResult,
  CanaryMessage,
  DiagnosticCanaryPortDeps,
  DiagnosticProviderSeam,
} from './diagnostic-canary-port.js';

// Ceilings and content-free accounting.
export {
  usageProvenanceOf,
  USAGE_PROVENANCES,
  createOperatorLedger,
  createRequestContractDiagnosticLedger,
  createSchemaDifferentialDiagnosticLedger,
  createSchemaRepairVerificationLedger,
  createRequestLedger,
  LEDGER_PHASES,
  LEDGER_REFUSALS,
  DIAGNOSTIC_CANARY_REQUESTS,
  SCHEMA_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
  SCHEMA_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
  SCHEMA_DIFFERENTIAL_PROBE_REQUESTS,
  SCHEMA_REPAIR_VERIFICATION_MAX_ESTIMATED_COST_USD,
  SCHEMA_REPAIR_VERIFICATION_MAX_PROVIDER_REQUESTS,
  SCHEMA_REPAIR_VERIFICATION_PROBE_REQUESTS,
  MAX_ESTIMATED_COST_USD,
  MAX_PROVIDER_REQUESTS,
  REQUEST_CONTRACT_DIAGNOSTIC_MAX_ESTIMATED_COST_USD,
  REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS,
} from './accounting.js';
export type {
  UsageProvenance,
  LedgerPhase,
  LedgerRefusal,
  LedgerReservation,
  LedgerSnapshot,
  ProviderUsageFacts,
  RequestLedger,
} from './accounting.js';

// Closed outcomes.
export { OPERATOR_EXIT_CODES, OPERATOR_OUTCOMES } from './exit-codes.js';
export type { OperatorOutcome } from './exit-codes.js';

// Offline preflight.
export { EXPECTED_SMOKE_CONFIG_DIGEST, PREFLIGHT_FAILURES, runPreflight } from './preflight.js';
export type { PreflightFailure, PreflightInput, PreflightResult } from './preflight.js';

// HF4-R5. The governed credential ingress: a closed MODE vocabulary and the wiring it selects.
// Neither can carry a credential — the modes are two literals, and the composition holds only the
// redacting holder the resolver produced.
export {
  CREDENTIAL_SOURCE_MODES,
  DEFAULT_CREDENTIAL_SOURCE_MODE,
  isCredentialSourceMode,
} from './credential-source.js';
export type { CredentialSourceMode } from './credential-source.js';
export { createCredentialComposition } from './credential-composition.js';
export type {
  ClipboardIngressCounters,
  CredentialComposition,
  CredentialCompositionSeams,
} from './credential-composition.js';

// Governed synthetic knowledge admission, through the production authority.
export { admitGroundedInput, GROUNDED_ADMISSION_REFUSALS } from './governed-grounded-input.js';
export type { GroundedAdmission, GroundedAdmissionRefusal } from './governed-grounded-input.js';

// The evaluation-only execution composition.
export { createCandidateGateway, createCandidateInvoker } from './evaluation-gateway.js';
export type { CandidateGatewayDeps } from './evaluation-gateway.js';
export {
  createTransportBoundaryAbort,
  createTransportStartHook,
} from './cancellation-transport.js';

// One Riya turn on the real serving path.
export { runRiyaEvaluationTurn, taskClassFor, toGroundedContext } from './riya-turn.js';
export type { RiyaTurnDeps, RiyaTurnOutcome, RiyaTurnRequest } from './riya-turn.js';
export {
  SYNTHETIC_AVAILABILITY,
  SYNTHETIC_CONVERSATION_PREFIX,
  SYNTHETIC_TENANT_ID,
  syntheticContinuityFor,
} from './synthetic-context.js';

// The two candidate ports.
export {
  createQualityCandidatePort,
  createSafetyCandidatePort,
  stateReaderFor,
} from './candidate-ports.js';
export type { BaseTurnDeps, CandidatePortDeps, QualityPortDeps } from './candidate-ports.js';

// Deterministic reply-language measurement.
export { measureReplyLanguage } from './measurement/reply-language.js';
export type { MeasuredLanguageMode } from './measurement/reply-language.js';

// The sequence, and the only way it is allowed to speak.
export { runCandidateEvidenceOperator, SECOND_CREDENTIAL_NOTICE } from './operator.js';
export type { OperatorDeps, OperatorResult } from './operator.js';
export { createAccountedSession } from './candidate-session.js';
export type { CandidateSession, CandidateSessionDeps } from './candidate-session.js';
export { createSafeConsole, createStdoutSafeConsole } from './safe-console.js';
export type { SafeConsole, SafeValue } from './safe-console.js';

// POST-PR-131 SCHEMA DIFFERENTIAL HARNESS. The orthogonal probe matrix, its pure analysis, the probe
// port and the live composition the executable binds.
//
// Exported because the previous round proved a reviewed seam the executable does not bind is worth
// nothing, and because the analysis must be assertable on fixtures before a live authorization is
// spent on it. The matrix is deliberately NOT a cumulative ladder: each probe carries one real
// fragment, so the result is read as a SET of rejections rather than as an ordering.
export {
  planRiyaSchemaProbeMatrix,
  SCHEMA_PROBE_KINDS,
  SCHEMA_PROBE_STEP_IDS,
} from './internal/riya-schema-probe-matrix.js';
export type {
  SchemaProbe,
  SchemaProbeKind,
  SchemaProbeStepId,
} from './internal/riya-schema-probe-matrix.js';
export {
  analyseSchemaProbeMatrix,
  SCHEMA_DIFFERENTIAL_CLASSIFICATIONS,
} from './internal/schema-differential-classification.js';
export type {
  SchemaDifferentialAnalysis,
  SchemaDifferentialClassification,
  SchemaProbeOutcome,
} from './internal/schema-differential-classification.js';
export { createSchemaProbePort, SCHEMA_PROBE_COMPLETION_CAP } from './schema-probe-port.js';
export type { SchemaProbePortDeps, SchemaProbeProviderSeam } from './schema-probe-port.js';
export {
  createLiveSchemaProbeComposition,
  openLiveSchemaProbeRunner,
} from './live-schema-probe-composition.js';
export type {
  LiveSchemaProbeComposition,
  LiveSchemaProbeDeps,
  SchemaProbeRunner,
} from './live-schema-probe-composition.js';

// POST-SDH4 SCHEMA REPAIR VERIFICATION. A NEW bounded plan, vocabulary and composition for verifying
// the repaired observation schema. Separate from SDH4's historical R0-R8 matrix in every respect —
// step ids, classification tokens, ledger counter, exit code — so a receipt can always say which
// matrix produced it and the immutable SDH4 evidence stays readable.
export {
  planRiyaSchemaRepairVerification,
  SCHEMA_REPAIR_PROBE_KINDS,
  SCHEMA_REPAIR_VERIFICATION_STEP_IDS,
} from './internal/riya-schema-repair-verification-plan.js';
export type {
  SchemaRepairProbeKind,
  SchemaRepairVerificationProbe,
  SchemaRepairVerificationStepId,
} from './internal/riya-schema-repair-verification-plan.js';
export {
  analyseSchemaRepairVerification,
  SCHEMA_REPAIR_VERIFICATION_CLASSIFICATIONS,
} from './internal/schema-repair-verification-classification.js';
export type {
  SchemaRepairProbeOutcome,
  SchemaRepairVerificationAnalysis,
  SchemaRepairVerificationClassification,
} from './internal/schema-repair-verification-classification.js';
export {
  createLiveSchemaRepairVerificationComposition,
  createSchemaRepairVerificationPort,
  openLiveSchemaRepairVerificationRunner,
} from './schema-repair-verification-port.js';
export type {
  LiveSchemaRepairVerificationComposition,
  LiveSchemaRepairVerificationDeps,
  SchemaRepairProviderSeam,
  SchemaRepairVerificationRunner,
} from './schema-repair-verification-port.js';

// POST-SRV1 OPERATIONAL ACCEPTANCE. The first bounded matrix that runs at the REAL governed Riya
// completion budget rather than the low control cap, and the first that puts the captured
// representative production messages on the wire beside the repaired schema. Separate plan,
// vocabulary, ledger counter and exit code again, for the same reason: a receipt must always say
// which envelope produced it.
export {
  OPERATIONAL_ACCEPTANCE_STEP_IDS,
  OPERATIONAL_MESSAGE_SOURCES,
  OPERATIONAL_PROBE_KINDS,
  planOperationalAcceptance,
} from './internal/operational-acceptance-plan.js';
export type {
  OperationalAcceptancePlanInput,
  OperationalAcceptanceProbe,
  OperationalAcceptanceStepId,
  OperationalMessageSource,
  OperationalProbeKind,
} from './internal/operational-acceptance-plan.js';
export {
  analyseOperationalAcceptance,
  OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS,
} from './internal/operational-acceptance-classification.js';
export type {
  OperationalAcceptanceAnalysis,
  OperationalAcceptanceClassification,
  OperationalAcceptanceOutcome,
} from './internal/operational-acceptance-classification.js';
export {
  createLiveOperationalAcceptanceComposition,
  createOperationalAcceptancePort,
  OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET,
  openLiveOperationalAcceptanceRunner,
} from './operational-acceptance-port.js';
export type {
  LiveOperationalAcceptanceComposition,
  LiveOperationalAcceptanceDeps,
  OperationalAcceptanceRunner,
  OperationalProviderSeam,
} from './operational-acceptance-port.js';

// POST-OAD3 REPRESENTATIVE ACCEPTANCE. The one-probe gate that re-asks OAD3's single unanswered
// question. It reuses OAD3's plan, capture and projection rather than copying them, and carries its
// own tiny vocabulary in which a rate limit is NOT a verdict — the distinction OAD3's matrix
// classifier lacked, and the reason its receipt named the message shape on a 429.
export {
  isProviderAccepted,
  isProviderContractRejected,
  isProviderOutcomeInconclusive,
  NON_VERDICT_HTTP_CLASSES,
  PROVIDER_CONTRACT_REJECTION_HTTP_CLASSES,
  PROVIDER_OUTCOME_ROLE,
  PROVIDER_OUTCOME_ROLES,
} from './internal/provider-outcome-classes.js';
export type { ProviderOutcomeRole } from './internal/provider-outcome-classes.js';
export {
  analyseRepresentativeAcceptance,
  REPRESENTATIVE_ACCEPTANCE_CLASSIFICATIONS,
} from './internal/representative-acceptance-classification.js';
export type {
  RepresentativeAcceptanceAnalysis,
  RepresentativeAcceptanceClassification,
  RepresentativeAcceptanceOutcome,
} from './internal/representative-acceptance-classification.js';
export {
  createLiveRepresentativeAcceptanceComposition,
  createRepresentativeAcceptancePort,
  openLiveRepresentativeAcceptanceRunner,
  REPRESENTATIVE_ACCEPTANCE_COMPLETION_BUDGET,
  REPRESENTATIVE_ACCEPTANCE_STEP_ID,
  selectRepresentativeProbe,
} from './representative-acceptance-port.js';
export type {
  LiveRepresentativeAcceptanceComposition,
  LiveRepresentativeAcceptanceDeps,
  RepresentativeAcceptanceRunner,
} from './representative-acceptance-port.js';

// POST-RA1 NEUTRAL CLIENT ACCEPTANCE. RA1's captured request came from the SAFETY fixture manifest
// and resolves to CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY — an adversarial self-as-authority turn — so its 400 is a fact
// about that turn rather than about an ordinary sales conversation. This is the neutral counterpart:
// same schema, same budget, same production builder, an ordinary client turn.
export {
  captureNeutralClientRiyaRequest,
  DIAGNOSTIC_REQUEST_SOURCES,
  NEUTRAL_CLIENT_DIAGNOSTIC_CASE_ID,
  NEUTRAL_CLIENT_DIAGNOSTIC_REQUEST,
  NEUTRAL_CLIENT_DIAGNOSTIC_TEXT,
  NEUTRAL_CLIENT_REQUEST_PROVENANCE,
} from './neutral-client-diagnostic-request.js';
export type { DiagnosticRequestSource } from './neutral-client-diagnostic-request.js';
export { diagnosticRepresentativeSource } from './diagnostic-canary-materials.js';
export {
  NEUTRAL_CLIENT_STEP_ID,
  planNeutralClientProbe,
} from './internal/operational-acceptance-plan.js';
export type {
  DiagnosticProbe,
  NeutralClientProbe,
} from './internal/operational-acceptance-plan.js';
export {
  createLiveNeutralRepresentativeComposition,
  createNeutralRepresentativePort,
  NEUTRAL_REPRESENTATIVE_COMPLETION_BUDGET,
  openLiveNeutralRepresentativeRunner,
} from './neutral-representative-acceptance-port.js';
export type {
  LiveNeutralRepresentativeComposition,
  LiveNeutralRepresentativeDeps,
  NeutralRepresentativeRunner,
} from './neutral-representative-acceptance-port.js';

// POST-NRA1 GPT-OSS-120B STRICT MODEL DIFFERENTIAL. NRA1 sent the neutral production-built request to
// the production 20B candidate and was refused with JSON_VALIDATE_FAILED — the same failure class RA1
// met on the adversarial turn. This changes exactly ONE variable: the model id on the wire. Production
// candidate identity is untouched, and the differential model is diagnostic-only.
export {
  MODEL_DIFFERENTIAL_BASELINE_MODEL_ID,
  MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
  MODEL_DIFFERENTIAL_CATALOG_SNAPSHOT,
  SMOKE_PROVES_DIFFERENTIAL_MODEL_ENTITLEMENT,
  SMOKE_PROVIDER_CREDENTIAL_CHECK_MODEL,
} from './model-differential-identity.js';
export {
  analyseModelDifferential,
  MODEL_DIFFERENTIAL_CLASSIFICATIONS,
} from './internal/model-differential-classification.js';
export type {
  ModelDifferentialAnalysis,
  ModelDifferentialClassification,
  ModelDifferentialOutcome,
} from './internal/model-differential-classification.js';
export {
  MODEL_DIFFERENTIAL_STEP_ID,
  planModelDifferentialProbe,
} from './internal/operational-acceptance-plan.js';
export type { ModelDifferentialStepId } from './internal/operational-acceptance-plan.js';
export {
  createLiveModelDifferentialComposition,
  createModelDifferentialPort,
  MODEL_DIFFERENTIAL_COMPLETION_BUDGET,
  openLiveModelDifferentialRunner,
} from './model-differential-port.js';
export type {
  LiveModelDifferentialComposition,
  LiveModelDifferentialDeps,
  ModelDifferentialProbe,
  ModelDifferentialRunner,
} from './model-differential-port.js';

// POST-MD120B3 GROQ RESPONSES API STRICT ENDPOINT DIFFERENTIAL. MD120B3 sent the neutral
// production-built request to GPT-OSS-120B over Chat Completions and was refused with
// JSON_VALIDATE_FAILED — the same failure class NRA1 met on 20B. The strict failure therefore
// reproduces across BOTH governed GPT-OSS models, and the model is no longer the open axis.
//
// This changes exactly ONE variable: the provider ENDPOINT. The model stays the production candidate,
// the schema stays the production projected document, the messages stay NRA1's own capture, and the
// output bound stays 4,096. It is a DIAGNOSTIC and not a migration: the Responses API is currently
// beta, production routing is untouched, and nothing here selects an endpoint for serving.
//
// The vocabulary carries one token the earlier gates did not need. On this endpoint a provider 2xx is
// not the finding, and neither is a wire-shaped document: the verdict runs the FULL production
// projector — the profile's own `projectStructuredResult`, not `structuredSchema.safeParse`, which is
// only its first stage. A 2xx whose document production would refuse is
// RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED rather than either acceptance or provider rejection.
// Accepting on shape alone would be a false-positive endpoint verdict, which is the worst thing this
// diagnostic could produce.
export {
  PROVIDER_ENDPOINT_FAMILIES,
  RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
  RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY,
  RESPONSES_DIFFERENTIAL_ENDPOINT_MATURITY,
  RESPONSES_DIFFERENTIAL_MODEL_ID,
  RESPONSES_DIFFERENTIAL_SCHEMA_NAME,
  SMOKE_PROVES_RESPONSES_ENDPOINT_ENTITLEMENT,
  SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
} from './responses-differential-identity.js';
export type { ProviderEndpointFamily } from './responses-differential-identity.js';
export {
  analyseResponsesDifferential,
  RESPONSES_DIFFERENTIAL_CLASSIFICATIONS,
} from './internal/responses-differential-classification.js';
export type {
  ResponsesDifferentialAnalysis,
  ResponsesDifferentialClassification,
  ResponsesDifferentialOutcome,
} from './internal/responses-differential-classification.js';
export {
  planResponsesDifferentialProbe,
  RESPONSES_DIFFERENTIAL_STEP_ID,
} from './internal/operational-acceptance-plan.js';
export type { ResponsesDifferentialStepId } from './internal/operational-acceptance-plan.js';
export {
  createLiveResponsesDifferentialComposition,
  createResponsesDifferentialPort,
  openLiveResponsesDifferentialRunner,
  RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET,
} from './responses-differential-port.js';
export type {
  LiveResponsesDifferentialComposition,
  LiveResponsesDifferentialDeps,
  ResponsesDifferentialProbe,
  ResponsesDifferentialRunner,
  ResponsesProviderSeam,
} from './responses-differential-port.js';
// POST-RSP20B2 REASONING-EFFORT LOW DIFFERENTIAL. RSP20B2 sent the neutral production-built request
// over the Groq Responses API and reproduced JSON_VALIDATE_FAILED, as MD120B3 had on 120B and NRA1 on
// 20B. Model and endpoint are both closed as axes.
//
// What every one of those requests shares is that it carried NO reasoning field at all. GPT-OSS
// reasoning tokens are drawn from the same completion budget the structured answer needs, so a model
// reasoning at the documented default has less of that budget left for the JSON. This changes exactly
// ONE variable: it sends `reasoning_effort='low'`. The model, the endpoint, the schema, the captured
// messages and the 4,096 bound are all held -- and the bound most of all, because it is the quantity
// the effort setting competes for.
//
// It composes the MERGED, separately reviewed diagnostic adapter and creates no new one. Production
// sends no reasoning field of any spelling, and this run does not change that: a production effort
// change is a separate owner decision.
//
// The vocabulary splits a token every earlier classifier collapsed. `json_validate_failed` is the
// provider reporting that its OWN OUTPUT failed strict validation -- the request was accepted and
// generation ran -- so it is REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID rather than a request
// rejection. A 400 carrying any other code is REASONING_LOW_20B_STRICT_PROVIDER_REQUEST_REJECTED,
// which would mean something entirely different: that adding the field changed how the provider reads
// the request, invalidating the differential rather than answering it. Historical classifiers keep
// their own wording, because their receipts are immutable.
export {
  REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT,
  REASONING_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
  REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE,
  REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
  REASONING_DIFFERENTIAL_ENDPOINT_FAMILY,
  REASONING_DIFFERENTIAL_MODEL_ID,
  REASONING_FIELD_POSTURES,
  SMOKE_PROVES_REASONING_DIAGNOSTIC_ENTITLEMENT,
} from './reasoning-differential-identity.js';
export type { ReasoningFieldPosture } from './reasoning-differential-identity.js';
export {
  analyseReasoningDifferential,
  REASONING_DIFFERENTIAL_CLASSIFICATIONS,
} from './internal/reasoning-differential-classification.js';
export type {
  ReasoningDifferentialAnalysis,
  ReasoningDifferentialClassification,
  ReasoningDifferentialOutcome,
} from './internal/reasoning-differential-classification.js';
export {
  planReasoningDifferentialProbe,
  REASONING_DIFFERENTIAL_STEP_ID,
} from './internal/operational-acceptance-plan.js';
export type { ReasoningDifferentialStepId } from './internal/operational-acceptance-plan.js';
export {
  createLiveReasoningDifferentialComposition,
  createReasoningDifferentialPort,
  openLiveReasoningDifferentialRunner,
  REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
} from './reasoning-differential-port.js';
export type {
  LiveReasoningDifferentialComposition,
  LiveReasoningDifferentialDeps,
  ReasoningDifferentialProbe,
  ReasoningDifferentialRunner,
  ReasoningDifferentialRunResult,
  ReasoningProviderSeam,
  ReasoningProviderSeamResult,
} from './reasoning-differential-port.js';
// POST-RLD1 LOW-REASONING 8192 OUTPUT-BUDGET DIFFERENTIAL. RLD1 sent the neutral production request
// at reasoning_effort='low' and max_completion_tokens=4096 and received HTTP 400 with
// json_validate_failed. Explicit low reasoning effort did NOT repair the exact neutral path.
//
// That closes the explicit-low-at-4096 REPAIR ATTEMPT and nothing wider. Other reasoning-effort
// values remain untested, and no claim is made that reasoning effort is generally irrelevant -- so
// this run holds low rather than concluding the axis is finished with.
//
// This changes exactly ONE variable: the per-request completion bound, 4096 -> 8192. The model, the
// endpoint, the effort, the captured messages, the projected schema and the strict mode are all held
// -- and held by CONSTRUCTION rather than by assertion: this port and the RLD1 port are two callers
// of one shared internal primitive that decides everything except the budget.
//
// It does NOT replay RLD1's 4096 request; that answer is recorded. It does NOT move
// RIYA_COMPLETION_BUDGET_TOKENS, which stays 4096 -- the 8192 lives only in this diagnostic identity.
//
// The vocabulary keeps RLD1's split: json_validate_failed is the provider reporting that its OWN
// OUTPUT failed strict validation, so it is REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID rather
// than a request rejection; a 400/413/422 carrying any other code is
// REASONING_LOW_8192_STRICT_PROVIDER_REQUEST_REJECTED, which at this budget would most likely be a
// 413 saying the request itself became unacceptable -- invalidating the differential rather than
// answering it. RLD1's own classifier vocabulary is untouched, because its receipt is immutable.
export {
  REASONING_BUDGET_8192_BASELINE_BUDGET,
  REASONING_BUDGET_8192_BASELINE_CLASSIFICATION,
  REASONING_BUDGET_8192_CANDIDATE_BUDGET,
  REASONING_BUDGET_8192_ENDPOINT_FAMILY,
  REASONING_BUDGET_8192_MODEL_ID,
  REASONING_BUDGET_8192_REASONING_EFFORT,
  RLD1_FAILED_PROBE_USAGE_OBSERVED,
  RLD1_TRUNCATION_AT_BASELINE_PROVEN,
  SMOKE_PROVES_BUDGET_DIAGNOSTIC_ENTITLEMENT,
} from './reasoning-budget-8192-identity.js';
export {
  analyseReasoningBudget8192,
  REASONING_BUDGET_8192_CLASSIFICATIONS,
} from './internal/reasoning-budget-8192-classification.js';
export type {
  ReasoningBudget8192Analysis,
  ReasoningBudget8192Classification,
  ReasoningBudget8192Outcome,
} from './internal/reasoning-budget-8192-classification.js';
export {
  planReasoningBudget8192Probe,
  REASONING_BUDGET_8192_STEP_ID,
} from './internal/operational-acceptance-plan.js';
export type { ReasoningBudget8192StepId } from './internal/operational-acceptance-plan.js';
export {
  createLiveReasoningBudget8192Composition,
  createReasoningBudget8192Port,
  openLiveReasoningBudget8192Runner,
  REASONING_BUDGET_8192_OUTPUT_BUDGET,
} from './reasoning-budget-8192-port.js';
export type {
  LiveReasoningBudget8192Composition,
  LiveReasoningBudget8192Deps,
  ReasoningBudget8192Probe,
  ReasoningBudget8192RunResult,
  ReasoningBudget8192Runner,
} from './reasoning-budget-8192-port.js';
// POST-RBD1 BEST-EFFORT json_schema STRICT-POSTURE DIFFERENTIAL. RLD1 met json_validate_failed at
// 4,096 and RBD1 met it again at 8,192, both under json_schema.strict: true. Neither the effort
// attempt nor the budget attempt repaired the exact neutral path, and what every one of those
// requests shares is CONSTRAINED DECODING.
//
// This changes exactly ONE nested wire leaf: response_format.json_schema.strict, true -> false. The
// model, endpoint, captured messages, projected schema, SCHEMA NAME, reasoning_effort and 8,192
// budget are all held -- and held by CONSTRUCTION: the gateway's best-effort adapter builds its body
// by DERIVING from the reasoning adapter's and flipping one leaf, and both run through one shared
// Chat Completions exchange so a response cannot classify two ways between them.
//
// It is emphatically NOT production's non-strict path. buildResponseFormat(schema, false) returns
// json_object, which drops the schema name and the schema body along with the flag -- that answers
// "what happens with no schema at all", a different and much weaker question whose result could not
// be compared with RBD1's. Production is untouched: strict-capable projected schemas still go out
// with strict: true, there is no automatic best-effort fallback and no retry-on-strict-failure.
//
// Groq documents that best-effort mode MAY still return a schema 400, so json_validate_failed here
// is a legitimate experimental outcome and is classified as an OUTPUT failure, never as a request
// rejection. RLD1's and RBD1's vocabularies, step ids, exit codes and counters are untouched.
export {
  PRIOR_FAILED_PROBE_USAGE_OBSERVED,
  PRIOR_TRUNCATION_PROVEN,
  PRODUCTION_NON_STRICT_FALLBACK_MODE,
  STRICT_FALSE_BASELINE_CLASSIFICATION,
  STRICT_FALSE_BASELINE_STRICT,
  STRICT_FALSE_BASELINE_STRUCTURED_MODE,
  STRICT_FALSE_CANDIDATE_STRICT,
  STRICT_FALSE_CANDIDATE_STRUCTURED_MODE,
  STRICT_FALSE_COMPLETION_BUDGET,
  STRICT_FALSE_ENDPOINT_FAMILY,
  STRICT_FALSE_MODEL_ID,
  STRICT_FALSE_REASONING_EFFORT,
  STRUCTURED_OUTPUT_WIRE_MODES,
} from './strict-false-differential-identity.js';
export type { StructuredOutputWireMode } from './strict-false-differential-identity.js';
export {
  analyseStrictFalseDifferential,
  STRICT_FALSE_CLASSIFICATIONS,
} from './internal/strict-false-differential-classification.js';
export type {
  StrictFalseAnalysis,
  StrictFalseClassification,
  StrictFalseOutcome,
} from './internal/strict-false-differential-classification.js';
export {
  planStrictFalseDifferentialProbe,
  STRICT_FALSE_DIFFERENTIAL_STEP_ID,
} from './internal/operational-acceptance-plan.js';
export type { StrictFalseDifferentialStepId } from './internal/operational-acceptance-plan.js';
export {
  createLiveStrictFalseDifferentialComposition,
  createStrictFalseDifferentialPort,
  openLiveStrictFalseDifferentialRunner,
  STRICT_FALSE_OUTPUT_BUDGET,
} from './strict-false-differential-port.js';
export type {
  LiveStrictFalseDifferentialComposition,
  LiveStrictFalseDifferentialDeps,
  StrictFalseDifferentialProbe,
  StrictFalseDifferentialRunResult,
  StrictFalseDifferentialRunner,
} from './strict-false-differential-port.js';
export type {
  ProjectStructuredResult,
  StructuredWireSchema,
} from './diagnostic-canary-materials.js';
// POST-MD120B3. The ONE profile-construction site, exported so a spec can prove the capture and the
// evaluation turn share it rather than reconstructing similar-looking arguments.
export { createRiyaEvaluationProfile } from './riya-turn.js';
export type { RiyaEvaluationProfile } from './riya-turn.js';
