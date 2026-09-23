import type { HybridKnowledgeHit } from './contracts.js';

export interface KnowledgeQualityCase {
  readonly caseId: string;
  readonly expectedChunkIds: readonly string[];
  readonly expectedCitationRefs: readonly string[];
  readonly hits: readonly HybridKnowledgeHit[];
}

export interface KnowledgeQualityThresholds {
  readonly minRecallAtK: number;
  readonly minPrecisionAtK: number;
  readonly minMeanReciprocalRank: number;
  readonly minCitationPrecision: number;
  readonly maxNoResultRate: number;
}

export interface KnowledgeQualityMetrics {
  readonly caseCount: number;
  readonly recallAtK: number;
  readonly precisionAtK: number;
  readonly meanReciprocalRank: number;
  readonly citationPrecision: number;
  readonly noResultRate: number;
}

export type KnowledgeQualityFailure =
  | 'recall-below-threshold'
  | 'precision-below-threshold'
  | 'mrr-below-threshold'
  | 'citation-precision-below-threshold'
  | 'no-result-rate-above-threshold';

export interface KnowledgeQualityReport {
  readonly metrics: KnowledgeQualityMetrics;
  readonly thresholds: KnowledgeQualityThresholds;
  readonly passed: boolean;
  readonly failures: readonly KnowledgeQualityFailure[];
}

export interface KnowledgeQualityRegressionTolerance {
  readonly maxRecallDrop: number;
  readonly maxPrecisionDrop: number;
  readonly maxMrrDrop: number;
  readonly maxCitationPrecisionDrop: number;
  readonly maxNoResultRateIncrease: number;
}

export interface KnowledgeQualityRegressionReport {
  readonly passed: boolean;
  readonly regressions: readonly string[];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function validUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateThresholds(thresholds: KnowledgeQualityThresholds): void {
  if (
    !validUnit(thresholds.minRecallAtK) ||
    !validUnit(thresholds.minPrecisionAtK) ||
    !validUnit(thresholds.minMeanReciprocalRank) ||
    !validUnit(thresholds.minCitationPrecision) ||
    !validUnit(thresholds.maxNoResultRate)
  ) {
    throw new TypeError('knowledge-quality-thresholds-invalid');
  }
}

function validateCases(cases: readonly KnowledgeQualityCase[]): void {
  if (cases.length < 1 || cases.length > 100_000) {
    throw new TypeError('knowledge-quality-cases-invalid');
  }
  const ids = new Set<string>();
  for (const item of cases) {
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(item.caseId) ||
      ids.has(item.caseId) ||
      item.expectedChunkIds.length < 1 ||
      item.expectedChunkIds.length > 128 ||
      new Set(item.expectedChunkIds).size !== item.expectedChunkIds.length ||
      item.expectedCitationRefs.length < 1 ||
      item.expectedCitationRefs.length > 128 ||
      new Set(item.expectedCitationRefs).size !== item.expectedCitationRefs.length ||
      item.hits.length > 64
    ) {
      throw new TypeError('knowledge-quality-cases-invalid');
    }
    ids.add(item.caseId);
  }
}

function citationRef(hit: HybridKnowledgeHit): string {
  return `${hit.citation.knowledgeId}@${String(hit.citation.version)}`;
}

/**
 * Evaluate a labelled, privacy-reviewed query fixture set.
 *
 * The evaluator never reads raw production traffic itself. A caller must supply a deliberately
 * curated case set whose expected chunks/citations are known. That keeps tuning evidence reproducible
 * and prevents this quality layer from becoming an ungoverned conversation-data sink.
 */
