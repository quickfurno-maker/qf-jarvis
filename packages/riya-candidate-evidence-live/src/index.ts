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
export type {
  CanaryInvocationResult,
  CanaryMessage,
  DiagnosticCanaryPortDeps,
  DiagnosticProviderSeam,
} from './diagnostic-canary-port.js';

// Ceilings and content-free accounting.
export {
  createOperatorLedger,
  createRequestContractDiagnosticLedger,
  createRequestLedger,
  LEDGER_PHASES,
  LEDGER_REFUSALS,
  DIAGNOSTIC_CANARY_REQUESTS,
  MAX_ESTIMATED_COST_USD,
  MAX_PROVIDER_REQUESTS,
  REQUEST_CONTRACT_DIAGNOSTIC_MAX_ESTIMATED_COST_USD,
  REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS,
} from './accounting.js';
export type {
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
