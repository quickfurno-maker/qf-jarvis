import { describe, expect, it } from 'vitest';

import {
  answerOperatorQuestion,
  assessEfficiency,
  buildNowBrief,
  detectRelativeMetricAnomaly,
  evaluateContinuousQuality,
  recommendRecovery,
  resolveRuntimeCapability,
} from '../index.js';

describe('proactive operating intelligence', () => {
  it('puts uncertain execution and Core unavailability ahead of lesser attention', () => {
    const brief = buildNowBrief({
      liveOperationalData: true,
      coreAvailable: false,
      pendingApprovals: 3,
      humanTakeovers: 1,
      pausedAi: 2,
      failedExecutions24h: 4,
      uncertainExecutions24h: 1,
      degradedWorkers: 0,
      unavailableWorkers: false,
      degradedModels: 0,
      unavailableModels: false,
      degradedEvaluations: 0,
      unavailableEvaluations: false,
      staleKnowledgeNamespaces: 0,
      unavailableKnowledge: false,
      correlationCoverage: 0.99,
      rolloutEnabled: false,
    });

    expect(brief.posture).toBe('CRITICAL');
    expect(brief.findings[0]?.priority).toBe('P0');
    expect(brief.findings.some((entry) => entry.id === 'core-authority-unavailable')).toBe(true);
    expect(brief.findings.some((entry) => entry.id === 'execution-uncertain')).toBe(true);
    expect(brief.executionAuthority).toBe('NONE');
    expect(brief.businessEffect).toBe(false);
  });

  it('calls missing observability a gap rather than healthy', () => {
    const brief = buildNowBrief({
      liveOperationalData: false,
      coreAvailable: true,
      pendingApprovals: null,
      humanTakeovers: null,
      pausedAi: null,
      failedExecutions24h: null,
      uncertainExecutions24h: null,
      degradedWorkers: null,
      unavailableWorkers: false,
      degradedModels: null,
      unavailableModels: false,
      degradedEvaluations: null,
      unavailableEvaluations: false,
      staleKnowledgeNamespaces: null,
      unavailableKnowledge: false,
      correlationCoverage: null,
      rolloutEnabled: false,
    });

    expect(brief.posture).toBe('OBSERVABILITY_GAP');
    expect(brief.findings.some((entry) => entry.id === 'live-observation-incomplete')).toBe(true);
    expect(brief.findings.some((entry) => entry.id === 'correlation-coverage-unavailable')).toBe(
      true,
    );
  });

  it('detects bounded directional anomalies without taking action', () => {
    expect(
      detectRelativeMetricAnomaly({
        metricRef: 'model.latency.p95',
        current: 1800,
        baseline: 1000,
        minimumMeaningfulDelta: 0.3,
        direction: 'HIGH_IS_BAD',
      }),
    ).toMatchObject({
      anomaly: true,
      direction: 'HIGH',
      severity: 'CRITICAL',
      executionAuthority: 'NONE',
    });

    expect(
      detectRelativeMetricAnomaly({
        metricRef: 'cache.hit-rate',
        current: 0.81,
        baseline: 0.8,
        minimumMeaningfulDelta: 0.1,
        direction: 'LOW_IS_BAD',
      }),
    ).toEqual({ anomaly: false, metricRef: 'cache.hit-rate' });
  });

  it('summarizes cache, model-call, token, cost and latency efficiency', () => {
    expect(
      assessEfficiency({
        requests: 100,
        modelCalls: 90,
        semanticCacheHits: 20,
        inputTokens: 200_000,
        outputTokens: 50_000,
        estimatedCostMinorUnits: 1000,
        latencyP95Ms: 1400,
      }),
    ).toMatchObject({
      cacheHitRate: 0.2,
      modelCallsPerRequest: 0.9,
      tokensPerRequest: 2500,
      estimatedCostMinorUnitsPerRequest: 10,
      posture: 'EFFICIENT',
    });
  });

  it('recommends only certified/safe recovery postures and never authorizes execution', () => {
    expect(
      recommendRecovery({
        primaryHealthy: false,
        certifiedFallbackReady: true,
        retrySafe: false,
        retryBudgetRemaining: 0,
        authorityDependent: false,
        coreAvailable: true,
      }),
    ).toEqual({
      recommendation: 'USE_CERTIFIED_FALLBACK',
      executionAuthorized: false,
      requiresHuman: false,
    });

    expect(
      recommendRecovery({
        primaryHealthy: false,
        certifiedFallbackReady: true,
        retrySafe: true,
        retryBudgetRemaining: 2,
        authorityDependent: true,
        coreAvailable: false,
      }),
    ).toEqual({
      recommendation: 'FAIL_CLOSED',
      executionAuthorized: false,
      requiresHuman: true,
    });
  });

  it('treats continuous evaluation as evidence, never production approval', () => {
    expect(
      evaluateContinuousQuality({
        sampleCount: 200,
        passCount: 198,
        criticalRegressionCount: 0,
        evidenceFresh: true,
        minimumSamples: 100,
        minimumPassRate: 0.98,
      }),
    ).toEqual({
      posture: 'EVIDENCE_HEALTHY',
      passRate: 0.99,
      productionApproval: false,
      reason: 'HEALTHY_SAMPLE',
    });

    expect(
      evaluateContinuousQuality({
        sampleCount: 200,
        passCount: 199,
        criticalRegressionCount: 1,
        evidenceFresh: true,
        minimumSamples: 100,
        minimumPassRate: 0.98,
      }).posture,
    ).toBe('HOLD');
  });

  it('prefers runtime or command truth over stale declarations without changing authority', () => {
    expect(
      resolveRuntimeCapability({
        declaration: 'NOT_CONNECTED',
        observation: 'NOT_APPLICABLE',
        command: 'AVAILABLE',
        rolloutEnabled: false,
      }),
    ).toEqual({
      state: 'AVAILABLE',
      source: 'COMMAND_AUTHORITY',
      executionAuthority: 'NONE',
    });

    expect(
      resolveRuntimeCapability({
        declaration: 'SHADOW',
        observation: 'DEGRADED',
        command: 'NOT_APPLICABLE',
        rolloutEnabled: false,
      }),
    ).toEqual({
      state: 'DEGRADED',
      source: 'RUNTIME_OBSERVATION',
      executionAuthority: 'NONE',
    });
  });

  it('refuses any attempt to smuggle enabled rollout into the pure intelligence layer', () => {
    expect(() =>
      buildNowBrief({
        liveOperationalData: true,
        coreAvailable: true,
        pendingApprovals: 0,
        humanTakeovers: 0,
        pausedAi: 0,
        failedExecutions24h: 0,
        uncertainExecutions24h: 0,
        degradedWorkers: 0,
        unavailableWorkers: false,
        degradedModels: 0,
        unavailableModels: false,
        degradedEvaluations: 0,
        unavailableEvaluations: false,
        staleKnowledgeNamespaces: 0,
        unavailableKnowledge: false,
        correlationCoverage: 1,
        rolloutEnabled: true,
      }),
    ).toThrow('proactive-operating-snapshot-invalid');
  });
});

