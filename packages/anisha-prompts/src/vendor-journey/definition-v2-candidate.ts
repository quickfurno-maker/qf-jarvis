/**
 * Anisha v2 vendor-expert candidate. Not part of ANISHA_PRODUCTION_PROMPTS.
 * Production profile and the exact approved v1 digest remain unchanged.
 */
import { createPromptDefinition } from '@qf-jarvis/prompt-registry';
import { ANISHA_VENDOR_JOURNEY_PROMPT_ID, ANISHA_VENDOR_JOURNEY_TASK_CLASS } from './definition.js';
import { ANISHA_VENDOR_EXPERT_SYSTEM_TEMPLATE_V2_CANDIDATE } from './system-template-v2-candidate.js';

export const ANISHA_VENDOR_EXPERT_PROMPT_V2_CANDIDATE = createPromptDefinition({
  promptId: ANISHA_VENDOR_JOURNEY_PROMPT_ID,
  promptVersion: 2,
  agentScope: 'VENDOR',
  taskClass: ANISHA_VENDOR_JOURNEY_TASK_CLASS,
  resultMode: 'STRUCTURED',
  systemTemplate: ANISHA_VENDOR_EXPERT_SYSTEM_TEMPLATE_V2_CANDIDATE,
});
