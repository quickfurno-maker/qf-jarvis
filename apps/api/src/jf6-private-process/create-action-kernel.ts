/**
 * JF-6 Action Kernel composition seam after the Temporal upgrade.
 *
 * Action Kernel is now a workspace package because there are two real consumers: apps/api and the
 * Temporal worker's Activities. The existing signed Core transport remains the only Core network
 * decision boundary. QuickFurno Core Automation executes effects after Core authorization; Jarvis and
 * Temporal never call that automation directly.
 */
import {
  createActionKernel,
  type ActionKernel,
  type ActionKernelObservabilityHook,
} from '@qf-jarvis/action-kernel';
import type {
  CoreAdapterObservabilityHook,
  CoreDecisionStateReader,
} from '@qf-jarvis/core-decision-adapter';
import { createJf6CoreDecisionBoundary } from './create-core-decision-boundary.js';

export interface Jf6ActionKernelConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly timeoutMs?: number;
  readonly stateReader: CoreDecisionStateReader;
  readonly clock: () => string;
  readonly correlationId?: string;
  readonly coreObservability?: CoreAdapterObservabilityHook;
  readonly kernelObservability?: ActionKernelObservabilityHook;
}

export function createJf6ActionKernel(config: Jf6ActionKernelConfig): ActionKernel {
  const coreDecision = createJf6CoreDecisionBoundary({
    baseUrl: config.baseUrl,
    keyId: config.keyId,
    privateKeyPem: config.privateKeyPem,
    stateReader: config.stateReader,
    clock: config.clock,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.correlationId === undefined ? {} : { correlationId: config.correlationId }),
    ...(config.coreObservability === undefined ? {} : { observability: config.coreObservability }),
  });
  return createActionKernel({
    coreDecision,
    ...(config.kernelObservability === undefined
      ? {}
      : { observability: config.kernelObservability }),
  });
}
