/**
 * `@qf-jarvis/event-ingestion` — the trust boundary in front of the event log.
 *
 * **Stage 3.2 provides pure Ed25519 signature verification, and nothing else.**
 *
 * What is here: a synchronous `verifySignature` function, a public-key registry, the
 * signature envelope type, the stable failure reason codes, and the protocol
 * constants. That is the entirety of the Core → Jarvis input-authentication layer.
 *
 * ### What is deliberately absent (Stage 3.3 and later)
 *
 * There is **no `ingest` function**, **no database access**, **no contract parsing or
 * validation**, **no idempotency or deduplication**, **no conflict handling**, **no
 * dead-letter or replay logic**, **no HTTP endpoint**, and **no worker loop**. Those
 * are Stage 3.3 (validated signed ingestion) onward, each already designed in
 * ADR-0020 / ADR-0021 / ADR-0022. Stage 3.2 refuses a forged, altered, stale, or
 * wrongly-keyed body — it does not yet decide what a *good* one becomes.
 *
 * ### Importing this package connects to, and reads, nothing
 *
 * No module here reads `process.env`, opens a file, or touches the network. The clock
 * is injected as `now`; the keys are injected as a `registry`. The only runtime it
 * depends on is `node:crypto`. It has **zero third-party runtime dependencies** — not
 * even `@qf-jarvis/contracts` — because it sits *in front of* contract validation and
 * must stay a pure leaf.
 *
 * See docs/decisions/ADR-0027 (Stage 3.2 protocol) and ADR-0020 (the parent design).
 */

export { verifySignature } from './signature/verify.js';
export type {
  SignatureVerificationFailure,
  SignatureVerificationResult,
  SignatureVerificationSuccess,
  VerifySignatureOptions,
} from './signature/verify.js';

export type { SignatureEnvelope } from './signature/signature-envelope.js';

export {
  EVENT_KEY_PURPOSE,
  MAX_PUBLIC_KEY_RECORDS,
  PublicKeyRegistry,
} from './signature/public-key-registry.js';
export type {
  KeyStatus,
  PublicKeyConfigRecord,
  RegisteredKey,
  RegistryEnvironment,
} from './signature/public-key-registry.js';

export { SIGNATURE_VERIFICATION_REASONS } from './signature/reason-codes.js';
export type { SignatureVerificationReason } from './signature/reason-codes.js';

export { PublicKeyRegistryError, SignatureVerificationConfigError } from './signature/errors.js';

export {
  DEFAULT_FRESHNESS_WINDOW_MS,
  DOMAIN_SEPARATION_PREFIX,
  MAX_FRESHNESS_WINDOW_MS,
  MAX_RAW_BODY_BYTES,
  MIN_FRESHNESS_WINDOW_MS,
  SUPPORTED_ALGORITHM,
} from './signature/limits.js';
