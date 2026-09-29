const REDACTED = '[REDACTED_TYPESAFE_API_KEY]';

export class TypeSafeApiKey {
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

export function createTypeSafeApiKey(value: string): TypeSafeApiKey {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 512) {
    throw new Error(
      'A TypeSafe API key must be a non-empty bounded string injected at composition.',
    );
  }
  return new TypeSafeApiKey(value);
}
