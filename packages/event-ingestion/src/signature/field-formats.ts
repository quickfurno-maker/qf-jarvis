/**
 * Shared, strict format validators for the values that cross the trust boundary.
 *
 * There is exactly **one** definition each for a keyId, a canonical timestamp, and an
 * Ed25519 signature, and both the envelope parser and the public-key registry use them.
 * A single definition is the point: if the envelope accepted a keyId shape the registry
 * rejected (or vice versa), the two would disagree about identity, and disagreement at a
 * trust boundary is where bugs and attacks live.
 */

/**
 * A keyId: **1–128 characters**, starting with an ASCII alphanumeric, then ASCII
 * alphanumerics and `. _ : -`.
 *
 * Excluded, deliberately: spaces, tabs, CR, LF, other Unicode control characters, `/`
 * and `\` path separators, and — critically — the `\n` that delimits the signing input.
 * A keyId can therefore never inject a newline into the signing input, nor a separator
 * into a log line.
 */
export const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * True iff `value` is a valid keyId. Accepts `unknown` and does not coerce: a non-string
 * (a number, a `String` object, `null`) is rejected outright, never stringified.
 */
export function isValidKeyId(value: unknown): value is string {
  return typeof value === 'string' && KEY_ID_PATTERN.test(value);
}

/**
 * A canonical UTC instant: exactly `YYYY-MM-DDTHH:mm:ss.SSSZ` (24 ASCII characters) and
 * a real calendar instant, proven by round-trip through `toISOString()` — so `2026-13-40…`
 * and any non-canonical spelling fail. Returns the epoch-millisecond value, or `null`.
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
 * Decode an Ed25519 signature string. It must be **exactly 88 characters**: 86 Base64
 * data characters followed by `==`, canonical, decoding to exactly 64 bytes. Any
 * deviation of length, alphabet, padding, or canonical form returns `null`.
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

/**
 * Decode a canonical, padded Base64 string of arbitrary (non-zero, multiple-of-four)
 * length to its bytes, or `null` if it is not canonical padded Base64. Used for the
 * SPKI DER public key in the registry.
 */
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !CANONICAL_BASE64.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}
