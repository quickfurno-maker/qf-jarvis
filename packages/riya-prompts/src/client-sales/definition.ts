/**
 * The governed Riya CLIENT sales prompt definitions, v1 (MVP-P2A.2-P).
 *
 * ### Why this package exists at all
 *
 * `@qf-jarvis/prompt-registry` is a MECHANISM: it binds an identity to exact bytes and computes their
 * digest, and it deliberately ships no content. ADR-0073 records "a default production prompt" as a
 * rejected alternative, and the synthetic SHADOW probe was the only definition in production source.
 *
 * So Riya had a registry and no prompt. Model selection stalled on exactly that: a candidate evaluated
 * without the prompt it will serve behind is not the candidate, and a P10 quality number produced that
 * way would be a measurement of a connectivity probe.
 *
 * ### THREE task classes, ONE reviewed body
 *
 * The Riya serving path resolves three exact CLIENT prompt identities with no fallback between them:
 * the ungrounded evolution turn, the grounded evolution turn, and the post-summary grounded reply-only
 * turn. The governed P10 corpus needs all three — `GROUNDING_QA`, `POST_SUMMARY_QA` and `COMPLETE_QA`
 * every one require a citation, and the last two sit at `SUMMARY` and `COMPLETE` where the reply-only
 * identity serves. Defining one of the three would leave 18 of the 72 cases unrunnable.
 *
 * They share ONE body, and that is load-bearing rather than convenient. A generic `EvaluationBinding`
 * carries a single `promptFamily`/`promptVersion`/`promptDigest`. If the suite executed three
 * different bodies, no honest binding could say which prompt it evaluated — and picking one digest as
 * "representative" would be a fabricated identity. With identical bytes there is nothing to choose
 * between: the family, the version and the digest are the same fact for all three.
 *
 * What actually differs between the paths is what the RUNTIME supplies — whether `groundedKnowledge`
 * is in the turn, and which strict schema the gateway enforces — so the body says "follow what this
 * turn gave you" rather than assuming one shape.
 *
 * ### It authorizes nothing
 *
 * A definition existing is not approval, not evaluation, not rollout and not selection — those remain
 * four separate things, and this is the first. There is no activation state, no model, no provider, no
 * gateway, no registry lifecycle, no mutation, no persistence, no network and no credential.
 */
import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition, PromptRegistry } from '@qf-jarvis/prompt-registry';
import {
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_REPLY_TASK_CLASS,
} from '@qf-jarvis/riya-model-interaction';

import { RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1 } from './system-template.js';

/** The exact, durable identity shared by every variant. Never `latest`, never a moving alias. */
export const RIYA_CLIENT_SALES_PROMPT_ID = 'riya.client-sales';
export const RIYA_CLIENT_SALES_PROMPT_VERSION = 1;

/**
 * One variant.
 *
 * Everything except the task class is fixed here, so a variant cannot be added with different bytes,
 * a different scope or a different result mode by accident — and the registry refuses it anyway.
 */
function clientSalesVariant(taskClass: string): PromptDefinition {
  return createPromptDefinition({
    promptId: RIYA_CLIENT_SALES_PROMPT_ID,
    promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
    agentScope: 'CLIENT',
    taskClass,
    resultMode: 'STRUCTURED',
    systemTemplate: RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1,
  });
}

/** The ordinary turn: no governed knowledge in the payload, evolution schema. */
export const RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1: PromptDefinition = clientSalesVariant(
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
);

/** The grounded turn: governed records in the payload, evolution schema. */
export const RIYA_CLIENT_SALES_GROUNDED_EVOLUTION_PROMPT_V1: PromptDefinition = clientSalesVariant(
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
);

/** The post-summary turn: governed records in the payload, reply-only schema, no phase move. */
export const RIYA_CLIENT_SALES_GROUNDED_REPLY_PROMPT_V1: PromptDefinition = clientSalesVariant(
  RIYA_GROUNDED_REPLY_TASK_CLASS,
);

/**
 * Every production Riya prompt this package defines: three task classes, one reviewed body.
 *
 * A frozen list rather than a loose export set, so a spec can assert the production surface has not
 * quietly grown a fourth prompt nobody reviewed — or a variant whose bytes drifted from the others.
 */
export const RIYA_PRODUCTION_PROMPTS: readonly PromptDefinition[] = Object.freeze([
  RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1,
  RIYA_CLIENT_SALES_GROUNDED_EVOLUTION_PROMPT_V1,
  RIYA_CLIENT_SALES_GROUNDED_REPLY_PROMPT_V1,
]);

/**
 * The assembled registry.
 *
 * Offered so the candidate evidence operator and a future production composition do not each rebuild
 * the same three-variant assembly and risk assembling it differently. It is `createPromptRegistry`
 * over the frozen set and nothing more: no lifecycle, no activation, no mutation, no environment
 * discovery. Building a registry is not registering a prompt with anything.
 */
export function createRiyaPromptRegistryV1(): PromptRegistry {
  return createPromptRegistry(RIYA_PRODUCTION_PROMPTS);
}
