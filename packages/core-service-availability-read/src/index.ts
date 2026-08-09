/**
 * `@qf-jarvis/core-service-availability-read` — the Core-owned service availability read contract
 * (RWC-P5, ADR-0100).
 *
 * ### The one question this package answers
 *
 * *May this service be discussed for this city?* — and it answers it with QuickFurno Core's words,
 * never its own. There is no city list, no service list, no default and no fallback anywhere in this
 * source: every value comes from a snapshot a reader supplied, and a snapshot that cannot be proved
 * is a refusal rather than a smaller truth.
 *
 * ### Data in, nothing out
 *
 * This package cannot cause an effect. No HTTP, no fetch, no URL, no API key, no environment read, no
 * database, no cache, no clock, no randomness, no n8n, no provider, no model. It also knows nothing
 * about Riya: no phase, no continuity, no conversation, no observation. Those directions are both
 * enforced by its containment spec, and they are what let one contract serve a future WhatsApp Riya,
 * an operator surface, or anything else that needs the same authority.
 *
 * ### The public surface is FOUR runtime values
 *
 * A version, the error vocabulary, the error class, and the one parser. The schemas are not exported:
 * a caller able to compose sub-schemas would build its own half-validated snapshot, and the guarantee
 * that everything in use went through `parseCoreServiceAvailabilitySnapshotV1` would quietly stop
 * being true. The deterministic fake lives under `./testing` so it can never become a production
 * default.
 *
 * Types are exported freely. A type cannot be used to bypass a check.
 */

export { CORE_SERVICE_AVAILABILITY_READ_VERSION } from './contract/snapshot.js';
export { parseCoreServiceAvailabilitySnapshotV1 } from './contract/snapshot.js';
export type {
  CoreAvailabilityCityV1,
  CoreAvailabilityRowV1,
  CoreAvailabilityServiceV1,
  CoreServiceAvailabilitySnapshotV1,
} from './contract/snapshot.js';

export {
  CORE_SERVICE_AVAILABILITY_READ_ERROR_CODES,
  CoreServiceAvailabilityReadError,
} from './errors.js';
export type { CoreServiceAvailabilityReadErrorCode } from './errors.js';

export type {
  CoreServiceAvailabilityReader,
  CoreServiceAvailabilityReadInput,
} from './contract/reader.js';
