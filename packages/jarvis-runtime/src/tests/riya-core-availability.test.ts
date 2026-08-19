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

import { createRiyaConversationModelProfile } from '@qf-jarvis/riya-model-interaction';

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

/**
 * Split a canonical-style observation list into the POST-SDH4 provider container.
 *
 * The provider representation no longer carries `operation` on the item — the array a payload sits in
 * IS the discriminator — so these fixtures keep expressing intent as one tagged list and this helper
 * projects it into what the wire now expects.
 */
function providerObservations(
  observations: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const strip = (one: Record<string, unknown>): Record<string, unknown> => {
    const { operation: _operation, ...rest } = one;
    return rest;
  };
  return {
    sets: observations.filter((one) => one['operation'] === 'SET').map(strip),
    clears: observations.filter((one) => one['operation'] === 'CLEAR').map(strip),
  };
}

function riyaAnswer(
  current: RiyaConversationContinuityStateV1,
  observations: readonly Record<string, unknown>[],
): unknown {
  const decided = evolveRiyaConversation({
    current,
    batch: { version: 1, observations: observations as never, skipProjectDetails: false },
  });
  return {
    // HF4: required-and-nullable reasonCode; null projects to absence.
    reply: { kind: 'REPLY', replyBody: 'Thanks — that helps.', reasonCode: null, citations: [] },
    evolution: {
      version: 1,
      observations: providerObservations(observations),
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
// The request budget: what is proved, and what is explicitly NOT.
// ---------------------------------------------------------------------------

/**
 * The TRUE-maximum P5 data fixture: near the snapshot ceiling AND at the ref ceiling.
 *
 * The earlier version searched for the first padding whose canonical JSON landed in the window, and
 * that match arrived while the selected index-0 refs were still SHORT of Riya's 64-character
 * `NeedDiscovery` limit. So it proved a large snapshot beside ordinary refs, not a maximal request.
 *
 * Fixed constants instead of a search, because two things must hold at once and a search proved only
 * the first:
 *
 * - `PAD` = 58 makes a two-digit-index ref exactly `4 + 58 + 2 = 64` — the Riya maximum — while every
 *   single-digit-index ref is 63, so the whole catalogue stays P5-valid;
 * - index 10 is therefore the entry whose ref is exactly 64, and it is what the continuity holds.
 *
 * Deterministic and asserted, not assumed: the specs below pin the resulting sizes exactly, so a
 * change to the serialization shows up as a failure rather than as a quietly weaker proof.
 */
const NEAR_CEILING_PAD = 58;
const NEAR_CEILING_MAX_REF_INDEX = 10;

function nearCeilingSnapshot(): {
  readonly snapshot: CoreServiceAvailabilitySnapshotV1;
  readonly chars: number;
  readonly serviceRef: string;
  readonly cityRef: string;
  readonly longestRef: number;
} {
  const cities = Array.from({ length: 24 }, (_unused, index) => ({
    ref: `loc.${'c'.repeat(NEAR_CEILING_PAD)}${String(index)}`,
    displayName: `City Number ${String(index)}`,
  }));
  const services = Array.from({ length: 16 }, (_unused, index) => ({
    ref: `svc.${'s'.repeat(NEAR_CEILING_PAD)}${String(index)}`,
    displayName: `Service Number ${String(index)}`,
  }));
  const snapshot = syntheticAvailabilitySnapshot({
    cities,
    services,
    availability: services.map((service) => ({
      serviceRef: service.ref,
      cityRefs: 'ALL' as const,
    })),
  });
  return {
    snapshot,
    chars: JSON.stringify(snapshot).length,
    serviceRef: services[NEAR_CEILING_MAX_REF_INDEX]?.ref ?? '',
    cityRef: cities[NEAR_CEILING_MAX_REF_INDEX]?.ref ?? '',
    longestRef: Math.max(
      ...cities.map((city) => city.ref.length),
      ...services.map((service) => service.ref.length),
    ),
  };
}

/** Continuity holding ALL SEVEN discovery values at their maximum permitted sizes. */
function maximalContinuity(serviceRef: string, cityRef: string): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    continuityRevision: 4,
    phase: 'SUMMARY',
    discovery: {
      completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
      missingFields: [],
      serviceInterestRef: serviceRef,
      locationRef: cityRef,
      // The remaining refs are conversational, not catalogue entries, so Core availability has no
      // opinion on them -- but they are still at their own canonical `NeedDiscovery` maximum of 64,
      // because the point of this fixture is the largest request the contracts permit.
      propertyTypeRef: `prop.${'p'.repeat(59)}`,
      scopeSummary: 'x'.repeat(500),
      budgetNote: 'b'.repeat(120),
      timelineNote: 't'.repeat(120),
      consultationPreferenceRef: `consult.${'v'.repeat(56)}`,
    },
    fieldProvenance: {
      serviceInterest: 'user_stated',
      location: 'user_stated',
      propertyType: 'user_stated',
      scope: 'user_stated',
      budget: 'user_stated',
      timeline: 'user_stated',
      consultationPreference: 'user_stated',
    },
    summaryConfirmed: false,
  });
}

