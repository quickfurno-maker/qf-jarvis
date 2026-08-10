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
import type { RiyaBenchmarkObservationV1 } from '../contracts/observation.js';
import {
  createRiyaBenchmarkEvidence,
  isCanonicalBenchmarkInstant,
  riyaBenchmarkEvidenceIntegrityHolds,
} from '../contracts/evidence.js';
import { canonicalJson, sha256OfCanonical } from '../internal/digest.js';
import {
  approximateDecodeTokensPerSecondP50,
  approximateDecodeTokensPerSecondP95,
  meanOutputTokensPerSuccess,
  successRateBasisPoints,
} from '../service/derived.js';
import { compareRiyaBenchmarkResultSets } from '../service/compare.js';
import {
  createRiyaBenchmarkResultSet,
  riyaBenchmarkResultSetIntegrityHolds,
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
    ]) {
      expect(isCanonicalBenchmarkInstant(bad), bad).toBe(false);
    }
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

  it('refuses a set whose cases were measured differently from one another', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkResultSet({
          version: 1,
          results: [
            evidenceFor('case.alpha'),
            evidenceFor('case.beta'),
            syntheticEvidence({
              workload: syntheticWorkload({ workloadCaseId: 'case.gamma', concurrency: 8 }),
            }),
          ],
          expectedCaseIds: caseIds,
        }),
      ),
    ).toBe('COMPARISON_NOT_PARITY');
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
    // A swapped result breaks the set digest even though each artifact is individually valid.
    expect(
      riyaBenchmarkResultSetIntegrityHolds({
        ...set,
        results: [...set.results].reverse(),
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

  it('identical parity compares, and reports EQUIVALENT for identical numbers', () => {
    const comparison = compareRiyaBenchmarkResultSets(setOf(), setOf());
    expect(comparison.comparable).toBe(true);
    expect(comparison.parityMismatches).toStrictEqual([]);
    expect(comparison.paretoRelation).toBe('EQUIVALENT');
    expect(comparison.deltas.length).toBeGreaterThan(0);
    expect(comparison.deltas.every((one) => one.delta === 0)).toBe(true);
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
    expect(comparison.paretoRelation).toBe('NOT_COMPARABLE');
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

  it('reports a genuine trade-off as a TRADE-OFF, not a winner', () => {
    // B is faster and uses more memory. This is the normal answer, and the whole reason there is no
    // single number here.
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
    expect(comparison.paretoRelation).toBe('TRADEOFF');
  });

  it('reports dominance when one side really is better on every reported axis', () => {
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
    expect(comparison.paretoRelation).toBe('B_DOMINATES');
  });

  it('returns NO winner, NO recommendation, NO approval and NO score', () => {
    const comparison = compareRiyaBenchmarkResultSets(setOf(), setOf({ modelId: 'model.beta' }));
    expect(Object.keys(comparison).sort()).toStrictEqual([
      'comparable',
      'deltas',
      'paretoRelation',
      'parityMismatches',
    ]);
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

  it('an axis only one side measured is skipped, not counted as a zero', () => {
    // Treating an absent memory reading as zero would make the side that did not measure look better.
    const withoutMemory = setOf({ observation: MEASURED_NO_MEMORY });
    const comparison = compareRiyaBenchmarkResultSets(setOf(), withoutMemory);
    expect(comparison.comparable).toBe(true);
    expect(comparison.deltas.some((one) => one.axis === 'peakHostMemoryBytes')).toBe(false);
    expect(comparison.paretoRelation).toBe('EQUIVALENT');
  });
});
