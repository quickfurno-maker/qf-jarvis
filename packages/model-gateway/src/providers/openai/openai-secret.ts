/**
 * Redacting OpenAI API-key holder.
 *
 * The raw key is injected only at composition. It is never serializable or printable and is exposed
 * only as the Authorization header value consumed by the fixed-endpoint transport.
 */
const REDACTED = '[REDACTED_OPENAI_API_KEY]';

export class OpenAIApiKey {
  readonly #value: string;

  public constructor(value: string) {
    this.#value = value;
  }

  public authorizationHeaderValue(): string {
    return 'Bearer ' + this.#value;
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

export function createOpenAIApiKey(value: string): OpenAIApiKey {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 512) {
    throw new Error(
      'An OpenAI API key must be a non-empty bounded string (injected at composition).',
    );
  }
  return new OpenAIApiKey(value);
}
