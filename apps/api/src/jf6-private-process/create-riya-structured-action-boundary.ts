import type { CoreRiyaIntakePort } from '@qf-jarvis/core-riya-intake';
import type { DatabasePool } from '@qf-jarvis/event-backbone';
import { createPostgresRiyaConversationContinuityStore } from '@qf-jarvis/postgres-riya-conversation-continuity-store';
import {
  createRiyaStructuredActionService,
  type RiyaStructuredActionService,
} from '@qf-jarvis/riya-web-conversation-service';

import {
  createJf6CoreServiceAvailabilityReader,
  type Jf6CoreServiceAvailabilityReaderConfig,
} from './create-core-service-availability-reader.js';

export interface Jf6RiyaStructuredActionBoundaryConfig {
  readonly pool: DatabasePool;
  readonly availability: Jf6CoreServiceAvailabilityReaderConfig;
  /**
   * The complete Core-owned intake authority. There is deliberately no default or inferred adapter:
   * QuickFurno must define the customer-reference/contact/consent/submission mapping explicitly.
   */
  readonly coreIntakePort: CoreRiyaIntakePort;
}

/**
 * Compose the production-capable structured Riya path without inventing Core semantics.
 *
 * The durable continuity store and signed availability reader are real application adapters. The
 * intake port stays injected until QuickFurno provides its reviewed source-of-truth mapping. No
 * model, provider, listener, environment read or fallback is introduced here.
 */
export function createJf6RiyaStructuredActionBoundary(
  config: Jf6RiyaStructuredActionBoundaryConfig,
): RiyaStructuredActionService {
  return createRiyaStructuredActionService({
    continuityStore: createPostgresRiyaConversationContinuityStore({ pool: config.pool }),
    availabilityReader: createJf6CoreServiceAvailabilityReader(config.availability),
    coreIntakePort: config.coreIntakePort,
  });
}
