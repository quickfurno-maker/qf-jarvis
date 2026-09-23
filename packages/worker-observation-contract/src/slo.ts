export const WORKER_SLO_OBJECTIVES = Object.freeze([
  'MODEL_P95_LATENCY',
  'KNOWLEDGE_P95_LATENCY',
  'MODEL_FAILURE_RATE',
  'MODEL_FALLBACK_RATE',
  'MODEL_AVAILABILITY',
  'OLDEST_PENDING_AGE',
  'FAILED_INDETERMINATE_RATE',
  'KNOWLEDGE_TECHNICAL_FAILURE_RATE',
] as const);

export type WorkerSloObjective = (typeof WORKER_SLO_OBJECTIVES)[number];

export interface WorkerSloPolicyInput {
  readonly policyRef: string;
  readonly minModelLatencySamples: number;
  readonly minKnowledgeLatencySamples: number;
  readonly minModelOutcomeSamples: number;
  readonly maxModelP95Ms: number;
  readonly maxKnowledgeP95Ms: number;
  readonly maxModelFailureRate: number;
  readonly maxModelFallbackRate: number;
  readonly minModelAvailability: number;
  readonly maxOldestPendingAgeMs: number;
  readonly maxFailedIndeterminateRate: number;
  readonly maxKnowledgeTechnicalFailureRate: number;
}

export interface WorkerSloPolicy extends WorkerSloPolicyInput {}

export interface WorkerSloObservationInput {
  readonly spool: {
    readonly pending: number;
    readonly oldestPendingAgeMs: number | null;
  };
  readonly modelGateway?: {
    readonly completed: number;
    readonly failed: number;
    readonly fallbackUsed: number;
  };
  readonly outcomes: {
    readonly completedNoReply: number;
    readonly completedQueued: number;
    readonly completedStale: number;
    readonly releasedPreAgent: number;
    readonly failedIndeterminate: number;
  };
  readonly modelLatency: readonly { readonly latencyMs: number }[];
  readonly knowledgeRetrieval: {
    readonly served: number;
    readonly noCandidates: number;
    readonly governanceRefused: number;
    readonly embeddingFailed: number;
    readonly storeFailed: number;
    readonly rerankerFailed: number;
    readonly otherFailed: number;
    readonly latency: readonly { readonly latencyMs: number }[];
  };
}

export interface WorkerSloEvaluation {
  readonly policyRef: string;
  readonly status: 'PASS' | 'BREACH' | 'INSUFFICIENT_DATA';
  readonly breaches: readonly WorkerSloObjective[];
  readonly insufficient: readonly WorkerSloObjective[];
  readonly measurements: {
    readonly modelP95Ms: number | null;
    readonly knowledgeP95Ms: number | null;
    readonly modelFailureRate: number | null;
    readonly modelFallbackRate: number | null;
    readonly modelAvailability: number | null;
    readonly oldestPendingAgeMs: number;
    readonly failedIndeterminateRate: number;
    readonly knowledgeTechnicalFailureRate: number;
  };
}

function validRef(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

function validRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validSampleCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10_000;
}

export function createWorkerSloPolicy(input: WorkerSloPolicyInput): WorkerSloPolicy {
  if (
    !validRef(input.policyRef) ||
    !validSampleCount(input.minModelLatencySamples) ||
    !validSampleCount(input.minKnowledgeLatencySamples) ||
    !validSampleCount(input.minModelOutcomeSamples) ||
    !validNonNegative(input.maxModelP95Ms) ||
    !validNonNegative(input.maxKnowledgeP95Ms) ||
    !validRate(input.maxModelFailureRate) ||
    !validRate(input.maxModelFallbackRate) ||
    !validRate(input.minModelAvailability) ||
    !validNonNegative(input.maxOldestPendingAgeMs) ||
    !validRate(input.maxFailedIndeterminateRate) ||
    !validRate(input.maxKnowledgeTechnicalFailureRate)
  ) {
    throw new TypeError('worker-slo-policy-invalid');
  }
  return Object.freeze({ ...input });
}

/**
 * Initial engineering SLO. This is a starting operating contract, not a claim that production has
 * already achieved these values; the runbook requires review against measured traffic before release.
 */
export const INITIAL_WORKER_SLO_POLICY_V1 = createWorkerSloPolicy({
  policyRef: 'qfj.quickfurno-worker-slo.engineering.v1',
  minModelLatencySamples: 20,
  minKnowledgeLatencySamples: 20,
  minModelOutcomeSamples: 20,
  maxModelP95Ms: 15_000,
  maxKnowledgeP95Ms: 500,
  maxModelFailureRate: 0.02,
  maxModelFallbackRate: 0,
  minModelAvailability: 0.98,
  maxOldestPendingAgeMs: 30_000,
  maxFailedIndeterminateRate: 0.01,
  maxKnowledgeTechnicalFailureRate: 0.02,
});

