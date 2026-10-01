import {
  evaluateAosBehaviourPolicy,
  type AosBehaviourContext,
  type AosBehaviourPolicy,
  type AosBehaviourTrigger,
} from './behavior.js';

export interface AosPolicySimulationScenario {
  readonly scenarioId: string;
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
}

export interface AosPolicySimulationResult {
  readonly protocol: 'qfj.aos.policy-simulation.v1';
  readonly scenarioCount: number;
  readonly previousMatches: number;
  readonly candidateMatches: number;
  readonly newlyMatched: readonly string[];
  readonly noLongerMatched: readonly string[];
  readonly activationAuthorized: false;
  readonly businessEffect: false;
}

export function simulateAosPolicyChange(input: {
  readonly previous: AosBehaviourPolicy;
  readonly candidate: AosBehaviourPolicy;
  readonly scenarios: readonly AosPolicySimulationScenario[];
}): AosPolicySimulationResult {
  if (
    input.previous.policyId !== input.candidate.policyId ||
    input.scenarios.length < 1 ||
    input.scenarios.length > 100_000
  ) {
    throw new TypeError('aos-policy-simulation-invalid');
  }

  const ids = new Set<string>();
  const previous = new Set<string>();
  const candidate = new Set<string>();
  for (const scenario of input.scenarios) {
    if (ids.has(scenario.scenarioId) || scenario.scenarioId.length < 1) {
      throw new TypeError('aos-policy-simulation-invalid');
    }
    ids.add(scenario.scenarioId);
    if (evaluateAosBehaviourPolicy(input.previous, scenario.trigger, scenario.context).matched) {
      previous.add(scenario.scenarioId);
    }
    if (evaluateAosBehaviourPolicy(input.candidate, scenario.trigger, scenario.context).matched) {
      candidate.add(scenario.scenarioId);
    }
  }

  return Object.freeze({
    protocol: 'qfj.aos.policy-simulation.v1' as const,
    scenarioCount: input.scenarios.length,
    previousMatches: previous.size,
    candidateMatches: candidate.size,
    newlyMatched: Object.freeze([...candidate].filter((id) => !previous.has(id)).sort()),
    noLongerMatched: Object.freeze([...previous].filter((id) => !candidate.has(id)).sort()),
    activationAuthorized: false as const,
    businessEffect: false as const,
  });
}
