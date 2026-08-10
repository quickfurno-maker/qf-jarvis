/**
 * The normalized OBSERVATION: pre-supplied measurements, checked for internal honesty (RMB-A).
 *
 * ### This package measures nothing
 *
 * Every number here arrives from a harness that ran somewhere else. That is the containment boundary:
 * a package that took its own measurements would need a model, a network and a clock, and would stop
 * being evidence tooling.
 *
 * What it can do is refuse a measurement that contradicts itself. The checks below are the ones that
 * catch a broken harness rather than a slow model:
 *
 * - **Requests must balance.** `successful + failed === attempted`. A harness that drops requests on
 *   the floor reports a latency computed over a population nobody can name.
 * - **Percentiles must be ordered.** A p95 below its p50 is not a fast tail, it is swapped fields.
 * - **A run with zero successes cannot claim latency.** This is the one that matters. A benchmark
 *   where everything failed produces beautiful numbers — instant time-to-first-token, because there
 *   were no tokens — and read six months later, out of context, it looks like the fastest
 *   configuration anyone tried.
 * - **Tokens and decode speed must agree about whether output happened.** Output tokens with no
 *   decode metric, or a decode metric with no output tokens, is a harness reporting on two different
 *   runs.
 *
 * Integers only, in micros and bytes. Floating point makes two identical runs produce two different
 * digests on two machines, and evidence that cannot be re-derived is not evidence.
 */
import { z } from 'zod';

import { RiyaBenchmarkError } from './errors.js';
import {
  RIYA_BENCHMARK_MAX_BYTES,
  RIYA_BENCHMARK_MAX_MICROS,
  RIYA_BENCHMARK_MAX_REQUESTS,
  RIYA_BENCHMARK_MAX_TOKENS,
} from './vocabularies.js';

export interface RiyaBenchmarkObservationV1 {
  readonly version: 1;
  readonly attemptedRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly inputTokensTotal: number;
  readonly outputTokensTotal: number;
  /** Absent when nothing succeeded. Present and ordered when something did. */
  readonly timeToFirstTokenMicrosP50?: number;
  readonly timeToFirstTokenMicrosP95?: number;
  readonly endToEndLatencyMicrosP50?: number;
  readonly endToEndLatencyMicrosP95?: number;
  readonly decodeMicrosPerOutputTokenP50?: number;
  readonly decodeMicrosPerOutputTokenP95?: number;
  readonly peakAcceleratorMemoryBytes?: number;
  readonly peakHostMemoryBytes?: number;
}

export type RiyaBenchmarkObservationInput = RiyaBenchmarkObservationV1;

const COUNT = z.int().min(0).max(RIYA_BENCHMARK_MAX_REQUESTS);
const TOKENS = z.int().min(0).max(RIYA_BENCHMARK_MAX_TOKENS);
const MICROS = z.int().min(0).max(RIYA_BENCHMARK_MAX_MICROS);
const BYTES = z.int().min(1).max(RIYA_BENCHMARK_MAX_BYTES);

const observationSchema = z
  .object({
    version: z.literal(1),
    attemptedRequests: COUNT.min(1),
    successfulRequests: COUNT,
    failedRequests: COUNT,
    inputTokensTotal: TOKENS,
    outputTokensTotal: TOKENS,
    timeToFirstTokenMicrosP50: MICROS.optional(),
    timeToFirstTokenMicrosP95: MICROS.optional(),
    endToEndLatencyMicrosP50: MICROS.optional(),
    endToEndLatencyMicrosP95: MICROS.optional(),
    decodeMicrosPerOutputTokenP50: MICROS.optional(),
    decodeMicrosPerOutputTokenP95: MICROS.optional(),
    peakAcceleratorMemoryBytes: BYTES.optional(),
    peakHostMemoryBytes: BYTES.optional(),
  })
  .strict();

/** The percentile pairs, so ordering and presence are checked the same way for each. */
const PERCENTILE_PAIRS = [
  ['timeToFirstTokenMicrosP50', 'timeToFirstTokenMicrosP95'],
  ['endToEndLatencyMicrosP50', 'endToEndLatencyMicrosP95'],
  ['decodeMicrosPerOutputTokenP50', 'decodeMicrosPerOutputTokenP95'],
] as const;

