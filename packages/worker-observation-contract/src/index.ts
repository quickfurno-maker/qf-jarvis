import { z } from 'zod';

const canonicalInstant = z.iso.datetime({ offset: false });
const ref = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const modelRef = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/u);
const boundedCount = z.number().int().nonnegative().max(1_000_000_000);
const boundedUsage = z.number().int().nonnegative().max(1_000_000_000_000);
const latencySample = z
  .object({
    at: canonicalInstant,
    latencyMs: z.number().nonnegative().max(300_000),
  })
  .strict();

const spoolSchema = z
  .object({
    pending: boundedCount,
    processing: boundedCount,
    completed: boundedCount,
    failed: boundedCount,
    oldestPendingAgeMs: z.number().int().nonnegative().max(86_400_000).nullable(),
  })
  .strict();

const outcomesSchema = z
  .object({
    completedNoReply: boundedCount,
    completedQueued: boundedCount,
    completedStale: boundedCount,
    releasedPreAgent: boundedCount,
    failedIndeterminate: boundedCount,
  })
  .strict();

const knowledgeRetrievalSchema = z
  .object({
    served: boundedCount,
    noCandidates: boundedCount,
    governanceRefused: boundedCount,
    embeddingFailed: boundedCount,
    storeFailed: boundedCount,
    rerankerFailed: boundedCount,
    otherFailed: boundedCount,
    latency: z.array(latencySample).max(120),
  })
  .strict();

const baseShape = {
  emittedAt: canonicalInstant,
  revision: z.string().regex(/^[0-9a-f]{40}$/u),
  runtimeId: ref,
  state: z.enum(['HEALTHY', 'DEGRADED', 'DISABLED']),
  providerMode: z.literal('GROQ_ONLY'),
  knowledgeRevision: ref,
  embeddingModelRef: modelRef,
  spool: spoolSchema,
  outcomes: outcomesSchema,
  modelLatency: z.array(latencySample).max(120),
  knowledgeRetrieval: knowledgeRetrievalSchema,
} as const;

export const quickFurnoWorkerObservationV1Schema = z
  .object({
    protocol: z.literal('qfj.quickfurno-worker-observation.v1'),
    ...baseShape,
  })
  .strict();

export const quickFurnoWorkerObservationV2Schema = z
  .object({
    protocol: z.literal('qfj.quickfurno-worker-observation.v2'),
    ...baseShape,
    modelUsage: z
      .object({
        invocations: boundedCount,
        reportedTokenInvocations: boundedCount,
        inputTokens: boundedUsage,
        outputTokens: boundedUsage,
        totalTokens: boundedUsage,
      })
      .strict(),
    embeddingUsage: z
      .object({
        requests: boundedCount,
        texts: boundedUsage,
        characters: boundedUsage,
      })
      .strict(),
  })
  .strict();

export const quickFurnoWorkerObservationSchema = z.discriminatedUnion('protocol', [
  quickFurnoWorkerObservationV1Schema,
  quickFurnoWorkerObservationV2Schema,
]);

export type QuickFurnoWorkerObservationV1 = z.infer<typeof quickFurnoWorkerObservationV1Schema>;
export type QuickFurnoWorkerObservationV2 = z.infer<typeof quickFurnoWorkerObservationV2Schema>;
export type QuickFurnoWorkerObservation = z.infer<typeof quickFurnoWorkerObservationSchema>;

export function parseQuickFurnoWorkerObservation(value: unknown): QuickFurnoWorkerObservation {
  return quickFurnoWorkerObservationSchema.parse(value);
}

export {
  createWorkerSloPolicy,
  evaluateWorkerSlo,
  INITIAL_WORKER_SLO_POLICY_V1,
} from './slo.js';
export type {
  WorkerSloPolicy,
  WorkerSloPolicyInput,
  WorkerSloObjective,
  WorkerSloEvaluation,
} from './slo.js';

export {
  createScaleReadinessPolicy,
  evaluateScaleReadiness,
} from './scaling.js';
export type {
  ScaleReadinessPolicy,
  ScaleReadinessPolicyInput,
  ScaleReadinessDecision,
  ScaleReadinessEvaluation,
} from './scaling.js';
