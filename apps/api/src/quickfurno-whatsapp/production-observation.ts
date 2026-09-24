import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ModelUsage } from '@qf-jarvis/model-gateway';
import {
  parseQuickFurnoWorkerObservation,
  type QuickFurnoWorkerObservationV3,
} from '@qf-jarvis/worker-observation-contract';

import type { HybridRetrievalReason } from '@qf-jarvis/knowledge-index';

import type { QuickFurnoWhatsAppProcessorOutcome } from './turn-processor.js';

const MAX_COUNTER = 1_000_000_000;
const MAX_USAGE = 1_000_000_000_000;
const MAX_LATENCY_SAMPLES = 120;

export interface ProductionSpoolObservation {
  readonly pending: number;
  readonly processing: number;
  readonly completed: number;
  readonly failed: number;
  readonly oldestPendingAgeMs: number | null;
}

export interface QuickFurnoWorkerObservationWriter {
  recordModelLatency(latencyMs: number, at: string): void;
  recordModelOutcome(ok: boolean, usedFallback?: boolean): void;
  recordModelUsage(usage: ModelUsage): void;
  recordEmbeddingUsage(texts: readonly string[]): void;
  recordKnowledgeRetrieval(reason: HybridRetrievalReason, latencyMs: number, at: string): void;
  recordOutcome(outcome: QuickFurnoWhatsAppProcessorOutcome): void;
  write(
    state: 'HEALTHY' | 'DEGRADED' | 'DISABLED',
    spool: ProductionSpoolObservation,
    emittedAt: string,
  ): Promise<void>;
}

export interface QuickFurnoWorkerObservationWriterConfig {
  readonly filePath: string;
  readonly revision: string;
  readonly runtimeId: string;
  readonly knowledge:
    | Readonly<{ mode: 'DISABLED' }>
    | Readonly<{ mode: 'HYBRID'; revision: string; embeddingModelRef: string }>;
}

function increment(value: number): number {
  return Math.min(MAX_COUNTER, value + 1);
}

function addUsage(value: number, delta: number | undefined): number {
  if (delta === undefined || !Number.isFinite(delta) || !Number.isInteger(delta) || delta < 0) {
    return value;
  }
  return Math.min(MAX_USAGE, value + delta);
}

