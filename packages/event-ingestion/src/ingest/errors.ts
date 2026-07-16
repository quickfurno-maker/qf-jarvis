/**
 * The single, bounded error raised when the semantic canonicaliser is handed a value
 * outside the JSON value domain (ADR-0029 rule 7).
 *
 * It carries a **stable code** from a closed set and a **bounded structural path** that names
 * structure only: **sorted object-key ordinal tokens** (`[key#0]`) and **numeric array
 * indexes** (`[3]`) — for example `$[key#0][key#1][3]`. It **never** includes a raw object-key
 * name (which could itself be an email, phone number, address, credential, or free text), a
 * symbol-key description, the rejected value, the canonical string, the event payload, a
 * signature, or key material: a utility that refuses a value must not then record it
 * (ADR-0029, ADR-0026, security-principles §5).
 */

/** The closed set of reasons the semantic canonicaliser refuses an input. Stable, countable. */
export type SemanticCanonicalisationErrorCode =
  | 'unsupported-value'
  | 'non-finite-number'
  | 'sparse-array'
  | 'cyclic-value'
  | 'non-plain-object'
  | 'accessor-property'
  | 'symbol-key';

/** Raised on programmer misuse. Carries a code and a structural path — never a value. */
export class SemanticCanonicalisationError extends Error {
  /** A stable machine token from the closed set above. */
  public readonly code: SemanticCanonicalisationErrorCode;

  /**
   * A bounded, data-free structural path to the offending location: sorted object-key ordinal
   * tokens and numeric array indexes, e.g. `$[key#0][key#1][3]`. Never a raw object-key name.
   */
  public readonly path: string;

  public constructor(code: SemanticCanonicalisationErrorCode, path: string) {
    super(`semantic canonicalisation refused a value (${code}) at ${path}`);
    this.name = 'SemanticCanonicalisationError';
    this.code = code;
    this.path = path;
  }
}
