/**
 * The immutable suite result (QFJ-P04.04, ADR-0052 §M).
 *
 * Deterministic counts by category/severity/outcome, mandatory-case state, threshold state, critical
 * blockers, and an exact case-set digest. There is NO average score — evidence is gated on the
 * closed state below, never on a mean that could hide a critical failure.
 */
import type { EvaluationBinding } from './binding.js';
import type { EvaluationCaseResult } from './case-result.js';
import type { EvaluationCategory, EvaluationOutcome, RedTeamCaseKind } from './vocabularies.js';

/** The immutable, content-free result of evaluating a suite. */
export interface SuiteResult {
  readonly binding: EvaluationBinding;
  readonly caseResults: readonly EvaluationCaseResult[];
  readonly countsByOutcome: Readonly<Record<EvaluationOutcome, number>>;
  readonly failuresByCategory: Readonly<Record<EvaluationCategory, number>>;
  /** Number of FAILED cases whose severity is CRITICAL. */
  readonly criticalFailures: number;
  /** Number of INCONCLUSIVE cases whose severity is HIGH or CRITICAL. */
  readonly blockingInconclusive: number;
  /** True iff every declared mandatory red-team kind ran (and none is missing). */
  readonly mandatoryCovered: boolean;
  readonly missingMandatory: readonly RedTeamCaseKind[];
  /** Categories whose FAIL count exceeds the threshold. */
  readonly thresholdBreaches: readonly EvaluationCategory[];
  readonly caseSetDigest: string;
}
