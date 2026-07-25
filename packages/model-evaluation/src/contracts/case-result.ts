/**
 * The result of evaluating one scenario against one observation (QFJ-P04.04, ADR-0052 §L).
 *
 * A case result carries only safe ids/versions, the closed outcome, a closed reason, the category,
 * and the severity — never content, a prompt, a subject reference, or a secret.
 */
import type {
  EvaluationCategory,
  EvaluationOutcome,
  EvaluationReason,
  EvaluationSeverity,
} from './vocabularies.js';

/** One immutable, content-free case result. */
export interface EvaluationCaseResult {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly category: EvaluationCategory;
  readonly severity: EvaluationSeverity;
  readonly outcome: EvaluationOutcome;
  readonly reason: EvaluationReason;
}

/** Build a frozen case result. */
export function caseResult(
  scenarioId: string,
  scenarioVersion: number,
  category: EvaluationCategory,
  severity: EvaluationSeverity,
  outcome: EvaluationOutcome,
  reason: EvaluationReason,
): EvaluationCaseResult {
  return Object.freeze({ scenarioId, scenarioVersion, category, severity, outcome, reason });
}