describe('read-only operator intelligence', () => {
  const now = buildNowBrief({
    liveOperationalData: true,
    coreAvailable: true,
    pendingApprovals: 2,
    humanTakeovers: 0,
    pausedAi: 0,
    failedExecutions24h: 1,
    uncertainExecutions24h: 0,
    degradedWorkers: 0,
    unavailableWorkers: false,
    degradedModels: 1,
    unavailableModels: false,
    degradedEvaluations: 0,
    unavailableEvaluations: false,
    staleKnowledgeNamespaces: 0,
    unavailableKnowledge: false,
    correlationCoverage: 1,
    rolloutEnabled: false,
  });

  const context = {
    now,
    agents: [
      {
        id: 'riya' as const,
        label: 'Riya',
        state: 'DEGRADED',
        lifecycle: 'SHADOW',
        facts: ['Model gateway: DEGRADED ? shared'],
        route: '/agents/riya',
      },
    ],
    systems: [
      {
        id: 'model-gateway',
        label: 'Model Gateway',
        state: 'DEGRADED',
        detail: 'One provider profile is degraded.',
        route: '/models',
      },
      {
        id: 'quickfurno-core',
        label: 'QuickFurno Core',
        state: 'CONNECTED',
        detail: 'Authority observation is connected.',
        route: '/core-sync',
      },
    ],
    capabilities: [
      {
        id: 'model.gateway',
        label: 'Model gateway',
        state: 'DEGRADED',
        source: 'RUNTIME_OBSERVATION',
        route: '/governance',
      },
      {
        id: 'memory.governed',
        label: 'Governed long-term memory',
        state: 'DISABLED',
        source: 'GOVERNED_DECLARATION',
        route: '/memory',
      },
      {
        id: 'simulation.digital-twin',
        label: 'Digital-twin simulation',
        state: 'AVAILABLE',
        source: 'GOVERNED_DECLARATION',
        route: '/simulation',
      },
      {
        id: 'release.certification',
        label: 'Release assurance and certification',
        state: 'AVAILABLE',
        source: 'GOVERNED_DECLARATION',
        route: '/release',
      },
      {
        id: 'evaluation.continuous',
        label: 'Continuous production evaluation',
        state: 'SHADOW',
        source: 'GOVERNED_DECLARATION',
        route: '/release',
      },
      {
        id: 'context.semantic-cache',
        label: 'Semantic cache and context compression',
        state: 'DISABLED',
        source: 'GOVERNED_DECLARATION',
        route: '/analytics',
      },
    ],
  } as const;

  it('answers what needs attention from ranked proactive findings', () => {
    const answer = answerOperatorQuestion('What needs my attention right now?', context);
    expect(answer.topic).toBe('ATTENTION');
    expect(answer.facts.some((fact) => fact.includes('Execution failures'))).toBe(true);
    expect(answer.executionAuthority).toBe('NONE');
    expect(answer.businessEffect).toBe(false);
  });

  it('answers a named-agent question from attributable facts only', () => {
    const answer = answerOperatorQuestion('Why is Riya degraded?', context);
    expect(answer.topic).toBe('AGENT');
    expect(answer.headline).toContain('Riya');
    expect(answer.facts).toEqual(['Model gateway: DEGRADED ? shared']);
    expect(answer.routes).toEqual(['/agents/riya']);
  });

  it('answers model and Core questions from governed system evidence', () => {
    expect(answerOperatorQuestion('Are models healthy?', context)).toMatchObject({
      topic: 'MODEL',
      headline: 'model needs attention.',
    });
    expect(answerOperatorQuestion('Is Core available?', context)).toMatchObject({
      topic: 'CORE',
      headline: 'core posture is healthy in the current snapshot.',
    });
  });

  it('answers memory, simulation, release and efficiency questions from capability evidence', () => {
    expect(answerOperatorQuestion('Is memory enabled?', context)).toMatchObject({
      topic: 'MEMORY',
      headline: 'memory capability posture is constrained.',
      routes: ['/memory'],
    });
    expect(answerOperatorQuestion('Is the digital twin available?', context)).toMatchObject({
      topic: 'SIMULATION',
      headline: 'simulation capability posture is available.',
      routes: ['/simulation'],
    });
    expect(answerOperatorQuestion('Is this release certified?', context)).toMatchObject({
      topic: 'RELEASE',
    });
    expect(
      answerOperatorQuestion('Where are model cost and cache savings?', context),
    ).toMatchObject({
      topic: 'EFFICIENCY',
      headline: 'efficiency capability posture is constrained.',
    });
  });

  it('rejects empty and overlong questions', () => {
    expect(() => answerOperatorQuestion('   ', context)).toThrow(
      'operator-intelligence-query-invalid',
    );
    expect(() => answerOperatorQuestion('x'.repeat(501), context)).toThrow(
      'operator-intelligence-query-invalid',
    );
  });
});
