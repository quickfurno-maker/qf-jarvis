/**
 * `@qf-jarvis/jarvis-v1-provider-certification-live` — the JF-5B live certification operator.
 *
 * ### Evaluation only, and off the serving path
 *
 * No production package or application imports this, it implements no business authority, it writes to
 * no database and it activates nothing. A containment spec asserts the first of those rather than
 * trusting the sentence.
 *
 * ### What it ADDS, and what it merely composes
 *
 * The audit that opened JF-5B found exactly one capability the repository did not have: bounded
 * AUTHENTICATED NaraRouter model discovery, and a deterministic way to pick one entitled fallback model
 * from what comes back. Everything else already existed and is composed unchanged —
 *
 * - `@qf-jarvis/groq-staging-smoke` for Groq connectivity AND for the masked-TTY secret primitive;
 * - `@qf-jarvis/model-gateway` for the Nara chat transport, its router-alias refusal, its redacting key
 *   holder, and for ALL provider selection;
 * - `@qf-jarvis/model-evaluation` for bindings;
 * - the three JF-5A prompt packages for the reviewed bytes and their digests.
 *
 * ### Six bindings, and no seal
 *
 * One `EvaluationBinding` carries one prompt digest, and there are three distinct production prompt
 * bodies, so two providers need SIX bindings. This operator builds them, measures against them, and
 * stops: it mints no `ApprovalEvidence`, sets no production approval and produces no active release.
 * JF-5C performs the owner seal.
 *
 * ### Nothing here reaches a network by being imported
 *
 * Every module below is pure or takes an injected seam. A live run requires an explicit flag AND a
 * phrase typed at a terminal, so importing this package — or running the whole test suite — performs
 * zero provider calls.
 */

// The one genuinely new capability: bounded authenticated discovery and deterministic selection.
export {
  MAX_DISCOVERY_PAGES,
  MAX_DISCOVERY_RESPONSE_BYTES,
  MAX_SHORTLIST,
  MIN_CONTEXT_LENGTH,
  NARA_MODELS_ENDPOINT,
  DISCOVERY_REJECTIONS,
  SHORTLIST_REFUSALS,
  buildNaraShortlist,
  isDiscoverableModelId,
  parseNaraModelDiscovery,
  selectNaraModel,
} from './discovery/nara-model-discovery.js';

// JF-5B-R3: the OWNER-supplied candidate shortlist. A continuation channel for the honest stop the
// metadata rule already performs -- it chooses which models are worth probing, and nothing else. The
// existing scorer still picks the winner, and authenticated discovery still authorises every candidate.
export {
  OWNER_CANDIDATE_REFUSALS,
  checkOwnerCandidates,
  resolveOwnerCandidateShortlist,
} from './discovery/owner-candidate-shortlist.js';
export type {
  OwnerCandidateCheck,
  OwnerCandidateRefusal,
  OwnerShortlistResult,
} from './discovery/owner-candidate-shortlist.js';
export type {
  DiscoveredNaraModel,
  DiscoveryRejection,
  NaraDiscoveryResult,
  NaraProbeScore,
  RejectedAlias,
  ShortlistRefusal,
  ShortlistResult,
} from './discovery/nara-model-discovery.js';

// The double-opt-in gate, the outside-the-repository rule and the call/cost ledger.
export {
  EXECUTE_LIVE_FLAG,
  GATE_REFUSALS,
  JF5B_BUDGET,
  LIVE_CONFIRMATION_PHRASE,
  checkArgvGate,
  checkOutputPath,
  checkTypedConfirmation,
  createCallLedger,
  createLiveBudget,
} from './contracts/live-execution-gate.js';
export type { CallLedger, GateRefusal, LiveBudget } from './contracts/live-execution-gate.js';

// JF-5B-R6: the EVALUATION-ONLY Groq pacer. Not a production rate limiter, not a gateway policy, and
// imported by nothing that serves a turn -- a containment spec asserts that rather than trusting it.
export {
  GROQ_OBSERVED_RPD,
  GROQ_OBSERVED_RPM,
  GROQ_OBSERVED_TPD,
  GROQ_OBSERVED_TPM,
  MIN_MODEL_CALL_INTERVAL_MS,
  PACING_TARGET_TPM,
  RATE_LIMIT_COOLDOWN_MS,
  createGroqLivePacer,
  pacingDelayMsFor,
} from './contracts/groq-live-pacing.js';
export type {
  GroqLivePacer,
  PacingClock,
  PacingObservation,
  PacingSleeper,
} from './contracts/groq-live-pacing.js';

