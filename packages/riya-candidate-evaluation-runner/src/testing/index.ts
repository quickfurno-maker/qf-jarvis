/**
 * `@qf-jarvis/riya-candidate-evaluation-runner/testing` — deterministic fakes.
 *
 * Separated from the root so a fake candidate can never be mistaken for a real adapter, and so the
 * root API cannot be used to evaluate something invented.
 */
export { FakeSafetyCandidate, FakeQualityCandidate } from './fakes.js';
export type { FakeSafetyBehaviour, FakeQualityBehaviour } from './fakes.js';
