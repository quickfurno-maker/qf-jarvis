/**
 * The closed error vocabulary for runtime construction (QFJ-M1, ADR-0054).
 *
 * Runtime decision OUTCOMES use {@link RuntimeReason}; these codes are raised only when building an
 * envelope, proposal, or context from invalid input. A message is a fixed, repository-owned string —
 * never caller content, a subject reference, a token, or arbitrary metadata.
 */
export const RUNTIME_ERROR_CODES = [
  'invalid-envelope',
  'invalid-proposal',
  'invalid-context',
  'scope-violation',
  'invalid-provenance',
] as const;
export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

const RUNTIME_ERROR_MESSAGES: Readonly<Record<RuntimeErrorCode, string>> = Object.freeze({
  'invalid-envelope': 'An inbound envelope is invalid.',
  'invalid-proposal': 'A runtime proposal is invalid.',
  'invalid-context': 'A conversation context is invalid.',
  'scope-violation': 'An actor may not act on this party type.',
  'invalid-provenance': 'A runtime provenance record is invalid.',
});

/**
 * A bounded, content-free agent-runtime error. It exposes only a closed `code` and a fixed message; it
 * never carries caller content, a subject reference, a token, or arbitrary metadata.
 */
export class AgentRuntimeError extends Error {
  public readonly code: RuntimeErrorCode;

  public constructor(code: RuntimeErrorCode) {
    super(RUNTIME_ERROR_MESSAGES[code]);
    this.name = 'AgentRuntimeError';
    this.code = code;
    Object.freeze(this);
  }
}
