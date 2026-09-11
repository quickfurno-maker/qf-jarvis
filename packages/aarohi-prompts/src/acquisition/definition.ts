/**
 * The governed Aarohi PROSPECT acquisition prompt definition, v1 (JF-5A, ADR-0151).
 *
 * ### Why this package exists at all
 *
 * `@qf-jarvis/prompt-registry` is a MECHANISM: it binds an identity to exact bytes and computes their
 * digest, and it ships no content. ADR-0073 records "a default production prompt" as a rejected
 * alternative.
 *
 * So Aarohi had twelve offline-certified AVG stages, a behaviour adapter, a routed runtime seam, a
 * PROSPECT governed RAG scope — and no prompt, and until JF-5A no model scope to hold one. ADR-0150 §41
 * recorded that as the honest residue of that lane: a model-eligible acquisition turn reached the draft
 * step and failed closed. This closes it, with the scope additions in the same lane.
 *
 * ### ONE task class, deliberately
 *
 * Aarohi's serving path resolves one identity at `RESPONSE_GENERATION`. Only two of AVG-7's six
 * strategies permit a model draft at all, and both produce the same kind of turn, so a second identity
 * would be an identity nothing resolves.
 *
 * ### Defining a prompt does not make a strategy model-eligible
 *
 * Worth saying explicitly, because it is the one way this package could do harm. Which strategies may
 * reach a model is decided by `evaluateAarohiSalesTurn` and mapped by the Aarohi behaviour adapter.
 * Nothing here changes that mapping, and nothing here can: both `REQUEST_CORE_*_CONTEXT` strategies
 * remain `NO_ACTION` with zero model calls, and both review strategies remain escalations with zero
 * model calls, exactly as before.
 *
 * ### It authorizes nothing
 *
 * A definition existing is not approval, not evaluation, not rollout and not selection. There is no
 * activation state, no model, no provider, no gateway, no registry lifecycle, no mutation, no
 * persistence, no network and no credential.
 */
import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition, PromptRegistry } from '@qf-jarvis/prompt-registry';

import { AAROHI_ACQUISITION_SYSTEM_TEMPLATE_V1 } from './system-template.js';

/** The exact, durable identity. Never `latest`, never a moving alias. */
export const AAROHI_ACQUISITION_PROMPT_ID = 'aarohi.acquisition';
export const AAROHI_ACQUISITION_PROMPT_VERSION = 1;

/**
 * The task class Aarohi's serving path resolves.
 *
 * The generic runtime default, and written here rather than imported because `jarvis-runtime` owns the
 * constant as a private composition detail and this package must not depend on the runtime. The registry
 * refuses a mismatch, so a drift between the two fails closed at resolution.
 */
export const AAROHI_ACQUISITION_TASK_CLASS = 'RESPONSE_GENERATION';

/** The ONE reviewed Aarohi production prompt. PROSPECT scope, STRUCTURED result. */
export const AAROHI_ACQUISITION_PROMPT_V1: PromptDefinition = createPromptDefinition({
  promptId: AAROHI_ACQUISITION_PROMPT_ID,
  promptVersion: AAROHI_ACQUISITION_PROMPT_VERSION,
  agentScope: 'PROSPECT',
  taskClass: AAROHI_ACQUISITION_TASK_CLASS,
  resultMode: 'STRUCTURED',
  systemTemplate: AAROHI_ACQUISITION_SYSTEM_TEMPLATE_V1,
});

/**
 * Every production Aarohi prompt this package defines.
 *
 * A frozen list rather than a loose export set, so a spec can assert the production surface has not
 * quietly grown a second prompt nobody reviewed.
 */
export const AAROHI_PRODUCTION_PROMPTS: readonly PromptDefinition[] = Object.freeze([
  AAROHI_ACQUISITION_PROMPT_V1,
]);

/**
 * The assembled registry.
 *
 * Offered so an evaluation operator and a production composition do not each rebuild the same assembly
 * and risk assembling it differently. It is `createPromptRegistry` over the frozen set and nothing more.
 */
export function createAarohiPromptRegistryV1(): PromptRegistry {
  return createPromptRegistry(AAROHI_PRODUCTION_PROMPTS);
}
