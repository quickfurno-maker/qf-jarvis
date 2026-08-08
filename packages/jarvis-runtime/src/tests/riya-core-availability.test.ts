/**
 * RWC-P5 — the Core availability snapshot at the Riya-aware runtime boundary (ADR-0100 §30).
 *
 * The runtime performs NO Core read. The snapshot arrives from the service that owns the outbound
 * call, exactly as the continuity arrives from the service that owns the store — and, exactly like
 * the continuity and the envelope, it is RE-PROVED here rather than trusted. It crossed a boundary
 * from a system this repository does not compile, through a port with no implementation, so its
 * declared type is a claim about a shape and not evidence of one.
 *
 * The budget question is settled here too: raising Riya's own user-content bound must not quietly
 * require raising the generic gateway defaults for every other agent.
 */
import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { RIYA_CONVERSATION_EVOLUTION_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
} from '../testing/deterministic-runtime-fixture.js';

type ModelRequest = Parameters<ModelGatewayInvoker['invoke']>[0];
type ModelResponse = Extract<ModelGatewayInvocation, { readonly ok: true }>['response'];

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

const EVOLUTION_PROMPT = createPromptDefinition({
  promptId: 'riya.conversation.evolution',
  promptVersion: 1,
  agentScope: 'CLIENT',
  taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  resultMode: 'STRUCTURED',
  systemTemplate: 'Synthetic RWC-P5 evolution fixture prompt. Not a production instruction.',
});

const EVOLUTION_BINDING = {
  promptFamily: EVOLUTION_PROMPT.promptId,
  promptVersion: EVOLUTION_PROMPT.promptVersion,
  evaluationRef: 'evref-p5-0001',
  evaluationPromptDigest: EVOLUTION_PROMPT.contentDigest,
};

const SNAPSHOT: CoreServiceAvailabilitySnapshotV1 = syntheticAvailabilitySnapshot({
  cities: [
    { ref: 'loc.pune', displayName: 'Pune' },
    { ref: 'loc.mumbai', displayName: 'Mumbai' },
  ],
  services: [
    { ref: 'modular-kitchen', displayName: 'Modular Kitchen' },
    { ref: 'wardrobe', displayName: 'Wardrobe' },
  ],
  availability: [
    { serviceRef: 'modular-kitchen', cityRefs: 'ALL' },
    { serviceRef: 'wardrobe', cityRefs: ['loc.pune'] },
  ],
});

function continuity(
  over: Partial<Parameters<typeof createRiyaConversationContinuityState>[0]> = {},
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    continuityRevision: 0,
    phase: 'INTRO',
    discovery: {
      completeness: 'MORE_DISCOVERY_REQUIRED',
      missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
    },
    summaryConfirmed: false,
    ...over,
  });
}

const SET = (field: string, value: string): Record<string, unknown> => ({
  field,
  operation: 'SET',
  value,
  provenance: 'user_stated',
});

function riyaAnswer(
  current: RiyaConversationContinuityStateV1,
  observations: readonly Record<string, unknown>[],
): unknown {
  const decided = evolveRiyaConversation({
    current,
    batch: { version: 1, observations: observations as never, skipProjectDetails: false },
  });
  return {
    reply: { kind: 'REPLY', replyBody: 'Thanks — that helps.', citations: [] },
    evolution: {
      version: 1,
      observations,
      skipProjectDetails: false,
      questionPlan: {
        phase: decided.questionPlan.phase,
        questionFields: [...decided.questionPlan.questionFields],
      },
    },
  };
}

function recordingInvoker(structuredResult: unknown): ModelGatewayInvoker & {
  invoked(): number;
  request(): ModelRequest | undefined;
} {
  let n = 0;
  let seen: ModelRequest | undefined;
  return {
    invoke(request: ModelRequest) {
      n += 1;
      seen = request;
      const md = request.metadata;
      const response: ModelResponse = {
        runId: request.runId,
        resultMode: 'STRUCTURED',
        structuredResult,
        provenance: {
          runId: request.runId,
          purpose: request.purpose,
          providerId: String(md['providerId']),
          modelId: String(md['modelId']),
          modelVersion: String(md['modelVersion']),
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          promptDigest: request.promptDigest,
          mode: 'ACTIVE',
          usedFallback: false,
          attempts: 1,
        },
        usage: { outputTokens: 10, inputTokens: 10, totalTokens: 20 },
        latencyMs: 2,
        finishStatus: 'completed',
      };
      return Promise.resolve({ ok: true as const, response });
    },
    invoked: () => n,
    request: () => seen,
  };
}

