/**
 * The closed error vocabulary for Anisha behaviour construction (QFJ-S3-D-A, ADR-0070).
 *
 * A package-local error type, following the same shape every other runtime package uses
 * (`AgentRuntimeError`, `RiyaBehaviourError`, and the adapter errors in M3/M4/M5): a closed `code`, a
 * fixed repository-owned message, a frozen instance, and never caller content, vendor text, a
 * document, a balance or arbitrary metadata.
 *
 * This is NOT a second error system for the runtime. Runtime OUTCOMES continue to use `RuntimeReason`
 * from `@qf-jarvis/agent-runtime`. These codes are raised only when a caller hands this package
 * structurally invalid behaviour input.
 */
const ANISHA_ERROR_CODE_VALUES = [
  /** A vendor-journey context failed the closed schema, its bounds, or a contradiction rule. */
  'invalid-vendor-journey-context',
  /** The turn input failed the closed behaviour schema, or its signals and context disagree. */
  'invalid-turn-input',
] as const;
export type AnishaErrorCode = (typeof ANISHA_ERROR_CODE_VALUES)[number];

/** Frozen at runtime, not merely `as const` — a caller holding the array cannot grow the vocabulary. */
export const ANISHA_ERROR_CODES: readonly AnishaErrorCode[] = Object.freeze([
  ...ANISHA_ERROR_CODE_VALUES,
]);

const ANISHA_ERROR_MESSAGES: Readonly<Record<AnishaErrorCode, string>> = Object.freeze({
  'invalid-vendor-journey-context': 'An Anisha vendor-journey context is invalid.',
  'invalid-turn-input': 'An Anisha turn input is invalid.',
});

/**
 * A bounded, content-free Anisha behaviour error.
 *
 * The message is repository-owned and stable. A validator that echoed a zod issue path, a caller
 * message or a rejected value would turn an error into a disclosure surface — and the values this
 * package rejects are exactly the ones that must not leak.
 */
export class AnishaBehaviourError extends Error {
  public readonly code: AnishaErrorCode;

  public constructor(code: AnishaErrorCode) {
    super(ANISHA_ERROR_MESSAGES[code]);
    this.name = 'AnishaBehaviourError';
    this.code = code;
    Object.freeze(this);
  }
}
