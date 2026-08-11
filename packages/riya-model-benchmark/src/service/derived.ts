/**
 * Derived DISPLAY metrics (RMB-A).
 *
 * ### These are not evidence and not scores
 *
 * Every value here is a pure function of an observation that is already evidence. Nothing is measured,
 * nothing is weighted, nothing is combined across axes. A tokens-per-second number is a friendlier
 * rendering of micros-per-token, and that is all it is.
 *
 * The line matters because "derived metric" is how a composite score usually arrives. It starts as a
 * convenience — one number for the dashboard — and ends as the number people quote. So the rule here
 * is mechanical: a derived metric reads exactly one axis of one observation. Anything combining
 * latency with memory, or throughput with cost, is a judgement, and judgements are the owner's.
 *
 * Integer arithmetic, in basis points and whole tokens per second, so two machines agree.
 */
import type { RiyaBenchmarkObservationV1 } from '../contracts/observation.js';

const MICROS_PER_SECOND = 1_000_000;

/** Success as basis points of attempted, rounded down. 10_000 bps is every request. */
export function successRateBasisPoints(observation: RiyaBenchmarkObservationV1): number {
  return Math.floor((observation.successfulRequests * 10_000) / observation.attemptedRequests);
}

/**
 * Approximate steady-state decode speed, whole output tokens per second, from the p50 decode metric.
 *
 * `undefined` when the run produced no output — a run that decoded nothing has no decode speed, and
 * reporting zero would put a real-looking number next to runs that actually ran.
 */
export function approximateDecodeTokensPerSecondP50(
  observation: RiyaBenchmarkObservationV1,
): number | undefined {
  const micros = observation.decodeMicrosPerOutputTokenP50;
  if (micros === undefined || micros === 0) {
    return undefined;
  }
  return Math.floor(MICROS_PER_SECOND / micros);
}

/** The same, from the p95 decode metric — the slow tail, which is what a user actually feels. */
export function approximateDecodeTokensPerSecondP95(
  observation: RiyaBenchmarkObservationV1,
): number | undefined {
  const micros = observation.decodeMicrosPerOutputTokenP95;
  if (micros === undefined || micros === 0) {
    return undefined;
  }
  return Math.floor(MICROS_PER_SECOND / micros);
}

/**
 * Successful replies per second, in MILLI-replies so the integer keeps three decimals.
 *
 * `2_500` means 2.5 replies/sec. Integer arithmetic because a float would make two machines disagree
 * about a digest-adjacent number, and this is the figure the whole workstream is pointed at.
 *
 * `undefined` when the observation predates `measuredWindowMicros`. Deliberately not approximated from
 * `concurrency / p50` — that estimate is wrong the moment a target batches, queues or has a tail, and
 * it would be indistinguishable from a real measurement in a report.
 */
export function successfulRequestsPerSecondMilli(
  observation: RiyaBenchmarkObservationV1,
): number | undefined {
  const window = observation.measuredWindowMicros;
  if (window === undefined) {
    return undefined;
  }
  // Safe at the bounds: 1e6 requests x 1e6 x 1e3 = 1e15, under Number.MAX_SAFE_INTEGER (~9.0e15).
  return Math.floor((observation.successfulRequests * MICROS_PER_SECOND * 1_000) / window);
}

/**
 * Aggregate output tokens per second across the measured window.
 *
 * `undefined` when the window is absent or nothing was produced — a run that decoded nothing has no
 * throughput, and reporting zero would sit in a table beside runs that actually ran.
 */
export function aggregateOutputTokensPerSecond(
  observation: RiyaBenchmarkObservationV1,
): number | undefined {
  const window = observation.measuredWindowMicros;
  if (window === undefined || observation.outputTokensTotal === 0) {
    return undefined;
  }
  // Safe at the bounds: 1e9 tokens x 1e6 = 1e15, under Number.MAX_SAFE_INTEGER.
  return Math.floor((observation.outputTokensTotal * MICROS_PER_SECOND) / window);
}

/** Mean output tokens per successful request, rounded down. `undefined` when nothing succeeded. */
export function meanOutputTokensPerSuccess(
  observation: RiyaBenchmarkObservationV1,
): number | undefined {
  if (observation.successfulRequests === 0) {
    return undefined;
  }
  return Math.floor(observation.outputTokensTotal / observation.successfulRequests);
}
