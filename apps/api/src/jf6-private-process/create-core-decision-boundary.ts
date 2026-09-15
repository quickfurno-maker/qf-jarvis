/**
 * JF-6 QuickFurno Core composition seam.
 *
 * The HTTP transport is concrete; authority is not. This factory only joins the reviewed signed
 * transport to the existing Core decision adapter. It reads no environment and invents no state,
 * retry, fallback, provider, or business rule.
 */
import {
  createCoreDecisionAdapter,
  type CoreAdapterObservabilityHook,
  type CoreDecisionAdapter,
  type CoreDecisionStateReader,
} from '@qf-jarvis/core-decision-adapter';
import { createQuickFurnoCoreTransport } from '@qf-jarvis/core-decision-http-transport';

export interface Jf6CoreDecisionBoundaryConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly timeoutMs?: number;
  readonly stateReader: CoreDecisionStateReader;
  readonly clock: () => string;
  readonly correlationId?: string;
  readonly observability?: CoreAdapterObservabilityHook;
}

export function createJf6CoreDecisionBoundary(
  config: Jf6CoreDecisionBoundaryConfig,
): CoreDecisionAdapter {
  const transport = createQuickFurnoCoreTransport({
    baseUrl: config.baseUrl,
    keyId: config.keyId,
    privateKeyPem: config.privateKeyPem,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  });
  return createCoreDecisionAdapter({
    stateReader: config.stateReader,
    clock: config.clock,
    transport,
    ...(config.correlationId === undefined ? {} : { correlationId: config.correlationId }),
    ...(config.observability === undefined ? {} : { observability: config.observability }),
  });
}
