/**
 * The closed error vocabulary for Riya behaviour construction (QFJ-S3-C, ADR-0067).
 *
 * A package-local error type, following the same shape every other runtime package uses
 * (`AgentRuntimeError`, and the adapter errors in M3/M4/M5): a closed `code`, a fixed
 * repository-owned message, a frozen instance, and never caller content, client text, a subject
 * reference or arbitrary metadata.
 *
 * This is NOT a second error system for the runtime. Runtime OUTCOMES continue to use
 * `RuntimeReason` from `@qf-jarvis/agent-runtime`, and proposal/scope failures continue to raise
 * `AgentRuntimeError` from the merged boundary. These codes are raised only when a caller hands this
 * package structurally invalid behaviour input.
 */
export const RIYA_ERROR_CODES = [
  /** The turn input failed the closed behaviour schema. */
  'invalid-turn-input',
  /** A need-discovery record failed the closed schema or its bounds. */
  'invalid-need-discovery',
  /** A proposal request failed the closed schema before reaching the merged proposal boundary. */
  'invalid-proposal-request',
] as const;
export type RiyaErrorCode = (typeof RIYA_ERROR_CODES)[number];

const RIYA_ERROR_MESSAGES: Readonly<Record<RiyaErrorCode, string>> = Object.freeze({
  'invalid-turn-input': 'A Riya turn input is invalid.',
  'invalid-need-discovery': 'A Riya need-discovery record is invalid.',
  'invalid-proposal-request': 'A Riya proposal request is invalid.',
});

/** A bounded, content-free Riya behaviour error. */
export class RiyaBehaviourError extends Error {
  public readonly code: RiyaErrorCode;

  public constructor(code: RiyaErrorCode) {
    super(RIYA_ERROR_MESSAGES[code]);
    this.name = 'RiyaBehaviourError';
    this.code = code;
    Object.freeze(this);
  }
}
