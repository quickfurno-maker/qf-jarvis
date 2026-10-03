import {
  evaluateAosBehaviourPolicy,
  type AosBehaviourContext,
  type AosBehaviourPolicy,
  type AosBehaviourTrigger,
} from '@qf-jarvis/aos-intelligence';
import {
  compareDigitalTwinSuites,
  runDigitalTwinSuite,
  type DigitalTwinComparison,
  type DigitalTwinSuiteResult,
} from '@qf-jarvis/digital-twin-simulation';

export interface AosDigitalTwinScenario {
  readonly scenarioId: string;
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
  readonly expectedAction: AosBehaviourPolicy['action'] | 'NO_MATCH';
}

export interface AosPolicyDigitalTwinResult {
  readonly protocol: 'qfj.aos.policy-digital-twin.v1';
  readonly policyId: string;
  readonly policyVersion: number;
  readonly suite: DigitalTwinSuiteResult;
  readonly activationAuthorized: false;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

function decisionFor(
  policy: AosBehaviourPolicy,
  scenario: AosDigitalTwinScenario,
): AosBehaviourPolicy['action'] | 'NO_MATCH' {
  const evaluated = evaluateAosBehaviourPolicy(policy, scenario.trigger, scenario.context);
  return evaluated.matched && evaluated.action !== 'NONE' ? evaluated.action : 'NO_MATCH';
}

export async function runAosPolicyDigitalTwin(input: {
  readonly policy: AosBehaviourPolicy;
  readonly scenarios: readonly AosDigitalTwinScenario[];
}): Promise<AosPolicyDigitalTwinResult> {
  if (input.scenarios.length < 1 || input.scenarios.length > 10_000) {
    throw new TypeError('aos-policy-digital-twin-scenarios-invalid');
  }

  const suite = await runDigitalTwinSuite({
    scenarios: input.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      input: scenario,
      expectedDecision: scenario.expectedAction,
    })),
    candidate: Object.freeze({
      run(raw: unknown) {
        const scenario = raw as AosDigitalTwinScenario;
        return Promise.resolve(
          Object.freeze({
            decision: decisionFor(input.policy, scenario),
            effects: Object.freeze({
              providerCalls: 0,
              coreMutations: 0,
              channelSends: 0,
              workflowStarts: 0,
              databaseWrites: 0,
            }),
          }),
        );
      },
    }),
  });

  return Object.freeze({
    protocol: 'qfj.aos.policy-digital-twin.v1' as const,
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
    suite,
    activationAuthorized: false as const,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export interface AosPolicyDigitalTwinComparison {
  readonly protocol: 'qfj.aos.policy-digital-twin-comparison.v1';
  readonly baseline: AosPolicyDigitalTwinResult;
  readonly candidate: AosPolicyDigitalTwinResult;
  readonly comparison: DigitalTwinComparison;
  readonly safeForOwnerReview: boolean;
  readonly activationAuthorized: false;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export async function compareAosPoliciesInDigitalTwin(input: {
  readonly baseline: AosBehaviourPolicy;
  readonly candidate: AosBehaviourPolicy;
  readonly scenarios: readonly AosDigitalTwinScenario[];
}): Promise<AosPolicyDigitalTwinComparison> {
  if (
    input.baseline.policyId !== input.candidate.policyId ||
    input.candidate.version !== input.baseline.version + 1
  ) {
    throw new TypeError('aos-policy-digital-twin-version-invalid');
  }

  const [baseline, candidate] = await Promise.all([
    runAosPolicyDigitalTwin({ policy: input.baseline, scenarios: input.scenarios }),
    runAosPolicyDigitalTwin({ policy: input.candidate, scenarios: input.scenarios }),
  ]);
  const comparison = compareDigitalTwinSuites(baseline.suite, candidate.suite);

  return Object.freeze({
    protocol: 'qfj.aos.policy-digital-twin-comparison.v1' as const,
    baseline,
    candidate,
    comparison,
    safeForOwnerReview: candidate.suite.failed === 0 && comparison.regressions.length === 0,
    activationAuthorized: false as const,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}
