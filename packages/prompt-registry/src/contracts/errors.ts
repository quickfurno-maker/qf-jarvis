/**
 * The closed error vocabulary for prompt-registry construction (QFJ-S3-I-A, ADR-0072).
 *
 * A package-local error type following the same shape every other package uses (`AgentRuntimeError`,
 * `RiyaBehaviourError`, `AnishaBehaviourError`, the M3/M4/M5 adapter errors): a closed `code`, a fixed
 * repository-owned message, a frozen instance.
 *
 * The message discipline matters more here than anywhere else in the repository. An error raised while
 * validating a prompt definition is holding the prompt text at that moment, and a message that echoed
 * the rejected value — or a zod issue path, or a caller identifier — would turn a validator into the
 * one place system instructions leak into logs. So the public message says what went wrong and
 * nothing about what was passed in.
 */
const PROMPT_REGISTRY_ERROR_CODE_VALUES = [
  /** A definition failed the closed schema, its bounds, or its digest re-computation. */
  'invalid-definition',
  /** Two definitions claimed the same (promptId, promptVersion) identity. */
  'duplicate-definition',
  /** A resolution request was structurally invalid. A well-formed miss returns undefined instead. */
  'invalid-resolution',
] as const;
export type PromptRegistryErrorCode = (typeof PROMPT_REGISTRY_ERROR_CODE_VALUES)[number];

/** Frozen at runtime, not merely `as const` — a caller holding the array cannot grow the vocabulary. */
export const PROMPT_REGISTRY_ERROR_CODES: readonly PromptRegistryErrorCode[] = Object.freeze([
  ...PROMPT_REGISTRY_ERROR_CODE_VALUES,
]);

const PROMPT_REGISTRY_ERROR_MESSAGES: Readonly<Record<PromptRegistryErrorCode, string>> =
  Object.freeze({
    'invalid-definition': 'A prompt definition is invalid.',
    'duplicate-definition': 'A duplicate prompt definition is not allowed.',
    'invalid-resolution': 'A prompt resolution request is invalid.',
  });

/** A bounded, content-free prompt-registry error. It never carries prompt text or caller values. */
export class PromptRegistryError extends Error {
  public readonly code: PromptRegistryErrorCode;

  public constructor(code: PromptRegistryErrorCode) {
    super(PROMPT_REGISTRY_ERROR_MESSAGES[code]);
    this.name = 'PromptRegistryError';
    this.code = code;
    Object.freeze(this);
  }
}
