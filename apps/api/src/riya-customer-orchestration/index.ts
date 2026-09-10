/**
 * The Riya customer orchestration boundary (JF-4, ADR-0149).
 *
 * An INTERNAL application module. `@qf-jarvis/api` exports nothing from its package root, so this is a
 * composition surface for this application only — not a package API.
 */
export { createRiyaCustomerRuntimeComposition } from './create-riya-customer-runtime.js';
export { RiyaCustomerRuntimeCompositionError } from './create-riya-customer-runtime.js';
export type {
  RiyaCustomerRuntimeComposition,
  RiyaCustomerRuntimeConfig,
  RiyaCustomerTurnRunner,
} from './create-riya-customer-runtime.js';

export { RiyaCustomerOrchestrationError } from './mastra-customer-turn-runner.js';

export { RIYA_CUSTOMER_ORCHESTRATION_REFUSALS } from './contracts.js';
export type {
  RiyaCustomerOrchestrationEvent,
  RiyaCustomerOrchestrationObservability,
  RiyaCustomerOrchestrationRefusal,
} from './contracts.js';

export { createGovernedRagRetrievalPort } from './governed-rag-knowledge-port.js';
