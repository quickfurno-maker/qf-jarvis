/**
 * The immutable evaluation suite (QFJ-P04.04, ADR-0052).
 *
 * A suite bundles an exact {@link EvaluationBinding}, a deterministically-ordered set of scenarios
 * (unique by id/version), a versioned {@link SuiteThresholds}, and the closed set of mandatory
 * red-team kinds that must be covered. It is immutable; a duplicate scenario id/version is rejected.
 */
import { EvaluationError } from './errors.js';
import type { EvaluationBinding } from './binding.js';
import { scenarioKey } from './scenario.js';
import type { EvaluationScenario } from './scenario.js';
import type { SuiteThresholds } from './thresholds.js';
import type { RedTeamCaseKind } from './vocabularies.js';

/** One immutable evaluation suite. */
export interface EvaluationSuite {
  readonly binding: EvaluationBinding;
  readonly scenarios: readonly EvaluationScenario[];
  readonly thresholds: SuiteThresholds;
  readonly mandatoryRedTeamKinds: readonly RedTeamCaseKind[];
}

export interface EvaluationSuiteInput {
  readonly binding: EvaluationBinding;
  readonly scenarios: readonly EvaluationScenario[];
  readonly thresholds: SuiteThresholds;
  readonly mandatoryRedTeamKinds?: readonly RedTeamCaseKind[];
}

function compareScenarios(a: EvaluationScenario, b: EvaluationScenario): number {
  if (a.scenarioId !== b.scenarioId) {
    return a.scenarioId < b.scenarioId ? -1 : 1;
  }
  return a.scenarioVersion - b.scenarioVersion;
}

/** Validate and freeze a suite. Throws `EvaluationError('duplicate-scenario')` on a repeated id/version. */
export function createEvaluationSuite(input: EvaluationSuiteInput): EvaluationSuite {
  const ordered = [...input.scenarios].sort(compareScenarios);
  const seen = new Set<string>();
  for (const scenario of ordered) {
    const key = scenarioKey(scenario.scenarioId, scenario.scenarioVersion);
    if (seen.has(key)) {
      throw new EvaluationError('duplicate-scenario');
    }
    seen.add(key);
  }
  return Object.freeze({
    binding: input.binding,
    scenarios: Object.freeze(ordered),
    thresholds: input.thresholds,
    mandatoryRedTeamKinds: Object.freeze([...(input.mandatoryRedTeamKinds ?? [])]),
  });
}
