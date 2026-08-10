/**
 * Evaluate one Riya quality suite (RWC-P10, ADR-0106 §17).
 *
 * Pure and deterministic: same suite plus same observations, same result and same digests, every
 * time, on every machine. No clock, no randomness, no I/O, no model, no environment read. The only
 * non-determinism a caller can introduce is the ORDER they hand things in, and the suite constructor
 * has already removed that.
 */
import { evaluateRiyaQualityCase } from '../internal/evaluate-case.js';
import { riyaQualityCaseSetDigest, riyaQualityResultDigest } from '../internal/result-integrity.js';
import { observationKey } from '../contracts/observation.js';
import type { RiyaQualityObservationV1 } from '../contracts/observation.js';
import { riyaQualityScenarioKey } from '../contracts/scenario.js';
import type {
  RiyaQualityCaseResultV1,
  RiyaQualitySuiteResultV1,
  RiyaQualityThresholdBreach,
} from '../contracts/results.js';
import { passRateBps } from '../contracts/thresholds.js';
import type { RiyaQualitySuiteV1 } from '../contracts/suite.js';
import {
  RIYA_QUALITY_DIMENSIONS,
  RIYA_QUALITY_INCONCLUSIVE_CODES,
} from '../contracts/vocabularies.js';
import type { RiyaQualityCaseOutcome, RiyaQualityDimension } from '../contracts/vocabularies.js';

/**
 * Evaluate a suite against the supplied observations.
 *
 * An observation whose key matches no scenario is IGNORED rather than an error: a caller may
 * legitimately hold a wider set than one suite covers. A scenario with no observation is
 * `INCONCLUSIVE`, which the thresholds then refuse — so a missing case cannot pass unnoticed.
 */
export function evaluateRiyaQualitySuite(
  suite: RiyaQualitySuiteV1,
  observations: readonly RiyaQualityObservationV1[],
): RiyaQualitySuiteResultV1 {
  const byKey = new Map<string, RiyaQualityObservationV1>();
  for (const observation of observations) {
    // Last write wins, and it cannot matter: two observations for one scenario is a caller defect,
    // and the suite result is about scenarios, not about submissions.
    byKey.set(observationKey(observation), observation);
  }

  const caseResults: RiyaQualityCaseResultV1[] = [];
  const applicable = new Map<RiyaQualityDimension, number>();
  const passes = new Map<RiyaQualityDimension, number>();
  const counts: Record<RiyaQualityCaseOutcome, number> = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  let objectiveFailureCount = 0;

  for (const scenario of suite.scenarios) {
    const evaluated = evaluateRiyaQualityCase(
      scenario,
      byKey.get(riyaQualityScenarioKey(scenario)),
      suite.thresholds.requiredHumanReviews,
    );
    caseResults.push(evaluated.result);
    counts[evaluated.result.outcome] += 1;

    // The two "not measured" markers are NOT objective failures. Counting them as both would let one
    // missing observation trip two independent gates and make the report read as two problems.
    objectiveFailureCount += evaluated.result.objectiveFailures.filter(
      (code) => !RIYA_QUALITY_INCONCLUSIVE_CODES.has(code),
    ).length;

    for (const dimension of evaluated.tally.applicable) {
      applicable.set(dimension, (applicable.get(dimension) ?? 0) + 1);
    }
    for (const dimension of evaluated.tally.passed) {
      passes.set(dimension, (passes.get(dimension) ?? 0) + 1);
    }
  }

  const applicableCounts: Partial<Record<RiyaQualityDimension, number>> = {};
  const passCounts: Partial<Record<RiyaQualityDimension, number>> = {};
  const rates: Partial<Record<RiyaQualityDimension, number>> = {};
  for (const dimension of RIYA_QUALITY_DIMENSIONS) {
    const applicableCount = applicable.get(dimension);
    if (applicableCount === undefined) {
      continue;
    }
    const passCount = passes.get(dimension) ?? 0;
    applicableCounts[dimension] = applicableCount;
    passCounts[dimension] = passCount;
    rates[dimension] = passRateBps(passCount, applicableCount);
  }

  // ---- gates -------------------------------------------------------------------------------
  const breaches: RiyaQualityThresholdBreach[] = [];
  const thresholds = suite.thresholds;

  if (objectiveFailureCount > thresholds.maximumObjectiveFailures) {
    breaches.push(
      Object.freeze({
        kind: 'OBJECTIVE_FAILURES' as const,
        observed: objectiveFailureCount,
        limit: thresholds.maximumObjectiveFailures,
      }),
    );
  }
  if (counts.INCONCLUSIVE > thresholds.maximumInconclusiveCases) {
    breaches.push(
      Object.freeze({
        kind: 'INCONCLUSIVE_CASES' as const,
        observed: counts.INCONCLUSIVE,
        limit: thresholds.maximumInconclusiveCases,
      }),
    );
  }

  for (const dimension of RIYA_QUALITY_DIMENSIONS) {
    const floor = thresholds.minimumPassRateBpsByDimension[dimension];
    if (floor === undefined) {
      continue;
    }
    const applicableCount = applicableCounts[dimension] ?? 0;
    if (applicableCount === 0) {
      // A gated dimension nothing measured is a HOLE, not a pass. Without this the easiest way to
      // clear a floor would be to remove every case that exercised it.
      breaches.push(
        Object.freeze({
          kind: 'DIMENSION_NOT_COVERED' as const,
          dimension,
          observed: 0,
          limit: floor,
        }),
      );
      continue;
    }
    const rate = rates[dimension] ?? 0;
    if (rate < floor) {
      breaches.push(
        Object.freeze({
          kind: 'DIMENSION_PASS_RATE' as const,
          dimension,
          observed: rate,
          limit: floor,
        }),
      );
    }
  }

  const caseSetDigest = riyaQualityCaseSetDigest(caseResults);
  const qualityEligible = breaches.length === 0;

  // ONE preimage, shared with the evidence gate and the comparator (owner correction on PR #111).
  // A second copy here would drift, and the day it did, an artifact would verify against a formula
  // nobody was checking.
  const resultDigest = riyaQualityResultDigest({
    binding: suite.binding,
    caseSetDigest,
    countsByOutcome: counts,
    objectiveFailureCount,
    dimensionApplicableCounts: applicableCounts,
    dimensionPassCounts: passCounts,
    dimensionPassRateBps: rates,
    thresholdBreaches: breaches,
    qualityEligible,
  });

  return Object.freeze({
    version: 1 as const,
    binding: suite.binding,
    caseResults: Object.freeze(caseResults),
    countsByOutcome: Object.freeze({ ...counts }),
    objectiveFailureCount,
    dimensionApplicableCounts: Object.freeze(applicableCounts),
    dimensionPassCounts: Object.freeze(passCounts),
    dimensionPassRateBps: Object.freeze(rates),
    thresholdBreaches: Object.freeze(breaches),
    qualityEligible,
    caseSetDigest,
    resultDigest,
  });
}
