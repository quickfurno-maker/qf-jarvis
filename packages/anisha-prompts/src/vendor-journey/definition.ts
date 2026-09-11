/**
 * The governed Anisha VENDOR journey prompt definition, v1 (JF-5A, ADR-0151).
 *
 * ### Why this package exists at all
 *
 * `@qf-jarvis/prompt-registry` is a MECHANISM: it binds an identity to exact bytes and computes their
 * digest, and it deliberately ships no content. ADR-0073 records "a default production prompt" as a
 * rejected alternative.
 *
 * So Anisha had a decision kernel, a behaviour adapter, a runtime seam, a governed RAG scope — and no
 * prompt. ADR-0071 said so explicitly and left it open. A vendor turn that reached the model boundary
 * resolved whatever single identity the deployment happened to configure, which for every existing
 * deployment is Riya's CLIENT prompt, and a CLIENT definition cannot serve a VENDOR scope: the registry
 * refuses it. That refusal was correct and it was also the whole gap.
 *
 * ### ONE task class, deliberately
 *
 * Anisha's serving path resolves one identity at `RESPONSE_GENERATION`. Riya defines three variants
 * because her runtime supplies three different payload shapes and all three appear in her governed
 * corpus; Anisha's runtime supplies one. Defining two more to match Riya's shape would create prompt
 * identities nothing resolves, and a suite could not honestly say which of them it evaluated.
 *
 * ### It authorizes nothing
 *
 * A definition existing is not approval, not evaluation, not rollout and not selection. There is no
 * activation state, no model, no provider, no gateway, no registry lifecycle, no mutation, no
 * persistence, no network and no credential.
 */
import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition, PromptRegistry } from '@qf-jarvis/prompt-registry';

import { ANISHA_VENDOR_JOURNEY_SYSTEM_TEMPLATE_V1 } from './system-template.js';

/** The exact, durable identity. Never `latest`, never a moving alias. */
export const ANISHA_VENDOR_JOURNEY_PROMPT_ID = 'anisha.vendor-journey';
export const ANISHA_VENDOR_JOURNEY_PROMPT_VERSION = 1;

/**
 * The task class Anisha's serving path resolves.
 *
 * The generic runtime default, and written here rather than imported because `jarvis-runtime` owns the
 * constant as a private composition detail and this package must not depend on the runtime. The
 * registry refuses a mismatch, so a drift between the two fails closed at resolution rather than
 * silently selecting nothing.
 */
export const ANISHA_VENDOR_JOURNEY_TASK_CLASS = 'RESPONSE_GENERATION';

/** The ONE reviewed Anisha production prompt. VENDOR scope, STRUCTURED result. */
export const ANISHA_VENDOR_JOURNEY_PROMPT_V1: PromptDefinition = createPromptDefinition({
  promptId: ANISHA_VENDOR_JOURNEY_PROMPT_ID,
  promptVersion: ANISHA_VENDOR_JOURNEY_PROMPT_VERSION,
  agentScope: 'VENDOR',
  taskClass: ANISHA_VENDOR_JOURNEY_TASK_CLASS,
  resultMode: 'STRUCTURED',
  systemTemplate: ANISHA_VENDOR_JOURNEY_SYSTEM_TEMPLATE_V1,
});

/**
 * Every production Anisha prompt this package defines.
 *
 * A frozen list rather than a loose export set, so a spec can assert the production surface has not
 * quietly grown a second prompt nobody reviewed.
 */
export const ANISHA_PRODUCTION_PROMPTS: readonly PromptDefinition[] = Object.freeze([
  ANISHA_VENDOR_JOURNEY_PROMPT_V1,
]);

/**
 * The assembled registry.
 *
 * Offered so an evaluation operator and a production composition do not each rebuild the same assembly
 * and risk assembling it differently. It is `createPromptRegistry` over the frozen set and nothing
 * more: no lifecycle, no activation, no mutation, no environment discovery.
 */
export function createAnishaPromptRegistryV1(): PromptRegistry {
  return createPromptRegistry(ANISHA_PRODUCTION_PROMPTS);
}
