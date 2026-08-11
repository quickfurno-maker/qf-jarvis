/**
 * RMB-A — evidence, result sets, derived metrics and comparison.
 *
 * The comparison specs carry the weight. A benchmark package earns its keep by refusing comparisons
 * that look fine, and the two failures worth building around are a parity mismatch reported as a
 * delta, and a composite score that lets speed outrank correctness.
 */
import { describe, expect, it } from 'vitest';

import { RiyaBenchmarkError } from '../contracts/errors.js';
import { createRiyaBenchmarkObservation } from '../contracts/observation.js';
import { createRiyaBenchmarkWorkload, workloadParityKey } from '../contracts/workload.js';
import type { RiyaBenchmarkObservationV1 } from '../contracts/observation.js';
import {
  createRiyaBenchmarkEvidence,
  isCanonicalBenchmarkInstant,
  riyaBenchmarkEvidenceIntegrityHolds,
  verifyRiyaBenchmarkEvidence,
} from '../contracts/evidence.js';
import { canonicalJson, sha256OfCanonical } from '../internal/digest.js';
import {
  aggregateOutputTokensPerSecond,
  successfulRequestsPerSecondMilli,
  approximateDecodeTokensPerSecondP50,
  approximateDecodeTokensPerSecondP95,
  meanOutputTokensPerSuccess,
  successRateBasisPoints,
} from '../service/derived.js';
import { compareRiyaBenchmarkResultSets } from '../service/compare.js';
import {
  createRiyaBenchmarkResultSet,
  riyaBenchmarkResultSetIntegrityHolds,
  verifyRiyaBenchmarkResultSet,
} from '../service/result-set.js';
import {
  SYNTHETIC_BENCHMARK_INSTANT,
  syntheticDigest,
  syntheticEvidence,
  syntheticHostedEnvironment,
  syntheticObservation,
  syntheticSubject,
  syntheticWorkload,
} from '../testing/fixtures.js';

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaBenchmarkError ? error.code : 'not-a-benchmark-error';
  }
  return 'no-error';
};

/**
 * Build a result set an ATTACKER would build: swap one member, then recompute every digest so the
 * artifact is perfectly self-consistent.
 *
 * This is the adversary that a hash-only check cannot see. `sha256OfCanonical` is unkeyed, so anyone
 * who can edit a body can re-stamp it — which is exactly why verification reconstructs rather than
 * compares.
 */
function forgeResultSet(
  set: ReturnType<typeof createRiyaBenchmarkResultSet>,
  replacement: Record<string, unknown>,
): Record<string, unknown> {
  const results = [replacement, ...set.results.slice(1)];
  const evidenceDigests = results.map((one) => {
    const { evidenceDigest: _old, ...body } = one as Record<string, unknown>;
    return sha256OfCanonical(body);
  });
  const stamped = results.map((one, index) => ({ ...one, evidenceDigest: evidenceDigests[index] }));
  const manifestDigest = sha256OfCanonical({ version: 1, caseIds: set.caseIds });
  return {
    version: 1,
    results: stamped,
    caseIds: set.caseIds,
    manifestDigest,
    resultSetDigest: sha256OfCanonical({ version: 1, manifestDigest, evidenceDigests }),
  };
}

// ---------------------------------------------------------------------------
// 23–32. Evidence.
// ---------------------------------------------------------------------------