function runtimeWith(over: Partial<JarvisRuntimeConfig> = {}) {
  return createJarvisRuntime(
    syntheticRuntimeConfig({
      promptRegistry: createPromptRegistry([EVOLUTION_PROMPT]),
      riyaConversationEvolutionPromptBinding: EVOLUTION_BINDING,
      ...over,
    }),
  );
}

const envelope = () =>
  syntheticInboundEnvelope({
    tenantId: TENANT,
    conversationId: CONVERSATION,
    normalizedText: 'I want a modular kitchen in Pune',
  });

// ---------------------------------------------------------------------------
// The snapshot is re-proved, not trusted.
// ---------------------------------------------------------------------------

describe('the availability snapshot is re-proved at the boundary', () => {
  const expectRefusedBeforeGateway = async (
    snapshot: unknown,
  ): Promise<ReturnType<typeof recordingInvoker>> => {
    const current = continuity();
    const invoker = recordingInvoker(riyaAnswer(current, []));
    const result = await runtimeWith({
      gatewayInvoker: invoker,
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: snapshot as never,
    });
    expect(result.runtimeResult.outcome).toBe('REFUSED');
    expect(result.runtimeResult.refusalReason).toBe('orchestration-invariant');
    expect(result.observationBatch).toBeUndefined();
    expect(result.authorizedReply).toBeUndefined();
    expect(invoker.invoked()).toBe(0);
    return invoker;
  };

  it('accepts a canonical snapshot', async () => {
    const current = continuity();
    const invoker = recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')]));
    const result = await runtimeWith({
      gatewayInvoker: invoker,
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(invoker.invoked()).toBe(1);
    expect(result.observationBatch?.observations).toHaveLength(1);
  });

  it('refuses an absent snapshot before the gateway', async () => {
    await expectRefusedBeforeGateway(undefined);
  });

  it('refuses a malformed snapshot before the gateway', async () => {
    await expectRefusedBeforeGateway({ version: 1, cities: 'everywhere' });
  });

  it('refuses a FORGED extra key before the gateway', async () => {
    // A caller that could smuggle a key past this boundary could smuggle one into the model request.
    await expectRefusedBeforeGateway({
      ...JSON.parse(JSON.stringify(SNAPSHOT)),
      vendorCount: 12,
    });
  });

  it('refuses a snapshot whose availability references a city it never listed', async () => {
    await expectRefusedBeforeGateway({
      ...JSON.parse(JSON.stringify(SNAPSHOT)),
      availability: [
        { serviceRef: 'modular-kitchen', cityRefs: 'ALL' },
        { serviceRef: 'wardrobe', cityRefs: ['loc.atlantis'] },
      ],
    });
  });

  it('refuses an oversized snapshot before the gateway', async () => {
    const cities = Array.from({ length: 60 }, (_unused, index) => ({
      ref: `loc.${'q'.repeat(100)}.${String(index)}`,
      displayName: `City ${String(index)}`,
    }));
    const services = Array.from({ length: 60 }, (_unused, index) => ({
      ref: `svc.${'q'.repeat(100)}.${String(index)}`,
      displayName: `Service ${String(index)}`,
    }));
    await expectRefusedBeforeGateway({
      version: 1,
      snapshotRef: 'snap.big',
      taxonomyVersion: 1,
      cities,
      services,
      availability: services.map((s) => ({
        serviceRef: s.ref,
        cityRefs: cities.map((c) => c.ref),
      })),
    });
  });

  it('the refusal reports the canonical identity and leaks no catalogue', async () => {
    const current = continuity();
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(current, [])),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: { version: 1, cities: [{ ref: 'loc.leak' }] } as never,
    });
    // The envelope was canonicalized before the snapshot was examined, so the identity is real.
    expect(result.runtimeResult.runId).toBe('rt.1');
    expect(result.runtimeResult.conversationId).toBe(CONVERSATION);
    expect(JSON.stringify(result)).not.toContain('loc.leak');
  });
});

// ---------------------------------------------------------------------------
// The authority reaches the model, and only the model.
// ---------------------------------------------------------------------------

