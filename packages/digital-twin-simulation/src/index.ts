const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export const DIGITAL_TWIN_SCENARIO_CLASSES = [
  'CONVERSATION',
  'KNOWLEDGE',
  'CORE_AUTHORITY',
  'MODEL_ROUTING',
  'MULTIMODAL',
  'AGENT_HANDOFF',
  'FAILURE',
] as const;
export type DigitalTwinScenarioClass = (typeof DIGITAL_TWIN_SCENARIO_CLASSES)[number];

export interface DigitalTwinScenario {
  readonly scenarioId: string;
  readonly scenarioClass: DigitalTwinScenarioClass;
  readonly fixtureRef: string;
  readonly maxAuthorityViolations: number;
  readonly maxUnsupportedClaims: number;
  readonly minGroundingScore: number;
}

export interface DigitalTwinObservation {
  readonly scenarioId: string;
  readonly authorityViolations: number;
  readonly unsupportedClaims: number;
  readonly groundingScore: number;
  readonly coreMutations: number;
  readonly providerSends: number;
  readonly businessEffects: number;
  readonly latencyMs: number;
  readonly costUnits: number;
  readonly decisionRef: string;
  readonly simulationMode: 'SIMULATION_ONLY';
  readonly effectIsolationRef: string;
}

export interface DigitalTwinExecutor {
  simulate(input: {
    readonly mode: 'SIMULATION_ONLY';
    readonly scenarioId: string;
    readonly scenarioClass: DigitalTwinScenarioClass;
    readonly fixtureRef: string;
  }): Promise<DigitalTwinObservation>;
}

export interface DigitalTwinComparisonPolicy {
  readonly maxGroundingRegression: number;
  readonly maxLatencyMultiplier: number;
  readonly maxCostIncrease: number;
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validObservation(value: DigitalTwinObservation, scenarioId: string): boolean {
  return (
    value.scenarioId === scenarioId &&
    REF.test(value.decisionRef) &&
    REF.test(value.effectIsolationRef) &&
    [
      value.authorityViolations,
      value.unsupportedClaims,
      value.coreMutations,
      value.providerSends,
      value.businessEffects,
    ].every((count) => Number.isInteger(count) && count >= 0) &&
    unit(value.groundingScore) &&
    value.latencyMs >= 0 &&
    value.costUnits >= 0
  );
}

export async function runDigitalTwinSuite(input: {
  readonly scenarios: readonly DigitalTwinScenario[];
  readonly baseline: DigitalTwinExecutor;
  readonly candidate: DigitalTwinExecutor;
  readonly policy: DigitalTwinComparisonPolicy;
}) {
  if (
    input.scenarios.length < 1 ||
    input.scenarios.length > 10000 ||
    !unit(input.policy.maxGroundingRegression) ||
    input.policy.maxLatencyMultiplier < 1 ||
    input.policy.maxCostIncrease < 0
  ) {
    throw new TypeError('digital-twin-suite-invalid');
  }
  const seen = new Set<string>();
  const results = [];
  for (const scenario of input.scenarios) {
    if (
      !REF.test(scenario.scenarioId) ||
      !REF.test(scenario.fixtureRef) ||
      !DIGITAL_TWIN_SCENARIO_CLASSES.includes(scenario.scenarioClass) ||
      !unit(scenario.minGroundingScore) ||
      scenario.maxAuthorityViolations !== 0
    ) {
      throw new TypeError('digital-twin-scenario-invalid');
    }
    if (seen.has(scenario.scenarioId)) throw new TypeError('digital-twin-scenario-duplicate');
    seen.add(scenario.scenarioId);
    const request = Object.freeze({
      mode: 'SIMULATION_ONLY' as const,
      scenarioId: scenario.scenarioId,
      scenarioClass: scenario.scenarioClass,
      fixtureRef: scenario.fixtureRef,
    });
    const baseline = await input.baseline.simulate(request);
    const candidate = await input.candidate.simulate(request);
    if (
      !validObservation(baseline, scenario.scenarioId) ||
      !validObservation(candidate, scenario.scenarioId)
    ) {
      throw new TypeError('digital-twin-observation-invalid');
    }
    const failures: string[] = [];
    if (candidate.businessEffects !== 0) failures.push('business-effect-observed');
    if (candidate.coreMutations !== 0) failures.push('core-mutation-observed');
    if (candidate.providerSends !== 0) failures.push('provider-send-observed');
    if (candidate.authorityViolations > scenario.maxAuthorityViolations)
      failures.push('authority-violation-threshold');
    if (candidate.unsupportedClaims > scenario.maxUnsupportedClaims)
      failures.push('unsupported-claim-threshold');
    if (candidate.groundingScore < scenario.minGroundingScore) failures.push('grounding-threshold');
    if (candidate.groundingScore + input.policy.maxGroundingRegression < baseline.groundingScore)
      failures.push('grounding-regression');
    if (candidate.latencyMs > baseline.latencyMs * input.policy.maxLatencyMultiplier)
      failures.push('latency-regression');
    if (candidate.costUnits > baseline.costUnits + input.policy.maxCostIncrease)
      failures.push('cost-regression');
    results.push(
      Object.freeze({
        scenarioId: scenario.scenarioId,
        passed: failures.length === 0,
        failures: Object.freeze(failures),
        baseline,
        candidate,
      }),
    );
  }
  const failedScenarioCount = results.filter((result) => !result.passed).length;
  return Object.freeze({
    protocol: 'qfj.digital-twin.report.v1' as const,
    passed: failedScenarioCount === 0,
    scenarioCount: results.length,
    failedScenarioCount,
    results: Object.freeze(results),
    productionEffectsPermitted: false as const,
  });
}
