/**
 * `@qf-jarvis/riya-model-benchmark-harness/testing` — deterministic fakes.
 *
 * Separated from the root so no fake target can be mistaken for a real adapter, and so the root API
 * cannot be used to run a benchmark against something invented. Every value here is fabricated to
 * exercise a branch.
 */
export {
  SYNTHETIC_HARNESS_INSTANT,
  ManualClock,
  FakeTarget,
  FakeMemoryProbe,
  fakeHostedTarget,
} from './fakes.js';
export type { FakeRequestScript, FakeTargetOptions } from './fakes.js';
