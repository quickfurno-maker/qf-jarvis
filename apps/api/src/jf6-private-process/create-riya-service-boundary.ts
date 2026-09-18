/**
 * JF-6 production Riya service composition.
 *
 * This is the first serving composition that joins the existing durable Riya stores with the
 * signed QuickFurno Core availability read. It creates no pool, reads no environment and starts
 * no listener. The caller owns the database pool, runtime, signing material and HTTP capability.
 */
import type { DatabasePool } from '@qf-jarvis/event-backbone';
import type { RiyaConversationEvolutionJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import { createPostgresRiyaConversationContinuityStore } from '@qf-jarvis/postgres-riya-conversation-continuity-store';
import {
  createPostgresRiyaTurnCoordinator,
  type PostgresRiyaTurnCoordinatorObservabilityHook,
} from '@qf-jarvis/postgres-riya-turn-coordinator';
import {
  createRiyaWebConversationService,
  type RiyaConversationOperationalObservabilityHook,
  type RiyaConversationService,
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