describe('evidence binds the whole artifact and authorizes nothing', () => {
  it('stamps a SHA-256 digest and freezes', () => {
    const evidence = syntheticEvidence();
    expect(evidence.evidenceDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(riyaBenchmarkEvidenceIntegrityHolds(evidence)).toBe(true);
  });

  it('is syntheticWorkload and NOT production-approved, as literals', () => {
    const evidence = syntheticEvidence();
    expect(evidence.syntheticWorkload).toBe(true);
    expect(evidence.productionApproval).toBe(false);
    // There is no way to construct one that says otherwise.
    expect(
      codeOf(() =>
        createRiyaBenchmarkEvidence({
          version: 1,
          subject: syntheticSubject(),
          environment: syntheticHostedEnvironment(),
          workload: syntheticWorkload(),
          observation: syntheticObservation(),
          createdAt: SYNTHETIC_BENCHMARK_INSTANT,
          productionApproval: true,
        } as never),
      ),
    ).toBe('OBSERVATION_INVALID');
    expect(
      codeOf(() =>
        createRiyaBenchmarkEvidence({
          ...syntheticEvidence(),
          syntheticWorkload: false,
        } as never),
      ),
    ).toBe('OBSERVATION_INVALID');
  });

  it('the digest covers EVERY part — not a summary of them', () => {
    const base = syntheticEvidence();
    const variants = [
      { subject: syntheticSubject({ modelId: 'model.beta' }) },
      { environment: syntheticHostedEnvironment() },
      { workload: syntheticWorkload({ concurrency: 8 }) },
      { observation: syntheticObservation({ endToEndLatencyMicrosP50: 800_000 }) },
      { createdAt: '2026-02-02T00:00:00Z' },
    ];
    const digests = new Set([base.evidenceDigest]);
    for (const variant of variants) {
      const evidence = createRiyaBenchmarkEvidence({
        version: 1,
        subject: base.subject,
        environment: base.environment,
        workload: base.workload,
        observation: base.observation,
        createdAt: base.createdAt,
        ...variant,
      });
      digests.add(evidence.evidenceDigest);
    }
    // Six distinct artifacts, six distinct digests.
    expect(digests.size).toBe(6);
  });

  const BROKEN_PARTS: readonly (readonly [string, Record<string, unknown>])[] = [
    ['subject', { subject: { ...syntheticSubject(), promptVersion: 0 } }],
    ['environment', { environment: { ...syntheticHostedEnvironment(), acceleratorCount: 2 } }],
    ['workload', { workload: { ...syntheticWorkload(), concurrency: 0 } }],
    ['observation', { observation: { ...syntheticObservation(), failedRequests: 5 } }],
  ];

  it.each(BROKEN_PARTS)('deep re-proof catches a broken nested %s', (_part, override) => {
    const base = syntheticEvidence();
    expect(
      codeOf(() =>
        createRiyaBenchmarkEvidence({
          version: 1,
          subject: base.subject,
          environment: base.environment,
          workload: base.workload,
          observation: base.observation,
          createdAt: base.createdAt,
          ...override,
        }),
      ),
    ).not.toBe('no-error');
  });

  it('the nested failure names the part, not the wrapper', () => {
    const base = syntheticEvidence();
    expect(
      codeOf(() =>
        createRiyaBenchmarkEvidence({
          version: 1,
          subject: { ...base.subject, promptDigest: 'short' },
          environment: base.environment,
          workload: base.workload,
          observation: base.observation,
          createdAt: base.createdAt,
        }),
      ),
    ).toBe('SUBJECT_INVALID');
    expect(
      codeOf(() =>
        createRiyaBenchmarkEvidence({
          version: 1,
          subject: base.subject,
          environment: { ...base.environment, kind: 'HOSTED_OPAQUE' as const },
          workload: base.workload,
          observation: base.observation,
          createdAt: base.createdAt,
        }),
      ),
    ).toBe('ENVIRONMENT_INVALID');
  });

  it('a tampered artifact is refused on re-proof and fails the integrity check', () => {
    const evidence = syntheticEvidence();
    const faster = {
      ...evidence,
      observation: syntheticObservation({ endToEndLatencyMicrosP50: 1 }),
    };
    expect(riyaBenchmarkEvidenceIntegrityHolds(faster)).toBe(false);
    expect(codeOf(() => createRiyaBenchmarkEvidence(faster))).toBe('EVIDENCE_TAMPERED');
    // Editing the digest to match the edit does not help — it is recomputed from the body.
    expect(
      codeOf(() =>
        createRiyaBenchmarkEvidence({ ...faster, evidenceDigest: syntheticDigest('beef') }),
      ),
    ).toBe('EVIDENCE_TAMPERED');
  });

  it('the workload and the observation must agree on how many requests ran', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkEvidence({
          version: 1,
          subject: syntheticSubject(),
          environment: syntheticHostedEnvironment(),
          workload: syntheticWorkload({ measuredRequestCount: 40 }),
          observation: syntheticObservation(),
          createdAt: SYNTHETIC_BENCHMARK_INSTANT,
        }),
      ),
    ).toBe('REQUEST_COUNT_MISMATCH');
  });

  it('createdAt is a canonical UTC instant, and is injected rather than read', () => {
    expect(isCanonicalBenchmarkInstant('2026-01-01T00:00:00Z')).toBe(true);
    expect(isCanonicalBenchmarkInstant('2026-01-01T00:00:00.500Z')).toBe(true);
    for (const bad of [
      '2026-01-01',
      '2026-01-01T00:00:00+05:30',
      'not-a-time',
      '2026-13-01T00:00:00Z',
      // The ones a shape check plus Date.parse would WRONGLY accept: JavaScript normalizes these to
      // the following month and reports a finite number, so the artifact would carry a createdAt
      // nobody wrote, silently shifted.
      '2026-02-30T00:00:00Z',
      '2026-04-31T00:00:00Z',
      '2026-02-29T00:00:00Z',
      '2026-00-10T00:00:00Z',
      '2026-01-00T00:00:00Z',
      '2026-01-32T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:60Z',
    ]) {
      expect(isCanonicalBenchmarkInstant(bad), bad).toBe(false);
    }
    // A real leap day is accepted; 2024 and 2000 are leap years, 1900 and 2026 are not.
    expect(isCanonicalBenchmarkInstant('2024-02-29T12:00:00Z')).toBe(true);
    expect(isCanonicalBenchmarkInstant('2000-02-29T00:00:00.000Z')).toBe(true);
    expect(isCanonicalBenchmarkInstant('1900-02-29T00:00:00Z')).toBe(false);
    // Same inputs, same digest — twice, with no clock involved.
    expect(syntheticEvidence().evidenceDigest).toBe(syntheticEvidence().evidenceDigest);
  });

  it('re-proving a canonical artifact is idempotent', () => {
    const once = syntheticEvidence();
    expect(createRiyaBenchmarkEvidence(once)).toStrictEqual(once);
  });

  it('key order and an explicit undefined do not change identity', () => {
    // Two spellings of the same artifact are the same artifact.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(sha256OfCanonical({ a: 1 })).toBe(sha256OfCanonical({ a: 1, b: undefined }));
  });
});

// ---------------------------------------------------------------------------
// 33–38. Result set and manifest.
// ---------------------------------------------------------------------------