export function evaluateKnowledgeQuality(
  cases: readonly KnowledgeQualityCase[],
  thresholds: KnowledgeQualityThresholds,
): KnowledgeQualityReport {
  validateCases(cases);
  validateThresholds(thresholds);

  const recalls: number[] = [];
  const precisions: number[] = [];
  const reciprocalRanks: number[] = [];
  let citationRelevant = 0;
  let citationReturned = 0;
  let noResultCases = 0;

  for (const item of cases) {
    const expectedChunks = new Set(item.expectedChunkIds);
    const expectedCitations = new Set(item.expectedCitationRefs);
    const relevantHits = item.hits.filter((hit) => expectedChunks.has(hit.chunkId));

    recalls.push(ratio(new Set(relevantHits.map((hit) => hit.chunkId)).size, expectedChunks.size));
    precisions.push(ratio(relevantHits.length, item.hits.length));

    const firstRelevant = item.hits.findIndex((hit) => expectedChunks.has(hit.chunkId));
    reciprocalRanks.push(firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1));

    if (item.hits.length === 0) noResultCases += 1;
    for (const hit of item.hits) {
      citationReturned += 1;
      if (expectedCitations.has(citationRef(hit))) citationRelevant += 1;
    }
  }

  const metrics: KnowledgeQualityMetrics = Object.freeze({
    caseCount: cases.length,
    recallAtK: average(recalls),
    precisionAtK: average(precisions),
    meanReciprocalRank: average(reciprocalRanks),
    citationPrecision: ratio(citationRelevant, citationReturned),
    noResultRate: ratio(noResultCases, cases.length),
  });

  const failures: KnowledgeQualityFailure[] = [];
  if (metrics.recallAtK < thresholds.minRecallAtK) failures.push('recall-below-threshold');
  if (metrics.precisionAtK < thresholds.minPrecisionAtK)
    failures.push('precision-below-threshold');
  if (metrics.meanReciprocalRank < thresholds.minMeanReciprocalRank)
    failures.push('mrr-below-threshold');
  if (metrics.citationPrecision < thresholds.minCitationPrecision)
    failures.push('citation-precision-below-threshold');
  if (metrics.noResultRate > thresholds.maxNoResultRate)
    failures.push('no-result-rate-above-threshold');

  return Object.freeze({
    metrics,
    thresholds: Object.freeze({ ...thresholds }),
    passed: failures.length === 0,
    failures: Object.freeze(failures),
  });
}

function validateTolerance(tolerance: KnowledgeQualityRegressionTolerance): void {
  if (
    !validUnit(tolerance.maxRecallDrop) ||
    !validUnit(tolerance.maxPrecisionDrop) ||
    !validUnit(tolerance.maxMrrDrop) ||
    !validUnit(tolerance.maxCitationPrecisionDrop) ||
    !validUnit(tolerance.maxNoResultRateIncrease)
  ) {
    throw new TypeError('knowledge-quality-regression-tolerance-invalid');
  }
}

/**
 * Compare a candidate against a previously accepted baseline. This is intentionally separate from
 * absolute thresholds: a candidate must not pass merely because both old and new releases clear a
 * loose floor while quality materially regresses.
 */
export function compareKnowledgeQualityReports(
  baseline: KnowledgeQualityReport,
  candidate: KnowledgeQualityReport,
  tolerance: KnowledgeQualityRegressionTolerance,
): KnowledgeQualityRegressionReport {
  validateTolerance(tolerance);
  const regressions: string[] = [];
  if (baseline.metrics.recallAtK - candidate.metrics.recallAtK > tolerance.maxRecallDrop)
    regressions.push('recall-regressed');
  if (
    baseline.metrics.precisionAtK - candidate.metrics.precisionAtK >
    tolerance.maxPrecisionDrop
  )
    regressions.push('precision-regressed');
  if (
    baseline.metrics.meanReciprocalRank - candidate.metrics.meanReciprocalRank >
    tolerance.maxMrrDrop
  )
    regressions.push('mrr-regressed');
  if (
    baseline.metrics.citationPrecision - candidate.metrics.citationPrecision >
    tolerance.maxCitationPrecisionDrop
  )
    regressions.push('citation-precision-regressed');
  if (
    candidate.metrics.noResultRate - baseline.metrics.noResultRate >
    tolerance.maxNoResultRateIncrease
  )
    regressions.push('no-result-rate-regressed');

  return Object.freeze({
    passed: regressions.length === 0,
    regressions: Object.freeze(regressions),
  });
}
