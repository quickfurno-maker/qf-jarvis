/**
 * Neutral Jarvis v1 production serving profile.
 *
 * This package contains immutable facts shared by offline certification/sealing and production
 * serving. It performs no certification, evidence minting, network access, credential access,
 * rollout decision or business authorization.
 */
import { AAROHI_ACQUISITION_PROMPT_V1 } from '@qf-jarvis/aarohi-prompts';
import { ANISHA_VENDOR_JOURNEY_PROMPT_V1 } from '@qf-jarvis/anisha-prompts';
import { RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1 } from '@qf-jarvis/riya-prompts';
import type { PromptDefinition } from '@qf-jarvis/prompt-registry';

export const JARVIS_V1_PRODUCTION_PROVIDER_MODE = 'GROQ_ONLY' as const;
export const JARVIS_V1_GROQ_DATA_CONTROLS_REF =
  'datacontrols.groq.observed.2026-09-11.staging-synthetic' as const;
export const JARVIS_V1_PRODUCTION_CAPABILITY_PROFILE_REF = 'cap.jf5b.structured.v1' as const;
export const JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS = 16_384 as const;
export const JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS = 4_096 as const;

export const JARVIS_V1_PRODUCTION_AGENTS = ['RIYA', 'ANISHA', 'AAROHI'] as const;
export type JarvisV1ProductionAgent = (typeof JARVIS_V1_PRODUCTION_AGENTS)[number];

export const JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT: Readonly<
  Record<JarvisV1ProductionAgent, PromptDefinition>
> = Object.freeze({
  RIYA: RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1,
  ANISHA: ANISHA_VENDOR_JOURNEY_PROMPT_V1,
  AAROHI: AAROHI_ACQUISITION_PROMPT_V1,
});
