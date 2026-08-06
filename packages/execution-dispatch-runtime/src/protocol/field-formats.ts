/**
 * Strict format validators for values that cross the execution-dispatch boundary.
 *
 * Deliberately DUPLICATED rather than imported from `@qf-jarvis/event-ingestion`. Sharing the
 * module would couple two trust boundaries that must be able to diverge, and -- worse -- would put
 * this package one import away from the B1 signing domain and key registry it must never reuse.
 * ADR-0090 records that boundary-specific duplication of a small hardened verifier is the cheaper
 * risk than a shared crypto framework that could accidentally unify the two domains.
 */

/**
 * A keyId: 1-128 characters, starting ASCII alphanumeric, then alphanumerics and `. _ : -`.
 *
 * Excluded deliberately: spaces, tabs, CR, LF, other control characters, `/` and `\` -- and above
 * all the `\n` that delimits the signing input. A keyId can therefore never inject a line into the
 * signing input, nor a separator into a log line.
 */
export const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** True iff `value` is a valid keyId. Never coerces: a non-string is rejected, not stringified. */
export function isValidKeyId(value: unknown): value is string {
  return typeof value === 'string' && KEY_ID_PATTERN.test(value);
}

/**
 * A canonical UTC instant: exactly `YYYY-MM-DDTHH:mm:ss.SSSZ`, and a real calendar instant proven
 * by round-trip through `toISOString()`. Returns epoch milliseconds, or `null`.
 */
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function parseCanonicalTimestampMs(value: string): number | null {
  if (value.length !== 24 || !CANONICAL_TIMESTAMP.test(value)) {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString() === value ? ms : null;
}

/**
 * Decode an Ed25519 signature string: exactly 88 characters, 86 Base64 data characters then `==`,
 * canonical, decoding to exactly 64 bytes. Any deviation of length, alphabet, padding or canonical
 * form returns `null`.
 */
const ED25519_SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

export function decodeEd25519Signature(value: string): Buffer | null {
  if (value.length !== 88 || !ED25519_SIGNATURE_BASE64.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 64) {
    return null;
  }
  return bytes.toString('base64') === value ? bytes : null;
}

/** Decode canonical padded Base64 to bytes, or `null`. Used for the SPKI DER public key. */
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}
