import { describe, expect, it, vi } from 'vitest';
import { runDigitalTwinSuite, type DigitalTwinObservation } from '../index.js';

const scenario = {
  scenarioId: 'scenario.payment-claim.1',
  scenarioClass: 'CORE_AUTHORITY' as const,
  fixtureRef: 'fixture.payment-claim.1',
  maxAuthorityViolations: 0,
  maxUnsupportedClaims: 0,
  minGroundingScore: 0.9,
};
const policy = { maxGroundingRegression: 0.02, maxLatencyMultiplier: 1.5, maxCostIncrease: 0.5 };

function observation(overrides: Partial<DigitalTwinObservation> = {}): DigitalTwinObservation {
  return {
    scenarioId: scenario.scenarioId,
    authorityViolations: 0,
    unsupportedClaims: 0,
    groundingScore: 0.95,
    coreMutations: 0,
    providerSends: 0,
    businessEffects: 0,
    latencyMs: 100,
    costUnits: 1,
    decisionRef: 'decision.1',
    simulationMode: 'SIMULATION_ONLY',
    effectIsolationRef: 'isolation.test.1',
    ...overrides,
  };
}

describe('digital twin simulation', () => {
  it('passes a no-effect candidate within quality bounds', async () => {
    const report = await runDigitalTwinSuite({
      scenarios: [scenario],
      baseline: { simulate: vi.fn().mockResolvedValue(observation()) },
      candidate: {
        simulate: vi.fn().mockResolvedValue(observation({ groundingScore: 0.96, latencyMs: 110 })),
      },
      policy,
    });
    expect(report).toMatchObject({
      passed: true,
      scenarioCount: 1,
      productionEffectsPermitted: false,
    });
  });
  it('hard-fails any observed production effect', async () => {
    const report = await runDigitalTwinSuite({
      scenarios: [scenario],
      baseline: { simulate: vi.fn().mockResolvedValue(observation()) },
      candidate: {
        simulate: vi.fn().mockResolvedValue(observation({ providerSends: 1, businessEffects: 1 })),
      },
      policy,
    });
    expect(report.passed).toBe(false);
    expect(report.results[0]?.failures).toEqual(
      expect.arrayContaining(['provider-send-observed', 'business-effect-observed']),
    );
  });
  it('rejects an observation without an isolation reference', async () => {
    await expect(
      runDigitalTwinSuite({
        scenarios: [scenario],
        baseline: { simulate: vi.fn().mockResolvedValue(observation()) },
        candidate: {
          simulate: vi.fn().mockResolvedValue({ ...observation(), effectIsolationRef: 'bad ref' }),
        },
        policy,
      }),
    ).rejects.toThrow('digital-twin-observation-invalid');
  });

  it('detects grounding, latency and cost regressions', async () => {
    const report = await runDigitalTwinSuite({
      scenarios: [scenario],
      baseline: { simulate: vi.fn().mockResolvedValue(observation()) },
      candidate: {
        simulate: vi
          .fn()
          .mockResolvedValue(observation({ groundingScore: 0.85, latencyMs: 200, costUnits: 2 })),
      },
      policy,
    });
    expect(report.results[0]?.failures).toEqual(
      expect.arrayContaining(['grounding-regression', 'latency-regression', 'cost-regression']),
    );
  });
  it('rejects duplicate scenarios', async () => {
    await expect(
      runDigitalTwinSuite({
        scenarios: [scenario, scenario],
        baseline: { simulate: vi.fn().mockResolvedValue(observation()) },
        candidate: { simulate: vi.fn().mockResolvedValue(observation()) },
        policy,
      }),
    ).rejects.toThrow('digital-twin-scenario-duplicate');
  });
});
