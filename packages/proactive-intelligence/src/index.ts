/**
 * @qf-jarvis/proactive-intelligence
 *
 * Pure operating intelligence for Jarvis.
 *
 * This package can rank attention, detect bounded anomalies, assess efficiency,
 * recommend a certified recovery posture and describe continuous-evaluation health.
 * It can NEVER authorize, execute, send, mutate Core truth, or enable a rollout.
 */

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

function nonNegativeInt(value: number, max = 1_000_000_000): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export const PROACTIVE_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type ProactivePriority = (typeof PROACTIVE_PRIORITIES)[number];

export const PROACTIVE_DOMAINS = [
  'AUTHORITY',
  'CONVERSATION',
  'EXECUTION',
  'MODEL',
  'WORKER',
  'KNOWLEDGE',
  'EVALUATION',
  'EFFICIENCY',
  'ROLL_OUT',
  'CORRELATION',
] as const;
export type ProactiveDomain = (typeof PROACTIVE_DOMAINS)[number];

export interface ProactiveFinding {
  readonly id: string;
  readonly priority: ProactivePriority;
  readonly domain: ProactiveDomain;
  readonly title: string;
  readonly summary: string;
  readonly route: string;
  readonly requiresHuman: boolean;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export interface OperatingSnapshot {
  readonly liveOperationalData: boolean;
  readonly coreAvailable: boolean;
  readonly pendingApprovals: number | null;
  readonly humanTakeovers: number | null;
  readonly pausedAi: number | null;
  readonly failedExecutions24h: number | null;
  readonly uncertainExecutions24h: number | null;
  readonly degradedWorkers: number | null;
  readonly unavailableWorkers: boolean;
  readonly degradedModels: number | null;
  readonly unavailableModels: boolean;
  readonly degradedEvaluations: number | null;
  readonly unavailableEvaluations: boolean;
  readonly staleKnowledgeNamespaces: number | null;
  readonly unavailableKnowledge: boolean;
  readonly correlationCoverage: number | null;
  readonly rolloutEnabled: boolean;
}

export interface NowBrief {
  readonly posture: 'CRITICAL' | 'ATTENTION' | 'STABLE' | 'OBSERVABILITY_GAP';
  readonly headline: string;
  readonly findings: readonly ProactiveFinding[];
  readonly counts: Readonly<Record<ProactivePriority, number>>;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

function finding(
  id: string,
  priority: ProactivePriority,
  domain: ProactiveDomain,
  title: string,
  summary: string,
  route: string,
  requiresHuman: boolean,
): ProactiveFinding {
  if (!REF.test(id) || !route.startsWith('/') || title.length === 0 || summary.length === 0) {
    throw new TypeError('proactive-finding-invalid');
  }
  return Object.freeze({
    id,
    priority,
    domain,
    title,
    summary,
    route,
    requiresHuman,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

function validateSnapshot(input: OperatingSnapshot): void {
  for (const value of [
    input.pendingApprovals,
    input.humanTakeovers,
    input.pausedAi,
    input.failedExecutions24h,
    input.uncertainExecutions24h,
    input.degradedWorkers,
    input.degradedModels,
    input.degradedEvaluations,
    input.staleKnowledgeNamespaces,
  ]) {
    if (value !== null && !nonNegativeInt(value, 10_000_000)) {
      throw new TypeError('proactive-operating-snapshot-invalid');
    }
  }
  if (input.correlationCoverage !== null && !unit(input.correlationCoverage)) {
    throw new TypeError('proactive-operating-snapshot-invalid');
  }
  if (input.rolloutEnabled) {
    throw new TypeError('proactive-operating-snapshot-invalid');
  }
}

const PRIORITY_ORDER: Readonly<Record<ProactivePriority, number>> = Object.freeze({
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
});

export function buildNowBrief(input: OperatingSnapshot): NowBrief {
  validateSnapshot(input);
  const findings: ProactiveFinding[] = [];

  if (!input.coreAvailable) {
    findings.push(
      finding(
        'core-authority-unavailable',
        'P0',
        'AUTHORITY',
        'QuickFurno Core authority is unavailable',
        'Business truth and authorization cannot be verified. Jarvis must fail closed on authority-dependent work.',
        '/core-sync',
        true,
      ),
    );
  }

  if ((input.uncertainExecutions24h ?? 0) > 0) {
    findings.push(
      finding(
        'execution-uncertain',
        'P0',
        'EXECUTION',
        'Execution outcome is uncertain',
        String(input.uncertainExecutions24h) +
          ' execution outcome(s) are uncertain in the bounded 24-hour observation window.',
        '/execution',
        true,
      ),
    );
  }

  if ((input.failedExecutions24h ?? 0) > 0) {
    findings.push(
      finding(
        'execution-failed',
        'P1',
        'EXECUTION',
        'Execution failures need review',
        String(input.failedExecutions24h) +
          ' failed execution(s) are visible in the bounded 24-hour observation window.',
        '/execution',
        true,
      ),
    );
  }

  if ((input.pendingApprovals ?? 0) > 0) {
    const count = input.pendingApprovals ?? 0;
    findings.push(
      finding(
        'operator-approvals-pending',
        count >= 10 ? 'P1' : 'P2',
        'AUTHORITY',
        'Operator decisions are waiting',
        String(count) + ' approval request(s) are awaiting an operator decision.',
        '/approvals',
        true,
      ),
    );
  }

  if ((input.humanTakeovers ?? 0) > 0) {
    findings.push(
      finding(
        'human-takeovers-active',
        'P1',
        'CONVERSATION',
        'Human takeovers are active',
        String(input.humanTakeovers) + ' conversation(s) are currently held by a human operator.',
        '/operations',
        true,
      ),
    );
  }

  if ((input.pausedAi ?? 0) > 0) {
    findings.push(
      finding(
        'ai-paused-active',
        'P2',
        'CONVERSATION',
        'AI automation is paused',
        String(input.pausedAi) + ' controlled conversation(s) currently have AI paused.',
        '/operations',
        true,
      ),
    );
  }

  if (input.unavailableWorkers) {
    findings.push(
      finding(
        'worker-telemetry-unavailable',
        'P1',
        'WORKER',
        'Worker health cannot be proven',
        'The governed observation boundary is not currently providing worker telemetry.',
        '/workers',
        false,
      ),
    );
  } else if ((input.degradedWorkers ?? 0) > 0) {
    findings.push(
      finding(
        'workers-degraded',
        'P1',
        'WORKER',
        'Worker capacity is degraded',
        String(input.degradedWorkers) + ' observed worker(s) report a degraded state.',
        '/workers',
        false,
      ),
    );
  }

  if (input.unavailableModels) {
    findings.push(
      finding(
        'model-telemetry-unavailable',
        'P1',
        'MODEL',
        'Model health cannot be proven',
        'The model-gateway observation is unavailable, so provider health and fallback readiness are unknown.',
        '/models',
        false,
      ),
    );
  } else if ((input.degradedModels ?? 0) > 0) {
    findings.push(
      finding(
        'models-degraded',
        'P1',
        'MODEL',
        'Model gateway is degraded',
        String(input.degradedModels) + ' observed model/provider profile(s) report degradation.',
        '/models',
        false,
      ),
    );
  }

  if (input.unavailableKnowledge) {
    findings.push(
      finding(
        'knowledge-unavailable',
        'P2',
        'KNOWLEDGE',
        'Grounding state cannot be proven',
        'Governed knowledge telemetry is unavailable. Jarvis should not assume retrieval freshness.',
        '/knowledge',
        false,
      ),
    );
  } else if ((input.staleKnowledgeNamespaces ?? 0) > 0) {
    findings.push(
      finding(
        'knowledge-stale',
        'P2',
        'KNOWLEDGE',
        'Knowledge freshness needs attention',
        String(input.staleKnowledgeNamespaces) + ' knowledge namespace(s) are stale or degraded.',
        '/knowledge',
        false,
      ),
    );
  }

  if (input.unavailableEvaluations) {
    findings.push(
      finding(
        'evaluation-evidence-unavailable',
        'P2',
        'EVALUATION',
        'Continuous quality evidence is unavailable',
        'Jarvis cannot prove current evaluation health from the operating snapshot.',
        '/evaluations',
        false,
      ),
    );
  } else if ((input.degradedEvaluations ?? 0) > 0) {
    findings.push(
      finding(
        'evaluations-degraded',
        'P1',
        'EVALUATION',
        'Quality or safety evidence is degraded',
        String(input.degradedEvaluations) + ' observed evaluation dimension(s) are degraded.',
        '/evaluations',
        true,
      ),
    );
  }

  if (input.correlationCoverage === null) {
    findings.push(
      finding(
        'correlation-coverage-unavailable',
        'P2',
        'CORRELATION',
        'End-to-end decision correlation is incomplete',
        'Per-event correlation coverage is not yet available to the operator plane, so exact decision replay remains partial.',
        '/operations',
        false,
      ),
    );
  } else if (input.correlationCoverage < 0.95) {
    findings.push(
      finding(
        'correlation-coverage-low',
        input.correlationCoverage < 0.8 ? 'P1' : 'P2',
        'CORRELATION',
        'Decision trace coverage is below target',
        'Only ' +
          String(Math.round(input.correlationCoverage * 100)) +
          '% of observed chains carry complete correlation evidence.',
        '/operations',
        false,
      ),
    );
  }

  if (!input.liveOperationalData) {
    findings.push(
      finding(
        'live-observation-incomplete',
        'P2',
        'AUTHORITY',
        'Runtime observation is incomplete',
        'Jarvis OS is relying partly or wholly on governed repository declarations rather than request-time operational evidence.',
        '/',
        false,
      ),
    );
  }

  const sorted = Object.freeze(
    findings.sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id.localeCompare(b.id),
    ),
  );
  const counts: Record<ProactivePriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const entry of sorted) counts[entry.priority] += 1;

  const posture =
    counts.P0 > 0
      ? ('CRITICAL' as const)
      : counts.P1 > 0
        ? ('ATTENTION' as const)
        : !input.liveOperationalData
          ? ('OBSERVABILITY_GAP' as const)
          : ('STABLE' as const);

  const headline =
    posture === 'CRITICAL'
      ? 'Critical operating attention is required.'
      : posture === 'ATTENTION'
        ? 'Jarvis found operating conditions that need attention.'
        : posture === 'OBSERVABILITY_GAP'
          ? 'No critical condition is proven, but observability is incomplete.'
          : 'No high-priority operating condition is visible in the current snapshot.';

  return Object.freeze({
    posture,
    headline,
    findings: sorted,
    counts: Object.freeze({ ...counts }),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export interface RelativeMetricObservation {
  readonly metricRef: string;
  readonly current: number;
  readonly baseline: number;
  readonly minimumMeaningfulDelta: number;
  readonly direction: 'HIGH_IS_BAD' | 'LOW_IS_BAD' | 'BOTH';
}

export type RelativeMetricAnomaly =
  | {
      readonly anomaly: true;
      readonly metricRef: string;
      readonly relativeDelta: number;
      readonly direction: 'HIGH' | 'LOW';
      readonly severity: 'WARNING' | 'CRITICAL';
      readonly executionAuthority: 'NONE';
    }
  | { readonly anomaly: false; readonly metricRef: string };

export function detectRelativeMetricAnomaly(
  input: RelativeMetricObservation,
): RelativeMetricAnomaly {
  if (
    !REF.test(input.metricRef) ||
    !Number.isFinite(input.current) ||
    !Number.isFinite(input.baseline) ||
    !Number.isFinite(input.minimumMeaningfulDelta) ||
    input.minimumMeaningfulDelta < 0 ||
    input.minimumMeaningfulDelta > 10 ||
    input.baseline === 0
  ) {
    throw new TypeError('relative-metric-observation-invalid');
  }
  const relativeDelta = (input.current - input.baseline) / Math.abs(input.baseline);
  const high = relativeDelta >= input.minimumMeaningfulDelta;
  const low = relativeDelta <= -input.minimumMeaningfulDelta;
  const directionAllowed =
    (high && (input.direction === 'HIGH_IS_BAD' || input.direction === 'BOTH')) ||
    (low && (input.direction === 'LOW_IS_BAD' || input.direction === 'BOTH'));

  if (!directionAllowed) {
    return Object.freeze({ anomaly: false as const, metricRef: input.metricRef });
  }
  return Object.freeze({
    anomaly: true as const,
    metricRef: input.metricRef,
    relativeDelta,
    direction: high ? ('HIGH' as const) : ('LOW' as const),
    severity: Math.abs(relativeDelta) >= input.minimumMeaningfulDelta * 2 ? 'CRITICAL' : 'WARNING',
    executionAuthority: 'NONE' as const,
  });
}

export interface EfficiencyInput {
  readonly requests: number;
  readonly modelCalls: number;
  readonly semanticCacheHits: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMinorUnits: number;
  readonly latencyP95Ms: number;
}

export interface EfficiencyAssessment {
  readonly cacheHitRate: number;
  readonly modelCallsPerRequest: number;
  readonly tokensPerRequest: number;
  readonly estimatedCostMinorUnitsPerRequest: number;
  readonly latencyP95Ms: number;
  readonly posture: 'EFFICIENT' | 'REVIEW' | 'INSUFFICIENT_DATA';
}

export function assessEfficiency(input: EfficiencyInput): EfficiencyAssessment {
  for (const value of [
    input.requests,
    input.modelCalls,
    input.semanticCacheHits,
    input.inputTokens,
    input.outputTokens,
    input.estimatedCostMinorUnits,
    input.latencyP95Ms,
  ]) {
    if (!nonNegativeInt(value)) throw new TypeError('efficiency-input-invalid');
  }
  if (input.semanticCacheHits > input.requests) throw new TypeError('efficiency-input-invalid');

  if (input.requests === 0) {
    return Object.freeze({
      cacheHitRate: 0,
      modelCallsPerRequest: 0,
      tokensPerRequest: 0,
      estimatedCostMinorUnitsPerRequest: 0,
      latencyP95Ms: input.latencyP95Ms,
      posture: 'INSUFFICIENT_DATA' as const,
    });
  }

  const cacheHitRate = input.semanticCacheHits / input.requests;
  const modelCallsPerRequest = input.modelCalls / input.requests;
  const tokensPerRequest = (input.inputTokens + input.outputTokens) / input.requests;
  const estimatedCostMinorUnitsPerRequest = input.estimatedCostMinorUnits / input.requests;
  const posture =
    modelCallsPerRequest <= 1.2 && input.latencyP95Ms <= 3_000
      ? ('EFFICIENT' as const)
      : ('REVIEW' as const);

  return Object.freeze({
    cacheHitRate,
    modelCallsPerRequest,
    tokensPerRequest,
    estimatedCostMinorUnitsPerRequest,
    latencyP95Ms: input.latencyP95Ms,
    posture,
  });
}

export interface RecoveryInput {
  readonly primaryHealthy: boolean;
  readonly certifiedFallbackReady: boolean;
  readonly retrySafe: boolean;
  readonly retryBudgetRemaining: number;
  readonly authorityDependent: boolean;
  readonly coreAvailable: boolean;
}

export type RecoveryRecommendation =
  | {
      readonly recommendation: 'CONTINUE_PRIMARY' | 'USE_CERTIFIED_FALLBACK' | 'RETRY_PRIMARY';
      readonly executionAuthorized: false;
      readonly requiresHuman: false;
    }
  | {
      readonly recommendation: 'FAIL_CLOSED' | 'HUMAN_REVIEW';
      readonly executionAuthorized: false;
      readonly requiresHuman: boolean;
    };

export function recommendRecovery(input: RecoveryInput): RecoveryRecommendation {
  if (!nonNegativeInt(input.retryBudgetRemaining, 100)) {
    throw new TypeError('recovery-input-invalid');
  }
  if (input.authorityDependent && !input.coreAvailable) {
    return Object.freeze({
      recommendation: 'FAIL_CLOSED' as const,
      executionAuthorized: false as const,
      requiresHuman: true as const,
    });
  }
  if (input.primaryHealthy) {
    return Object.freeze({
      recommendation: 'CONTINUE_PRIMARY' as const,
      executionAuthorized: false as const,
      requiresHuman: false as const,
    });
  }
  if (input.certifiedFallbackReady) {
    return Object.freeze({
      recommendation: 'USE_CERTIFIED_FALLBACK' as const,
      executionAuthorized: false as const,
      requiresHuman: false as const,
    });
  }
  if (input.retrySafe && input.retryBudgetRemaining > 0) {
    return Object.freeze({
      recommendation: 'RETRY_PRIMARY' as const,
      executionAuthorized: false as const,
      requiresHuman: false as const,
    });
  }
  return Object.freeze({
    recommendation: 'HUMAN_REVIEW' as const,
    executionAuthorized: false as const,
    requiresHuman: true as const,
  });
}

export interface ContinuousEvaluationInput {
  readonly sampleCount: number;
  readonly passCount: number;
  readonly criticalRegressionCount: number;
  readonly evidenceFresh: boolean;
  readonly minimumSamples: number;
  readonly minimumPassRate: number;
}

export interface ContinuousEvaluationPosture {
  readonly posture: 'EVIDENCE_HEALTHY' | 'HOLD' | 'INSUFFICIENT_EVIDENCE';
  readonly passRate: number | null;
  readonly productionApproval: false;
  readonly reason:
    | 'HEALTHY_SAMPLE'
    | 'CRITICAL_REGRESSION'
    | 'PASS_RATE_BELOW_THRESHOLD'
    | 'EVIDENCE_STALE'
    | 'INSUFFICIENT_SAMPLE';
}

export function evaluateContinuousQuality(
  input: ContinuousEvaluationInput,
): ContinuousEvaluationPosture {
  if (
    !nonNegativeInt(input.sampleCount, 1_000_000) ||
    !nonNegativeInt(input.passCount, 1_000_000) ||
    input.passCount > input.sampleCount ||
    !nonNegativeInt(input.criticalRegressionCount, 1_000_000) ||
    !nonNegativeInt(input.minimumSamples, 1_000_000) ||
    input.minimumSamples < 1 ||
    !unit(input.minimumPassRate)
  ) {
    throw new TypeError('continuous-evaluation-input-invalid');
  }
  if (!input.evidenceFresh) {
    return Object.freeze({
      posture: 'HOLD' as const,
      passRate: input.sampleCount === 0 ? null : input.passCount / input.sampleCount,
      productionApproval: false as const,
      reason: 'EVIDENCE_STALE' as const,
    });
  }
  if (input.sampleCount < input.minimumSamples) {
    return Object.freeze({
      posture: 'INSUFFICIENT_EVIDENCE' as const,
      passRate: input.sampleCount === 0 ? null : input.passCount / input.sampleCount,
      productionApproval: false as const,
      reason: 'INSUFFICIENT_SAMPLE' as const,
    });
  }
  const passRate = input.passCount / input.sampleCount;
  if (input.criticalRegressionCount > 0) {
    return Object.freeze({
      posture: 'HOLD' as const,
      passRate,
      productionApproval: false as const,
      reason: 'CRITICAL_REGRESSION' as const,
    });
  }
  if (passRate < input.minimumPassRate) {
    return Object.freeze({
      posture: 'HOLD' as const,
      passRate,
      productionApproval: false as const,
      reason: 'PASS_RATE_BELOW_THRESHOLD' as const,
    });
  }
  return Object.freeze({
    posture: 'EVIDENCE_HEALTHY' as const,
    passRate,
    productionApproval: false as const,
    reason: 'HEALTHY_SAMPLE' as const,
  });
}

export const RUNTIME_CAPABILITY_STATES = [
  'AVAILABLE',
  'DEGRADED',
  'SHADOW',
  'PLANNED',
  'DISABLED',
  'NOT_CONNECTED',
  'ROLLOUT_OFF',
] as const;
export type RuntimeCapabilityState = (typeof RUNTIME_CAPABILITY_STATES)[number];

export interface RuntimeCapabilityEvidence {
  readonly declaration: Exclude<RuntimeCapabilityState, 'DEGRADED'>;
  readonly observation: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_OBSERVED' | 'NOT_APPLICABLE';
  readonly command: 'AVAILABLE' | 'LOCKED' | 'NOT_CONNECTED' | 'NOT_APPLICABLE';
  readonly rolloutEnabled: boolean;
}

export interface RuntimeCapabilityTruth {
  readonly state: RuntimeCapabilityState;
  readonly source: 'RUNTIME_OBSERVATION' | 'COMMAND_AUTHORITY' | 'GOVERNED_DECLARATION';
  readonly executionAuthority: 'NONE';
}

export function resolveRuntimeCapability(input: RuntimeCapabilityEvidence): RuntimeCapabilityTruth {
  if (input.rolloutEnabled) throw new TypeError('runtime-capability-evidence-invalid');

  if (input.declaration === 'ROLLOUT_OFF') {
    return Object.freeze({
      state: 'ROLLOUT_OFF' as const,
      source: 'GOVERNED_DECLARATION' as const,
      executionAuthority: 'NONE' as const,
    });
  }

  if (input.command !== 'NOT_APPLICABLE') {
    if (input.command === 'AVAILABLE') {
      return Object.freeze({
        state: 'AVAILABLE' as const,
        source: 'COMMAND_AUTHORITY' as const,
        executionAuthority: 'NONE' as const,
      });
    }
    if (input.command === 'LOCKED') {
      return Object.freeze({
        state: input.declaration === 'PLANNED' ? ('PLANNED' as const) : ('DISABLED' as const),
        source: 'COMMAND_AUTHORITY' as const,
        executionAuthority: 'NONE' as const,
      });
    }
    return Object.freeze({
      state: 'NOT_CONNECTED' as const,
      source: 'COMMAND_AUTHORITY' as const,
      executionAuthority: 'NONE' as const,
    });
  }

  if (input.observation === 'HEALTHY') {
    return Object.freeze({
      state: 'AVAILABLE' as const,
      source: 'RUNTIME_OBSERVATION' as const,
      executionAuthority: 'NONE' as const,
    });
  }
  if (input.observation === 'DEGRADED') {
    return Object.freeze({
      state: 'DEGRADED' as const,
      source: 'RUNTIME_OBSERVATION' as const,
      executionAuthority: 'NONE' as const,
    });
  }
  if (input.observation === 'UNAVAILABLE') {
    return Object.freeze({
      state: 'NOT_CONNECTED' as const,
      source: 'RUNTIME_OBSERVATION' as const,
      executionAuthority: 'NONE' as const,
    });
  }

  return Object.freeze({
    state: input.declaration,
    source: 'GOVERNED_DECLARATION' as const,
    executionAuthority: 'NONE' as const,
  });
}

export const OPERATOR_INTELLIGENCE_TOPICS = [
  'ATTENTION',
  'AGENT',
  'MODEL',
  'KNOWLEDGE',
  'EXECUTION',
  'CORE',
  'WORKERS',
  'EVALUATIONS',
  'CAPABILITIES',
  'MEMORY',
  'SIMULATION',
  'RELEASE',
  'EFFICIENCY',
  'SYSTEM',
] as const;
export type OperatorIntelligenceTopic = (typeof OPERATOR_INTELLIGENCE_TOPICS)[number];

export interface OperatorAgentState {
  readonly id: 'jarvis' | 'riya' | 'anisha' | 'aarohi';
  readonly label: string;
  readonly state: string;
  readonly lifecycle: string;
  readonly facts: readonly string[];
  readonly route: string;
}

export interface OperatorSystemState {
  readonly id: string;
  readonly label: string;
  readonly state: string;
  readonly detail: string;
  readonly route: string;
}

export interface OperatorCapabilityState {
  readonly id: string;
  readonly label: string;
  readonly state: string;
  readonly source: string;
  readonly route: string;
}

export interface OperatorIntelligenceContext {
  readonly now: NowBrief;
  readonly agents: readonly OperatorAgentState[];
  readonly systems: readonly OperatorSystemState[];
  readonly capabilities: readonly OperatorCapabilityState[];
}

export interface OperatorIntelligenceAnswer {
  readonly topic: OperatorIntelligenceTopic;
  readonly headline: string;
  readonly summary: string;
  readonly facts: readonly string[];
  readonly routes: readonly string[];
  readonly confidence: 'DETERMINISTIC';
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

const MAX_OPERATOR_QUERY_CHARS = 500;
const MAX_OPERATOR_FACT_CHARS = 320;
const MAX_OPERATOR_FACTS = 8;

function queryTokens(value: string): readonly string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function hasAny(tokens: readonly string[], candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.includes(candidate));
}

function classifyOperatorQuestion(tokens: readonly string[]): OperatorIntelligenceTopic {
  if (hasAny(tokens, ['riya', 'anisha', 'aarohi', 'jarvis', 'agent'])) return 'AGENT';
  if (hasAny(tokens, ['memory', 'remember', 'retention', 'erasure'])) return 'MEMORY';
  if (hasAny(tokens, ['simulation', 'simulate', 'twin', 'replay', 'rehearsal']))
    return 'SIMULATION';
  if (
    hasAny(tokens, [
      'release',
      'deploy',
      'deployment',
      'promotion',
      'sha',
      'certified',
      'certification',
    ])
  )
    return 'RELEASE';
  if (
    hasAny(tokens, [
      'cost',
      'costs',
      'token',
      'tokens',
      'cache',
      'efficiency',
      'efficient',
      'savings',
    ])
  )
    return 'EFFICIENCY';
  if (
    hasAny(tokens, [
      'model',
      'models',
      'provider',
      'providers',
      'latency',
      'fallback',
      'circuit',
      'routing',
    ])
  )
    return 'MODEL';
  if (
    hasAny(tokens, [
      'knowledge',
      'rag',
      'retrieval',
      'grounding',
      'freshness',
      'context',
      'contexts',
    ])
  ) {
    return 'KNOWLEDGE';
  }
  if (
    hasAny(tokens, [
      'execution',
      'executions',
      'failed',
      'failure',
      'failures',
      'uncertain',
      'dispatch',
      'automation',
    ])
  ) {
    return 'EXECUTION';
  }
  if (hasAny(tokens, ['core', 'authority', 'truth', 'sync', 'authorities'])) return 'CORE';
  if (hasAny(tokens, ['worker', 'workers', 'gpu', 'capacity', 'node'])) return 'WORKERS';
  if (hasAny(tokens, ['evaluation', 'evaluations', 'quality', 'safety', 'regression'])) {
    return 'EVALUATIONS';
  }
  if (
    hasAny(tokens, ['capability', 'capabilities', 'rollout', 'available', 'enabled', 'governance'])
  ) {
    return 'CAPABILITIES';
  }
  if (
    hasAny(tokens, ['attention', 'urgent', 'priority', 'need', 'wrong', 'problem', 'issue', 'now'])
  ) {
    return 'ATTENTION';
  }
  return 'SYSTEM';
}

function boundedFacts(values: readonly string[]): readonly string[] {
  return Object.freeze(
    values
      .filter((value) => typeof value === 'string' && value.length > 0)
      .map((value) => value.slice(0, MAX_OPERATOR_FACT_CHARS))
      .slice(0, MAX_OPERATOR_FACTS),
  );
}

function uniqueRoutes(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [
      ...new Set(values.filter((value) => typeof value === 'string' && value.startsWith('/'))),
    ].slice(0, 6),
  );
}

function operatorAnswer(
  topic: OperatorIntelligenceTopic,
  headline: string,
  summary: string,
  facts: readonly string[],
  routes: readonly string[],
): OperatorIntelligenceAnswer {
  return Object.freeze({
    topic,
    headline: headline.slice(0, 180),
    summary: summary.slice(0, 500),
    facts: boundedFacts(facts),
    routes: uniqueRoutes(routes),
    confidence: 'DETERMINISTIC' as const,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

function namedAgent(
  tokens: readonly string[],
  context: OperatorIntelligenceContext,
): OperatorAgentState | undefined {
  return context.agents.find((agent) => tokens.includes(agent.id));
}

function systemsByNeed(
  context: OperatorIntelligenceContext,
  ids: readonly string[],
): readonly OperatorSystemState[] {
  return context.systems.filter((entry) => ids.includes(entry.id));
}

export function answerOperatorQuestion(
  query: string,
  context: OperatorIntelligenceContext,
): OperatorIntelligenceAnswer {
  if (
    typeof query !== 'string' ||
    query.trim().length === 0 ||
    query.length > MAX_OPERATOR_QUERY_CHARS
  ) {
    throw new TypeError('operator-intelligence-query-invalid');
  }
  const tokens = queryTokens(query);
  const topic = classifyOperatorQuestion(tokens);

  if (topic === 'ATTENTION') {
    return operatorAnswer(
      topic,
      context.now.headline,
      context.now.findings.length === 0
        ? 'No proactive operating finding is visible in the current governed snapshot.'
        : 'Jarvis ranked the current operating findings by severity. P0/P1 conditions should be investigated before lower-priority work.',
      context.now.findings.map((entry) => `${entry.priority} | ${entry.title} | ${entry.summary}`),
      context.now.findings.map((entry) => entry.route),
    );
  }

  if (topic === 'AGENT') {
    const agent = namedAgent(tokens, context);
    if (agent !== undefined) {
      return operatorAnswer(
        topic,
        `${agent.label} is ${agent.state.replaceAll('_', ' ').toLowerCase()}.`,
        `Lifecycle: ${agent.lifecycle}. The facts below come from the governed operator snapshot; no missing dependency is inferred healthy.`,
        agent.facts,
        [agent.route],
      );
    }
    return operatorAnswer(
      topic,
      'Agent operating posture',
      'Jarvis can compare the currently exposed state of all governed agents.',
      context.agents.map(
        (agentEntry) =>
          `${agentEntry.label}: ${agentEntry.state} | lifecycle ${agentEntry.lifecycle}`,
      ),
      context.agents.map((agentEntry) => agentEntry.route),
    );
  }

  const capabilityTopic: Partial<
    Readonly<
      Record<OperatorIntelligenceTopic, { readonly ids: readonly string[]; readonly route: string }>
    >
  > = {
    MEMORY: { ids: ['memory.governed'], route: '/memory' },
    SIMULATION: { ids: ['simulation.digital-twin'], route: '/simulation' },
    RELEASE: {
      ids: [
        'release.certification',
        'evaluation.continuous',
        'simulation.digital-twin',
        'recovery.certified-fallback',
      ],
      route: '/release',
    },
    EFFICIENCY: {
      ids: ['context.semantic-cache', 'recovery.certified-fallback'],
      route: '/analytics',
    },
  };
  const capabilitySelection = capabilityTopic[topic];
  if (capabilitySelection !== undefined) {
    const matches = context.capabilities.filter((entry) =>
      capabilitySelection.ids.includes(entry.id),
    );
    const unavailable = matches.filter(
      (entry) => !['AVAILABLE', 'HEALTHY', 'CONNECTED'].includes(entry.state),
    );
    return operatorAnswer(
      topic,
      matches.length === 0
        ? `${topic.toLowerCase()} evidence is not exposed.`
        : unavailable.length === 0
          ? `${topic.toLowerCase()} capability posture is available.`
          : `${topic.toLowerCase()} capability posture is constrained.`,
      matches.length === 0
        ? 'The current operator context contains no matching capability evidence, so Jarvis will not infer availability.'
        : unavailable.length === 0
          ? 'Every matching capability currently reports an available state.'
          : `${String(unavailable.length)} matching capability state(s) are not currently available.`,
      matches.map(
        (entry) => `${entry.label}: ${entry.state} | evidence ${entry.source.replaceAll('_', ' ')}`,
      ),
      [capabilitySelection.route, ...matches.map((entry) => entry.route)],
    );
  }

  const topicSystems: Readonly<
    Record<
      Exclude<
        OperatorIntelligenceTopic,
        | 'ATTENTION'
        | 'AGENT'
        | 'CAPABILITIES'
        | 'MEMORY'
        | 'SIMULATION'
        | 'RELEASE'
        | 'EFFICIENCY'
        | 'SYSTEM'
      >,
      readonly string[]
    >
  > = {
    MODEL: ['model-gateway'],
    KNOWLEDGE: ['knowledge-index', 'knowledge-freshness', 'rag'],
    EXECUTION: ['quickfurno-core-automation', 'execution-dispatch'],
    CORE: ['quickfurno-core'],
    WORKERS: ['worker-fleet', 'worker'],
    EVALUATIONS: ['evaluation', 'evaluations'],
  };

  if (topic === 'CAPABILITIES') {
    const nonAvailable = context.capabilities.filter(
      (entry) =>
        entry.state !== 'AVAILABLE' && entry.state !== 'HEALTHY' && entry.state !== 'CONNECTED',
    );
    return operatorAnswer(
      topic,
      nonAvailable.length === 0
        ? 'All exposed capabilities are currently available.'
        : `${String(nonAvailable.length)} capability state(s) are not currently available.`,
      'Effective runtime state takes precedence over stale declarations where live observation or command authority exists.',
      nonAvailable.length === 0
        ? context.capabilities.map((entry) => `${entry.label}: ${entry.state}`)
        : nonAvailable.map(
            (entry) =>
              `${entry.label}: ${entry.state} | evidence ${entry.source.replaceAll('_', ' ')}`,
          ),
      ['/governance'],
    );
  }

  if (topic === 'SYSTEM') {
    const unhealthy = context.systems.filter(
      (entry) => !['AVAILABLE', 'CONNECTED', 'HEALTHY'].includes(entry.state),
    );
    return operatorAnswer(
      topic,
      unhealthy.length === 0
        ? 'No degraded system component is visible.'
        : 'System attention is visible.',
      unhealthy.length === 0
        ? 'The currently exposed system components report an available/healthy/connected state.'
        : `${String(unhealthy.length)} component(s) are not reporting a healthy/available state.`,
      unhealthy.map((entry) => `${entry.label}: ${entry.state} | ${entry.detail}`),
      unhealthy.map((entry) => entry.route),
    );
  }

  const systemTopic = Object.prototype.hasOwnProperty.call(topicSystems, topic)
    ? (topic as keyof typeof topicSystems)
    : undefined;
  if (systemTopic === undefined) {
    return operatorAnswer(
      topic,
      'Requested operating evidence is not exposed.',
      'Jarvis will not invent an answer for a topic whose governed evidence mapping is unavailable.',
      [],
      ['/intelligence'],
    );
  }

  const systems = systemsByNeed(context, topicSystems[systemTopic]);
  const matching =
    systems.length > 0
      ? systems
      : context.systems.filter((entry) => {
          const haystack = `${entry.id} ${entry.label}`.toLowerCase();
          return tokens.some((token) => haystack.includes(token));
        });

  const defaultRoute: Readonly<Record<keyof typeof topicSystems, string>> = {
    MODEL: '/models',
    KNOWLEDGE: '/knowledge',
    EXECUTION: '/execution',
    CORE: '/core-sync',
    WORKERS: '/workers',
    EVALUATIONS: '/evaluations',
  };
  if (matching.length === 0) {
    return operatorAnswer(
      topic,
      `${topic.toLowerCase().replaceAll('_', ' ')} evidence is not fully exposed.`,
      'Jarvis will not invent a healthy state when the requested operating evidence is absent.',
      ['The current operator snapshot does not expose a matching system component.'],
      [defaultRoute[systemTopic]],
    );
  }
  const unhealthy = matching.filter(
    (entry) => !['AVAILABLE', 'CONNECTED', 'HEALTHY'].includes(entry.state),
  );
  return operatorAnswer(
    topic,
    unhealthy.length === 0
      ? `${topic.toLowerCase().replaceAll('_', ' ')} posture is healthy in the current snapshot.`
      : `${topic.toLowerCase().replaceAll('_', ' ')} needs attention.`,
    unhealthy.length === 0
      ? 'Every matching component currently reports an available/connected/healthy state.'
      : `${String(unhealthy.length)} matching component(s) report a degraded, offline or unavailable state.`,
    matching.map((entry) => `${entry.label}: ${entry.state} | ${entry.detail}`),
    [...matching.map((entry) => entry.route), defaultRoute[systemTopic]],
  );
}