export function createQuickFurnoWorkerObservationWriter(
  config: QuickFurnoWorkerObservationWriterConfig,
): QuickFurnoWorkerObservationWriter {
  const latencies: { at: string; latencyMs: number }[] = [];
  const knowledgeLatencies: { at: string; latencyMs: number }[] = [];
  const knowledgeRetrieval = {
    served: 0,
    noCandidates: 0,
    governanceRefused: 0,
    embeddingFailed: 0,
    storeFailed: 0,
    rerankerFailed: 0,
    otherFailed: 0,
  };
  const outcomes = {
    completedNoReply: 0,
    completedQueued: 0,
    completedStale: 0,
    releasedPreAgent: 0,
    failedIndeterminate: 0,
  };
  const modelGateway = {
    completed: 0,
    failed: 0,
    fallbackUsed: 0,
  };
  const modelUsage = {
    invocations: 0,
    reportedTokenInvocations: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const embeddingUsage = {
    requests: 0,
    texts: 0,
    characters: 0,
  };

  return Object.freeze({
    recordModelLatency(latencyMs: number, at: string): void {
      if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 300_000) return;
      latencies.push(Object.freeze({ at, latencyMs }));
      if (latencies.length > MAX_LATENCY_SAMPLES)
        latencies.splice(0, latencies.length - MAX_LATENCY_SAMPLES);
    },

    recordModelOutcome(ok: boolean, usedFallback = false): void {
      if (ok) modelGateway.completed = increment(modelGateway.completed);
      else modelGateway.failed = increment(modelGateway.failed);
      if (ok && usedFallback) modelGateway.fallbackUsed = increment(modelGateway.fallbackUsed);
    },

    recordModelUsage(usage: ModelUsage): void {
      modelUsage.invocations = increment(modelUsage.invocations);
      const reportsAny =
        usage.inputTokens !== undefined ||
        usage.outputTokens !== undefined ||
        usage.totalTokens !== undefined;
      if (reportsAny) {
        modelUsage.reportedTokenInvocations = increment(modelUsage.reportedTokenInvocations);
      }
      modelUsage.inputTokens = addUsage(modelUsage.inputTokens, usage.inputTokens);
      modelUsage.outputTokens = addUsage(modelUsage.outputTokens, usage.outputTokens);
      modelUsage.totalTokens = addUsage(modelUsage.totalTokens, usage.totalTokens);
    },

    recordEmbeddingUsage(texts: readonly string[]): void {
      embeddingUsage.requests = increment(embeddingUsage.requests);
      embeddingUsage.texts = addUsage(embeddingUsage.texts, texts.length);
      embeddingUsage.characters = addUsage(
        embeddingUsage.characters,
        texts.reduce((sum, text) => sum + text.length, 0),
      );
    },

    recordKnowledgeRetrieval(reason: HybridRetrievalReason, latencyMs: number, at: string): void {
      if (reason === 'hybrid-served')
        knowledgeRetrieval.served = increment(knowledgeRetrieval.served);
      else if (reason === 'hybrid-no-candidates')
        knowledgeRetrieval.noCandidates = increment(knowledgeRetrieval.noCandidates);
      else if (reason === 'hybrid-governance-refused')
        knowledgeRetrieval.governanceRefused = increment(knowledgeRetrieval.governanceRefused);
      else if (reason === 'hybrid-embedding-failed' || reason === 'hybrid-query-embedding-denied')
        knowledgeRetrieval.embeddingFailed = increment(knowledgeRetrieval.embeddingFailed);
      else if (reason === 'hybrid-candidate-store-failed')
        knowledgeRetrieval.storeFailed = increment(knowledgeRetrieval.storeFailed);
      else if (
        reason === 'hybrid-reranker-failed' ||
        reason === 'hybrid-reranker-data-class-denied'
      )
        knowledgeRetrieval.rerankerFailed = increment(knowledgeRetrieval.rerankerFailed);
      else knowledgeRetrieval.otherFailed = increment(knowledgeRetrieval.otherFailed);

      if (Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= 300_000) {
        knowledgeLatencies.push(Object.freeze({ at, latencyMs }));
        if (knowledgeLatencies.length > MAX_LATENCY_SAMPLES)
          knowledgeLatencies.splice(0, knowledgeLatencies.length - MAX_LATENCY_SAMPLES);
      }
    },

    recordOutcome(outcome: QuickFurnoWhatsAppProcessorOutcome): void {
      if (outcome === 'completed-no-reply')
        outcomes.completedNoReply = increment(outcomes.completedNoReply);
      else if (outcome === 'completed-queued')
        outcomes.completedQueued = increment(outcomes.completedQueued);
      else if (outcome === 'completed-stale')
        outcomes.completedStale = increment(outcomes.completedStale);
      else if (outcome === 'released-pre-agent')
        outcomes.releasedPreAgent = increment(outcomes.releasedPreAgent);
      else if (outcome === 'failed-indeterminate') {
        outcomes.failedIndeterminate = increment(outcomes.failedIndeterminate);
      }
    },

    async write(
      state: 'HEALTHY' | 'DEGRADED' | 'DISABLED',
      spool: ProductionSpoolObservation,
      emittedAt: string,
    ): Promise<void> {
      const observation: QuickFurnoWorkerObservationV3 = parseQuickFurnoWorkerObservation({
        protocol: 'qfj.quickfurno-worker-observation.v3',
        emittedAt,
        revision: config.revision,
        runtimeId: config.runtimeId,
        state,
        providerMode: 'GROQ_ONLY',
        knowledge: config.knowledge,
        spool,
        outcomes,
        modelLatency: latencies,
        knowledgeRetrieval: {
          ...knowledgeRetrieval,
          latency: knowledgeLatencies,
        },
        modelGateway,
        modelUsage,
        embeddingUsage,
      }) as QuickFurnoWorkerObservationV3;
      const directory = dirname(config.filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = config.filePath + '.tmp';
      await writeFile(temporary, JSON.stringify(observation), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, config.filePath);
    },
  });
}
