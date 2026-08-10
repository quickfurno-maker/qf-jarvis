/**
 * Comparing two benchmark result sets (RMB-A).
 *
 * ### Parity first, and parity is not negotiable
 *
 * Two sets are comparable only when they measured the same thing: same suite, same harness, same
 * cases, same prompt profile, same token settings, same concurrency, same batch, same warmup and
 * measured counts, same streaming mode, same sampling config, same measurement policy.
 *
 * They may differ in exactly the things a benchmark exists to vary — model, release, provider,
 * execution class, environment, runtime engine, quantization.
 *
 * When parity breaks, this returns the named axes rather than a delta. A latency comparison across
 * different concurrencies is not a slightly-less-reliable comparison; it is two unrelated numbers
 * subtracted, and reporting it with a caveat means somebody eventually quotes it without one.
 *
 * ### What this deliberately does not return
 *
 * No winner. No recommendation. No approval. No overall score, weighted or otherwise. Not because a
 * score is hard, but because it would be wrong: latency, memory, reliability and cost have no shared
 * unit, and a weighting that combines them is a business judgement wearing a number's clothes.
 *
 * `RIYA_BENCHMARK_PARETO_RELATIONS` is offered as the one honest summary — A is better on every axis,
 * or B is, or it is a trade-off. **Dominance is not rollout approval.** A dominating configuration can
 * still fail generic safety, fail P10 Riya quality, or be dominated on a cost axis this package does
 * not model.
 */
import type { RiyaBenchmarkEvidenceV1 } from '../contracts/evidence.js';
import type { RiyaBenchmarkResultSetV1 } from './result-set.js';
import type {
  RiyaBenchmarkParetoRelation,
  RiyaBenchmarkParityMismatch,
} from '../contracts/vocabularies.js';

/** One axis, one case, both sides. Deltas are `b - a`, so negative means B is lower. */
export interface RiyaBenchmarkAxisDelta {
  readonly workloadCaseId: string;
  readonly axis: string;
  readonly a: number;
  readonly b: number;
  readonly delta: number;
}

export interface RiyaBenchmarkComparison {
  readonly comparable: boolean;
  /** Named axes on which parity failed. Empty iff `comparable`. */
  readonly parityMismatches: readonly RiyaBenchmarkParityMismatch[];
  readonly deltas: readonly RiyaBenchmarkAxisDelta[];
  /**
   * A Pareto relation over the reported operational axes, or `NOT_COMPARABLE`.
   *
   * NOT a verdict, NOT a recommendation, NOT rollout approval. See the file header.
   */
  readonly paretoRelation: RiyaBenchmarkParetoRelation;
}

/** The axes compared, and the direction that counts as better. All of these are lower-is-better. */
const LOWER_IS_BETTER = [
  'timeToFirstTokenMicrosP50',
  'timeToFirstTokenMicrosP95',
  'endToEndLatencyMicrosP50',
  'endToEndLatencyMicrosP95',
  'decodeMicrosPerOutputTokenP50',
  'decodeMicrosPerOutputTokenP95',
  'peakAcceleratorMemoryBytes',
  'peakHostMemoryBytes',
] as const;

/** Higher-is-better axes, kept separate so the dominance test cannot confuse the directions. */
const HIGHER_IS_BETTER = ['successfulRequests'] as const;

/** Every parity condition, as a predicate over the two workloads that must agree. */
function parityMismatchesOf(
  a: RiyaBenchmarkEvidenceV1,
  b: RiyaBenchmarkEvidenceV1,
): readonly RiyaBenchmarkParityMismatch[] {
  const found: RiyaBenchmarkParityMismatch[] = [];
  const x = a.workload;
  const y = b.workload;
  if (x.benchmarkSuiteId !== y.benchmarkSuiteId) found.push('SUITE_MISMATCH');
  if (x.benchmarkSuiteVersion !== y.benchmarkSuiteVersion) found.push('SUITE_VERSION_MISMATCH');
  if (x.benchmarkImplementationId !== y.benchmarkImplementationId) {
    found.push('IMPLEMENTATION_MISMATCH');
  }
  if (x.benchmarkImplementationVersion !== y.benchmarkImplementationVersion) {
    found.push('IMPLEMENTATION_VERSION_MISMATCH');
  }
  if (x.promptProfileDigest !== y.promptProfileDigest) found.push('PROMPT_PROFILE_MISMATCH');
  if (x.inputTokenCount !== y.inputTokenCount) found.push('INPUT_TOKEN_COUNT_MISMATCH');
  if (x.maximumOutputTokens !== y.maximumOutputTokens) found.push('MAX_OUTPUT_TOKENS_MISMATCH');
  if (x.concurrency !== y.concurrency) found.push('CONCURRENCY_MISMATCH');
  if (x.batchSize !== y.batchSize) found.push('BATCH_SIZE_MISMATCH');
  if (x.warmupRequestCount !== y.warmupRequestCount) found.push('WARMUP_COUNT_MISMATCH');
  if (x.measuredRequestCount !== y.measuredRequestCount) found.push('MEASURED_COUNT_MISMATCH');
  if (x.streaming !== y.streaming) found.push('STREAMING_MISMATCH');
  if (x.samplingConfigDigest !== y.samplingConfigDigest) found.push('SAMPLING_CONFIG_MISMATCH');
  if (x.measurementPolicyRef !== y.measurementPolicyRef) found.push('MEASUREMENT_POLICY_MISMATCH');
  return found;
}

