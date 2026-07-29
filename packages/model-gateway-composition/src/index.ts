/**
 * `@qf-jarvis/model-gateway-composition` — the production Model Gateway composition (QFJ-S2-B, ADR-0062).
 *
 * The QFJ-S2-A audit found the gateway complete but UNWIRED: `createModelGateway` was never instantiated
 * outside its own package, and the QFJ-M4 `ModelGatewayInvoker` seam had no live implementation. This
 * package closes exactly that gap and nothing else — it COMPOSES the existing gateway and copies none of
 * its routing, retry, fallback, circuit, budget or validation logic.
 *
 * The root surface is deliberately TWO runtime exports; everything else is type-only, and the count is
 * locked by test. The composition is born OFF and is structurally non-activatable: no `ACTIVE`/`CANARY`
 * configuration is accepted, no rollout controller is constructed or returned, `allowFallback` is false,
 * and a non-zero `retryBudget` is refused.
 *
 * No secret, no environment variable, no filesystem, no network, no database, no provider activation.
 * The production credential-resolver seam is interface-only and is never invoked. QuickFurno Core
 * remains the final authority; a model result is a draft input, never a decision.
 */
export { createProductionModelGateway } from './create-production-model-gateway.js';
export { createLiveModelGatewayInvoker } from './live-model-gateway-invoker.js';

export type {
  ProductionCompositionConfig,
  ProductionCompositionRefusal,
  ProductionCompositionResult,
  ProductionCompositionStatus,
  ProductionModelGatewayComposition,
} from './contracts/production-composition-config.js';
