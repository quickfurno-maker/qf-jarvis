/**
 * `@qf-jarvis/core-decision-adapter/testing` — deterministic test support (QFJ-M3, ADR-0056).
 *
 * A SEPARATE subpath so the transport/state fakes and synthetic fixtures can never become production
 * defaults. No real Core, network, key, or token.
 */
export {
  scriptedCoreTransport,
  throwingCoreTransport,
  malformedCoreTransport,
  mismatchedCoreTransport,
  replayingCoreTransport,
  syntheticState,
  scriptedStateReader,
  fixedClock,
  type RecordingStateReader,
  type ReplayingCoreTransport,
} from './deterministic-core-transport.js';
export { coreRequest, syntheticCitation } from './fixtures.js';