describe('a result set is the whole suite, or it is refused', () => {
  const caseIds = ['case.alpha', 'case.beta', 'case.gamma'];
  const evidenceFor = (workloadCaseId: string) =>
    syntheticEvidence({ workload: syntheticWorkload({ workloadCaseId }) });
  const fullSet = () =>
    createRiyaBenchmarkResultSet({
      version: 1,
      results: [evidenceFor('case.gamma'), evidenceFor('case.alpha'), evidenceFor('case.beta')],
      expectedCaseIds: caseIds,
    });

  it('sorts deterministically regardless of input order', () => {
    const set = fullSet();
    expect(set.results.map((one) => one.workload.workloadCaseId)).toStrictEqual([
      'case.alpha',
      'case.beta',
      'case.gamma',
    ]);
    expect(set.caseIds).toStrictEqual(caseIds);
    expect(Object.isFrozen(set)).toBe(true);
    expect(Object.isFrozen(set.results)).toBe(true);
  });

  it('refuses a duplicated case', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkResultSet({
          version: 1,
          results: [evidenceFor('case.alpha'), evidenceFor('case.alpha'), evidenceFor('case.beta')],
          expectedCaseIds: caseIds,
        }),
      ),
    ).toBe('MANIFEST_DUPLICATE_CASE');
  });

  it('refuses a missing case — the selection failure this exists to stop', () => {
    // Run everything, keep the good ones, and nothing downstream can tell.
    expect(
      codeOf(() =>
        createRiyaBenchmarkResultSet({
          version: 1,
          results: [evidenceFor('case.alpha'), evidenceFor('case.beta')],
          expectedCaseIds: caseIds,
        }),
      ),
    ).toBe('MANIFEST_CASE_MISSING');
  });

  it('refuses a case from somewhere else', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkResultSet({
          version: 1,
          results: [
            evidenceFor('case.alpha'),
            evidenceFor('case.beta'),
            evidenceFor('case.gamma'),
            evidenceFor('case.delta'),
          ],
          expectedCaseIds: caseIds,
        }),
      ),
    ).toBe('MANIFEST_CASE_UNEXPECTED');
  });

  it('ACCEPTS a set whose cases have different shapes — that is what a suite is', () => {
    // An earlier version required full workload parity inside a set, which made a concurrency sweep
    // illegal. The owner goal is throughput under RISING concurrency, and a set that may hold only one
    // concurrency cannot express it.
    const set = createRiyaBenchmarkResultSet({
      version: 1,
      results: [
        evidenceFor('case.alpha'),
        syntheticEvidence({
          workload: syntheticWorkload({ workloadCaseId: 'case.beta', concurrency: 8 }),
        }),
        syntheticEvidence({
          workload: syntheticWorkload({
            workloadCaseId: 'case.gamma',
            concurrency: 32,
            inputTokenCount: 2_048,
            maximumOutputTokens: 512,
            batchSize: 4,
            streaming: false,
            promptProfileDigest: syntheticDigest('abcd'),
            samplingConfigDigest: syntheticDigest('bcde'),
          }),
        }),
      ],
      expectedCaseIds: caseIds,
    });
    expect(set.results).toHaveLength(3);
    expect(new Set(set.results.map((one) => one.workload.concurrency))).toStrictEqual(
      new Set([1, 8, 32]),
    );
    expect(riyaBenchmarkResultSetIntegrityHolds(set)).toBe(true);
  });

  it.each([
    ['suite', { benchmarkSuiteId: 'suite.beta' }, 'RESULT_SET_SUITE_MISMATCH'],
    ['suite version', { benchmarkSuiteVersion: 2 }, 'RESULT_SET_SUITE_MISMATCH'],
    [
      'harness',
      { benchmarkImplementationId: 'harness.beta' },
      'RESULT_SET_IMPLEMENTATION_MISMATCH',
    ],
    [
      'harness version',
      { benchmarkImplementationVersion: 3 },
      'RESULT_SET_IMPLEMENTATION_MISMATCH',
    ],
    [
      'measurement policy',
      { measurementPolicyRef: 'policy.measure.v2' },
      'RESULT_SET_MEASUREMENT_POLICY_MISMATCH',
    ],
  ])('but a different %s within one set is refused', (_name, override, expected) => {
    // Who measured, and by what rules, must be uniform. Two harnesses can agree on every number and
    // still disagree about what a p95 IS.
    expect(
      codeOf(() =>
        createRiyaBenchmarkResultSet({
          version: 1,
          results: [
            evidenceFor('case.alpha'),
            evidenceFor('case.beta'),
            syntheticEvidence({
              workload: syntheticWorkload({ workloadCaseId: 'case.gamma', ...override }),
            }),
          ],
          expectedCaseIds: caseIds,
        }),
      ),
    ).toBe(expected);
  });

  it('refuses a set containing a tampered artifact', () => {
    const tampered = {
      ...evidenceFor('case.gamma'),
      observation: syntheticObservation({ endToEndLatencyMicrosP50: 1 }),
    };
    expect(
      codeOf(() =>
        createRiyaBenchmarkResultSet({
          version: 1,
          results: [evidenceFor('case.alpha'), evidenceFor('case.beta'), tampered],
          expectedCaseIds: caseIds,
        }),
      ),
    ).toBe('EVIDENCE_TAMPERED');
  });

  it('manifest and result-set digests are deterministic and independently checkable', () => {
    const set = fullSet();
    expect(set.manifestDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(set.resultSetDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(set.manifestDigest).not.toBe(set.resultSetDigest);
    expect(fullSet().resultSetDigest).toBe(set.resultSetDigest);
    expect(riyaBenchmarkResultSetIntegrityHolds(set)).toBe(true);

    // Order is RE-DERIVED, not trusted, so a set serialised in a different order is the same set and
    // verifies to the same canonical form. Two spellings of one artifact are one artifact.
    const reversed = { ...set, results: [...set.results].reverse() };
    expect(riyaBenchmarkResultSetIntegrityHolds(reversed)).toBe(true);
    expect(verifyRiyaBenchmarkResultSet(reversed)).toStrictEqual(set);

    // Substituting a DIFFERENT member does break it, which is the property that matters.
    expect(
      riyaBenchmarkResultSetIntegrityHolds({
        ...set,
        results: [set.results[0], set.results[0], set.results[2]],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Derived display metrics.
// ---------------------------------------------------------------------------

describe('derived metrics are renderings, never scores', () => {
  it('computes success rate, decode speed and mean output', () => {
    const observation = syntheticObservation();
    expect(successRateBasisPoints(observation)).toBe(10_000);
    expect(approximateDecodeTokensPerSecondP50(observation)).toBe(50);
    expect(approximateDecodeTokensPerSecondP95(observation)).toBe(25);
    expect(meanOutputTokensPerSuccess(observation)).toBe(204);
  });

  it('reports partial success honestly', () => {
    const observation = syntheticObservation({ successfulRequests: 17, failedRequests: 3 });
    expect(successRateBasisPoints(observation)).toBe(8_500);
  });

  it('returns undefined rather than a flattering zero when there is nothing to report', () => {
    // Built directly rather than by clearing fields off the healthy fixture: a total-failure run is
    // its own artifact, and spelling it out says what it is.
    const failed = createRiyaBenchmarkObservation({
      version: 1,
      attemptedRequests: 20,
      successfulRequests: 0,
      failedRequests: 20,
      inputTokensTotal: 10_240,
      outputTokensTotal: 0,
    });
    expect(approximateDecodeTokensPerSecondP50(failed)).toBeUndefined();
    expect(meanOutputTokensPerSuccess(failed)).toBeUndefined();
    expect(successRateBasisPoints(failed)).toBe(0);
  });

  it('each derived metric reads ONE axis — none of them combine', () => {
    // The rule that keeps a convenience from becoming a composite score.
    const observation = syntheticObservation();
    const memoryChanged = syntheticObservation({ peakHostMemoryBytes: 1_073_741_824 });
    expect(approximateDecodeTokensPerSecondP50(memoryChanged)).toBe(
      approximateDecodeTokensPerSecondP50(observation),
    );
    expect(successRateBasisPoints(memoryChanged)).toBe(successRateBasisPoints(observation));
  });
});

// ---------------------------------------------------------------------------
// 39–47. Comparison.
// ---------------------------------------------------------------------------

describe('two runs are compared only under exact parity, and never ranked', () => {
  const caseIds = ['case.alpha', 'case.beta'];
  /** The healthy run, minus the memory readings. A harness that did not measure memory. */
  const MEASURED_NO_MEMORY = createRiyaBenchmarkObservation({
    version: 1,
    attemptedRequests: 20,
    successfulRequests: 20,
    failedRequests: 0,
    inputTokensTotal: 10_240,
    outputTokensTotal: 4_096,
    timeToFirstTokenMicrosP50: 120_000,
    timeToFirstTokenMicrosP95: 260_000,
    endToEndLatencyMicrosP50: 900_000,
    endToEndLatencyMicrosP95: 1_500_000,
    decodeMicrosPerOutputTokenP50: 20_000,
    decodeMicrosPerOutputTokenP95: 40_000,
  });
  const setOf = (
    options: {
      readonly modelId?: string;
      readonly hosted?: boolean;
      readonly workload?: Partial<ReturnType<typeof syntheticWorkload>>;
      /** A COMPLETE observation, not a partial: a partial cannot express "no memory reading". */
      readonly observation?: RiyaBenchmarkObservationV1;
    } = {},
  ) =>
    createRiyaBenchmarkResultSet({
      version: 1,
      results: caseIds.map((workloadCaseId) =>
        syntheticEvidence({
          subject: syntheticSubject({ modelId: options.modelId ?? 'model.alpha' }),
          ...(options.hosted === true ? { environment: syntheticHostedEnvironment() } : {}),
          workload: syntheticWorkload({ workloadCaseId, ...options.workload }),
          observation: options.observation ?? syntheticObservation(),
        }),
      ),
      expectedCaseIds: caseIds,
    });

  it('identical parity compares, and every delta is zero', () => {
    const comparison = compareRiyaBenchmarkResultSets(setOf(), setOf());
    expect(comparison.comparable).toBe(true);
    expect(comparison.parityMismatches).toStrictEqual([]);
    expect(comparison.deltas.length).toBeGreaterThan(0);
    expect(comparison.deltas.every((one) => one.delta === 0)).toBe(true);
    // Zero deltas, and NO field that turns them into a verdict.
    expect(Object.keys(comparison).sort()).toStrictEqual([
      'comparable',
      'deltas',
      'parityMismatches',
    ]);
  });

  it('the RELEASE may differ — that is the point of the exercise', () => {
    const comparison = compareRiyaBenchmarkResultSets(setOf(), setOf({ modelId: 'model.beta' }));
    expect(comparison.comparable).toBe(true);
    expect(comparison.parityMismatches).toStrictEqual([]);
  });

  it('the ENVIRONMENT may differ too', () => {
    const comparison = compareRiyaBenchmarkResultSets(setOf(), setOf({ hosted: true }));
    expect(comparison.comparable).toBe(true);
  });

  it.each([
    ['suite', { benchmarkSuiteId: 'suite.beta' }, 'SUITE_MISMATCH'],
    ['suite version', { benchmarkSuiteVersion: 2 }, 'SUITE_VERSION_MISMATCH'],
    ['harness', { benchmarkImplementationId: 'harness.beta' }, 'IMPLEMENTATION_MISMATCH'],
    ['prompt profile', { promptProfileDigest: syntheticDigest('bad') }, 'PROMPT_PROFILE_MISMATCH'],
    ['concurrency', { concurrency: 8 }, 'CONCURRENCY_MISMATCH'],
    ['batch size', { batchSize: 4 }, 'BATCH_SIZE_MISMATCH'],
    ['warmup count', { warmupRequestCount: 9 }, 'WARMUP_COUNT_MISMATCH'],
    ['streaming', { streaming: false }, 'STREAMING_MISMATCH'],
    [
      'sampling config',
      { samplingConfigDigest: syntheticDigest('bbb') },
      'SAMPLING_CONFIG_MISMATCH',
    ],
    [
      'measurement policy',
      { measurementPolicyRef: 'policy.measure.v2' },
      'MEASUREMENT_POLICY_MISMATCH',
    ],
    ['input tokens', { inputTokenCount: 1_024 }, 'INPUT_TOKEN_COUNT_MISMATCH'],
    ['output cap', { maximumOutputTokens: 512 }, 'MAX_OUTPUT_TOKENS_MISMATCH'],
  ])('a different %s is NOT comparable, and says which axis', (_name, workload, expected) => {
    const comparison = compareRiyaBenchmarkResultSets(setOf(), setOf({ workload }));
    expect(comparison.comparable).toBe(false);
    expect(comparison.parityMismatches).toContain(expected);
    // No deltas at all — a mismatched comparison reports nothing subtractable.
    expect(comparison.deltas).toStrictEqual([]);
  });

  it('a different case set is not comparable', () => {
    const other = createRiyaBenchmarkResultSet({
      version: 1,
      results: [
        syntheticEvidence({ workload: syntheticWorkload({ workloadCaseId: 'case.alpha' }) }),
      ],
      expectedCaseIds: ['case.alpha'],
    });
    const comparison = compareRiyaBenchmarkResultSets(setOf(), other);
    expect(comparison.comparable).toBe(false);
    expect(comparison.parityMismatches).toContain('WORKLOAD_CASE_SET_MISMATCH');
  });

  it('a genuine trade-off is REPORTED AS NUMBERS, with no summary of it', () => {
    // B is faster and uses more memory. This is the normal answer, and the whole reason there is no
    // single number here — including no Pareto relation, which was drafted and removed.
    const comparison = compareRiyaBenchmarkResultSets(
      setOf(),
      setOf({
        observation: syntheticObservation({
          endToEndLatencyMicrosP50: 600_000,
          endToEndLatencyMicrosP95: 900_000,
          peakHostMemoryBytes: 17_179_869_184,
        }),
      }),
    );
    expect(comparison.comparable).toBe(true);
    const latency = comparison.deltas.filter((one) => one.axis === 'endToEndLatencyMicrosP50');
    const memory = comparison.deltas.filter((one) => one.axis === 'peakHostMemoryBytes');
    expect(latency.every((one) => one.delta < 0)).toBe(true);
    expect(memory.every((one) => one.delta > 0)).toBe(true);
  });

  it('one-sided superiority is ALSO just numbers — no dominance verdict', () => {
    const comparison = compareRiyaBenchmarkResultSets(
      setOf(),
      setOf({
        observation: syntheticObservation({
          timeToFirstTokenMicrosP50: 60_000,
          timeToFirstTokenMicrosP95: 130_000,
          endToEndLatencyMicrosP50: 450_000,
          endToEndLatencyMicrosP95: 750_000,
          decodeMicrosPerOutputTokenP50: 10_000,
          decodeMicrosPerOutputTokenP95: 20_000,
          peakAcceleratorMemoryBytes: 4_294_967_296,
          peakHostMemoryBytes: 2_147_483_648,
        }),
      }),
    );
    expect(comparison.comparable).toBe(true);
    expect(comparison.deltas.every((one) => one.delta <= 0)).toBe(true);
    expect(Object.keys(comparison)).not.toContain('paretoRelation');
  });

  it('the PARETO field is gone, and nothing replaced it', () => {
    // Dominance needs every axis on both sides. Memory is optional, so an unmeasured axis dropped out
    // of the relation and "equivalent" could mean "equal on the axes we happened to share" — a
    // stronger claim than the data supports.
    const comparison = compareRiyaBenchmarkResultSets(setOf(), setOf({ modelId: 'model.beta' }));
    expect(Object.keys(comparison).sort()).toStrictEqual([
      'comparable',
      'deltas',
      'parityMismatches',
    ]);
    for (const gone of ['paretoRelation', 'relation', 'summary', 'outcome', 'result']) {
      expect(Object.keys(comparison), gone).not.toContain(gone);
    }
    const serialized = JSON.stringify(comparison).toUpperCase();
    for (const forbidden of [
      'WINNER',
      'BEST_MODEL',
      'RECOMMEND',
      'APPROVED',
      'PRODUCTION_READY',
      'OVERALLSCORE',
      'WEIGHTEDSCORE',
      'SCORE',
      'RANK',
      'VERDICT',
      'PASS',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('an axis only one side measured is OMITTED, and no summary calls them equal', () => {
    // Treating an absent memory reading as zero would make the side that did not measure look better.
    // Calling them EQUIVALENT would be worse: it reads as a finding about the two configurations when
    // it is a finding about what the harness recorded. Absence from the deltas IS the statement.
    const withoutMemory = setOf({ observation: MEASURED_NO_MEMORY });
    const comparison = compareRiyaBenchmarkResultSets(setOf(), withoutMemory);
    expect(comparison.comparable).toBe(true);
    expect(comparison.deltas.some((one) => one.axis === 'peakHostMemoryBytes')).toBe(false);
    expect(comparison.deltas.some((one) => one.axis === 'peakAcceleratorMemoryBytes')).toBe(false);
    // The shared axes are still compared.
    expect(comparison.deltas.some((one) => one.axis === 'endToEndLatencyMicrosP50')).toBe(true);
    expect(Object.keys(comparison)).not.toContain('paretoRelation');
  });

  it('BOTH inputs are deep-verified before any delta exists', () => {
    // The merge-blocking one. A comparison that reads an untrusted object produces output that looks
    // exactly like a real answer, and it is the thing somebody pastes into a decision.
    const valid = setOf();
    const tampered = {
      ...valid,
      results: [
        { ...valid.results[0], observation: syntheticObservation({ endToEndLatencyMicrosP50: 1 }) },
        valid.results[1],
      ],
    };
    expect(codeOf(() => compareRiyaBenchmarkResultSets(tampered, setOf()))).toBe(
      'EVIDENCE_TAMPERED',
    );
    expect(codeOf(() => compareRiyaBenchmarkResultSets(setOf(), tampered))).toBe(
      'EVIDENCE_TAMPERED',
    );
  });

  it('a recomputed digest does not buy a comparison', () => {
    // The attacker recomputes every digest over an artifact whose nested observation is structurally
    // impossible. Hash self-consistency is not schema validity.
    const valid = setOf();
    const forged = forgeResultSet(valid, {
      ...valid.results[0],
      observation: { ...syntheticObservation(), failedRequests: 7 },
    });
    expect(codeOf(() => compareRiyaBenchmarkResultSets(forged, setOf()))).toBe(
      'REQUEST_COUNT_MISMATCH',
    );
  });

  it('a recomputed set digest does not legalize a mixed-subject set', () => {
    const valid = setOf();
    const forged = forgeResultSet(valid, {
      ...valid.results[0],
      subject: syntheticSubject({ modelId: 'model.beta' }),
    });
    expect(codeOf(() => compareRiyaBenchmarkResultSets(forged, setOf()))).toBe(
      'RESULT_SET_SUBJECT_MISMATCH',
    );
  });

  it('unknown keys are refused before a comparison exists', () => {
    const valid = setOf();
    expect(codeOf(() => compareRiyaBenchmarkResultSets({ ...valid, note: 'x' }, setOf()))).toBe(
      'RESULT_SET_INVALID',
    );
    expect(codeOf(() => compareRiyaBenchmarkResultSets(null, setOf()))).toBe('RESULT_SET_INVALID');
    expect(codeOf(() => compareRiyaBenchmarkResultSets(setOf(), 'nonsense'))).toBe(
      'RESULT_SET_INVALID',
    );
  });
});

// ---------------------------------------------------------------------------
// Deep verification at the trust boundary (owner correction).
// ---------------------------------------------------------------------------

describe('a stored artifact is RECONSTRUCTED, never just hash-checked', () => {
  it('a canonical artifact verifies and comes back identical', () => {
    const evidence = syntheticEvidence();
    expect(verifyRiyaBenchmarkEvidence(evidence)).toStrictEqual(evidence);
    expect(riyaBenchmarkEvidenceIntegrityHolds(evidence)).toBe(true);
  });

  it('a stored artifact WITHOUT a digest is refused, not stamped', () => {
    // Stamping it here would turn a verifier into a laundering step: an unstamped body walks in and a
    // trusted artifact walks out.
    const { evidenceDigest: _absent, ...unstamped } = syntheticEvidence();
    expect(codeOf(() => verifyRiyaBenchmarkEvidence(unstamped))).toBe('DIGEST_INVALID');
    expect(codeOf(() => verifyRiyaBenchmarkEvidence({ ...unstamped, evidenceDigest: 'abc' }))).toBe(
      'DIGEST_INVALID',
    );
  });

  const UNKNOWN_KEY_CASES: readonly (readonly [
    string,
    (evidence: Record<string, unknown>) => Record<string, unknown>,
  ])[] = [
    ['outer', (e) => ({ ...e, note: 'x' })],
    ['subject', (e) => ({ ...e, subject: { ...syntheticSubject(), q: 1 } })],
    [
      'environment',
      (e) => ({ ...e, environment: { ...syntheticHostedEnvironment(), hostname: 'box' } }),
    ],
    ['workload', (e) => ({ ...e, workload: { ...syntheticWorkload(), prompt: 'hi' } })],
    ['observation', (e) => ({ ...e, observation: { ...syntheticObservation(), extra: 1 } })],
  ];

  it.each(UNKNOWN_KEY_CASES)('an unknown %s key is refused', (_where, mutate) => {
    const forged = mutate(syntheticEvidence() as unknown as Record<string, unknown>);
    const { evidenceDigest: _old, ...body } = forged;
    // Re-stamped, so only the SCHEMA can catch it.
    expect(
      codeOf(() =>
        verifyRiyaBenchmarkEvidence({ ...forged, evidenceDigest: sha256OfCanonical(body) }),
      ),
    ).not.toBe('no-error');
  });

  it('THE ONE THAT MATTERS: a recomputed digest cannot legalize a broken artifact', () => {
    // A hash-only gate accepts this. successful + failed !== attempted is a harness that dropped
    // requests on the floor, and its latency describes a population nobody can name.
    const base = syntheticEvidence();
    const broken = { ...base, observation: { ...syntheticObservation(), failedRequests: 9 } };
    const { evidenceDigest: _old, ...body } = broken;
    const selfConsistent = { ...broken, evidenceDigest: sha256OfCanonical(body) };

    // Self-consistent by hash...
    const { evidenceDigest: stamped, ...rest } = selfConsistent;
    expect(sha256OfCanonical(rest)).toBe(stamped);
    // ...and still refused, because reconstruction is the gate.
    expect(codeOf(() => verifyRiyaBenchmarkEvidence(selfConsistent))).toBe(
      'REQUEST_COUNT_MISMATCH',
    );
    expect(riyaBenchmarkEvidenceIntegrityHolds(selfConsistent)).toBe(false);
  });

  it('the boolean helper is TOTAL - anything in, a boolean out', () => {
    for (const junk of [null, undefined, 0, '', 'text', [], {}, { version: 1 }]) {
      expect(() => riyaBenchmarkEvidenceIntegrityHolds(junk)).not.toThrow();
      expect(riyaBenchmarkEvidenceIntegrityHolds(junk)).toBe(false);
    }
  });
});

describe('a result set is ONE configuration, proved not assumed', () => {
  const caseIds = ['case.alpha', 'case.beta'];
  const build = (results: readonly unknown[]) =>
    createRiyaBenchmarkResultSet({
      version: 1,
      results: results as never,
      expectedCaseIds: caseIds,
    });
  const evidenceFor = (
    workloadCaseId: string,
    options: Parameters<typeof syntheticEvidence>[0] = {},
  ) => syntheticEvidence({ workload: syntheticWorkload({ workloadCaseId }), ...options });

  it('a homogeneous set is accepted', () => {
    const set = build([evidenceFor('case.alpha'), evidenceFor('case.beta')]);
    expect(set.results).toHaveLength(2);
    expect(riyaBenchmarkResultSetIntegrityHolds(set)).toBe(true);
    expect(verifyRiyaBenchmarkResultSet(set)).toStrictEqual(set);
  });

  it('two cases measured on DIFFERENT MODELS is not one set', () => {
    // Identical workload parity, so the parity check passes - and the aggregate would describe a
    // machine that does not exist.
    expect(
      codeOf(() =>
        build([
          evidenceFor('case.alpha'),
          evidenceFor('case.beta', { subject: syntheticSubject({ modelId: 'model.beta' }) }),
        ]),
      ),
    ).toBe('RESULT_SET_SUBJECT_MISMATCH');
  });

  it('two cases measured against a DIFFERENT PROMPT is not one set', () => {
    expect(
      codeOf(() =>
        build([
          evidenceFor('case.alpha'),
          evidenceFor('case.beta', {
            subject: syntheticSubject({ promptDigest: syntheticDigest('fade') }),
          }),
        ]),
      ),
    ).toBe('RESULT_SET_SUBJECT_MISMATCH');
  });

  it('two cases measured on DIFFERENT HARDWARE is not one set', () => {
    expect(
      codeOf(() =>
        build([
          evidenceFor('case.alpha'),
          evidenceFor('case.beta', { environment: syntheticHostedEnvironment() }),
        ]),
      ),
    ).toBe('RESULT_SET_ENVIRONMENT_MISMATCH');
  });

  it('case SHAPE may vary; suite, harness and measurement policy may not', () => {
    // Parity is an INTER-SET property, checked per matched case in the comparison layer.
    expect(
      build([
        evidenceFor('case.alpha'),
        syntheticEvidence({
          workload: syntheticWorkload({ workloadCaseId: 'case.beta', concurrency: 8 }),
        }),
      ]).results,
    ).toHaveLength(2);
    expect(
      codeOf(() =>
        build([
          evidenceFor('case.alpha'),
          syntheticEvidence({
            workload: syntheticWorkload({
              workloadCaseId: 'case.beta',
              measurementPolicyRef: 'policy.measure.v2',
            }),
          }),
        ]),
      ),
    ).toBe('RESULT_SET_MEASUREMENT_POLICY_MISMATCH');
  });

  it('stored verification re-proves the manifest against what is ACTUALLY there', () => {
    const set = build([evidenceFor('case.alpha'), evidenceFor('case.beta')]);
    expect(
      codeOf(() =>
        verifyRiyaBenchmarkResultSet({
          ...set,
          caseIds: ['case.alpha', 'case.beta', 'case.gamma'],
        }),
      ),
    ).toBe('MANIFEST_CASE_MISSING');
  });

  it('stored verification re-proves BOTH digests and never restamps', () => {
    const set = build([evidenceFor('case.alpha'), evidenceFor('case.beta')]);
    expect(
      codeOf(() =>
        verifyRiyaBenchmarkResultSet({ ...set, manifestDigest: syntheticDigest('dede') }),
      ),
    ).toBe('DIGEST_INVALID');
    expect(
      codeOf(() =>
        verifyRiyaBenchmarkResultSet({ ...set, resultSetDigest: syntheticDigest('dede') }),
      ),
    ).toBe('DIGEST_INVALID');
  });

  it('an unknown set key is refused', () => {
    const set = build([evidenceFor('case.alpha'), evidenceFor('case.beta')]);
    expect(codeOf(() => verifyRiyaBenchmarkResultSet({ ...set, note: 'x' }))).toBe(
      'RESULT_SET_INVALID',
    );
  });

  it('a fully re-stamped set cannot legalize a mixed subject or environment', () => {
    const set = build([evidenceFor('case.alpha'), evidenceFor('case.beta')]);
    expect(
      codeOf(() =>
        verifyRiyaBenchmarkResultSet(
          forgeResultSet(set, {
            ...set.results[0],
            subject: syntheticSubject({ modelId: 'model.beta' }),
          }),
        ),
      ),
    ).toBe('RESULT_SET_SUBJECT_MISMATCH');
    expect(
      codeOf(() =>
        verifyRiyaBenchmarkResultSet(
          forgeResultSet(set, { ...set.results[0], environment: syntheticHostedEnvironment() }),
        ),
      ),
    ).toBe('RESULT_SET_ENVIRONMENT_MISMATCH');
  });

  it('the set boolean helper is TOTAL', () => {
    for (const junk of [null, undefined, 0, '', 'text', [], {}, { version: 1, results: [] }]) {
      expect(() => riyaBenchmarkResultSetIntegrityHolds(junk)).not.toThrow();
      expect(riyaBenchmarkResultSetIntegrityHolds(junk)).toBe(false);
    }
  });

  it('canonical ordering is re-derived, not trusted', () => {
    const set = build([evidenceFor('case.beta'), evidenceFor('case.alpha')]);
    expect(set.results.map((one) => one.workload.workloadCaseId)).toStrictEqual([
      'case.alpha',
      'case.beta',
    ]);
  });
});

// ---------------------------------------------------------------------------
// RMB-B additive fields: request timeout and measured window.
// ---------------------------------------------------------------------------

describe('the two additive V1 fields extend evidence without breaking it', () => {
  it('LEGACY artifacts stay valid, and their digests do not move', () => {
    // The compatibility property that makes this additive rather than a version bump. An artifact
    // written before either field existed must verify unchanged, and hash to what it always did --
    // otherwise every stored benchmark would silently become "tampered".
    const legacyWorkload = syntheticWorkload();
    expect(legacyWorkload.requestTimeoutMicros).toBeUndefined();
    const legacyObservation = syntheticObservation();
    expect(legacyObservation.measuredWindowMicros).toBeUndefined();

    const legacy = syntheticEvidence();
    expect(riyaBenchmarkEvidenceIntegrityHolds(legacy)).toBe(true);
    expect(verifyRiyaBenchmarkEvidence(legacy)).toStrictEqual(legacy);
    // An explicitly-undefined field is the same artifact as an absent one.
    expect(sha256OfCanonical({ a: 1 })).toBe(
      sha256OfCanonical({ a: 1, requestTimeoutMicros: undefined }),
    );
  });

  it('accepts a valid timeout and refuses an invalid one', () => {
    expect(
      createRiyaBenchmarkWorkload({ ...syntheticWorkload(), requestTimeoutMicros: 30_000_000 })
        .requestTimeoutMicros,
    ).toBe(30_000_000);
    for (const bad of [0, -1, 1.5, 86_400_000_001]) {
      expect(
        codeOf(() =>
          createRiyaBenchmarkWorkload({ ...syntheticWorkload(), requestTimeoutMicros: bad }),
        ),
        String(bad),
      ).toBe('WORKLOAD_INVALID');
    }
  });

  it('the timeout is part of measurement parity', () => {
    // A run that abandons a slow request at two seconds and one that waits thirty produce different
    // failure counts and different tails from the same target.
    const withTimeout = syntheticWorkload({ requestTimeoutMicros: 30_000_000 });
    expect(workloadParityKey(withTimeout)).not.toBe(workloadParityKey(syntheticWorkload()));
    expect(workloadParityKey(syntheticWorkload())).toBe(workloadParityKey(syntheticWorkload()));
  });

  it('accepts a valid measured window and refuses an invalid one', () => {
    expect(
      createRiyaBenchmarkObservation({ ...syntheticObservation(), measuredWindowMicros: 2_000 })
        .measuredWindowMicros,
    ).toBe(2_000);
    for (const bad of [0, -1, 1.5]) {
      expect(
        codeOf(() =>
          createRiyaBenchmarkObservation({ ...syntheticObservation(), measuredWindowMicros: bad }),
        ),
        String(bad),
      ).toBe('OBSERVATION_INVALID');
    }
  });

  it('a window is legal even when every request failed', () => {
    // The window is how long the failures took. Refusing it would hide that they took any time.
    const allFailed = createRiyaBenchmarkObservation({
      version: 1,
      attemptedRequests: 4,
      successfulRequests: 0,
      failedRequests: 4,
      inputTokensTotal: 2_048,
      outputTokensTotal: 0,
      measuredWindowMicros: 400,
    });
    expect(allFailed.measuredWindowMicros).toBe(400);
  });

  it('both fields are covered by the evidence digest', () => {
    const base = syntheticEvidence();
    const withTimeout = createRiyaBenchmarkEvidence({
      version: 1,
      subject: base.subject,
      environment: base.environment,
      workload: syntheticWorkload({ requestTimeoutMicros: 30_000_000 }),
      observation: base.observation,
      createdAt: base.createdAt,
    });
    const withWindow = createRiyaBenchmarkEvidence({
      version: 1,
      subject: base.subject,
      environment: base.environment,
      workload: base.workload,
      observation: syntheticObservation({ measuredWindowMicros: 2_000 }),
      createdAt: base.createdAt,
    });
    expect(
      new Set([base.evidenceDigest, withTimeout.evidenceDigest, withWindow.evidenceDigest]).size,
    ).toBe(3);
  });

  it('replies-per-second and tokens-per-second are exact', () => {
    // 20 successes in 2_000 micros = 10_000 replies/sec -> 10_000_000 milli.
    const observation = syntheticObservation({ measuredWindowMicros: 2_000 });
    expect(successfulRequestsPerSecondMilli(observation)).toBe(10_000_000);
    // 4_096 tokens in 2_000 micros = 2_048_000 tokens/sec.
    expect(aggregateOutputTokensPerSecond(observation)).toBe(2_048_000);
  });

  it('both helpers are undefined without a window, and never estimated', () => {
    // Deliberately NOT approximated from concurrency / p50 -- that estimate is wrong under batching,
    // queueing and tails, and would be indistinguishable from a measurement in a report.
    const legacy = syntheticObservation();
    expect(successfulRequestsPerSecondMilli(legacy)).toBeUndefined();
    expect(aggregateOutputTokensPerSecond(legacy)).toBeUndefined();
  });

  it('tokens-per-second is undefined when nothing was produced', () => {
    const noOutput = createRiyaBenchmarkObservation({
      version: 1,
      attemptedRequests: 2,
      successfulRequests: 0,
      failedRequests: 2,
      inputTokensTotal: 1_024,
      outputTokensTotal: 0,
      measuredWindowMicros: 500,
    });
    expect(aggregateOutputTokensPerSecond(noOutput)).toBeUndefined();
    // Zero replies per second is a real answer, though.
    expect(successfulRequestsPerSecondMilli(noOutput)).toBe(0);
  });

  it('the arithmetic stays a SAFE INTEGER at the contract bounds', () => {
    // 1e6 requests x 1e6 x 1e3 = 1e15, and 1e9 tokens x 1e6 = 1e15. Both under ~9.0e15.
    expect(1_000_000 * 1_000_000 * 1_000).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(1_000_000_000 * 1_000_000).toBeLessThan(Number.MAX_SAFE_INTEGER);
    const extreme = createRiyaBenchmarkObservation({
      version: 1,
      attemptedRequests: 1_000_000,
      successfulRequests: 1_000_000,
      failedRequests: 0,
      inputTokensTotal: 1_000_000_000,
      outputTokensTotal: 1_000_000_000,
      timeToFirstTokenMicrosP50: 1,
      timeToFirstTokenMicrosP95: 2,
      endToEndLatencyMicrosP50: 3,
      endToEndLatencyMicrosP95: 4,
      decodeMicrosPerOutputTokenP50: 1,
      decodeMicrosPerOutputTokenP95: 2,
      measuredWindowMicros: 1,
    });
    expect(Number.isSafeInteger(successfulRequestsPerSecondMilli(extreme) ?? 0)).toBe(true);
    expect(Number.isSafeInteger(aggregateOutputTokensPerSecond(extreme) ?? 0)).toBe(true);
  });

  it('a timeout mismatch is a NAMED parity failure', () => {
    const caseIds = ['case.alpha'];
    const setOf = (requestTimeoutMicros?: number) =>
      createRiyaBenchmarkResultSet({
        version: 1,
        results: [
          syntheticEvidence({
            workload: syntheticWorkload(
              requestTimeoutMicros === undefined
                ? { workloadCaseId: 'case.alpha' }
                : { workloadCaseId: 'case.alpha', requestTimeoutMicros },
            ),
          }),
        ],
        expectedCaseIds: caseIds,
      });
    const comparison = compareRiyaBenchmarkResultSets(setOf(30_000_000), setOf(2_000_000));
    expect(comparison.comparable).toBe(false);
    expect(comparison.parityMismatches).toContain('REQUEST_TIMEOUT_MISMATCH');
    expect(comparison.deltas).toStrictEqual([]);
  });

  it('the window is a compared AXIS, and its absence is NOT a parity failure', () => {
    const caseIds = ['case.alpha'];
    const setOf = (measuredWindowMicros?: number) =>
      createRiyaBenchmarkResultSet({
        version: 1,
        results: [
          syntheticEvidence({
            workload: syntheticWorkload({ workloadCaseId: 'case.alpha' }),
            observation: syntheticObservation(
              measuredWindowMicros === undefined ? {} : { measuredWindowMicros },
            ),
          }),
        ],
        expectedCaseIds: caseIds,
      });

    // Both report it: a real delta.
    const compared = compareRiyaBenchmarkResultSets(setOf(2_000), setOf(1_000));
    expect(compared.comparable).toBe(true);
    const windowDelta = compared.deltas.find((one) => one.axis === 'measuredWindowMicros');
    expect(windowDelta?.delta).toBe(-1_000);

    // One side is legacy: still comparable, the axis is simply absent. Refusing here would strand
    // every artifact written before the harness existed.
    const mixed = compareRiyaBenchmarkResultSets(setOf(2_000), setOf());
    expect(mixed.comparable).toBe(true);
    expect(mixed.parityMismatches).toStrictEqual([]);
    expect(mixed.deltas.some((one) => one.axis === 'measuredWindowMicros')).toBe(false);
  });
});
