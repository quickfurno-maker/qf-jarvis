import { randomUUID } from 'node:crypto';

import { createRuntimePolicy } from '@qf-jarvis/agent-runtime';
import {
  createFetchTypeSafeTransport,
  createJevDecisionShadowPort,
  JevDecisionProvider,
} from '@qf-jarvis/jev-decision-adapter';
import {
  closeDatabasePool,
  createDatabasePool,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';
import {
  createEstimatedBudgetPolicy,
  createFetchGroqTransport,
  createFetchOpenAITransport,
  createGroqProviderConfig,
  createModelCapabilityProfile,
  createModelCapabilityRegistry,
  createOpenAIProviderConfig,
  createSystemClock,
  GroqModelProvider,
  OpenAIModelProvider,
  type GatewayEvent,
  type GatewayObservabilityHook,
} from '@qf-jarvis/model-gateway';
import {
  createLiveModelGatewayInvoker,
  createProductionModelGateway,
  type ProductionApprovalClaim,
} from '@qf-jarvis/model-gateway-composition';
import type { ApprovalEvidence, ProviderReleaseRef } from '@qf-jarvis/model-evaluation';
import type {
  ModelGatewayInvoker,
  ModelReplyPromptBinding,
  ModelReplyPromptBindings,
} from '@qf-jarvis/model-reply-adapter';
import {
  JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER,
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
import { createPostgresDurableTurnSpool } from '@qf-jarvis/quickfurno-gateway/postgres-durable-turn-spool';
import { createInMemoryPublicKnowledgeSemanticCache } from '@qf-jarvis/semantic-context-engine';
import { createJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import {
  RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1,
  RIYA_PRODUCTION_PROMPTS,
} from '@qf-jarvis/riya-prompts';
import { addMetric, emitStructuredLog, recordMetric, setMetric } from '@qf-jarvis/observability';
import {
  createFileAosMarketCapacityObservationWriter,
  createFileAosOwnerAttentionObservationWriter,
  runAosSupervisorShadowCycle,
} from '@qf-jarvis/proactive-worker';

import { createFileGroqCredentialBinding } from '../secrets/file-groq-credential-binding.js';
import { createAgniCaseEscalationPort } from './agni-case-escalation.js';
import { createFileOpenAICredentialBinding } from '../secrets/file-openai-credential-binding.js';
import {
  createQuickFurnoClientMatchRequestWriter,
  createQuickFurnoClientVendorFeedbackWriter,
  createQuickFurnoAarohiBehaviourInputReader,
  createQuickFurnoAarohiProjectionWriter,
  createQuickFurnoWhatsAppAuthorityReader,
  createQuickFurnoWhatsAppConversationContextReader,
  createQuickFurnoWhatsAppMaterialReader,
  createQuickFurnoWhatsAppReplyWriter,
} from './quickfurno-http.js';
import { createQuickFurnoWorkerKillSwitch } from './production-kill-switch.js';
import {
  quickFurnoWorkerAgniCaseHttpPost,
  quickFurnoWorkerHttpPost,
} from './production-network.js';
import { createAdaptiveQuickFurnoWhatsAppSpecialistRuntime } from './adaptive-specialist-runtime.js';
import { createQuickFurnoWhatsAppAuthorityStatePort } from './authority-state-port.js';
import { createQuickFurnoWhatsAppParallelScheduler } from './parallel-turn-scheduler.js';
import {
  createQuickFurnoWhatsAppSpecialistRuntime,
  type QuickFurnoWhatsAppSpecialistObserver,
  type QuickFurnoWhatsAppSpecialistRuntime,
} from './specialist-runtime.js';
import {
  createQuickFurnoWhatsAppTurnProcessor,
  type QuickFurnoWhatsAppProcessorOutcome,
} from './turn-processor.js';
import type {
  QuickFurnoWhatsAppConversationContextV1,
  QuickFurnoWhatsAppWorkerMaterial,
} from './contracts.js';
import { bindOpenAIV1SealForProduction } from './openai-production-seal-binding.js';
import { bindJf5cSealForProduction } from './production-seal-binding.js';
import type { QuickFurnoWhatsAppProductionWorkerConfig } from './production-worker-config.js';
import { createAgentFlowTraceObservationWriter } from './agent-flow-trace-observation.js';
import { createQuickFurnoAosMarketCapacityReader } from './aos-market-capacity-http.js';
import { createQuickFurnoWorkerObservationWriter } from './production-observation.js';

function boundedProvider(event: GatewayEvent): 'openai' | 'groq' | 'other' {
  const value = event.providerId?.toLowerCase() ?? '';
  if (value.includes('openai')) return 'openai';
  if (value.includes('groq')) return 'groq';
  return 'other';
}

const OTEL_MODEL_GATEWAY_OBSERVABILITY: GatewayObservabilityHook = Object.freeze({
  record(event: GatewayEvent): void {
    const provider = boundedProvider(event);
    const result = event.code ?? event.type;
    if (event.latencyMs !== undefined) {
      recordMetric('qfj.model.duration', event.latencyMs, { provider, result });
    }
    if (event.cost !== undefined) {
      recordMetric('qfj.model.cost', event.cost, { provider, result: 'completed' });
    }
    if (event.type === 'invocation-failed' || event.type === 'timeout') {
      addMetric('qfj.model.errors', 1, { provider, result });
    }
    if (event.type === 'concurrency-refused' || event.type === 'queue-refused') {
      addMetric('qfj.provider.saturation', 1, { provider, result: event.type });
    }
    if (event.type === 'invocation-started') {
      addMetric('qfj.provider.concurrency', 1, { provider, result: 'admitted' });
    }
    emitStructuredLog(
      event.type === 'invocation-failed' || event.type === 'timeout' ? 'WARN' : 'INFO',
      `model_gateway.${event.type}`,
      {
        'model.provider': provider,
        'model.outcome': result,
        ...(event.latencyMs === undefined ? {} : { 'model.latency_ms': event.latencyMs }),
        ...(event.cost === undefined ? {} : { 'model.cost': event.cost }),
        ...(event.totalTokens === undefined ? {} : { 'model.tokens.total': event.totalTokens }),
      },
    );
  },
});

export interface QuickFurnoWhatsAppProductionWorker {
  readonly revision: string;
  readonly providerMode: 'GROQ_ONLY' | 'OPENAI_LUNA_SOL';
  readonly verifiedApprovalCount: number;
  readonly deploymentMode: 'SINGLE_OWNER' | 'MULTI_REPLICA';
  readonly agentLanes: readonly ('RIYA' | 'ANISHA' | 'AAROHI')[];
  readonly maxConcurrentTurns: number;
  readonly maxConcurrentByAgent: Readonly<Record<'RIYA' | 'ANISHA' | 'AAROHI', number>>;
  run(signal: AbortSignal): Promise<void>;
  processOne(): Promise<QuickFurnoWhatsAppProcessorOutcome>;
  close(): Promise<void>;
}

function systemInstant(): string {
  return new Date().toISOString();
}

function sleepUntilAosCycle(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = () => {
      done();
    };
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface ProductionRuntimeStack {
  readonly tier: 'GROQ' | 'LUNA' | 'SOL';
  readonly release: ProviderReleaseRef;
  readonly capabilityProfileRef: string;
  readonly promptBindings: ModelReplyPromptBindings;
  readonly riyaConversationEvolutionPromptBinding: ModelReplyPromptBinding;
  readonly riyaGroundedConversationEvolutionPromptBinding: ModelReplyPromptBinding;
  readonly riyaGroundedReplyPromptBinding: ModelReplyPromptBinding;
  readonly evaluationEvidence: readonly ApprovalEvidence[];
  readonly productionApprovals: readonly ProductionApprovalClaim[];
  readonly baseGatewayInvoker: ModelGatewayInvoker;
}

function capabilityRegistryFor(release: ProviderReleaseRef) {
  return createModelCapabilityRegistry([
    createModelCapabilityProfile({
      release,
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
}

function splitOpenAIConcurrency(input: Readonly<{ maxConcurrent: number; maxQueue: number }>) {
  const solConcurrent = Math.max(1, Math.floor(input.maxConcurrent * 0.2));
  const lunaConcurrent = input.maxConcurrent - solConcurrent;
  const solQueue = Math.max(1, Math.floor(input.maxQueue * 0.2));
  const lunaQueue = input.maxQueue - solQueue;
  if (lunaConcurrent < 1 || lunaQueue < 1) throw new Error('production-worker-config-invalid');
  return Object.freeze({
    LUNA: Object.freeze({ maxConcurrent: lunaConcurrent, maxQueue: lunaQueue }),
    SOL: Object.freeze({ maxConcurrent: solConcurrent, maxQueue: solQueue }),
  });
}

function adaptiveTextSignals(text: string) {
  const normalized = text.toLowerCase();
  const requiresCoreVerification =
    /\b(price|pricing|package|credit|credits|payment|paid|order|status|assigned|assignment|active|activation|account|balance|refund)\b/u.test(
      normalized,
    );
  const highRisk =
    /\b(legal|lawsuit|fraud|scam|threat|harassment|abuse|refund dispute|chargeback|privacy complaint)\b/u.test(
      normalized,
    );
  const multiStepReasoning =
    text.length > 1200 ||
    /\b(compare|analyse|analyze|strategy|plan|trade-?off|step by step|multiple options|pros and cons)\b/u.test(
      normalized,
    );
  const ambiguitySignals =
    /\b(this|that|it|they|same one|previous one|earlier)\b/u.test(normalized) && text.length < 220
      ? 1
      : 0;
  return Object.freeze({
    requiresCoreVerification,
    highRisk,
    multiStepReasoning,
    ambiguitySignals,
  });
}

export async function createQuickFurnoWhatsAppProductionWorker(
  config: QuickFurnoWhatsAppProductionWorkerConfig,
): Promise<QuickFurnoWhatsAppProductionWorker> {
  // Seal verification happens before credential resolution, database I/O or spool claims.
  // Knowledge is part of the certified binding only when this deployment actually enables it.
  const expectedKnowledgeRevision =
    config.knowledge.mode === 'HYBRID' ? config.knowledge.revision : null;
  const gatewayClock = createSystemClock();
  const killSwitch = createQuickFurnoWorkerKillSwitch(config.killSwitchFile);
  const runtimeStacks: ProductionRuntimeStack[] = [];
  let providerMode: QuickFurnoWhatsAppProductionWorker['providerMode'];
  let verifiedApprovalCount: number;

  if (config.modelProvider.mode === 'GROQ_ONLY') {
    const sealed = bindJf5cSealForProduction(
      config.modelProvider.seal,
      config.revision,
      expectedKnowledgeRevision,
    );
    if (!sealed.ok) throw new Error(`production-seal-refused:${sealed.reason}`);
    const binding = sealed.binding;
    const credentialBinding = createFileGroqCredentialBinding({
      credentialReference: Object.freeze({ ref: config.modelProvider.credentialReference }),
      absoluteFilePath: config.modelProvider.credentialFile,
    });
    const apiKey = await credentialBinding.resolver.resolve({
      ref: config.modelProvider.credentialReference,
    });
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
    const production = createProductionModelGateway({
      mode: 'ACTIVE',
      providerMode: 'GROQ_ONLY',
      providers: [provider],
      approvedReleases: [binding.release],
      capabilityRegistry: capabilityRegistryFor(binding.release),
      budgetPolicy: createEstimatedBudgetPolicy({}),
      killSwitch,
      clock: gatewayClock,
      observability: OTEL_MODEL_GATEWAY_OBSERVABILITY,
      concurrency: config.concurrency.modelGateway,
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
    )
      throw new Error('production-model-gateway-refused');
    runtimeStacks.push({
      tier: 'GROQ',
      ...binding,
      baseGatewayInvoker: createLiveModelGatewayInvoker(production.composition.gateway),
    });
    providerMode = 'GROQ_ONLY';
    verifiedApprovalCount = 3;
  } else {
    const sealed = bindOpenAIV1SealForProduction(
      config.modelProvider.seal,
      config.revision,
      expectedKnowledgeRevision,
    );
    if (!sealed.ok) throw new Error(`production-seal-refused:${sealed.reason}`);
    const credentialBinding = createFileOpenAICredentialBinding({
      credentialReference: Object.freeze({ ref: config.modelProvider.credentialReference }),
      absoluteFilePath: config.modelProvider.credentialFile,
    });
    const apiKey = await credentialBinding.resolver.resolve({
      ref: config.modelProvider.credentialReference,
    });
    const concurrency = splitOpenAIConcurrency(config.concurrency.modelGateway);
    for (const tier of ['LUNA', 'SOL'] as const) {
      const binding = sealed.binding[tier];
      const provider = new OpenAIModelProvider(
        createOpenAIProviderConfig({
          providerId: 'openai',
          modelId: binding.release.modelId,
          modelVersion: binding.release.modelVersion,
          executionClass: 'HOSTED',
          maxInputTokens: JARVIS_V1_PRODUCTION_MAX_INPUT_TOKENS,
          maxCompletionTokens: JARVIS_V1_PRODUCTION_MAX_COMPLETION_TOKENS,
          supportsStrictJsonSchema: true,
          reasoningEffort: JARVIS_V1_OPENAI_REASONING_EFFORT_BY_TIER[tier],
          apiKey,
          transport: createFetchOpenAITransport(),
          dataControlsAttested: true,
        }),
        gatewayClock,
      );
      const production = createProductionModelGateway({
        mode: 'ACTIVE',
        providerMode: 'OPENAI_ONLY',
        providers: [provider],
        approvedReleases: [binding.release],
        capabilityRegistry: capabilityRegistryFor(binding.release),
        budgetPolicy: createEstimatedBudgetPolicy({}),
        killSwitch,
        clock: gatewayClock,
        observability: OTEL_MODEL_GATEWAY_OBSERVABILITY,
        concurrency: concurrency[tier],
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
        production.composition.status.providerMode !== 'OPENAI_ONLY' ||
        production.composition.status.fallbackEnabled ||
        production.composition.status.retryBudget !== 0 ||
        production.composition.status.verifiedApprovalCount !== 3
      )
        throw new Error('production-model-gateway-refused');
      runtimeStacks.push({
        ...binding,
        baseGatewayInvoker: createLiveModelGatewayInvoker(production.composition.gateway),
      });
    }
    providerMode = 'OPENAI_LUNA_SOL';
    verifiedApprovalCount = 6;
  }

  let decisionShadowPort: Parameters<typeof createJarvisRuntime>[0]['decisionShadowPort'];
  if (config.decisionIntelligence.mode === 'SHADOW') {
    const jev = new JevDecisionProvider({
      model: config.decisionIntelligence.model,
      apiKey: config.decisionIntelligence.apiKey,
      transport: createFetchTypeSafeTransport(),
    });
    let discoveredModels: readonly string[];
    try {
      discoveredModels = await jev.listModels(
        AbortSignal.timeout(config.decisionIntelligence.timeoutMs),
      );
    } catch {
      throw new Error('production-jev-discovery-failed');
    }
    if (!discoveredModels.includes(config.decisionIntelligence.model)) {
      throw new Error('production-jev-model-unavailable');
    }
    decisionShadowPort = createJevDecisionShadowPort({
      provider: jev,
      timeoutMs: config.decisionIntelligence.timeoutMs,
      minConfidence: config.decisionIntelligence.minConfidence,
      maxConcurrent: config.decisionIntelligence.maxConcurrent,
    });
  }

  let pool: DatabasePool | undefined;
  if (config.database !== undefined) {
    pool = createDatabasePool(config.database);
  }

  const traceObservation =
    config.agentFlowTraceSnapshotFile === undefined
      ? undefined
      : createAgentFlowTraceObservationWriter({
          filePath: config.agentFlowTraceSnapshotFile,
          sourceRevision: config.revision,
        });
  const observation = createQuickFurnoWorkerObservationWriter({
    filePath: config.operationalSnapshotFile,
    revision: config.revision,
    runtimeId: config.runtimeId,
    providerMode,
    knowledge:
      config.knowledge.mode === 'HYBRID'
        ? Object.freeze({
            mode: 'HYBRID' as const,
            revision: config.knowledge.revision,
            embeddingModelRef: config.knowledge.embedding.modelRef,
          })
        : Object.freeze({ mode: 'DISABLED' as const }),
  });
  const observedGatewayInvoker = (baseGatewayInvoker: ModelGatewayInvoker): ModelGatewayInvoker =>
    Object.freeze({
      async invoke(request: Parameters<ModelGatewayInvoker['invoke']>[0]) {
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
      const semanticCache =
        hybridConfig.semanticCache.mode === 'PUBLIC_KNOWLEDGE_ONLY'
          ? createInMemoryPublicKnowledgeSemanticCache({
              maxEntries: hybridConfig.semanticCache.maxEntries,
              threshold: hybridConfig.semanticCache.threshold,
              publicTopics: hybridConfig.semanticCache.publicTopics,
            })
          : undefined;
      const baseHybridKnowledge = createHybridKnowledgeRetriever({
        embedding,
        store: knowledgeStore,
        ...(semanticCache === undefined ? {} : { semanticCache }),
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

    const agniCaseEscalation =
      config.agniCaseEscalation === undefined
        ? undefined
        : createAgniCaseEscalationPort({
            ...config.agniCaseEscalation,
            httpPost: quickFurnoWorkerAgniCaseHttpPost,
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

    const aosShadowConfig = config.aosShadow.mode === 'SHADOW' ? config.aosShadow : undefined;
    const aosRuntime =
      aosShadowConfig === undefined
        ? undefined
        : (() => {
            const reader = createQuickFurnoAosMarketCapacityReader(httpConfig);
            const ownerAttention = createFileAosOwnerAttentionObservationWriter(
              aosShadowConfig.ownerAttentionObservationFile,
            );
            const marketCapacity = createFileAosMarketCapacityObservationWriter(
              aosShadowConfig.marketCapacityObservationFile,
            );

            const runOnce = async (): Promise<void> => {
              const startedAt = performance.now();
              const generatedAt = systemInstant();
              try {
                const snapshot = await reader.read('quickfurno');
                const cycle = await runAosSupervisorShadowCycle({
                  cycleId: 'aos.market.' + String(Date.parse(generatedAt)),
                  generatedAt,
                  marketplaceSlices: snapshot.cells.map((cell) =>
                    Object.freeze({
                      sliceRef: cell.cellRef,
                      cityRef: cell.cityRef,
                      localityRef: cell.localityRef,
                      categoryRef: cell.categoryRef,
                      observedAt: snapshot.observedAt,
                      evidenceRef: 'capacity.' + cell.cellRef,
                      openDemand: cell.demand30d,
                      eligibleSupply: cell.eligibleSupply,
                      maximumDemandPerSupply: 3,
                      marketCell: Object.freeze({
                        demand7d: cell.demand7d,
                        demand30d: cell.demand30d,
                        demand90d: cell.demand90d,
                        registeredSupply: cell.registeredSupply,
                        activeSupply: cell.activeSupply,
                        creditReadySupply: cell.creditReadySupply,
                        threeVendorFillRate: cell.threeVendorFillRate,
                      }),
                    }),
                  ),
                });

                await Promise.all([
                  ownerAttention.write(cycle, generatedAt),
                  marketCapacity.write({
                    cycle,
                    emittedAt: generatedAt,
                    sourceObservedAt: snapshot.observedAt,
                    sourceCoverage: snapshot.coverage,
                    responseEvidence: snapshot.responseEvidence,
                  }),
                ]);

                const stateCounts =
                  cycle.marketplace?.marketCells.reduce(
                    (counts, one) => {
                      counts[one.state] = (counts[one.state] ?? 0) + 1;
                      return counts;
                    },
                    {} as Record<string, number>,
                  ) ?? {};
                const recommendationCounts =
                  cycle.marketplace?.marketCells.reduce(
                    (counts, one) => {
                      counts[one.recommendation] = (counts[one.recommendation] ?? 0) + 1;
                      return counts;
                    },
                    {} as Record<string, number>,
                  ) ?? {};

                addMetric('qfj.aos.cycles', 1, { result: 'success' });
                recordMetric('qfj.aos.cycle.duration', performance.now() - startedAt, {
                  result: 'success',
                });
                setMetric('qfj.aos.source.cells', snapshot.cells.length, {
                  result: snapshot.coverage.cellsTruncated ? 'truncated' : 'complete',
                });
                for (const state of [
                  'UNDER_SUPPLIED',
                  'BALANCED',
                  'OVER_SUPPLIED',
                  'LOW_QUALITY_SUPPLY',
                  'DEMAND_STARVED',
                ] as const) {
                  setMetric('qfj.aos.market.cells', stateCounts[state] ?? 0, {
                    result: state.toLowerCase(),
                  });
                }
                for (const recommendation of [
                  'ACQUIRE_VENDORS',
                  'MAINTAIN',
                  'HOLD_PACKAGE_ACTIVATION',
                  'IMPROVE_VENDOR_QUALITY',
                  'BOOST_CLIENT_DEMAND',
                ] as const) {
                  setMetric('qfj.aos.recommendations', recommendationCounts[recommendation] ?? 0, {
                    result: recommendation.toLowerCase(),
                  });
                }
                emitStructuredLog('INFO', 'aos.market_capacity.cycle_completed', {
                  'aos.cells': snapshot.cells.length,
                  'aos.cases': cycle.cases.length,
                  'aos.recommendations': cycle.recommendations.length,
                  'aos.model_calls': cycle.modelCalls,
                  'aos.source_truncated': snapshot.coverage.cellsTruncated,
                  'aos.execution_authority': 'NONE',
                });
              } catch {
                addMetric('qfj.aos.cycles', 1, { result: 'failed' });
                recordMetric('qfj.aos.cycle.duration', performance.now() - startedAt, {
                  result: 'failed',
                });
                emitStructuredLog('WARN', 'aos.market_capacity.cycle_failed', {
                  'aos.execution_authority': 'NONE',
                });
              }
            };

            return Object.freeze({
              async run(signal: AbortSignal): Promise<void> {
                while (!signal.aborted) {
                  await runOnce();
                  await sleepUntilAosCycle(aosShadowConfig.cadenceMs, signal);
                }
              },
            });
          })();

    const authoritativeState = createQuickFurnoWhatsAppAuthorityStatePort(
      createQuickFurnoWhatsAppAuthorityReader(httpConfig),
    );
    const aarohiAcquisitionBehaviourInput = createQuickFurnoAarohiBehaviourInputReader(httpConfig);
    const specialists = runtimeStacks.map((stack) => {
      const gatewayInvoker = observedGatewayInvoker(stack.baseGatewayInvoker);
      const orchestrationObservability =
        agniCaseEscalation === undefined
          ? undefined
          : Object.freeze({
              onEvent(event: {
                readonly type: string;
                readonly runId: string;
                readonly conversationId: string;
                readonly actor: string | undefined;
                readonly proposalKind: string | undefined;
              }): void {
                if (
                  event.type === 'proposal-created' &&
                  event.actor === 'ANISHA' &&
                  event.proposalKind === 'ESCALATE_TO_HUMAN'
                ) {
                  void agniCaseEscalation
                    .escalateVendor({
                      conversationId: event.conversationId,
                      runId: event.runId,
                    })
                    .catch(() => undefined);
                }
              },
            });

      const sharedRuntimeConfig = {
        authoritativeState,
        aarohiAcquisitionBehaviourInput,
        policy: createRuntimePolicy({
          policyRevision: config.policyRevision,
          unknownRouting: 'HUMAN',
        }),
        clock: systemInstant,
        release: stack.release,
        promptBindings: stack.promptBindings,
        riyaConversationEvolutionPromptBinding: stack.riyaConversationEvolutionPromptBinding,
        riyaGroundedConversationEvolutionPromptBinding:
          stack.riyaGroundedConversationEvolutionPromptBinding,
        riyaGroundedReplyPromptBinding: stack.riyaGroundedReplyPromptBinding,
        promptRegistry,
        capabilityProfileRef: stack.capabilityProfileRef,
        gatewayInvoker,
        ...(decisionShadowPort === undefined ? {} : { decisionShadowPort }),
        ...(agentHybridKnowledge === undefined ? {} : { agentHybridKnowledge }),
        ...(orchestrationObservability === undefined ? {} : { orchestrationObservability }),
        requireEvaluationRef: true as const,
        provenanceRefs: {
          runtimeRef: 'qfj.jarvis-runtime.quickfurno-authority-v2',
          releaseRef: stack.release.releaseId,
          providerRef: stack.release.providerId,
          configRef: stack.release.configDigest,
        },
      };

      // Anisha and Aarohi are certified on RESPONSE_GENERATION, which remains the generic runtime
      // default. Riya's governed client-sales prompt is intentionally certified on
      // RIYA_CONVERSATION_EVOLUTION. Keep the task class scoped to RIYA rather than changing the
      // shared runtime default, otherwise fixing first-contact Riya would silently break the other
      // two agents' exact prompt-registry lookups.
      const genericRuntime = createJarvisRuntime(sharedRuntimeConfig);
      const riyaRuntime = createJarvisRuntime({
        ...sharedRuntimeConfig,
        taskClass: RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1.taskClass,
      });
      const genericSpecialist = createQuickFurnoWhatsAppSpecialistRuntime({
        runtimeId: config.runtimeId,
        jarvisRuntime: genericRuntime,
      });
      const riyaSpecialist = createQuickFurnoWhatsAppSpecialistRuntime({
        runtimeId: config.runtimeId,
        jarvisRuntime: riyaRuntime,
      });
      const runtime: QuickFurnoWhatsAppSpecialistRuntime = Object.freeze({
        process(
          material: QuickFurnoWhatsAppWorkerMaterial,
          conversationContext?: QuickFurnoWhatsAppConversationContextV1,
          observer?: QuickFurnoWhatsAppSpecialistObserver,
        ) {
          const selected =
            'purpose' in material || material.assignedActor === 'RIYA'
              ? riyaSpecialist
              : genericSpecialist;
          return selected.process(material, conversationContext, observer);
        },
      });

      return Object.freeze({
        tier: stack.tier,
        releaseId: stack.release.releaseId,
        runtime,
      });
    });

    const groq = specialists.find((item) => item.tier === 'GROQ');
    const luna = specialists.find((item) => item.tier === 'LUNA');
    const sol = specialists.find((item) => item.tier === 'SOL');
    const routes =
      providerMode === 'GROQ_ONLY'
        ? (() => {
            if (groq === undefined) throw new Error('production-model-gateway-refused');
            const route = Object.freeze({ releaseId: groq.releaseId, runtime: groq.runtime });
            return Object.freeze({ SIMPLE: route, STANDARD: route, COMPLEX: route });
          })()
        : (() => {
            if (luna === undefined || sol === undefined) {
              throw new Error('production-model-gateway-refused');
            }
            return Object.freeze({
              SIMPLE: Object.freeze({ releaseId: luna.releaseId, runtime: luna.runtime }),
              STANDARD: Object.freeze({ releaseId: luna.releaseId, runtime: luna.runtime }),
              COMPLEX: Object.freeze({ releaseId: sol.releaseId, runtime: sol.runtime }),
            });
          })();

    const specialistRuntime = createAdaptiveQuickFurnoWhatsAppSpecialistRuntime({
      activeReleaseIds: specialists.map((item) => item.releaseId),
      routes,
      signals: (material) => {
        const text =
          'purpose' in material
            ? `${material.qualification.questionText} ${material.qualification.answerText}`
            : (material.normalizedText ?? '');
        const adaptive = adaptiveTextSignals(text);
        return {
          normalizedTextChars: Math.min(4096, text.length),
          conversationContextChars: 0,
          knowledgeHitCount: 0,
          ambiguitySignals: adaptive.ambiguitySignals,
          requiresCoreVerification: adaptive.requiresCoreVerification,
          multiStepReasoning: adaptive.multiStepReasoning,
          highRisk: adaptive.highRisk,
        };
      },
    });
    const spool =
      config.turnStore.mode === 'POSTGRES'
        ? (() => {
            if (pool === undefined) throw new Error('production-worker-config-invalid');
            return createPostgresDurableTurnSpool(pool);
          })()
        : await createFileDurableTurnSpool(config.turnStore.directory);
    await spool.recoverStale(config.staleProcessingMs, Date.now());
    const processor = createQuickFurnoWhatsAppTurnProcessor({
      queue: spool,
      materialReader: createQuickFurnoWhatsAppMaterialReader(httpConfig),
      conversationContextReader: createQuickFurnoWhatsAppConversationContextReader(httpConfig),
      specialistRuntime,
      clientVendorFeedbackWriter: createQuickFurnoClientVendorFeedbackWriter(httpConfig),
      clientMatchRequestWriter: createQuickFurnoClientMatchRequestWriter(httpConfig),
      aarohiProjectionWriter: createQuickFurnoAarohiProjectionWriter(httpConfig),
      replyWriter: createQuickFurnoWhatsAppReplyWriter(httpConfig),
      ...(traceObservation === undefined ? {} : { traceSink: traceObservation }),
    });

    let lastObservationMs = 0;
    let observationTail: Promise<void> = Promise.resolve();
    const writeObservation = (
      state: 'HEALTHY' | 'DEGRADED' | 'DISABLED',
      force: boolean,
    ): Promise<void> => {
      const operation = observationTail.then(async () => {
        const nowMs = Date.now();
        if (!force && nowMs - lastObservationMs < 10_000) return;
        const spoolState = await spool.snapshot(nowMs);
        setMetric('qf.job.queue.depth', spoolState.pending, {
          lane: 'jarvis-whatsapp',
          result: 'pending',
        });
        setMetric('qf.job.queue.oldest.age', spoolState.oldestPendingAgeMs ?? 0, {
          lane: 'jarvis-whatsapp',
          result: spoolState.oldestPendingAgeMs === null ? 'empty' : 'pending',
        });
        setMetric('qf.worker.dlq', spoolState.failed, {
          worker_role: 'whatsapp-worker',
          result: 'failed',
        });
        await observation.write(state, spoolState, new Date(nowMs).toISOString());
        lastObservationMs = nowMs;
      });
      observationTail = operation.catch(() => undefined);
      return operation;
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
    let traceObservationTail: Promise<void> = Promise.resolve();
    const writeTraceObservationBestEffort = async (): Promise<void> => {
      if (traceObservation === undefined) return;
      const operation = traceObservationTail.then(() => traceObservation.write(systemInstant()));
      traceObservationTail = operation.catch(() => undefined);
      try {
        await operation;
      } catch {
        // Trace observation is read-only and powerless. Failure affects only trace visibility.
      }
    };
    const recordObservedOutcome = async (
      outcome: QuickFurnoWhatsAppProcessorOutcome,
    ): Promise<void> => {
      observation.recordOutcome(outcome);
      addMetric('qf.worker.jobs', 1, {
        worker_role: 'whatsapp-worker',
        result: outcome,
      });
      if (outcome === 'released-pre-agent') {
        addMetric('qf.worker.retries', 1, {
          worker_role: 'whatsapp-worker',
          result: 'released',
        });
      }
      const state = killSwitch.active()
        ? 'DISABLED'
        : outcome === 'failed-indeterminate'
          ? 'DEGRADED'
          : 'HEALTHY';
      await writeObservationBestEffort(state, outcome !== 'idle');
      if (outcome !== 'idle') await writeTraceObservationBestEffort();
    };
    const processObservedOne = async (): Promise<QuickFurnoWhatsAppProcessorOutcome> => {
      const startedAt = performance.now();
      const outcome = await processor.processOne();
      recordMetric('qf.worker.duration', performance.now() - startedAt, {
        worker_role: 'whatsapp-worker',
        result: outcome,
      });
      await recordObservedOutcome(outcome);
      return outcome;
    };
    const scheduler = createQuickFurnoWhatsAppParallelScheduler({
      queue: spool,
      processor,
      agents: config.agentLanes,
      parallelism: {
        globalMaxConcurrentTurns: config.concurrency.globalMaxConcurrentTurns,
        maxConcurrentByAgent: config.concurrency.maxConcurrentByAgent,
      },
      idlePollMs: config.idlePollMs,
      canClaim: () => !killSwitch.active(),
      async onOutcome(outcome: QuickFurnoWhatsAppProcessorOutcome) {
        await recordObservedOutcome(outcome);
      },
      async onIdle() {
        await writeObservationBestEffort(killSwitch.active() ? 'DISABLED' : 'HEALTHY', false);
      },
    });

    // Required once: a bad aggregate-observation path is a deployment defect and refuses startup.
    await writeObservation(killSwitch.active() ? 'DISABLED' : 'HEALTHY', true);
    // The optional per-turn trace remains powerless: a trace-file defect cannot stop customer work.
    await writeTraceObservationBestEffort();

    return Object.freeze({
      revision: config.revision,
      providerMode,
      verifiedApprovalCount,
      deploymentMode: config.deploymentMode,
      agentLanes: config.agentLanes,
      maxConcurrentTurns: config.concurrency.globalMaxConcurrentTurns,
      maxConcurrentByAgent: config.concurrency.maxConcurrentByAgent,
      processOne: processObservedOne,
      async run(signal: AbortSignal): Promise<void> {
        // Process-local scheduling bounds each selected agent lane. In MULTI_REPLICA mode the
        // PostgreSQL spool adds the shared per-conversation ordering fence across all replicas.
        // AOS runs beside customer chat as a powerless SHADOW loop. Its per-cycle failures are
        // contained inside aosRuntime and never stop Riya/Anisha/Aarohi processing.
        await Promise.all([
          scheduler.run(signal),
          aosRuntime === undefined ? Promise.resolve() : aosRuntime.run(signal),
        ]);
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await traceObservationTail.catch(() => undefined);
        if (pool !== undefined) await closeDatabasePool(pool);
      },
    });
  } catch (error) {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined);
    throw error;
  }
}
