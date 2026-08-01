/**
 * `@qf-jarvis/prompt-registry` — the versioned prompt registry foundation (QFJ-S3-I-A, ADR-0072).
 *
 * A MECHANISM, not a prompt set. This package registers no production QuickFurno prompt, wires into
 * no runtime, and changes nothing about what the model is currently told: the hard-coded
 * `REPLY_PROMPT_CONTRACT` in the M4 adapter is untouched, and S3-I-B is where it is replaced.
 *
 * What it adds is the one property the runtime lacks today — a prompt identity that is BOUND to its
 * exact bytes. The digest is computed at construction from the template, never accepted from a
 * caller, so an identity cannot name a body it does not match.
 *
 * A definition existing is not approval. Prompt definition, evaluation evidence, provider rollout
 * approval, production selection and business authority remain five separate things, and this package
 * is only the first. There is no lifecycle state, no template engine, no mutation after construction,
 * no persistence, no network, no provider, no environment and no credential.
 *
 * Seven root runtime symbols. The digest helper and every internal schema stay unexported.
 */
export {
  PROMPT_REGISTRY_VERSION,
  PROMPT_AGENT_SCOPES_FROZEN,
  PROMPT_RESULT_MODES_FROZEN,
  createPromptDefinition,
} from './contracts/prompt-definition.js';
export type {
  PromptRegistryVersion,
  PromptAgentScope,
  PromptResultMode,
  PromptDefinitionInput,
  PromptDefinition,
} from './contracts/prompt-definition.js';

export { createPromptRegistry } from './contracts/prompt-registry.js';
export type { PromptRegistry, PromptResolutionRequest } from './contracts/prompt-registry.js';

export { PromptRegistryError, PROMPT_REGISTRY_ERROR_CODES } from './contracts/errors.js';
export type { PromptRegistryErrorCode } from './contracts/errors.js';