/**
 * An invoker that models the REAL gateway admission check before reaching a provider.
 *
 * The budget policy lives INSIDE the gateway, behind this port — `createEstimatedBudgetPolicy`
 * refuses a request whose `ceil(totalMessageChars / 4)` exceeds its own `tokenBudget`. So the
 * faithful place to model it is here, and `providerCalls` is what proves nothing was ever sent to a
 * model: an over-budget request is refused at admission and never produces a response.
 */
function budgetEnforcingInvoker(structuredResult: unknown): ModelGatewayInvoker & {
  admissions(): number;
  providerCalls(): number;
  request(): ModelRequest | undefined;
} {
  let admissions = 0;
  let providerCalls = 0;
  let seen: ModelRequest | undefined;
  return {
    invoke(request: ModelRequest) {
      admissions += 1;
      seen = request;
      const chars = request.messages.reduce((total, message) => total + message.content.length, 0);
      if (Math.ceil(chars / 4) > request.tokenBudget) {
        // `token-budget-exceeded`. Not transient, and no provider is reached.
        return Promise.resolve({ ok: false as const, transient: false });
      }
      providerCalls += 1;
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
    admissions: () => admissions,
    providerCalls: () => providerCalls,
    request: () => seen,
  };
}

/** The gateway's own estimator, restated. `jarvis-runtime` does not depend on `model-gateway`. */
const estimateInputTokens = (request: ModelRequest | undefined): number =>
  Math.ceil(
    (request?.messages ?? []).reduce((total, message) => total + message.content.length, 0) / 4,
  );

describe('the request budget, proved precisely and claimed narrowly', () => {
  const REQUEST_CHARACTER_BUDGET = 4096 * 4;
  /** `prompt-registry`'s own ceiling on a system template. NOT a request-budget guarantee. */
  const PROMPT_REGISTRY_MAX_TEMPLATE_CHARS = 16_384;

  it('the fixture really is maximal: every field at its contractual ceiling', () => {
    // Proved rather than asserted in prose. A "maximum" fixture that is quietly sub-maximal proves
    // less than it claims, which is how a budget headroom gets believed and then turns out not to
    // exist.
    const { chars, serviceRef, cityRef, longestRef } = nearCeilingSnapshot();

    // Every catalogue ref is P5-valid, and the selected pair sits exactly on the Riya limit.
    expect(longestRef).toBe(64);
    expect(cityRef.length).toBe(64);
    expect(serviceRef.length).toBe(64);

    // The snapshot is near its own ceiling.
    expect(chars).toBeGreaterThanOrEqual(5_500);
    expect(chars).toBeLessThanOrEqual(6_000);
    expect(chars).toBe(5_929);

    // And every remaining discovery field is at ITS maximum.
    const current = maximalContinuity(serviceRef, cityRef);
    expect(current.discovery.serviceInterestRef).toHaveLength(64);
    expect(current.discovery.locationRef).toHaveLength(64);
    expect(current.discovery.propertyTypeRef).toHaveLength(64);
    expect(current.discovery.consultationPreferenceRef).toHaveLength(64);
    expect(current.discovery.scopeSummary).toHaveLength(500);
    expect(current.discovery.budgetNote).toHaveLength(120);
    expect(current.discovery.timelineNote).toHaveLength(120);
  });

  it('near-ceiling P5 DATA leaves real system-prompt headroom under the unchanged budget', () => {
    // The claim being made, and its limits. `MAX_RIYA_USER_CONTENT_CHARS` is a Riya-local
    // serialization ceiling -- it bounds what this agent will SEND. It is not a promise that a
    // payload at that ceiling combines with every prompt-registry-valid system prompt inside the
    // shared 4096-token budget, because the budget covers BOTH messages.
    //
    // So the honest thing to measure is the headroom that remains.
    const { snapshot, serviceRef, cityRef } = nearCeilingSnapshot();
    const message = 'm'.repeat(4096);
    expect(message).toHaveLength(4096);

    const content = createRiyaConversationModelProfile({
      current: maximalContinuity(serviceRef, cityRef),
      availabilitySnapshot: snapshot,
    }).buildUserContent({ normalizedText: message } as never);

    expect(content.length).toBeLessThanOrEqual(12_288);
    const remainingSystemPromptChars = REQUEST_CHARACTER_BUDGET - content.length;
    expect(remainingSystemPromptChars).toBeGreaterThan(0);
    // And the headroom is a real working amount, not a technicality -- but it is well BELOW what the
    // prompt registry alone would accept, which is exactly the distinction this block exists for.
    expect(remainingSystemPromptChars).toBeLessThan(PROMPT_REGISTRY_MAX_TEMPLATE_CHARS);

    // The exact current numbers, pinned. If a serialization detail moves them, that is a review
    // question rather than something to discover during an activation.
    expect(content.length).toBe(11_432);
    expect(REQUEST_CHARACTER_BUDGET).toBe(16_384);
    expect(remainingSystemPromptChars).toBe(4_952);
  });

  it('a bounded evaluated prompt that FITS the headroom composes inside the 4096-token budget', async () => {
    const { snapshot, serviceRef, cityRef } = nearCeilingSnapshot();
    const current = maximalContinuity(serviceRef, cityRef);
    const message = 'm'.repeat(4096);

    const userContent = createRiyaConversationModelProfile({
      current,
      availabilitySnapshot: snapshot,
    }).buildUserContent({ normalizedText: message } as never);
    // Sized to fit, with a small margin for the composition's own framing.
    const fitting = REQUEST_CHARACTER_BUDGET - userContent.length - 64;
    expect(fitting).toBeGreaterThan(0);

    const prompt = createPromptDefinition({
      promptId: 'riya.conversation.evolution',
      promptVersion: 1,
      agentScope: 'CLIENT',
      taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
      resultMode: 'STRUCTURED',
      systemTemplate: `Synthetic RWC-P5 fixture. ${'p'.repeat(fitting - 26)}`,
    });
    const invoker = budgetEnforcingInvoker(riyaAnswer(current, []));
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        promptRegistry: createPromptRegistry([prompt]),
        riyaConversationEvolutionPromptBinding: {
          promptFamily: prompt.promptId,
          promptVersion: prompt.promptVersion,
          evaluationRef: 'evref-p5-fit',
          evaluationPromptDigest: prompt.contentDigest,
        },
        gatewayInvoker: invoker,
      }),
    ).processInboundForRiyaConversationEvolution({
      envelope: syntheticInboundEnvelope({
        tenantId: TENANT,
        conversationId: CONVERSATION,
        normalizedText: message,
      }),
      continuity: current,
      availabilitySnapshot: snapshot,
    });

    expect(invoker.admissions()).toBe(1);
    expect(invoker.providerCalls()).toBe(1);
    expect(invoker.request()?.tokenBudget).toBe(4096);
    expect(estimateInputTokens(invoker.request())).toBeLessThanOrEqual(4096);
    expect(result.observationBatch).toBeDefined();
  });

  it('a prompt-registry-VALID prompt that exceeds the headroom fails CLOSED', async () => {
    // The point of the whole block. `prompt-registry` accepts a 16384-character template; the M4
    // request budget covers the system prompt AND the P5 projection together. So a definition can be
    // perfectly valid and still not fit, and what must happen then is a refusal — never a truncated
    // catalogue, a truncated prompt, or a second model call.
    const { snapshot, serviceRef, cityRef } = nearCeilingSnapshot();
    const current = maximalContinuity(serviceRef, cityRef);
    const message = 'm'.repeat(4096);

    const oversizedButValid = PROMPT_REGISTRY_MAX_TEMPLATE_CHARS;
    const prompt = createPromptDefinition({
      promptId: 'riya.conversation.evolution',
      promptVersion: 1,
      agentScope: 'CLIENT',
      taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
      resultMode: 'STRUCTURED',
      systemTemplate: `Synthetic RWC-P5 oversized fixture. ${'p'.repeat(oversizedButValid - 36)}`,
    });
    // It really is a legal definition -- this is not a malformed-prompt test.
    expect(prompt.systemTemplate.length).toBe(PROMPT_REGISTRY_MAX_TEMPLATE_CHARS);

    const invoker = budgetEnforcingInvoker(riyaAnswer(current, []));
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        promptRegistry: createPromptRegistry([prompt]),
        riyaConversationEvolutionPromptBinding: {
          promptFamily: prompt.promptId,
          promptVersion: prompt.promptVersion,
          evaluationRef: 'evref-p5-over',
          evaluationPromptDigest: prompt.contentDigest,
        },
        gatewayInvoker: invoker,
      }),
    ).processInboundForRiyaConversationEvolution({
      envelope: syntheticInboundEnvelope({
        tenantId: TENANT,
        conversationId: CONVERSATION,
        normalizedText: message,
      }),
      continuity: current,
      availabilitySnapshot: snapshot,
    });

    // Refused at ADMISSION: no provider was ever reached, so nothing was generated, paid for or
    // partially applied.
    expect(estimateInputTokens(invoker.request())).toBeGreaterThan(4096);
    expect(invoker.providerCalls()).toBe(0);
    // One admission attempt, and no retry.
    expect(invoker.admissions()).toBe(1);
    // A bounded existing outcome. No new error code was invented for this.
    expect(result.runtimeResult.outcome).toBe('REFUSED');
    expect(result.observationBatch).toBeUndefined();
    expect(result.authorizedReply).toBeUndefined();
  });

  it('a realistic marketplace catalogue is comfortable — but it is NOT the maximum', async () => {
    // Retained as a realistic shape, and labelled as one. Thirty cities and twenty-five services with
    // a tiny synthetic prompt says nothing about the ceiling; the specs above are what bound it.
    const cities = Array.from({ length: 30 }, (_unused, index) => ({
      ref: `loc.c${String(index)}`,
      displayName: `City Number ${String(index)}`,
    }));
    const services = Array.from({ length: 25 }, (_unused, index) => ({
      ref: `svc.s${String(index)}`,
      displayName: `Service Number ${String(index)}`,
    }));
    const realistic = syntheticAvailabilitySnapshot({
      cities,
      services,
      availability: services.map((service, index) =>
        index === 0
          ? { serviceRef: service.ref, cityRefs: cities.slice(0, 4).map((c) => c.ref) }
          : { serviceRef: service.ref, cityRefs: 'ALL' as const },
      ),
    });
    const current = createRiyaConversationContinuityState({
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

    const invoker = budgetEnforcingInvoker(riyaAnswer(current, []));
    await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
      envelope: syntheticInboundEnvelope({
        tenantId: TENANT,
        conversationId: CONVERSATION,
        normalizedText: 'm'.repeat(4096),
      }),
      continuity: current,
      availabilitySnapshot: realistic,
    });

    expect(invoker.providerCalls()).toBe(1);
    expect(estimateInputTokens(invoker.request())).toBeLessThanOrEqual(4096);
    expect(invoker.request()?.tokenBudget).toBe(4096);
  });
});
