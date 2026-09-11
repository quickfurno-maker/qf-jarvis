/**
 * `@qf-jarvis/aarohi-prompts` — versioned Aarohi prompt definitions, and nothing else.
 *
 * The content boundary `@qf-jarvis/prompt-registry` deliberately does not have. The registry binds an
 * identity to exact bytes; this holds the bytes. Keeping them apart is what lets the registry stay a
 * mechanism with no QuickFurno content in it.
 *
 * One PROSPECT identity at one task class, because Aarohi's serving path resolves one — and because only
 * two of AVG-7's six strategies reach a model at all.
 *
 * It defines a prompt. It does not select a model, reach a provider, activate a rollout, decide
 * anything, make any strategy model-eligible, or hold business data — there is no price, package,
 * discount, city, service or promotion in it, because Aarohi may not originate any of those and the
 * governed turn context is where approved reference facts belong.
 */
export {
  AAROHI_ACQUISITION_PROMPT_ID,
  AAROHI_ACQUISITION_PROMPT_V1,
  AAROHI_ACQUISITION_PROMPT_VERSION,
  AAROHI_ACQUISITION_TASK_CLASS,
  AAROHI_PRODUCTION_PROMPTS,
  createAarohiPromptRegistryV1,
} from './acquisition/definition.js';
export { AAROHI_ACQUISITION_SYSTEM_TEMPLATE_V1 } from './acquisition/system-template.js';
