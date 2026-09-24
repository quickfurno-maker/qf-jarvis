const REF = /^[A-Za-z0-9._:-]{1,160}$/u;

export interface DigitalTwinEffectCounters {
  readonly providerCalls: number;
  readonly coreMutations: number;
  readonly channelSends: number;
  readonly workflowStarts: number;
  readonly databaseWrites: number;
}

export interface DigitalTwinCandidateResult {
  readonly decision: string;
  readonly artifact?: unknown;
  readonly effects: DigitalTwinEffectCounters;
}

export interface DigitalTwinCandidate {
  run(input: unknown): Promise<DigitalTwinCandidateResult>;
}

export interface DigitalTwinScenario {
  readonly scenarioId: string;
  readonly input: unknown;
  readonly expectedDecision: string;
  readonly expectedArtifact?: unknown;
}

export interface DigitalTwinScenarioResult {
  readonly scenarioId: string;
  readonly pass: boolean;
  readonly decision: string;
  readonly reason:
    'MATCH' | 'DECISION_MISMATCH' | 'ARTIFACT_MISMATCH' | 'EFFECT_OCCURRED' | 'CANDIDATE_FAILED';
}

export interface DigitalTwinSuiteResult {
  readonly protocol: 'qfj.digital-twin-suite.v1';
  readonly scenarioCount: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly DigitalTwinScenarioResult[];
}

function validEffects(effects: DigitalTwinEffectCounters): boolean {
  return Object.values(effects).every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 1_000_000,
  );
}

function effectTotal(effects: DigitalTwinEffectCounters): number {
  return (
    effects.providerCalls +
    effects.coreMutations +
    effects.channelSends +
    effects.workflowStarts +
    effects.databaseWrites
  );
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export async function runDigitalTwinSuite(input: {
  readonly scenarios: readonly DigitalTwinScenario[];
  readonly candidate: DigitalTwinCandidate;
}): Promise<DigitalTwinSuiteResult> {
  const scenarioCandidate: unknown = input.scenarios;
  if (
    !Array.isArray(scenarioCandidate) ||
    input.scenarios.length === 0 ||
    input.scenarios.length > 10_000
  ) {
    throw new TypeError('digital-twin-suite-invalid');
  }
  const ids = new Set<string>();
  const results: DigitalTwinScenarioResult[] = [];
  for (const scenario of input.scenarios) {
    if (
      !REF.test(scenario.scenarioId) ||
      ids.has(scenario.scenarioId) ||
      typeof scenario.expectedDecision !== 'string' ||
      scenario.expectedDecision.length === 0 ||
      scenario.expectedDecision.length > 160
    ) {
      throw new TypeError('digital-twin-suite-invalid');
    }
    ids.add(scenario.scenarioId);
    let actual: DigitalTwinCandidateResult;
    try {
      actual = await input.candidate.run(scenario.input);
    } catch {
      results.push(
        Object.freeze({
          scenarioId: scenario.scenarioId,
          pass: false,
          decision: 'CANDIDATE_FAILED',
          reason: 'CANDIDATE_FAILED' as const,
        }),
      );
      continue;
    }
    if (!validEffects(actual.effects) || effectTotal(actual.effects) !== 0) {
      results.push(
        Object.freeze({
          scenarioId: scenario.scenarioId,
          pass: false,
          decision: actual.decision,
          reason: 'EFFECT_OCCURRED' as const,
        }),
      );
      continue;
    }
    if (actual.decision !== scenario.expectedDecision) {
      results.push(
        Object.freeze({
          scenarioId: scenario.scenarioId,
          pass: false,
          decision: actual.decision,
          reason: 'DECISION_MISMATCH' as const,
        }),
      );
      continue;
    }
    if (
      scenario.expectedArtifact !== undefined &&
      !sameJson(actual.artifact, scenario.expectedArtifact)
    ) {
      results.push(
        Object.freeze({
          scenarioId: scenario.scenarioId,
          pass: false,
          decision: actual.decision,
          reason: 'ARTIFACT_MISMATCH' as const,
        }),
      );
      continue;
    }
    results.push(
      Object.freeze({
        scenarioId: scenario.scenarioId,
        pass: true,
        decision: actual.decision,
        reason: 'MATCH' as const,
      }),
    );
  }
  const passed = results.filter((result) => result.pass).length;
  return Object.freeze({
    protocol: 'qfj.digital-twin-suite.v1' as const,
    scenarioCount: results.length,
    passed,
    failed: results.length - passed,
    results: Object.freeze(results),
  });
}

export interface DigitalTwinComparison {
  readonly regressions: readonly string[];
  readonly improvements: readonly string[];
  readonly unchanged: readonly string[];
}

export function compareDigitalTwinSuites(
  baseline: DigitalTwinSuiteResult,
  candidate: DigitalTwinSuiteResult,
): DigitalTwinComparison {
  const candidateById = new Map(
    candidate.results.map((result) => [result.scenarioId, result] as const),
  );
  const regressions: string[] = [];
  const improvements: string[] = [];
  const unchanged: string[] = [];
  for (const before of baseline.results) {
    const after = candidateById.get(before.scenarioId);
    if (after === undefined) {
      regressions.push(before.scenarioId);
    } else if (before.pass && !after.pass) {
      regressions.push(before.scenarioId);
    } else if (!before.pass && after.pass) {
      improvements.push(before.scenarioId);
    } else {
      unchanged.push(before.scenarioId);
    }
  }
  return Object.freeze({
    regressions: Object.freeze(regressions.sort()),
    improvements: Object.freeze(improvements.sort()),
    unchanged: Object.freeze(unchanged.sort()),
  });
}
