/**
 * Immutable, versioned evaluation thresholds (QFJ-P04.04, ADR-0052 §G, §M).
 *
 * Thresholds are explicit and versioned: a per-category maximum number of allowed failures. Evidence
 * is gated on these closed thresholds together with the mandatory-case and critical/inconclusive
 * state — NEVER on an average score, which could hide a critical safety failure.
 */
import { z } from 'zod';

import { EvaluationError } from './errors.js';
import { EVALUATION_CATEGORIES } from './vocabularies.js';
import type { EvaluationCategory } from './vocabularies.js';

/** A per-category maximum allowed failure count, plus a version. */
export interface SuiteThresholds {
  readonly thresholdsId: string;
  readonly thresholdsVersion: number;
  /** Category -> maximum number of FAIL outcomes tolerated in that category. */
  readonly maxFailuresByCategory: Readonly<Record<EvaluationCategory, number>>;
}

export interface SuiteThresholdsInput {
  readonly thresholdsId: string;
  readonly thresholdsVersion: number;
  readonly maxFailuresByCategory?: Partial<Record<EvaluationCategory, number>>;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** Validate and freeze a threshold set. Any category not listed defaults to zero tolerated failures. */
export function createSuiteThresholds(input: SuiteThresholdsInput): SuiteThresholds {
  const idOk = IDENTIFIER.safeParse(input.thresholdsId).success;
  const versionOk = z.int().min(1).max(1_000_000).safeParse(input.thresholdsVersion).success;
  if (!idOk || !versionOk) {
    throw new EvaluationError('invalid-thresholds');
  }
  const supplied = input.maxFailuresByCategory ?? {};
  const table: Record<EvaluationCategory, number> = {} as Record<EvaluationCategory, number>;
  for (const category of EVALUATION_CATEGORIES) {
    const value = supplied[category] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > 100_000) {
      throw new EvaluationError('invalid-thresholds');
    }
    table[category] = value;
  }
  return Object.freeze({
    thresholdsId: input.thresholdsId,
    thresholdsVersion: input.thresholdsVersion,
    maxFailuresByCategory: Object.freeze(table),
  });
}
