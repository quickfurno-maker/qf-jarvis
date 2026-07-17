/**
 * `@qf-jarvis/event-ingestion` — the trust boundary in front of the event log.
 *
 * **Stage 3.2 provides pure Ed25519 signature verification, and nothing else.**
 *
 * What is here: a synchronous `verifySignature` function, a public-key registry, the
 * signature envelope type, the stable failure reason codes, and the protocol
 * constants. That is the entirety of the Core → Jarvis input-authentication layer.
 *
 * ### Stage 3.3 slice 1 adds a pure semantic-digest foundation (ADR-0029) — INTERNAL
 *
 * A deterministic canonical JSON + SHA-256 digest over an already-validated canonical event
 * exists internally (`src/ingest/`), for later semantic duplicate comparison. It is
 * **database-free** and separately owner-authorized, but it is **not a public package
 * capability**: it is deliberately **not exported** from this barrel, because there is no
 * current consumer and it must only ever be handed already-validated canonical-event output.
 * Only the later validated-ingestion composition will call it. It performs **no ingestion**,
 * touches **no database**, and is **not** the signing canonicalisation — signatures still
 * verify the exact raw bytes (ADR-0027).
 *
 * ### Stage 3.3 slice 2 adds database-free validated-event preparation (ADR-0030) — INTERNAL
 *
 * A pure composition (`src/ingest/prepare-validated-event.ts`) turns a raw body that has
 * **already passed Stage 3.2 signature and freshness verification** into a validated canonical
 * event bound to its semantic digest: strict fatal UTF-8 decoding, explicit BOM rejection,
 * `JSON.parse`, validation against the authoritative `@qf-jarvis/contracts` registry, and — on
 * success — a pristine, deeply frozen snapshot digested by the slice-1 primitive. A refused
 * body yields one of three pinned identifiers (`contract-validation-failed`,
 * `unknown-event-type`, `unknown-event-version`). It adds **no `ingest`, no persistence, no
 * database** and is **not exported** from this barrel — it is reached only by the later,
 * still-gated ingest composition.
 *
 * ### What is still deliberately absent (later Stage 3.3 slices)
 *
 * There is **no `ingest` function**, **no database access**, **no idempotency or deduplication**,
 * **no conflict handling**, **no dead-letter or replay logic**, **no HTTP endpoint**, and **no
 * worker loop**. Those are later Stage 3.3 slices onward, each already designed in
 * ADR-0020 / ADR-0021 / ADR-0022, and every persistence-touching part **remains gated on
 * managed-database readiness** (ADR-0029). Stage 3.2 refuses a forged, altered, stale, or
 * wrongly-keyed body; slice 2 decides whether an authentic body is a recognised, valid canonical
 * event — but neither one persists anything.
 *
 * ### Importing this package connects to, and reads, nothing
 *
 * No module here reads `process.env`, opens a file, or touches the network. The clock
 * is injected as `now`; the keys are injected as a `registry`. Its only runtime dependencies are
 * `node:crypto` and, since slice 2, `@qf-jarvis/contracts` — a **data-only** package that itself
 * opens no socket, reads no environment, and touches no filesystem (its transitive `zod` is used
 * for validation only). Contract validation still runs *behind* signature verification, never in
 * front of it.
 *
 * See docs/decisions/ADR-0027 (Stage 3.2 protocol), ADR-0029 (semantic digest), ADR-0030
 * (validated event preparation), and ADR-0020 (the parent design).
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

// --- Stage 3.3 slices 1 & 2: internal ingest primitives (ADR-0029, ADR-0030) — NOT exported ---
//
// The deterministic canonical-JSON + SHA-256 digest (slice 1) and the validated-event
// preparation that composes verification → UTF-8 → JSON → contract validation → frozen snapshot +
// digest (slice 2) are compiled as part of the package but are DELIBERATELY NOT re-exported here.
// A public surface is a promise; these are reached only by the later, still-gated ingest
// composition inside this package. Exposing them now would publish internal primitives — the
// digest must only ever see already-validated output, and preparation must only ever see an
// already-verified body. The package-root runtime surface stays exactly the Stage 3.2 set above.
