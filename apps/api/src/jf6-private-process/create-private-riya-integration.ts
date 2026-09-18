/**
 * JF-6 private Riya integration composition.
 *
 * One explicit serving seam: durable Riya service -> Mastra customer runner -> authenticated
 * private ingress -> loopback/private process. Construction starts nothing. The returned process
 * must still be explicitly started by deployment code.
 */
import {
  createRiyaCustomerRuntimeComposition,
  type RiyaCustomerTurnRunner,
} from '../riya-customer-orchestration/create-riya-customer-runtime.js';
import {
  createPrivateRiyaWebIngressHandler,
  type PrivateRiyaWebIngressConfig,
} from '../private-riya-web-ingress/create-handler.js';
import {
  createJf6PrivateProcess,
  type Jf6PrivateProcess,
  type Jf6PrivateProcessConfig,
} from './create-private-process.js';
import {
  createJf6RiyaServiceBoundary,
  type Jf6RiyaServiceBoundaryConfig,
} from './create-riya-service-boundary.js';
export interface Jf6PrivateRiyaIntegrationConfig {
  readonly service: Jf6RiyaServiceBoundaryConfig;
  readonly ingress: Omit<PrivateRiyaWebIngressConfig, 'service'>;
  readonly process: Omit<Jf6PrivateProcessConfig, 'ingress'>;
}

export interface Jf6PrivateRiyaIntegration {
  readonly customerTurnRunner: RiyaCustomerTurnRunner;
  readonly process: Jf6PrivateProcess;
}

/**
 * Compose the private serving boundary without activating it.
 *
 * Every WEB turn that reaches the ingress goes through the same Mastra customer workflow. The
 * private process only binds the already-composed ingress; it does not acquire credentials,
 * database configuration, provider configuration or business authority.
 */
export function createJf6PrivateRiyaIntegration(
  config: Jf6PrivateRiyaIntegrationConfig,
): Jf6PrivateRiyaIntegration {
  const conversationService = createJf6RiyaServiceBoundary(config.service);
  const customerRuntime = createRiyaCustomerRuntimeComposition({
    conversationService,
  });
  const ingress = createPrivateRiyaWebIngressHandler({
    ...config.ingress,
    service: customerRuntime.ingressService,
  });
  const process = createJf6PrivateProcess({
    ...config.process,
    ingress,
  });

  return Object.freeze({
    customerTurnRunner: customerRuntime.customerTurnRunner,
    process,
  });
}
