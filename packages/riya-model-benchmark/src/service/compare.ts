/**
 * Comparing two benchmark result sets (RMB-A).
 *
 * ### Both inputs are VERIFIED before anything is read
 *
 * Not integrity-checked — verified: deeply re-proved, homogeneity and manifest re-established, digests
 * recomputed. Only the reconstructions are used afterward.
 *
 * A comparison that reads `a.results` straight off an untrusted object is the most dangerous function
 * in a package like this. Its output looks exactly like a real answer, and it is the thing somebody
 * pastes into a decision. A statement about evidence that was never valid is worse than no statement,
 * so an invalid input produces no comparison object at all — it throws.
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
 * When parity breaks this returns the named axes rather than a delta. A latency comparison across
 * different concurrencies is not a slightly-less-reliable comparison; it is two unrelated numbers
 * subtracted, and reporting it with a caveat means somebody eventually quotes it without one.
 *
 * ### There is no summary, and that is the design
 *
 * No winner, no rank, no recommendation, no approval, no score — and, deliberately, no Pareto relation
 * either. A dominance verdict requires every axis to be present on both sides, and memory is optional;
 * an unmeasured axis silently drops out of the relation, so "equivalent" could mean "equal on the axes
 * we happened to share". That reads as a stronger claim than the data supports.
 *
 * What comes back is per-case, per-axis, side-by-side deltas over the axes BOTH sides measured. An
 * axis absent from the deltas was not compared. Reading the table is the owner's job, and it is a job
 * that should not be automated away.
 */
import type { RiyaBenchmarkEvidenceV1 } from '../contracts/evidence.js';
import { verifyRiyaBenchmarkResultSet } from './result-set.js';
import type { RiyaBenchmarkResultSetV1 } from './result-set.js';
import type { RiyaBenchmarkParityMismatch } from '../contracts/vocabularies.js';

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
  /**
   * Per-case, per-axis side-by-side values over the axes BOTH sides measured.
   *
   * An axis missing from this list was NOT compared — one side did not report it. That is not a tie
   * and not a zero, and there is deliberately no summary field that would smooth it over.
   */
  readonly deltas: readonly RiyaBenchmarkAxisDelta[];
}

/** The axes compared. Every one is read from both sides or from neither. */
const COMPARED_AXES = [
  'successfulRequests',
  'timeToFirstTokenMicrosP50',
  'timeToFirstTokenMicrosP95',
  'endToEndLatencyMicrosP50',
  'endToEndLatencyMicrosP95',
  'decodeMicrosPerOutputTokenP50',
  'decodeMicrosPerOutputTokenP95',
  'peakAcceleratorMemoryBytes',
  'peakHostMemoryBytes',
] as const;

/** Every parity condition, as a comparison of the two workloads that must agree. */
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
 * Compare two result sets under strict parity, after verifying both.
 *
 * Throws `RESULT_SET_INVALID`, `EVIDENCE_TAMPERED`, `DIGEST_INVALID` or another closed code if either
 * input fails verification — no comparison object, no parity result, no deltas.
 *
 * A parity MISMATCH is not an error: it returns `comparable: false` with the named axes, because "these
 * two were not measured the same way" is an answer.
 */
export function compareRiyaBenchmarkResultSets(a: unknown, b: unknown): RiyaBenchmarkComparison {
  // Verified first, and only the reconstructions are used below.
  const left: RiyaBenchmarkResultSetV1 = verifyRiyaBenchmarkResultSet(a);
  const right: RiyaBenchmarkResultSetV1 = verifyRiyaBenchmarkResultSet(b);

  const mismatches = new Set<RiyaBenchmarkParityMismatch>();

  // The case SETS must match before anything is paired. Comparing the overlap of two different suites
  // silently drops the cases one side found hard.
  const leftCases = [...left.caseIds].sort().join('|');
  const rightCases = [...right.caseIds].sort().join('|');
  if (leftCases !== rightCases) {
    mismatches.add('WORKLOAD_CASE_SET_MISMATCH');
  }

  const rightByCase = new Map(right.results.map((one) => [one.workload.workloadCaseId, one]));
  const pairs: (readonly [RiyaBenchmarkEvidenceV1, RiyaBenchmarkEvidenceV1])[] = [];
  for (const evidence of left.results) {
    const counterpart = rightByCase.get(evidence.workload.workloadCaseId);
    if (counterpart === undefined) {
      mismatches.add('WORKLOAD_CASE_SET_MISMATCH');
      continue;
    }
    for (const mismatch of parityMismatchesOf(evidence, counterpart)) {
      mismatches.add(mismatch);
    }
    pairs.push([evidence, counterpart]);
  }

  const parityMismatches = Object.freeze([...mismatches].sort());
  if (parityMismatches.length > 0) {
    return Object.freeze({
      comparable: false,
      parityMismatches,
      deltas: Object.freeze([]),
    });
  }

  const deltas: RiyaBenchmarkAxisDelta[] = [];
  for (const [x, y] of pairs) {
    for (const axis of COMPARED_AXES) {
      const valueA = axisValue(x, axis);
      const valueB = axisValue(y, axis);
      // An axis only one side reported is not a delta. Treating a missing memory reading as zero would
      // make the side that did not measure look better, and there is no summary field here that could
      // absorb the difference honestly.
      if (valueA === undefined || valueB === undefined) {
        continue;
      }
      deltas.push(
        Object.freeze({
          workloadCaseId: x.workload.workloadCaseId,
          axis,
          a: valueA,
          b: valueB,
          delta: valueB - valueA,
        }),
      );
    }
  }

  return Object.freeze({
    comparable: true,
    parityMismatches: Object.freeze([]),
    deltas: Object.freeze(deltas),
  });
}
