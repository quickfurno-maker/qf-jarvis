/**
 * `@qf-jarvis/riya-prompts` — versioned Riya prompt definitions, and nothing else.
 *
 * The content boundary `@qf-jarvis/prompt-registry` deliberately does not have. The registry binds an
 * identity to exact bytes; this holds the bytes. Keeping them apart is what lets the registry stay a
 * mechanism with no QuickFurno content in it, and lets one prompt be imported by both the candidate
 * evidence operator and a production composition without either duplicating a string or importing an
 * application.
 *
 * Three CLIENT task-class variants share ONE reviewed body, so the single `promptDigest` a generic
 * evaluation binding carries stays truthful across a suite that exercises all three paths.
 *
 * It defines prompts. It does not select a model, reach a provider, activate a rollout, decide
 * anything, or hold business data — there is no price, package, city, service, vendor or promotion in
 * it, because those change and the governed turn context is where they belong.
 */
export {
  RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1,
  RIYA_CLIENT_SALES_GROUNDED_EVOLUTION_PROMPT_V1,
  RIYA_CLIENT_SALES_GROUNDED_REPLY_PROMPT_V1,
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
  RIYA_PRODUCTION_PROMPTS,
  createRiyaPromptRegistryV1,
} from './client-sales/definition.js';
export { RIYA_CLIENT_SALES_SYSTEM_TEMPLATE_V1 } from './client-sales/system-template.js';
