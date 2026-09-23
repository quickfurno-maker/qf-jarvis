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
import { createJf6RiyaServiceBoundary } from '../jf6-private-process/create-riya-service-boundary.js';
import { createRiyaCustomerRuntimeComposition } from '../riya-customer-orchestration/create-riya-customer-runtime.js';
import {
  createQuickFurnoWhatsAppAuthorityReader,
  createQuickFurnoWhatsAppMaterialReader,
  createQuickFurnoWhatsAppReplyWriter,
} from './quickfurno-http.js';
import { createQuickFurnoWorkerKillSwitch } from './production-kill-switch.js';
import {
  quickFurnoWorkerAvailabilityHttpPost,
  quickFurnoWorkerHttpPost,
} from './production-network.js';
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
  const sealed = bindJf5cSealForProduction(config.seal, config.revision, config.knowledge.revision);
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

  const pool: DatabasePool = createDatabasePool(config.database);
  const observation = createQuickFurnoWorkerObservationWriter({
    filePath: config.operationalSnapshotFile,
    revision: config.revision,
    runtimeId: config.runtimeId,
    knowledgeRevision: config.knowledge.revision,
    embeddingModelRef: config.knowledge.embedding.modelRef,
  });
  const baseGatewayInvoker = createLiveModelGatewayInvoker(production.composition.gateway);
  const observedGatewayInvoker = Object.freeze({
    async invoke(request: Parameters<typeof baseGatewayInvoker.invoke>[0]) {
      const result = await baseGatewayInvoker.invoke(request);
      if (result.ok) observation.recordModelLatency(result.response.latencyMs, systemInstant());
      return result;
    },
  });

  let closed = false;
  try {
    const embedding = createOpenAICompatibleEmbeddingPort({
      endpoint: config.knowledge.embedding.endpoint,
      modelRef: config.knowledge.embedding.modelRef,
      executionClass: config.knowledge.embedding.executionClass,
      ...(config.knowledge.embedding.bearerToken === undefined
        ? {}
        : { bearerToken: config.knowledge.embedding.bearerToken }),
      timeoutMs: config.knowledge.embedding.timeoutMs,
      maxBatchItems: config.knowledge.embedding.maxBatchItems,
      maxInputChars: config.knowledge.embedding.maxInputChars,
    });
    await assertPostgresKnowledgeReleaseReady(
      pool,
      config.knowledge.revision,
      config.knowledge.embedding.modelRef,
    );
    const knowledgeStore = createPostgresHybridCandidateStore(pool, config.knowledge.revision);
    const baseHybridKnowledge = createHybridKnowledgeRetriever({
      embedding,
      store: knowledgeStore,
    });
    const hybridKnowledge = Object.freeze({
      knowledgeRevision: baseHybridKnowledge.knowledgeRevision,
      async retrieve(request: Parameters<typeof baseHybridKnowledge.retrieve>[0]) {
        const started = Date.now();
        const result = await baseHybridKnowledge.retrieve(request);
        observation.recordKnowledgeRetrieval(result.reason, Date.now() - started, systemInstant());
        return result;
      },
    });

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
      agentHybridKnowledge: {
        knowledgeRevision: config.knowledge.revision,
        retrieval: hybridKnowledge,
        agents: config.knowledge.agents,
      },
      requireEvaluationRef: true,
      provenanceRefs: {
        runtimeRef: 'qfj.jarvis-runtime.quickfurno-authority-v2',
        releaseRef: binding.release.releaseId,
        providerRef: binding.release.providerId,
        configRef: binding.release.configDigest,
      },
    });

    const riyaService = createJf6RiyaServiceBoundary({
      pool,
      runtime,
      runtimeId: config.runtimeId,
      maxConcurrentTextTurns: config.maxConcurrentTextTurns,
      availability: {
        baseUrl: config.quickfurno.baseUrl,
        keyId: config.quickfurno.keyId,
        privateKeyPem: config.quickfurno.privateKeyPem,
        clock: systemInstant,
        requestId: randomUUID,
        httpPost: quickFurnoWorkerAvailabilityHttpPost,
        timeoutMs: config.quickfurno.timeoutMs,
      },
    });
    const riya = createRiyaCustomerRuntimeComposition({
      conversationService: riyaService,
    }).customerTurnRunner;
    const specialistRuntime = createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: config.runtimeId,
      riya,
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
        await closeDatabasePool(pool);
      },
    });
  } catch (error) {
    await closeDatabasePool(pool).catch(() => undefined);
    throw error;
  }
}
