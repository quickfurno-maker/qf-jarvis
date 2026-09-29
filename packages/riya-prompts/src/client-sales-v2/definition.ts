/**
 * Riya CLIENT sales prompt v2 candidate definitions.
 *
 * Candidate-only surface: no production barrel export, no rollout and no activation. These
 * definitions exist so evaluation can bind exact bytes before any production seal is updated.
 */
import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition, PromptRegistry } from '@qf-jarvis/prompt-registry';
import {
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_REPLY_TASK_CLASS,
} from '@qf-jarvis/riya-model-interaction';

import { RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V2_CANDIDATE } from './system-template.js';

export const RIYA_CLIENT_SALES_PROMPT_ID_V2_CANDIDATE = 'riya.client-sales';
export const RIYA_CLIENT_SALES_PROMPT_VERSION_V2_CANDIDATE = 2;

function variant(taskClass: string): PromptDefinition {
  return createPromptDefinition({
    promptId: RIYA_CLIENT_SALES_PROMPT_ID_V2_CANDIDATE,
    promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION_V2_CANDIDATE,
    agentScope: 'CLIENT',
    taskClass,
    resultMode: 'STRUCTURED',
    systemTemplate: RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V2_CANDIDATE,
  });
}

export const RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V2_CANDIDATE = variant(
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
);
export const RIYA_CLIENT_SALES_GROUNDED_EVOLUTION_PROMPT_V2_CANDIDATE = variant(
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
);
export const RIYA_CLIENT_SALES_GROUNDED_REPLY_PROMPT_V2_CANDIDATE = variant(
  RIYA_GROUNDED_REPLY_TASK_CLASS,
);

export const RIYA_V2_CANDIDATE_PROMPTS: readonly PromptDefinition[] = Object.freeze([
  RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V2_CANDIDATE,
  RIYA_CLIENT_SALES_GROUNDED_EVOLUTION_PROMPT_V2_CANDIDATE,
  RIYA_CLIENT_SALES_GROUNDED_REPLY_PROMPT_V2_CANDIDATE,
]);

export function createRiyaPromptRegistryV2Candidate(): PromptRegistry {
  return createPromptRegistry(RIYA_V2_CANDIDATE_PROMPTS);
}
