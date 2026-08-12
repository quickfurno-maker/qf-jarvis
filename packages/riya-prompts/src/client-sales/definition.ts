/**
 * The governed Riya CLIENT sales prompt definition, v1 (MVP-P2A.2-P).
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
 * This package is the missing content boundary and nothing else. It holds versioned Riya prompt
 * definitions so the live candidate operator and a future production composition can both import the
 * same bytes rather than either duplicating them or reaching into an application.
 *
 * ### It authorizes nothing
 *
 * A definition existing is not approval, not evaluation, not rollout and not selection — those remain
 * four separate things, and this is the first. There is no activation state, no model, no provider, no
 * gateway, no registry lifecycle, no mutation, no persistence, no network and no credential.
 *
 * ### One task class, deliberately
 *
 * The Riya serving path has THREE governed prompt identities: `RIYA_CONVERSATION_EVOLUTION` (the
 * ungrounded turn), `RIYA_GROUNDED_CONVERSATION_EVOLUTION`, and `RIYA_GROUNDED_REPLY` (post-summary,
 * reply-only). They deliberately do not fall back to one another. This slice defines the FIRST — the
 * ungrounded evolution turn, which is the path a deployment runs when no grounded-knowledge registry
 * is configured, and therefore the one an MVP candidate evaluation exercises. The other two need their
 * own reviewed bytes before a grounded deployment can serve or be evaluated; they are named here so
 * their absence is a recorded gap rather than a surprise.
 */
import { createPromptDefinition } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition } from '@qf-jarvis/prompt-registry';
import { RIYA_CONVERSATION_EVOLUTION_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';

import { RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1 } from './system-template.js';

/** The exact, durable identity. Never `latest`, never a moving alias. */
export const RIYA_CLIENT_SALES_PROMPT_ID = 'riya.client-sales';
export const RIYA_CLIENT_SALES_PROMPT_VERSION = 1;

/**
 * The definition.
 *
 * Built through the real `createPromptDefinition`, so `contentDigest` is a genuine SHA-256 of exactly
 * the template bytes, computed by the same constructor the reply adapter verifies against — not a
 * second hash, and not a value anyone typed.
 */
export const RIYA_CLIENT_SALES_PROMPT_V1: PromptDefinition = createPromptDefinition({
  promptId: RIYA_CLIENT_SALES_PROMPT_ID,
  promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
  agentScope: 'CLIENT',
  taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  resultMode: 'STRUCTURED',
  systemTemplate: RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1,
});

/**
 * Every production Riya prompt this package defines. Exactly one, today.
 *
 * A frozen list rather than a loose export set, so a spec can assert the production surface has not
 * quietly grown a second prompt nobody reviewed.
 */
export const RIYA_PRODUCTION_PROMPTS: readonly PromptDefinition[] = Object.freeze([
  RIYA_CLIENT_SALES_PROMPT_V1,
]);