describe('the snapshot reaches the one model request and nothing else', () => {
  it('appears in the single user message as its own sibling', async () => {
    const current = continuity();
    const invoker = recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')]));
    await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    const messages = invoker.request()?.messages ?? [];
    expect(messages).toHaveLength(2);
    const payload = JSON.parse(String(messages[1]?.content)) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toStrictEqual([
      'coreAvailability',
      'known',
      'message',
      'phase',
      'summaryConfirmed',
      'version',
    ]);
  });

  it('still costs EXACTLY one gateway invocation, and at most one Core decision', async () => {
    // The whole slice adds an outbound READ, not an inference. If this ever became two, the reply and
    // the extraction could disagree about the same sentence.
    const current = continuity();
    const invoker = recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')]));
    await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(invoker.invoked()).toBe(1);
  });

  it('the runtime itself performs no Core read: it is given the snapshot or it refuses', async () => {
    // There is no reader in the runtime config, and nothing here could call one. The proof is that a
    // turn with no snapshot cannot proceed — the runtime has no way to obtain one.
    const current = continuity();
    const invoker = recordingInvoker(riyaAnswer(current, []));
    const result = await runtimeWith({
      gatewayInvoker: invoker,
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
    } as never);
    expect(result.runtimeResult.outcome).toBe('REFUSED');
    expect(invoker.invoked()).toBe(0);
  });

  it('no availability data leaks into the runtime result', async () => {
    const current = continuity();
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')])),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(Object.keys(result.runtimeResult)).toHaveLength(10);
    const serialized = JSON.stringify(result.runtimeResult);
    for (const forbidden of ['coreAvailability', 'availability', 'displayName', 'Pune', 'snap.']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('the OLDER inbound methods need no snapshot and are unchanged', async () => {
    // P5 extended exactly one capability. `processInbound` still takes an envelope and returns the
    // same ten keys, and nothing about it now depends on Core availability.
    const ordinary = createJarvisRuntime(
      syntheticRuntimeConfig({
        promptRegistry: createPromptRegistry([
          createPromptDefinition({
            promptId: 'reply.client',
            promptVersion: 1,
            agentScope: 'CLIENT',
            taskClass: 'RESPONSE_GENERATION',
            resultMode: 'STRUCTURED',
            systemTemplate: 'Synthetic CLIENT fixture prompt. Not a production instruction.',
          }),
        ]),
      }),
    );
    const result = await ordinary.processInbound(envelope());
    expect(Object.keys(result)).toHaveLength(10);
    expect('availabilitySnapshot' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The budget question, settled with arithmetic rather than optimism.
// ---------------------------------------------------------------------------

describe('the raised Riya bound fits the UNCHANGED gateway budget', () => {
  it('a representative maximum P5 request stays inside the existing 4096 token budget', async () => {
    // RWC-P5 raised the RIYA user-content bound to 12288. It did NOT raise
    // `DEFAULT_GATEWAY_REQUEST_BUDGETS.tokenBudget`, which is 4096 and shared by every agent. The
    // gateway admits a request on `ceil(totalMessageChars / 4)`, so this is the arithmetic that has
    // to hold — proved against the REAL request the composition built, not a hand-made one.
    const cities = Array.from({ length: 30 }, (_unused, index) => ({
      ref: `loc.c${String(index)}`,
      displayName: `City Number ${String(index)}`,
    }));
    const services = Array.from({ length: 25 }, (_unused, index) => ({
      ref: `svc.s${String(index)}`,
      displayName: `Service Number ${String(index)}`,
    }));
    const big = syntheticAvailabilitySnapshot({
      cities,
      services,
      availability: services.map((service, index) =>
        index === 0
          ? { serviceRef: service.ref, cityRefs: cities.slice(0, 4).map((c) => c.ref) }
          : { serviceRef: service.ref, cityRefs: 'ALL' as const },
      ),
    });
    const loaded = createRiyaConversationContinuityState({
      version: 1,
      tenantId: TENANT,
      conversationId: CONVERSATION,
      continuityRevision: 4,
      phase: 'NEED',
      discovery: {
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: ['budget', 'timeline'],
        serviceInterestRef: 'svc.s1',
        locationRef: 'loc.c1',
        propertyTypeRef: 'prop.apartment-3bhk',
        scopeSummary: 'x'.repeat(500),
        consultationPreferenceRef: 'consult.video',
      },
      fieldProvenance: {
        serviceInterest: 'user_stated',
        location: 'user_stated',
        propertyType: 'user_stated',
        scope: 'user_stated',
        consultationPreference: 'user_stated',
      },
      summaryConfirmed: false,
    });

    const invoker = recordingInvoker(riyaAnswer(loaded, []));
    await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
      envelope: syntheticInboundEnvelope({
        tenantId: TENANT,
        conversationId: CONVERSATION,
        // The M1 inbound maximum.
        normalizedText: 'm'.repeat(4096),
      }),
      continuity: loaded,
      availabilitySnapshot: big,
    });

    const request = invoker.request();
    expect(request).toBeDefined();
    const chars = (request?.messages ?? []).reduce(
      (total, message) => total + message.content.length,
      0,
    );
    // The gateway's own estimator, restated as the arithmetic it is. `jarvis-runtime` does not depend
    // on `@qf-jarvis/model-gateway`, so the formula is written out rather than imported.
    const estimatedInputTokens = Math.ceil(chars / 4);
    expect(estimatedInputTokens).toBeLessThanOrEqual(request?.tokenBudget ?? 0);
    expect(request?.tokenBudget).toBe(4096);
  });
});
