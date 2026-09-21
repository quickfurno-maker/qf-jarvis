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
  const sealed = bindJf5cSealForProduction(config.seal, config.revision);
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
  let closed = false;
  try {
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
      promptRegistry,
      capabilityProfileRef: binding.capabilityProfileRef,
      gatewayInvoker: createLiveModelGatewayInvoker(production.composition.gateway),
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

    return Object.freeze({
      revision: config.revision,
      providerMode: 'GROQ_ONLY' as const,
      verifiedApprovalCount: 3 as const,
      processOne: () => processor.processOne(),
      async run(signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
          // Do not claim a new turn while disabled. The gateway repeats this check at invocation time,
          // so a switch created after claim but before model execution still blocks the call.
          if (killSwitch.active()) {
            await abortableDelay(config.idlePollMs, signal);
            continue;
          }
          const outcome = await processor.processOne();
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
