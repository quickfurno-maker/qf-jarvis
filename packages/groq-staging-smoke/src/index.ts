/**
 * `@qf-jarvis/groq-staging-smoke` — the one-shot Groq STAGING smoke harness (QFJ-S1A, ADR-0061).
 *
 * The barrel exposes only the composition symbols, the closed sanitized vocabulary, the fixed synthetic
 * prompt identity constants, and the read-only types. It exposes NO credential accessor, NO prompt-text
 * override, NO second-invocation surface, and NOT the deterministic fakes (those live behind the
 * `./testing` subpath so they can never become a production default).
 *
 * Everything here is staging-only and non-authoritative. The model output is a discarded draft;
 * QuickFurno Core remains the final business authority and system of record.
 */

// The closed sanitized outcome vocabulary.
export {
  SMOKE_SUCCESS_REASON,
  SMOKE_FAILURE_REASONS,
  isSmokeReason,
  type SmokeFailureReason,
  type SmokeReason,
} from './smoke-reasons.js';

// The ONE fixed synthetic prompt — identity constants and the strict schema only. The messages are
// exported so a reviewer can read exactly what would be sent; nothing can replace them.
export {
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
  SYNTHETIC_SMOKE_MESSAGES,
  SYNTHETIC_SMOKE_JSON_SCHEMA,
  isSyntheticSmokeResponse,
} from './synthetic-prompt.js';

// The strict, closed, NON-SECRET configuration.
export {
  parseSmokeConfig,
  loadSmokeConfig,
  MIN_SMOKE_TIMEOUT_MS,
  MAX_SMOKE_TIMEOUT_MS,
  type SmokeConfig,
  type SmokeConfigResult,
} from './config.js';

// The SEMANTIC approval digest of a parsed configuration — the values, not the file bytes. Exported
// because the candidate evidence operator must verify the approval a config carries, and hashing the
// serialized file to do it is the exact defect HF1 repaired.
export {
  computeSmokeApprovalDigest,
  canonicalSmokeApprovalJson,
  smokeApprovalDigestPayload,
} from './config-digest.js';

// The concrete masked-TTY credential ingress (outside @qf-jarvis/model-gateway). No key accessor.
export {
  createMaskedTtyCredentialResolver,
  createNodeMaskedSecretSource,
  CREDENTIAL_PROMPT_LABEL,
  MIN_CREDENTIAL_LENGTH,
  MAX_CREDENTIAL_LENGTH,
  type MaskedSecretSource,
  type StagingCredentialResolver,
} from './masked-tty-credential-resolver.js';

// The one-shot run: one bind, one invocation, one HTTP request, zero retries, harness-owned abort.
export {
  runGroqStagingSmokeOnce,
  createSystemSmokeTimer,
  type SmokeTimer,
  type SmokeRunDeps,
  type SmokeRunResult,
  type SmokeCounters,
  type SmokeReferences,
} from './run-once.js';

// The sanitized report and the command surface.
export {
  formatSanitizedSmokeResult,
  formatSanitizedPreRunFailure,
} from './format-sanitized-result.js';
export {
  parseSmokeArgv,
  runSmokeCli,
  type SmokeArgvResult,
  type SmokeCliIo,
  type SmokeExitCode,
} from './cli.js';
