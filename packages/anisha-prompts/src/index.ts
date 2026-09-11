/**
 * `@qf-jarvis/anisha-prompts` — versioned Anisha prompt definitions, and nothing else.
 *
 * The content boundary `@qf-jarvis/prompt-registry` deliberately does not have. The registry binds an
 * identity to exact bytes; this holds the bytes. Keeping them apart is what lets the registry stay a
 * mechanism with no QuickFurno content in it, and lets one prompt be imported by both an evaluation
 * operator and a production composition without either duplicating a string or importing an application.
 *
 * One VENDOR identity at one task class, because Anisha's serving path resolves one.
 *
 * It defines a prompt. It does not select a model, reach a provider, activate a rollout, decide
 * anything, or hold business data — there is no price, package, credit, city, service, lead or
 * promotion in it, because those are Core's live truth and the governed turn context is where they
 * belong.
 */
export {
  ANISHA_PRODUCTION_PROMPTS,
  ANISHA_VENDOR_JOURNEY_PROMPT_ID,
  ANISHA_VENDOR_JOURNEY_PROMPT_V1,
  ANISHA_VENDOR_JOURNEY_PROMPT_VERSION,
  ANISHA_VENDOR_JOURNEY_TASK_CLASS,
  createAnishaPromptRegistryV1,
} from './vendor-journey/definition.js';
export { ANISHA_VENDOR_JOURNEY_SYSTEM_TEMPLATE_V1 } from './vendor-journey/system-template.js';