/** Validate and freeze a normalized observation. Throws a specific closed code per failure. */
export function createRiyaBenchmarkObservation(
  input: RiyaBenchmarkObservationInput,
): RiyaBenchmarkObservationV1 {
  const parsed = observationSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('OBSERVATION_INVALID');
  }
  const o = parsed.data;

  if (o.successfulRequests + o.failedRequests !== o.attemptedRequests) {
    throw new RiyaBenchmarkError('REQUEST_COUNT_MISMATCH');
  }

  for (const [p50Key, p95Key] of PERCENTILE_PAIRS) {
    const p50 = o[p50Key];
    const p95 = o[p95Key];
    // Both or neither. A pair with one half is a partial measurement pretending to be a whole one.
    if ((p50 === undefined) !== (p95 === undefined)) {
      throw new RiyaBenchmarkError('PERCENTILE_ORDER_INVALID');
    }
    if (p50 !== undefined && p95 !== undefined && p50 > p95) {
      throw new RiyaBenchmarkError('PERCENTILE_ORDER_INVALID');
    }
  }

  const succeeded = o.successfulRequests > 0;
  const claimsLatency =
    o.timeToFirstTokenMicrosP50 !== undefined ||
    o.endToEndLatencyMicrosP50 !== undefined ||
    o.decodeMicrosPerOutputTokenP50 !== undefined;

  // A run where nothing succeeded has no latency distribution to report, and the numbers it would
  // report are flattering.
  if (!succeeded && claimsLatency) {
    throw new RiyaBenchmarkError('PERCENTILE_ORDER_INVALID');
  }
  if (!succeeded && o.outputTokensTotal > 0) {
    throw new RiyaBenchmarkError('TOKEN_MEASUREMENT_INVALID');
  }

  // Output and decode speed have to tell the same story.
  const hasDecode = o.decodeMicrosPerOutputTokenP50 !== undefined;
  if (hasDecode !== o.outputTokensTotal > 0) {
    throw new RiyaBenchmarkError('TOKEN_MEASUREMENT_INVALID');
  }
  // Successful requests that consumed no input never happened.
  if (succeeded && o.inputTokensTotal === 0) {
    throw new RiyaBenchmarkError('TOKEN_MEASUREMENT_INVALID');
  }

  // Built key by key rather than spread: under `exactOptionalPropertyTypes` an explicitly-undefined
  // optional is a different type from an absent one, and the digest treats them as the same artifact.
  // Dropping them here is what makes those two facts agree.
  return Object.freeze({
    version: 1 as const,
    attemptedRequests: o.attemptedRequests,
    successfulRequests: o.successfulRequests,
    failedRequests: o.failedRequests,
    inputTokensTotal: o.inputTokensTotal,
    outputTokensTotal: o.outputTokensTotal,
    ...(o.timeToFirstTokenMicrosP50 === undefined
      ? {}
      : { timeToFirstTokenMicrosP50: o.timeToFirstTokenMicrosP50 }),
    ...(o.timeToFirstTokenMicrosP95 === undefined
      ? {}
      : { timeToFirstTokenMicrosP95: o.timeToFirstTokenMicrosP95 }),
    ...(o.endToEndLatencyMicrosP50 === undefined
      ? {}
      : { endToEndLatencyMicrosP50: o.endToEndLatencyMicrosP50 }),
    ...(o.endToEndLatencyMicrosP95 === undefined
      ? {}
      : { endToEndLatencyMicrosP95: o.endToEndLatencyMicrosP95 }),
    ...(o.decodeMicrosPerOutputTokenP50 === undefined
      ? {}
      : { decodeMicrosPerOutputTokenP50: o.decodeMicrosPerOutputTokenP50 }),
    ...(o.decodeMicrosPerOutputTokenP95 === undefined
      ? {}
      : { decodeMicrosPerOutputTokenP95: o.decodeMicrosPerOutputTokenP95 }),
    ...(o.peakAcceleratorMemoryBytes === undefined
      ? {}
      : { peakAcceleratorMemoryBytes: o.peakAcceleratorMemoryBytes }),
    ...(o.peakHostMemoryBytes === undefined ? {} : { peakHostMemoryBytes: o.peakHostMemoryBytes }),
  });
}