// The sanitized result model and the six-binding coverage manifest.
export {
  CASE_OUTCOMES,
  EXECUTION_LAYERS,
  LANGUAGE_MODES,
  createJf5bCoverageManifest,
  createLiveCaseRecord,
  manifestReadiness,
} from './contracts/coverage-manifest.js';
export type {
  CaseOutcome,
  ExecutionLayer,
  Jf5bCoverageManifest,
  LanguageMode,
  LiveCaseRecord,
} from './contracts/coverage-manifest.js';

// The JF-5B release identities and the six bindings.
export {
  CERTIFIED_AGENTS,
  CERTIFIED_PROVIDERS,
  GROQ_DATA_CONTROLS_REF,
  JF5B_CAPABILITY_PROFILE_REF,
  JF5B_CATALOGUE_SNAPSHOT,
  JF5B_CREATED_AT,
  JF5B_EVALUATION_SUITE_ID,
  JF5B_EVALUATION_SUITE_VERSION,
  JF5B_EVALUATOR_IMPL_ID,
  JF5B_EVALUATOR_IMPL_VERSION,
  JF5B_FIXTURE_MANIFEST_ID,
  JF5B_FIXTURE_MANIFEST_VERSION,
  JF5B_POLICY_CONTRACT_REVISION,
  JF5B_RED_TEAM_SUITE_ID,
  JF5B_RED_TEAM_SUITE_VERSION,
  NARA_DATA_CONTROLS_REF,
  PROMPT_BY_AGENT,
  createJf5bBinding,
  createJf5bBindingMatrix,
  createJf5bRelease,
} from './releases/jf5b-releases.js';
export type {
  CertifiedAgent,
  CertifiedProvider,
  Jf5bReleaseInput,
} from './releases/jf5b-releases.js';

// Nara credential ingress: the existing masked primitive, wrapped in the Nara-specific holder.
export {
  MAX_NARA_CREDENTIAL_LENGTH,
  MIN_NARA_CREDENTIAL_LENGTH,
  NARA_CREDENTIAL_FAILURES,
  NARA_CREDENTIAL_PROMPT_LABEL,
  createNodeMaskedSecretSource,
  readNaraCredential,
} from './credential/nara-credential-ingress.js';
export type {
  MaskedSecretSource,
  NaraCredentialFailure,
  NaraCredentialResult,
} from './credential/nara-credential-ingress.js';

// The ONE bounded network seam: authenticated discovery I/O, kept apart from the pure rules next to it.
export {
  DISCOVERY_FAILURES,
  DISCOVERY_TIMEOUT_MS,
  fetchNaraModelCatalogue,
} from './discovery/nara-discovery-transport.js';
export type {
  DiscoveryFailure,
  DiscoveryFetchResult,
  DiscoveryHttpResponse,
  NaraDiscoveryTransport,
  ReserveCall,
} from './discovery/nara-discovery-transport.js';

// The seams the executable injects, the phase vocabulary and the closed exit codes.
export { EXIT_CODES, RUN_PHASES } from './contracts/run-seams.js';
export type {
  ArtifactWriter,
  ConfirmationReader,
  ExitCode,
  OperatorIo,
  RepositoryFacts,
  RunOutcome,
  RunPhase,
} from './contracts/run-seams.js';

// The non-secret preflight summary and the argv surface.
export {
  GROQ_CHAT_HOST,
  NARA_CHAT_HOST,
  parseCertifyArgv,
  renderPreflightSummary,
} from './cli/preflight.js';
export type { CertifyArgv, PreflightFacts } from './cli/preflight.js';

// The JF-5B-ONLY phase-3 root-cause diagnostics (JF-5B-R8). Evaluation-only, like the pacer above: a
// spec pins the exact set of files permitted to name them, and no serving path is among them.
export {
  groqFactsFrom,
  groqMalformedStage,
  naraFactsFrom,
  naraMalformedStage,
  observeGroqTransport,
  observeNaraTransport,
  renderWireDiagnostic,
} from './diagnostics/jf5b-wire-observer.js';
export { GROQ_JSON_VALIDATE_FAILED_CODE } from './diagnostics/jf5b-wire-observer.js';
export type {
  FailedGenerationFacts,
  FailedGenerationKind,
  GroqWireFacts,
  MalformedStage,
  MessageContentKind,
  NaraWireFacts,
  ObservedGroqTransport,
  ObservedNaraTransport,
  WireObserver,
} from './diagnostics/jf5b-wire-observer.js';
export {
  MAX_SCHEMA_ISSUES,
  SCHEMA_ISSUES_UNAVAILABLE,
  renderSchemaIssues,
  schemaIssueTokens,
} from './diagnostics/jf5b-schema-issues.js';