/** Read one numeric axis off an evidence artifact, or `undefined` when it was not reported. */
function axisValue(evidence: RiyaBenchmarkEvidenceV1, axis: string): number | undefined {
  if (axis === 'successfulRequests') {
    return evidence.observation.successfulRequests;
  }
  const observation = evidence.observation as unknown as Record<string, number | undefined>;
  return observation[axis];
}

/**
 * Compare two result sets under strict parity.
 *
 * Throws nothing on a parity failure — it returns `comparable: false` with the named axes, because a
 * mismatch is an answer rather than an error. `COMPARISON_NOT_PARITY` is thrown only when the inputs
 * are structurally unusable, which is a different problem.
 */
export function compareRiyaBenchmarkResultSets(
  a: RiyaBenchmarkResultSetV1,
  b: RiyaBenchmarkResultSetV1,
): RiyaBenchmarkComparison {
  const mismatches = new Set<RiyaBenchmarkParityMismatch>();

  // The case SETS must match before anything is paired. Comparing the overlap of two different suites
  // silently drops the cases one side found hard.
  const aCases = [...a.caseIds].sort().join('|');
  const bCases = [...b.caseIds].sort().join('|');
  if (aCases !== bCases) {
    mismatches.add('WORKLOAD_CASE_SET_MISMATCH');
  }

  const byCaseB = new Map(b.results.map((one) => [one.workload.workloadCaseId, one]));
  const pairs: (readonly [RiyaBenchmarkEvidenceV1, RiyaBenchmarkEvidenceV1])[] = [];
  for (const left of a.results) {
    const right = byCaseB.get(left.workload.workloadCaseId);
    if (right === undefined) {
      mismatches.add('WORKLOAD_CASE_SET_MISMATCH');
      continue;
    }
    for (const mismatch of parityMismatchesOf(left, right)) {
      mismatches.add(mismatch);
    }
    pairs.push([left, right]);
  }

  const parityMismatches = Object.freeze([...mismatches].sort());
  if (parityMismatches.length > 0) {
    return Object.freeze({
      comparable: false,
      parityMismatches,
      deltas: Object.freeze([]),
      paretoRelation: 'NOT_COMPARABLE' as const,
    });
  }

  const deltas: RiyaBenchmarkAxisDelta[] = [];
  let aBetter = false;
  let bBetter = false;

  for (const [left, right] of pairs) {
    for (const axis of [...LOWER_IS_BETTER, ...HIGHER_IS_BETTER]) {
      const x = axisValue(left, axis);
      const y = axisValue(right, axis);
      // An axis only one side reported is not a delta. Treating a missing memory reading as zero
      // would make the side that did not measure look better.
      if (x === undefined || y === undefined) {
        continue;
      }
      deltas.push(
        Object.freeze({
          workloadCaseId: left.workload.workloadCaseId,
          axis,
          a: x,
          b: y,
          delta: y - x,
        }),
      );
      if (x === y) {
        continue;
      }
      const lowerIsBetter = (LOWER_IS_BETTER as readonly string[]).includes(axis);
      const leftWins = lowerIsBetter ? x < y : x > y;
      if (leftWins) {
        aBetter = true;
      } else {
        bBetter = true;
      }
    }
  }

  const paretoRelation: RiyaBenchmarkParetoRelation =
    aBetter && bBetter
      ? 'TRADEOFF'
      : aBetter
        ? 'A_DOMINATES'
        : bBetter
          ? 'B_DOMINATES'
          : 'EQUIVALENT';

  return Object.freeze({
    comparable: true,
    parityMismatches: Object.freeze([]),
    deltas: Object.freeze(deltas),
    paretoRelation,
  });
}
