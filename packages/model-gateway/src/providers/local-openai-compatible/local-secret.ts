/**
 * The optional local-server auth-token holder (QFJ-P04.01C, ADR-0047).
 *
 * A local OpenAI-compatible server MAY require a bearer token; loopback dev often needs none. When one is
 * supplied it is INJECTED at composition and held in a private field that is non-printable and
 * non-serializable: `toString`, `toJSON`, and Node's inspect hook all return a fixed redaction marker, so
 * the token can never appear in a log line, a snapshot, an error, an observability event, provenance, or a
 * report. Only the transport boundary reads {@link LocalAuthToken.authorizationHeaderValue}; the value is
 * never otherwise exposed and there is NO environment-variable access anywhere in this package.
 */
const REDACTED = '[REDACTED_LOCAL_AUTH_TOKEN]';

export class LocalAuthToken {
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
 * Wrap an injected token value. Rejects an empty/oversized value; does NOT assert a server-specific
 * prefix (a sentinel token must be usable in tests). Never logs or returns the value.
 */
export function createLocalAuthToken(value: string): LocalAuthToken {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 512) {
    throw new Error(
      'A local auth token must be a non-empty bounded string (injected at composition).',
    );
  }
  return new LocalAuthToken(value);
}
