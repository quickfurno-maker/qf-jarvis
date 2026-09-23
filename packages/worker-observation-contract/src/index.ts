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
const latencySample = z
  .object({
    at: canonicalInstant,
    latencyMs: z.number().nonnegative().max(300_000),
  })
  .strict();

export const quickFurnoWorkerObservationSchema = z
  .object({
    protocol: z.literal('qfj.quickfurno-worker-observation.v1'),
    emittedAt: canonicalInstant,
    revision: z.string().regex(/^[0-9a-f]{40}$/u),
    runtimeId: ref,
    state: z.enum(['HEALTHY', 'DEGRADED', 'DISABLED']),
    providerMode: z.literal('GROQ_ONLY'),
    knowledgeRevision: ref,
    embeddingModelRef: modelRef,
    spool: z
      .object({
        pending: boundedCount,
        processing: boundedCount,
        completed: boundedCount,
        failed: boundedCount,
        oldestPendingAgeMs: z.number().int().nonnegative().max(86_400_000).nullable(),
      })
      .strict(),
    outcomes: z
      .object({
        completedNoReply: boundedCount,
        completedQueued: boundedCount,
        completedStale: boundedCount,
        releasedPreAgent: boundedCount,
        failedIndeterminate: boundedCount,
      })
      .strict(),
    modelLatency: z.array(latencySample).max(120),
    knowledgeRetrieval: z
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
      .strict(),
  })
  .strict();

export type QuickFurnoWorkerObservation = z.infer<typeof quickFurnoWorkerObservationSchema>;

export function parseQuickFurnoWorkerObservation(value: unknown): QuickFurnoWorkerObservation {
  return quickFurnoWorkerObservationSchema.parse(value);
}
