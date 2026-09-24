import {
  createCoreDataTools,
  type CoreDataTools,
  type CoreRiyaIntakeReadPort,
} from '@qf-jarvis/core-data-tools';

import {
  createJf6CoreServiceAvailabilityReader,
  type Jf6CoreServiceAvailabilityReaderConfig,
} from './create-core-service-availability-reader.js';

export interface Jf6CoreDataToolsConfig {
  readonly availability: Jf6CoreServiceAvailabilityReaderConfig;
  /**
   * Read-only by type. A mutation-capable CoreRiyaIntakePort is intentionally not accepted here.
   * The QuickFurno integration slice must supply the separately reviewed live read/lookup adapter.
   */
  readonly riyaIntakeReadPort: CoreRiyaIntakeReadPort;
}

/**
 * Compose live Core data tools from the already-reviewed signed JF-6 availability transport plus a
 * separately supplied read-only Riya intake port. This composition creates no write authority.
 */
export function createJf6CoreDataTools(config: Jf6CoreDataToolsConfig): CoreDataTools {
  return createCoreDataTools({
    availabilityReader: createJf6CoreServiceAvailabilityReader(config.availability),
    riyaIntakePort: config.riyaIntakeReadPort,
  });
}
