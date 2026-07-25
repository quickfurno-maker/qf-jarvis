/**
 * The deterministic suite evaluation service (QFJ-P04.04, ADR-0052 §M).
 *
 * Runs each scenario against its pre-supplied observation (a missing observation yields an
 * INCONCLUSIVE `observation-missing` result — it NEVER invokes a model), then aggregates immutable,
 * content-free counts, mandatory-case coverage, threshold breaches, critical/inconclusive blockers,
 * and an exact case-set digest. No average score is computed.
 */
import { contentDigest } from '../contracts/digest.js';
import type { CandidateObservation } from '../contracts/observation.js';
import { caseResult } from '../contracts/case-result.js';
import type { EvaluationCaseResult } from '../contracts/case-result.js';
import { scenarioKey } from '../contracts/scenario.js';
import type { EvaluationSuite } from '../contracts/suite.js';
import type { SuiteResult } from '../contracts/suite-result.js';
import {
  EVALUATION_CATEGORIES,
  EVALUATION_OUTCOMES,
  BLOCKING_SEVERITIES,
} from '../contracts/vocabularies.js';
import type {
  EvaluationCategory,
  EvaluationOutcome,
  RedTeamCaseKind,
} from '../contracts/vocabularies.js';
import type { EvaluationEvent, EvaluationObservabilityHook } from '../contracts/observability.js';
import { NOOP_EVALUATION_OBSERVABILITY } from '../contracts/observability.js';
import { evaluateCase } from '../evaluators/evaluate-case.js';

export interface EvaluateSuiteOptions {
  readonly observability?: EvaluationObservabilityHook;
}

function emptyOutcomeCounts(): Record<EvaluationOutcome, number> {
  const counts = {} as Record<EvaluationOutcome, number>;
  for (const outcome of EVALUATION_OUTCOMES) {
    counts[outcome] = 0;
  }
  return counts;
}

function emptyCategoryCounts(): Record<EvaluationCategory, number> {
  const counts = {} as Record<EvaluationCategory, number>;
  for (const category of EVALUATION_CATEGORIES) {
    counts[category] = 0;
  }
  return counts;
}

/**
 * Evaluate a suite against a map of observations keyed by `scenarioId@version`. Deterministic and
 * content-free. Emits a `suite-evaluated` event and one `case-evaluated` event per case.
 */
export function evaluateSuite(
  suite: EvaluationSuite,
  observations: ReadonlyMap<string, CandidateObservation>,
  options?: EvaluateSuiteOptions,
): SuiteResult {
  const hook = options?.observability ?? NOOP_EVALUATION_OBSERVABILITY;
  const { release } = suite.binding;

  const caseResults: EvaluationCaseResult[] = [];
  const countsByOutcome = emptyOutcomeCounts();
  const failuresByCategory = emptyCategoryCounts();
  let criticalFailures = 0;
  let blockingInconclusive = 0;
  const ranRedTeamKinds = new Set<RedTeamCaseKind>();

  for (const scenario of suite.scenarios) {
    const key = scenarioKey(scenario.scenarioId, scenario.scenarioVersion);
    const observation = observations.get(key);
    const result =
      observation === undefined
        ? caseResult(
            scenario.scenarioId,
            scenario.scenarioVersion,
            scenario.category,
            scenario.severity,
            'INCONCLUSIVE',
            'observation-missing',
          )
        : evaluateCase(scenario, observation);

    caseResults.push(result);
    countsByOutcome[result.outcome] += 1;
    if (result.outcome === 'FAIL') {
      failuresByCategory[result.category] += 1;
      if (result.severity === 'CRITICAL') {
        criticalFailures += 1;
      }
    }
    if (result.outcome === 'INCONCLUSIVE' && BLOCKING_SEVERITIES.has(result.severity)) {
      blockingInconclusive += 1;
    }
    if (scenario.redTeamKind !== undefined && result.outcome !== 'INCONCLUSIVE') {
      ranRedTeamKinds.add(scenario.redTeamKind);
    }

    hook.onEvent(
      Object.freeze({
        type: 'case-evaluated',
        suiteId: suite.binding.evaluationSuiteId,
        suiteVersion: suite.binding.evaluationSuiteVersion,
        releaseId: release.releaseId,
        providerId: release.providerId,
        modelId: release.modelId,
        modelVersion: release.modelVersion,
        category: result.category,
        severity: result.severity,
        outcome: result.outcome,
        reason: result.reason,
        target: undefined,
        count: 1,
        digest: undefined,
      } satisfies EvaluationEvent),
    );
  }

  const missingMandatory = suite.mandatoryRedTeamKinds.filter((k) => !ranRedTeamKinds.has(k));
  const thresholdBreaches = EVALUATION_CATEGORIES.filter(
    (c) => failuresByCategory[c] > suite.thresholds.maxFailuresByCategory[c],
  );
  const caseSetDigest = contentDigest(
    caseResults.map((r) => [
      r.scenarioId,
      r.scenarioVersion,
      r.category,
      r.severity,
      r.outcome,
      r.reason,
    ]),
  );

  const result: SuiteResult = Object.freeze({
    binding: suite.binding,
    caseResults: Object.freeze(caseResults),
    countsByOutcome: Object.freeze(countsByOutcome),
    failuresByCategory: Object.freeze(failuresByCategory),
    criticalFailures,
    blockingInconclusive,
    mandatoryCovered: missingMandatory.length === 0,
    missingMandatory: Object.freeze(missingMandatory),
    thresholdBreaches: Object.freeze(thresholdBreaches),
    caseSetDigest,
  });

  hook.onEvent(
    Object.freeze({
      type: 'suite-evaluated',
      suiteId: suite.binding.evaluationSuiteId,
      suiteVersion: suite.binding.evaluationSuiteVersion,
      releaseId: release.releaseId,
      providerId: release.providerId,
      modelId: release.modelId,
      modelVersion: release.modelVersion,
      category: undefined,
      severity: undefined,
      outcome: undefined,
      reason: undefined,
      target: undefined,
      count: caseResults.length,
      digest: caseSetDigest,
    } satisfies EvaluationEvent),
  );

  return result;
}
