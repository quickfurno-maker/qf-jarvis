/**
 * The Groq API-key holder (QFJ-P04.01B, ADR-0046).
 *
 * The key is INJECTED at composition and held in a private field that is non-printable and
 * non-serializable: `toString`, `toJSON`, and Node's inspect hook all return a fixed redaction marker,
 * so the key can never appear in a log line, a snapshot, an error, an observability event, provenance,
 * or a report. Only the transport boundary reads {@link GroqApiKey.authorizationHeaderValue}; the value
 * itself is never otherwise exposed and there is NO environment-variable access anywhere in this package.
 */
const REDACTED = '[REDACTED_GROQ_API_KEY]';

export class GroqApiKey {
  readonly #value: string;

  public constructor(value: string) {
    this.#value = value;
  }

  /** The `Authorization` header value. Read ONLY by the transport when building a request. */
  public authorizationHeaderValue(): string {
    return `Bearer ${this.#value}`;
  }

  public toString(): string {
    return REDACTED;
  }
  public toJSON(): string {
    return REDACTED;
  }
  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}

/**
 * Wrap an injected key value. Rejects an empty/oversized value; does NOT assert a provider-specific
 * prefix (a sentinel key must be usable in tests). Never logs or returns the value.
 */
export function createGroqApiKey(value: string): GroqApiKey {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 512) {
    throw new Error('A Groq API key must be a non-empty bounded string (injected at composition).');
  }
  return new GroqApiKey(value);
}
