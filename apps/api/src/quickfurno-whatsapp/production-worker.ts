import { randomUUID } from 'node:crypto';

import { createRuntimePolicy } from '@qf-jarvis/agent-runtime';
import {
  closeDatabasePool,
  createDatabasePool,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';
import {
  createEstimatedBudgetPolicy,
  createFetchGroqTransport,
  createGroqProviderConfig,
  createModelCapabilityProfile,
  createModelCapabilityRegistry,
  createSystemClock,
  GroqModelProvider,
} from '@qf-jarvis/model-gateway';
import {
  createLiveModelGatewayInvoker,
  createProductionModelGateway,
} from '@qf-jarvis/model-gateway-composition';
import {
  JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
  JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
  JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT,
} from '@qf-jarvis/jarvis-v1-production-profile';
import { createHybridKnowledgeRetriever } from '@qf-jarvis/knowledge-index';
import { createOpenAICompatibleEmbeddingPort } from '@qf-jarvis/openai-compatible-embedding-adapter';
import {
  assertPostgresKnowledgeReleaseReady,
  createPostgresHybridCandidateStore,
} from '@qf-jarvis/postgres-knowledge-index';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import { createFileDurableTurnSpool } from '@qf-jarvis/quickfurno-gateway/durable-turn-spool';
import { createJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import { RIYA_PRODUCTION_PROMPTS } from '@qf-jarvis/riya-prompts';

import { createFileGroqCredentialBinding } from '../secrets/file-groq-credential-binding.js';
import {
  createQuickFurnoWhatsAppAuthorityReader,
  createQuickFurnoWhatsAppMaterialReader,
  createQuickFurnoWhatsAppReplyWriter,
} from './quickfurno-http.js';
import { createQuickFurnoWorkerKillSwitch } from './production-kill-switch.js';
import { quickFurnoWorkerHttpPost } from './production-network.js';
import { createQuickFurnoWhatsAppAuthorityStatePort } from './authority-state-port.js';
import { createQuickFurnoWhatsAppSpecialistRuntime } from './specialist-runtime.js';
import {
  createQuickFurnoWhatsAppTurnProcessor,
  type QuickFurnoWhatsAppProcessorOutcome,
} from './turn-processor.js';
import { bindJf5cSealForProduction } from './production-seal-binding.js';
import type { QuickFurnoWhatsAppProductionWorkerConfig } from './production-worker-config.js';
import { createQuickFurnoWorkerObservationWriter } from './production-observation.js';

export interface QuickFurnoWhatsAppProductionWorker {
  readonly revision: string;
  readonly providerMode: 'GROQ_ONLY';
  readonly verifiedApprovalCount: 3;
  run(signal: AbortSignal): Promise<void>;
  processOne(): Promise<QuickFurnoWhatsAppProcessorOutcome>;
  close(): Promise<void>;
}

function systemInstant(): string {
  return new Date().toISOString();
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const stop = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

export async function createQuickFurnoWhatsAppProductionWorker(
  config: QuickFurnoWhatsAppProductionWorkerConfig,
): Promise<QuickFurnoWhatsAppProductionWorker> {
  // Seal verification happens before credential resolution, database I/O or spool claims.
  // Knowledge is part of the certified binding only when this deployment actually enables it.
  const expectedKnowledgeRevision =
    config.knowledge.mode === 'HYBRID' ? config.knowledge.revision : null;
  const sealed = bindJf5cSealForProduction(config.seal, config.revision, expectedKnowledgeRevision);
  if (!sealed.ok) throw new Error(`production-seal-refused:${sealed.reason}`);
  const binding = sealed.binding;

  const credentialBinding = createFileGroqCredentialBinding({
    credentialReference: Object.freeze({ ref: config.groqCredentialReference }),
    absoluteFilePath: config.groqCredentialFile,
  });
  const apiKey = await credentialBinding.resolver.resolve({
    ref: config.groqCredentialReference,
  });

  const gatewayClock = createSystemClock();
  const provider = new GroqModelProvider(
    createGroqProviderConfig({
      providerId: 'groq',
      modelId: binding.release.modelId,
      modelVersion: binding.release.modelVersion,
      executionClass: 'HOSTED',
      maxInputTokens: JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
      maxCompletionTokens: JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
      supportsStrictJsonSchema: true,
      apiKey,
      transport: createFetchGroqTransport(),
      dataControlsAttested: true,
    }),
    gatewayClock,
  );
  const capabilityRegistry = createModelCapabilityRegistry([
    createModelCapabilityProfile({
      release: binding.release,
      taskClasses: ['RESPONSE_GENERATION'],
      resultModes: ['STRUCTURED'],
      structuredOutputMode: 'strict-json-schema',
      maxInputTokens: JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
      maxCompletionTokens: JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
      supportsTimeout: true,
      supportsCancellation: true,
      supportsStreaming: false,
    }),
  ]);
  const killSwitch = createQuickFurnoWorkerKillSwitch(config.killSwitchFile);
  const production = createProductionModelGateway({
    mode: 'ACTIVE',
    providerMode: 'GROQ_ONLY',
    providers: [provider],
    approvedReleases: [binding.release],
    capabilityRegistry,
    budgetPolicy: createEstimatedBudgetPolicy({}),
    killSwitch,
    clock: gatewayClock,
    concurrency: { maxConcurrent: 1, maxQueue: 1 },
    circuit: { failureThreshold: 3, cooldownMs: 30_000 },
    defaultRetryBudget: 0,
    allowFallback: false,
    credentialResolver: credentialBinding.resolver,
    evaluationEvidence: binding.evaluationEvidence,
    productionApprovals: binding.productionApprovals,
  });
  if (
    !production.ok ||
    !production.composition.status.activatable ||
    production.composition.status.providerMode !== 'GROQ_ONLY' ||
    production.composition.status.fallbackEnabled ||
    production.composition.status.retryBudget !== 0 ||
    production.composition.status.verifiedApprovalCount !== 3
  ) {
    throw new Error('production-model-gateway-refused');
  }

  let pool: DatabasePool | undefined;
  if (config.knowledge.mode === 'HYBRID') {
    if (config.database === undefined) throw new Error('production-worker-config-invalid');
    pool = createDatabasePool(config.database);
  } else if (config.database !== undefined) {
    throw new Error('production-worker-config-invalid');
  }

  const observation = createQuickFurnoWorkerObservationWriter({
    filePath: config.operationalSnapshotFile,
    revision: config.revision,
    runtimeId: config.runtimeId,
    knowledge:
      config.knowledge.mode === 'HYBRID'
        ? Object.freeze({
            mode: 'HYBRID' as const,
            revision: config.knowledge.revision,
            embeddingModelRef: config.knowledge.embedding.modelRef,
          })
        : Object.freeze({ mode: 'DISABLED' as const }),
  });
  const baseGatewayInvoker = createLiveModelGatewayInvoker(production.composition.gateway);
  const observedGatewayInvoker = Object.freeze({
    async invoke(request: Parameters<typeof baseGatewayInvoker.invoke>[0]) {
      const result = await baseGatewayInvoker.invoke(request);
      observation.recordModelOutcome(
        result.ok,
        result.ok ? result.response.provenance.usedFallback : false,
      );
      if (result.ok) {
        observation.recordModelLatency(result.response.latencyMs, systemInstant());
        observation.recordModelUsage(result.response.usage);
      }
      return result;
    },
  });

  let closed = false;
  try {
    let agentHybridKnowledge: Parameters<typeof createJarvisRuntime>[0]['agentHybridKnowledge'];
    if (config.knowledge.mode === 'HYBRID') {
      if (pool === undefined) throw new Error('production-worker-config-invalid');
      const hybridConfig = config.knowledge;
      const baseEmbedding = createOpenAICompatibleEmbeddingPort({
        endpoint: hybridConfig.embedding.endpoint,
        modelRef: hybridConfig.embedding.modelRef,
        executionClass: hybridConfig.embedding.executionClass,
        ...(hybridConfig.embedding.bearerToken === undefined
          ? {}
          : { bearerToken: hybridConfig.embedding.bearerToken }),
        timeoutMs: hybridConfig.embedding.timeoutMs,
        maxBatchItems: hybridConfig.embedding.maxBatchItems,
        maxInputChars: hybridConfig.embedding.maxInputChars,
      });
      const embedding = Object.freeze({
        modelRef: baseEmbedding.modelRef,
        dimension: baseEmbedding.dimension,
        executionClass: baseEmbedding.executionClass,
        async embed(texts: readonly string[]) {
          observation.recordEmbeddingUsage(texts);
          return baseEmbedding.embed(texts);
        },
      });
      await assertPostgresKnowledgeReleaseReady(
        pool,
        hybridConfig.revision,
        hybridConfig.embedding.modelRef,
      );
      const knowledgeStore = createPostgresHybridCandidateStore(pool, hybridConfig.revision);
      const baseHybridKnowledge = createHybridKnowledgeRetriever({
        embedding,
        store: knowledgeStore,
      });
      const hybridKnowledge = Object.freeze({
        knowledgeRevision: baseHybridKnowledge.knowledgeRevision,
        async retrieve(request: Parameters<typeof baseHybridKnowledge.retrieve>[0]) {
          const started = Date.now();
          const result = await baseHybridKnowledge.retrieve(request);
          observation.recordKnowledgeRetrieval(
            result.reason,
            Date.now() - started,
            systemInstant(),
          );
          return result;
        },
      });
      agentHybridKnowledge = Object.freeze({
        knowledgeRevision: hybridConfig.revision,
        retrieval: hybridKnowledge,
        agents: hybridConfig.agents,
      });
    }

    const promptRegistry = createPromptRegistry([
      ...RIYA_PRODUCTION_PROMPTS,
      JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT.ANISHA,
      JARVIS_V1_PRODUCTION_PROMPT_BY_AGENT.AAROHI,
    ]);
    const httpConfig = {
      baseUrl: config.quickfurno.baseUrl,
      keyId: config.quickfurno.keyId,
      privateKeyPem: config.quickfurno.privateKeyPem,
      clock: systemInstant,
      requestId: randomUUID,
      httpPost: quickFurnoWorkerHttpPost,
      timeoutMs: config.quickfurno.timeoutMs,
    };
    const authoritativeState = createQuickFurnoWhatsAppAuthorityStatePort(
      createQuickFurnoWhatsAppAuthorityReader(httpConfig),
    );
    const runtime = createJarvisRuntime({
      authoritativeState,
      policy: createRuntimePolicy({
        policyRevision: config.policyRevision,
        unknownRouting: 'HUMAN',
      }),
      clock: systemInstant,
      release: binding.release,
      promptBindings: binding.promptBindings,
      riyaConversationEvolutionPromptBinding: binding.riyaConversationEvolutionPromptBinding,
      riyaGroundedConversationEvolutionPromptBinding:
        binding.riyaGroundedConversationEvolutionPromptBinding,
      riyaGroundedReplyPromptBinding: binding.riyaGroundedReplyPromptBinding,
      promptRegistry,
      capabilityProfileRef: binding.capabilityProfileRef,
      gatewayInvoker: observedGatewayInvoker,
      ...(agentHybridKnowledge === undefined ? {} : { agentHybridKnowledge }),
      requireEvaluationRef: true,
      provenanceRefs: {
        runtimeRef: 'qfj.jarvis-runtime.quickfurno-authority-v2',
        releaseRef: binding.release.releaseId,
        providerRef: binding.release.providerId,
        configRef: binding.release.configDigest,
      },
    });

    // WhatsApp intentionally does not compose the durable Riya continuity/turn stores. QuickFurno
    // already owns the durable inbound message, conversation revision, consent and takeover state;
    // a second Jarvis-owned client-continuity store remains disabled until its lifecycle policy is
    // separately approved. The specialist runtime therefore executes one governed proposal per
    // QuickFurno-bound turn for RIYA/ANISHA/AAROHI alike.
    const specialistRuntime = createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: config.runtimeId,
      jarvisRuntime: runtime,
    });
    const spool = await createFileDurableTurnSpool(config.spoolDirectory);
    await spool.recoverStale(config.staleProcessingMs, Date.now());
    const processor = createQuickFurnoWhatsAppTurnProcessor({
      queue: spool,
      materialReader: createQuickFurnoWhatsAppMaterialReader(httpConfig),
      specialistRuntime,
      replyWriter: createQuickFurnoWhatsAppReplyWriter(httpConfig),
    });

    let lastObservationMs = 0;
    const writeObservation = async (
      state: 'HEALTHY' | 'DEGRADED' | 'DISABLED',
      force: boolean,
    ): Promise<void> => {
      const nowMs = Date.now();
      if (!force && nowMs - lastObservationMs < 10_000) return;
      const spoolState = await spool.snapshot(nowMs);
      await observation.write(state, spoolState, new Date(nowMs).toISOString());
      lastObservationMs = nowMs;
    };
    const writeObservationBestEffort = async (
      state: 'HEALTHY' | 'DEGRADED' | 'DISABLED',
      force: boolean,
    ): Promise<void> => {
      try {
        await writeObservation(state, force);
      } catch {
        // Observability is deliberately powerless: after startup it cannot block customer turns.
        // Jarvis OS will reject the stale/missing file and mark only its owned sections unavailable.
      }
    };
    const processObservedOne = async (): Promise<QuickFurnoWhatsAppProcessorOutcome> => {
      const outcome = await processor.processOne();
      observation.recordOutcome(outcome);
      const state = killSwitch.active()
        ? 'DISABLED'
        : outcome === 'failed-indeterminate'
          ? 'DEGRADED'
          : 'HEALTHY';
      await writeObservationBestEffort(state, outcome !== 'idle');
      return outcome;
    };

    // Required once: a bad path/permission is a deployment defect and refuses startup before claims.
    await writeObservation(killSwitch.active() ? 'DISABLED' : 'HEALTHY', true);

    return Object.freeze({
      revision: config.revision,
      providerMode: 'GROQ_ONLY' as const,
      verifiedApprovalCount: 3 as const,
      processOne: processObservedOne,
      async run(signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
          // Do not claim a new turn while disabled. The gateway repeats this check at invocation time,
          // so a switch created after claim but before model execution still blocks the call.
          if (killSwitch.active()) {
            await writeObservationBestEffort('DISABLED', false);
            await abortableDelay(config.idlePollMs, signal);
            continue;
          }
          const outcome = await processObservedOne();
          if (outcome === 'idle' || outcome === 'released-pre-agent') {
            await abortableDelay(config.idlePollMs, signal);
          }
        }
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        if (pool !== undefined) await closeDatabasePool(pool);
      },
    });
  } catch (error) {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined);
    throw error;
  }
}
