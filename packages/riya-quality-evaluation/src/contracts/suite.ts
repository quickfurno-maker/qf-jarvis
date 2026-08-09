/**
 * A Riya quality suite: one candidate binding, a fixed scenario set, one threshold set
 * (RWC-P10, ADR-0106 §17).
 *
 * Scenarios are sorted into a deterministic order at construction, so two callers who assembled the
 * same corpus in different orders produce the same suite, the same ordered result and the same
 * digest. Without that, a candidate comparison could report a difference that was only an array
 * order — and the whole value of this package is that a difference means something.
 */
import { z } from 'zod';

import type { RiyaQualityCandidateBindingV1 } from './binding.js';
import { RiyaQualityEvaluationError } from './errors.js';
import { riyaQualityScenarioKey } from './scenario.js';
import type { RiyaQualityScenarioV1 } from './scenario.js';
import type { RiyaQualityThresholdsV1 } from './thresholds.js';

/** The ceiling on one suite. Far above the 72-case golden corpus, and low enough to stay reviewable. */
export const RIYA_QUALITY_MAX_SCENARIOS = 1000;

export interface RiyaQualitySuiteV1 {
  readonly version: 1;
  readonly binding: RiyaQualityCandidateBindingV1;
  /** Deterministically ordered by scenario key. */
  readonly scenarios: readonly RiyaQualityScenarioV1[];
  readonly thresholds: RiyaQualityThresholdsV1;
}

export interface RiyaQualitySuiteInput {
  readonly binding: RiyaQualityCandidateBindingV1;
  readonly scenarios: readonly RiyaQualityScenarioV1[];
  readonly thresholds: RiyaQualityThresholdsV1;
}

const shapeSchema = z
  .object({
    binding: z.object({ version: z.literal(1) }).loose(),
    scenarios: z
      .array(z.object({ version: z.literal(1) }).loose())
      .min(1)
      .max(RIYA_QUALITY_MAX_SCENARIOS),
    thresholds: z.object({ thresholdsId: z.string().min(1) }).loose(),
  })
  .strict();

/**
 * Validate and freeze a quality suite. Throws `invalid-suite` or `duplicate-scenario`.
 *
 * An EMPTY suite is refused rather than trivially eligible. "Zero cases, zero failures, therefore
 * approved" is the most dangerous result this package could produce, and it is the one a mistake in
 * corpus assembly would most naturally produce.
 */
export function createRiyaQualitySuite(input: RiyaQualitySuiteInput): RiyaQualitySuiteV1 {
  if (!shapeSchema.safeParse(input).success) {
    throw new RiyaQualityEvaluationError('invalid-suite');
  }
  if (input.binding.thresholdsId !== input.thresholds.thresholdsId) {
    // The binding NAMES the thresholds evidence will be gated under. If the suite carried a
    // different set, the evidence would attest a gate that never ran.
    throw new RiyaQualityEvaluationError('invalid-suite');
  }
  if (input.binding.thresholdsVersion !== input.thresholds.thresholdsVersion) {
    throw new RiyaQualityEvaluationError('invalid-suite');
  }

  const keys = input.scenarios.map(riyaQualityScenarioKey);
  if (new Set(keys).size !== keys.length) {
    throw new RiyaQualityEvaluationError('duplicate-scenario');
  }

  const scenarios = [...input.scenarios].sort((a, b) => {
    const left = riyaQualityScenarioKey(a);
    const right = riyaQualityScenarioKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return Object.freeze({
    version: 1 as const,
    binding: input.binding,
    scenarios: Object.freeze(scenarios),
    thresholds: input.thresholds,
  });
}
