import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
  INITIAL_WORKER_SLO_POLICY_V1,
  evaluateWorkerSlo,
  parseQuickFurnoWorkerObservation,
} from '@qf-jarvis/worker-observation-contract';

import type { ReadSourceDescriptor, SectionContributions } from './read-source';

const MAX_FILE_BYTES = 64 * 1024;
const MAX_STALENESS_MS = 30_000;

function stateOf(state: 'HEALTHY' | 'DEGRADED' | 'DISABLED') {
  return state;
}

function p95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index] ?? null;
}

export function createWorkerObservationReadSource(filePath: string): ReadSourceDescriptor {
  if (!isAbsolute(filePath)) {
    throw new TypeError('worker-observation-path-invalid');
  }

  return Object.freeze({
    id: 'quickfurno-whatsapp-worker-observation',
    label: 'QuickFurno WhatsApp worker observation',
    observedReason:
      'Live aggregate worker health, queue counts, model latency and governed knowledge readiness.',
    owns: Object.freeze([
      'headlineMetrics',
      'workers',
      'models',
      'knowledge',
      'modelLatency',
    ] as const),
    timeoutMs: 1_000,
    async acquire(signal: AbortSignal) {
      let raw: string;
      try {
        raw = await readFile(filePath, { encoding: 'utf8', signal });
      } catch {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_UNREACHABLE' as const,
        });
      }
      if (raw.length < 2 || raw.length > MAX_FILE_BYTES) {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
        });
      }

      let observation;
      try {
        observation = parseQuickFurnoWorkerObservation(JSON.parse(raw));
      } catch {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
        });
      }

      const emittedMs = Date.parse(observation.emittedAt);
      const readAtMs = Date.now();
      if (
        !Number.isFinite(emittedMs) ||
        emittedMs > readAtMs + 1_000 ||
        readAtMs - emittedMs > MAX_STALENESS_MS
      ) {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
        });
      }

      const health = stateOf(observation.state);
      const slo = evaluateWorkerSlo(observation, INITIAL_WORKER_SLO_POLICY_V1);
      const usageItems =
        observation.protocol === 'qfj.quickfurno-worker-observation.v2'
          ? [
              {
                id: 'model-availability',
                label: 'Model availability',
                value: (() => {
                  const total =
                    observation.modelGateway.completed + observation.modelGateway.failed;
                  return total === 0
                    ? 'n/a'
                    : ((observation.modelGateway.completed / total) * 100).toFixed(2) + '%';
                })(),
                caption: 'Validated gateway completions divided by completed plus failed model calls.',
              },
              {
                id: 'model-fallback-rate',
                label: 'Model fallback',
                value:
                  observation.modelGateway.completed === 0
                    ? 'n/a'
                    : (
                        (observation.modelGateway.fallbackUsed /
                          observation.modelGateway.completed) *
                        100
                      ).toFixed(2) + '%',
                caption: 'Fallback use among validated model completions; production policy currently disables fallback.',
              },
              {
                id: 'model-total-tokens',
                label: 'Model tokens',
                value: String(observation.modelUsage.totalTokens),
                caption: 'Aggregate provider-reported tokens from successful validated model calls.',
              },
              {
                id: 'embedding-requests',
                label: 'Embedding requests',
                value: String(observation.embeddingUsage.requests),
                caption: 'Aggregate embedding requests issued by this production worker.',
              },
              {
                id: 'embedding-characters',
                label: 'Embedding characters',
                value: String(observation.embeddingUsage.characters),
                caption: 'Aggregate query characters submitted for embeddings; no query text retained.',
              },
            ]
          : [];
      const sections: SectionContributions = Object.freeze({
        headlineMetrics: {
          items: [
            {
              id: 'queue-pending',
              label: 'Pending turns',
              value: String(observation.spool.pending),
              caption: 'Durable WhatsApp turns waiting to be claimed.',
            },
            {
              id: 'queue-processing',
              label: 'Processing turns',
              value: String(observation.spool.processing),
              caption: 'Durable WhatsApp turns currently claimed by the single-owner worker.',
            },
            {
              id: 'queue-failed',
              label: 'Failed turns',
              value: String(observation.spool.failed),
              caption: 'Durable turns isolated after an indeterminate processing outcome.',
            },
            {
              id: 'queue-completed',
              label: 'Completed turns',
              value: String(observation.spool.completed),
              caption: 'Durable turns completed by this spool.',
            },
            {
              id: 'rag-served',
              label: 'RAG served',
              value: String(observation.knowledgeRetrieval.served),
              caption: 'Hybrid retrievals that returned governed evidence.',
            },
            {
              id: 'rag-refused',
              label: 'RAG refused',
              value: String(
                observation.knowledgeRetrieval.governanceRefused +
                  observation.knowledgeRetrieval.embeddingFailed +
                  observation.knowledgeRetrieval.storeFailed +
                  observation.knowledgeRetrieval.rerankerFailed +
                  observation.knowledgeRetrieval.otherFailed,
              ),
              caption: 'Hybrid retrievals refused or failed before model grounding.',
            },
            {
              id: 'rag-p95-ms',
              label: 'RAG p95',
              value: String(
                p95(observation.knowledgeRetrieval.latency.map((sample) => sample.latencyMs)) ?? 0,
              ),
              caption: 'p95 hybrid retrieval latency across the bounded live sample ring (ms).',
            },
            {
              id: 'engineering-slo-state',
              label: 'Engineering SLO',
              value: slo.status,
              caption:
                'Initial engineering SLO assessment; production targets require review against measured traffic.',
            },
            ...usageItems,
          ],
        },
        workers: {
          items: [
            {
              id: 'quickfurno-whatsapp-worker',
              label: 'WhatsApp worker',
              kind: 'local-node' as const,
              state: health,
              capacity: 'single-owner',
              detail: 'Live aggregate from the production worker observation boundary.',
            },
          ],
        },
        models: {
          items: [
            {
              id: 'production-model-gateway',
              label: 'Production model gateway',
              provider: 'Groq',
              state: health,
              dataClass: 'external-provider' as const,
              detail: 'Live worker observation for the sealed Groq-only production model path.',
            },
          ],
        },
        knowledge: {
          items: [
            {
              id: 'active-governed-knowledge',
              label: 'Active governed knowledge',
              owner: 'QF Jarvis',
              state: health,
              detail:
                'Live worker observation confirms an exact active knowledge revision is bound.',
            },
          ],
        },
        modelLatency: {
          points: observation.modelLatency.map((sample) => ({
            label: sample.at.slice(11, 19),
            value: sample.latencyMs,
          })),
        },
      });

      return Object.freeze({
        status: 'OBSERVED' as const,
        observedAt: new Date(readAtMs).toISOString(),
        sections,
      });
    },
  });
}
