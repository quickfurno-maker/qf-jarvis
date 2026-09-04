/**
 * `@qf-jarvis/riya-model-benchmark-local-adapter/testing` — deterministic fakes.
 *
 * Separated from the root so a scripted engine cannot be mistaken for a real one, and so the root API
 * cannot be used to benchmark something invented. Every value here is fabricated to exercise a branch.
 */
export {
  SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
  FAKE_STREAM_DONE,
  FakeEngineTransport,
  FakeTokenizer,
  fakeHealthyStream,
  fakeStreamChunk,
} from './fakes.js';
export type { FakeEngineScript, FakeEngineTransportOptions } from './fakes.js';
