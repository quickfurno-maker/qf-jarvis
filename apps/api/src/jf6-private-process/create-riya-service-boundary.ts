/**
 * JF-6 production Riya service composition.
 *
 * This is the first serving composition that joins the existing durable Riya stores with the
 * signed QuickFurno Core availability read. It creates no pool, reads no environment and starts
 * no listener. The caller owns the database pool, runtime, signing material and HTTP capability.
 */
import type { CoreRiyaIntakePort } from '@qf-jarvis/core-riya-intake';
import type { DatabasePool } from '@qf-jarvis/event-backbone';
import type { RiyaConversationEvolutionJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import { createPostgresRiyaConversationContinuityStore } from '@qf-jarvis/postgres-riya-conversation-continuity-store';
import {
  createPostgresRiyaTurnCoordinator,
  type PostgresRiyaTurnCoordinatorObservabilityHook,
} from '@qf-jarvis/postgres-riya-turn-coordinator';
import {
  createRiyaStructuredActionService,
  createRiyaWebConversationService,
  type RiyaConversationOperationalObservabilityHook,
  type RiyaConversationService,
  type RiyaStructuredActionService,
} from '@qf-jarvis/riya-web-conversation-service';

import {
  createJf6CoreServiceAvailabilityReader,
  type Jf6CoreServiceAvailabilityReaderConfig,
} from './create-core-service-availability-reader.js';
export interface Jf6RiyaServiceBoundaryConfig {
  readonly pool: DatabasePool;
  readonly runtime: RiyaConversationEvolutionJarvisRuntime;
  readonly runtimeId: string;
  readonly maxConcurrentTextTurns: number;
  readonly availability: Jf6CoreServiceAvailabilityReaderConfig;
  readonly observability?: RiyaConversationOperationalObservabilityHook;
  readonly turnCoordinatorObservability?: PostgresRiyaTurnCoordinatorObservabilityHook;
}

/**
 * Compose the real Riya conversation service over durable state and Core-owned availability.
 *
 * The continuity store and turn coordinator receive the same caller-owned pool. The availability
 * reader is the only QuickFurno network seam and remains signed, bounded and fail-closed.
 */
export function createJf6RiyaServiceBoundary(
  config: Jf6RiyaServiceBoundaryConfig,
): RiyaConversationService {
  const continuityStore = createPostgresRiyaConversationContinuityStore({
    pool: config.pool,
  });
  const turnCoordinator = createPostgresRiyaTurnCoordinator({
    pool: config.pool,
    ...(config.turnCoordinatorObservability === undefined
      ? {}
      : { observability: config.turnCoordinatorObservability }),
  });
  const availabilityReader = createJf6CoreServiceAvailabilityReader(config.availability);

  return createRiyaWebConversationService({
    runtime: config.runtime,
    continuityStore,
    availabilityReader,
    runtimeId: config.runtimeId,
    turnCoordinator,
    maxConcurrentTextTurns: config.maxConcurrentTextTurns,
    ...(config.observability === undefined ? {} : { observability: config.observability }),
  });
}

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
 * This shares the same reviewed JF-6 persistence composition surface as conversational Riya. The
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
