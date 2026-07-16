/**
 * The fixed constants of the Stage 3.2 signature protocol (ADR-0027).
 *
 * Everything here is a protocol constant or a bound. None of it is configurable at
 * runtime except the freshness window, which is bounded by the two values below and
 * defaulted to five minutes (ADR-0020 §3).
 */

/**
 * Domain-separation prefix. It binds a signature to *this* boundary (Core → Jarvis)
 * so a signature produced for another boundary cannot be replayed as valid here
 * (ADR-0020 §2). It is the first line of the signing input.
 */
export const DOMAIN_SEPARATION_PREFIX = 'qf-jarvis-event-v1';

/** The one and only accepted signature algorithm. Asymmetric, by design (ADR-0020 §1). */
export const SUPPORTED_ALGORITHM = 'ed25519';

/**
 * Maximum raw body accepted, in bytes (256 KiB). Checked *first*, before anything
 * parses or hashes the body, so an oversized input is refused cheaply rather than
 * being read into a hash. A canonical, contract-bounded event is far smaller than
 * this; the bound exists to cap work, not to shape valid events.
 */
export const MAX_RAW_BODY_BYTES = 262_144;

/** The envelope's `bodyDigest` is `sha256:<hex>`. This is the prefix. */
export const BODY_DIGEST_PREFIX = 'sha256:';

/** A SHA-256 digest is 32 bytes — 64 lowercase hexadecimal characters. */
export const BODY_DIGEST_HEX_LENGTH = 64;

/** An Ed25519 signature is exactly 64 bytes. */
export const ED25519_SIGNATURE_BYTES = 64;

/**
 * `signedAt` is an ISO-8601 UTC instant with millisecond precision and a `Z` zone:
 * `YYYY-MM-DDTHH:mm:ss.SSSZ` — exactly 24 ASCII characters. This is precisely what
 * `Date.prototype.toISOString()` produces, which is why the parser validates by
 * canonical round-trip.
 */
export const SIGNED_AT_LENGTH = 24;

/** Default freshness window: ±5 minutes around the injected `now` (ADR-0020 §3). */
export const DEFAULT_FRESHNESS_WINDOW_MS = 300_000;

/** Smallest configurable freshness window: 1 second. A zero window rejects everything. */
export const MIN_FRESHNESS_WINDOW_MS = 1_000;

/** Largest configurable freshness window: 1 hour. Beyond this, freshness stops meaning anything. */
export const MAX_FRESHNESS_WINDOW_MS = 3_600_000;