function p95(samples: readonly { readonly latencyMs: number }[]): number | null {
  if (samples.length === 0) return null;
  const values = samples
    .map((sample) => sample.latencyMs)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const index = Math.max(0, Math.ceil(values.length * 0.95) - 1);
  return values[Math.min(index, values.length - 1)] ?? null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

export function evaluateWorkerSlo(
  observation: WorkerSloObservationInput,
  policy: WorkerSloPolicy,
): WorkerSloEvaluation {
  const modelP95Ms = p95(observation.modelLatency);
  const knowledgeP95Ms = p95(observation.knowledgeRetrieval.latency);
  const oldestPendingAgeMs = observation.spool.oldestPendingAgeMs ?? 0;
  const modelCompleted = observation.modelGateway?.completed ?? 0;
  const modelFailed = observation.modelGateway?.failed ?? 0;
  const modelFallbackUsed = observation.modelGateway?.fallbackUsed ?? 0;
  const modelOutcomeTotal = modelCompleted + modelFailed;
  const modelFailureRate =
    observation.modelGateway === undefined || modelOutcomeTotal === 0
      ? null
      : ratio(modelFailed, modelOutcomeTotal);
  const modelFallbackRate =
    observation.modelGateway === undefined || modelCompleted === 0
      ? null
      : ratio(modelFallbackUsed, modelCompleted);
  const modelAvailability =
    observation.modelGateway === undefined || modelOutcomeTotal === 0
      ? null
      : ratio(modelCompleted, modelOutcomeTotal);

  const outcomeTotal =
    observation.outcomes.completedNoReply +
    observation.outcomes.completedQueued +
    observation.outcomes.completedStale +
    observation.outcomes.releasedPreAgent +
    observation.outcomes.failedIndeterminate;
  const failedIndeterminateRate = ratio(
    observation.outcomes.failedIndeterminate,
    outcomeTotal,
  );

  const technicalFailures =
    observation.knowledgeRetrieval.embeddingFailed +
    observation.knowledgeRetrieval.storeFailed +
    observation.knowledgeRetrieval.rerankerFailed +
    observation.knowledgeRetrieval.otherFailed;
  const retrievalTotal =
    observation.knowledgeRetrieval.served +
    observation.knowledgeRetrieval.noCandidates +
    observation.knowledgeRetrieval.governanceRefused +
    technicalFailures;
  const knowledgeTechnicalFailureRate = ratio(technicalFailures, retrievalTotal);

  const breaches: WorkerSloObjective[] = [];
  const insufficient: WorkerSloObjective[] = [];

  if (observation.modelLatency.length < policy.minModelLatencySamples || modelP95Ms === null) {
    insufficient.push('MODEL_P95_LATENCY');
  } else if (modelP95Ms > policy.maxModelP95Ms) {
    breaches.push('MODEL_P95_LATENCY');
  }

  if (
    observation.knowledgeRetrieval.latency.length < policy.minKnowledgeLatencySamples ||
    knowledgeP95Ms === null
  ) {
    insufficient.push('KNOWLEDGE_P95_LATENCY');
  } else if (knowledgeP95Ms > policy.maxKnowledgeP95Ms) {
    breaches.push('KNOWLEDGE_P95_LATENCY');
  }

  if (
    observation.modelGateway === undefined ||
    modelOutcomeTotal < policy.minModelOutcomeSamples ||
    modelFailureRate === null ||
    modelFallbackRate === null ||
    modelAvailability === null
  ) {
    insufficient.push('MODEL_FAILURE_RATE', 'MODEL_FALLBACK_RATE', 'MODEL_AVAILABILITY');
  } else {
    if (modelFailureRate > policy.maxModelFailureRate) breaches.push('MODEL_FAILURE_RATE');
    if (modelFallbackRate > policy.maxModelFallbackRate) breaches.push('MODEL_FALLBACK_RATE');
    if (modelAvailability < policy.minModelAvailability) breaches.push('MODEL_AVAILABILITY');
  }

  if (oldestPendingAgeMs > policy.maxOldestPendingAgeMs) {
    breaches.push('OLDEST_PENDING_AGE');
  }
  if (failedIndeterminateRate > policy.maxFailedIndeterminateRate) {
    breaches.push('FAILED_INDETERMINATE_RATE');
  }
  if (knowledgeTechnicalFailureRate > policy.maxKnowledgeTechnicalFailureRate) {
    breaches.push('KNOWLEDGE_TECHNICAL_FAILURE_RATE');
  }

  return Object.freeze({
    policyRef: policy.policyRef,
    status:
      breaches.length > 0
        ? ('BREACH' as const)
        : insufficient.length > 0
          ? ('INSUFFICIENT_DATA' as const)
          : ('PASS' as const),
    breaches: Object.freeze(breaches),
    insufficient: Object.freeze(insufficient),
    measurements: Object.freeze({
      modelP95Ms,
      knowledgeP95Ms,
      modelFailureRate,
      modelFallbackRate,
      modelAvailability,
      oldestPendingAgeMs,
      failedIndeterminateRate,
      knowledgeTechnicalFailureRate,
    }),
  });
}
