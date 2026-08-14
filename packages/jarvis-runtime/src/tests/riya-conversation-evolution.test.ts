/**
 * RWC-P4B — the Riya-aware inbound capability (ADR-0099 §35).
 *
 * The claim under test is structural, not conversational: ONE call to
 * `processInboundForRiyaConversationEvolution` performs ONE orchestration run, which makes ONE model
 * gateway invocation and at most one Core decision — and that single answer yields both the reply the
 * older methods already produced and the observations this turn learned.
 *
 * The two failure shapes it exists to prevent are (a) a second model call to "also extract", and (b)
 * the extraction quietly borrowing the ordinary reply prompt. So every spec here either counts
 * gateway invocations or pins which prompt was resolved.
 *
 * Everything drives the REAL composition root. Nothing calls `composeAndProcessInternal`,
 * `orchestrateInbound` or the M4 adapter directly.
 */
import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import { RIYA_CONVERSATION_EVOLUTION_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { ConversationControlState } from '../contracts/authoritative-state.js';
import {
  clearControlState,
  scriptedAuthoritativeState,
} from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
} from '../testing/deterministic-runtime-fixture.js';

/**
 * The gateway's request/response shapes, DERIVED from the invoker port rather than imported.
 *
 * `jarvis-runtime` does not depend on `@qf-jarvis/model-gateway` and must not start: it reaches the
 * gateway only through M4's injected invoker, and a test that took the direct dependency would make
 * the package's own allowlist a little less true than it reads.
 */
type ModelRequest = Parameters<ModelGatewayInvoker['invoke']>[0];
type ModelResponse = Extract<ModelGatewayInvocation, { readonly ok: true }>['response'];

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

/**
 * The Core authority this suite reasons against (RWC-P5).
 *
 * Supplied by the caller, never read by the runtime: the service that owns the outbound call owns
 * the read, exactly as the service that owns the store owns the continuity. Every ref these specs
 * emit exists here, because a ref Core does not list is refused before it can mean anything.
 */
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

/**
 * The DEDICATED evolution prompt: same CLIENT scope, different task class.
 *
 * That difference is the whole point of the binding. A registry resolves by identity AND task class,
 * so an evolution run that fell back to the ordinary reply prompt would be asking an un-evaluated
 * question with an evaluated prompt's credentials.
 */
const EVOLUTION_PROMPT = createPromptDefinition({
  promptId: 'riya.conversation.evolution',
  promptVersion: 1,
  agentScope: 'CLIENT',
  taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  resultMode: 'STRUCTURED',
  systemTemplate: 'Synthetic RWC-P4B evolution fixture prompt. Not a production instruction.',
});

const REPLY_PROMPT = createPromptDefinition({
  promptId: 'reply.client',
  promptVersion: 1,
  agentScope: 'CLIENT',
  taskClass: 'RESPONSE_GENERATION',
  resultMode: 'STRUCTURED',
  systemTemplate: 'Synthetic CLIENT runtime fixture prompt. Not a production instruction.',
});

const EVOLUTION_BINDING = {
  promptFamily: EVOLUTION_PROMPT.promptId,
  promptVersion: EVOLUTION_PROMPT.promptVersion,
  evaluationRef: 'evref-p4b-0001',
  evaluationPromptDigest: EVOLUTION_PROMPT.contentDigest,
};

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

/** A model answer whose claimed plan is the one the reducer actually decides for `current`. */
function riyaAnswer(
  current: RiyaConversationContinuityStateV1,
  observations: readonly Record<string, unknown>[],
): unknown {
  const decided = evolveRiyaConversation({
    current,
    batch: { version: 1, observations: observations as never, skipProjectDetails: false },
  });
  return {
    reply: {
      kind: 'REPLY',
      replyBody: 'Thanks — that helps. Could you tell me a little more?',
      // HF4: `reasonCode` is REQUIRED and nullable in the model-facing schema — Groq strict mode
      // has no absent property. The profile projects null back to an absent key, so the
      // provider-neutral reply these assertions read is unchanged.
      reasonCode: null,
      citations: [],
    },
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

/** A gateway invoker that counts invocations and records the request it was handed. */
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
        usage: { outputTokens: 42, inputTokens: 10, totalTokens: 52 },
        latencyMs: 5,
        finishStatus: 'completed',
      };
      return Promise.resolve({ ok: true as const, response });
    },
    invoked: () => n,
    request: () => seen,
  };
}

/** A Core transport that counts how many decisions one turn asked for. */
function countingCoreTransport(outcome: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED') {
  const inner = scriptedCoreTransport(outcome);
  let n = 0;
  return {
    count: (): number => n,
    send(command: Parameters<typeof inner.send>[0]) {
      n += 1;
      return inner.send(command);
    },
  };
}

function runtimeWith(over: Partial<JarvisRuntimeConfig> = {}) {
  return createJarvisRuntime(
    syntheticRuntimeConfig({
      // BOTH definitions are registered, so a fallback to the reply prompt would silently succeed
      // rather than fail with a missing-prompt error. The specs below have to catch it by identity.
      promptRegistry: createPromptRegistry([REPLY_PROMPT, EVOLUTION_PROMPT]),
      riyaConversationEvolutionPromptBinding: EVOLUTION_BINDING,
      ...over,
    }),
  );
}

const envelope = () =>
  syntheticInboundEnvelope({
    tenantId: TENANT,
    conversationId: CONVERSATION,
    normalizedText: 'I want a modular kitchen',
  });

// ---------------------------------------------------------------------------
// The older methods did not move.
// ---------------------------------------------------------------------------

describe('the two older inbound methods are untouched', () => {
  it('processInbound still returns the exact ten content-free keys', async () => {
    const result = await runtimeWith().processInbound(envelope());
    expect(Object.keys(result).sort()).toStrictEqual([
      'assignedActor',
      'boundRevision',
      'conversationId',
      'coreConsulted',
      'modelDrafted',
      'outcome',
      'proposalId',
      'provenance',
      'refusalReason',
      'runId',
    ]);
    // No observation, batch or continuity field appears on the ordinary result.
    for (const forbidden of ['observationBatch', 'observations', 'continuity', 'profileDetail']) {
      expect(forbidden in result, forbidden).toBe(false);
    }
  });

  it('the ordinary CLIENT reply path still resolves the ORDINARY prompt and schema', async () => {
    const invoker = recordingInvoker({
      kind: 'REPLY',
      replyBody: 'ordinary',
      citations: [],
    });
    await runtimeWith({ gatewayInvoker: invoker }).processInbound(envelope());
    expect(invoker.request()?.promptId).toBe('reply.client');
    expect(invoker.request()?.promptDigest).toBe(REPLY_PROMPT.contentDigest);
    expect(invoker.request()?.metadata['taskClass']).toBe('RESPONSE_GENERATION');
    // The user message is the client's own text, not a projection of anything.
    expect(invoker.request()?.messages[1]?.content).toBe('I want a modular kitchen');
  });

  it('processInboundForCoreAuthorizedReply still returns its exact two keys', async () => {
    const result = await runtimeWith().processInboundForCoreAuthorizedReply(envelope());
    expect(Object.keys(result).sort()).toStrictEqual(['authorizedReply', 'runtimeResult']);
    expect('observationBatch' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What the new method requires before it will reach a model.
// ---------------------------------------------------------------------------

describe('it fails closed before the gateway, as a REFUSED run', () => {
  const expectRefused = (
    result: Awaited<
      ReturnType<ReturnType<typeof runtimeWith>['processInboundForRiyaConversationEvolution']>
    >,
  ): void => {
    // A REFUSED result, never a throw. Every other runtime path normalizes the same way, and a
    // method that threw would make one inbound path behave unlike the other two.
    expect(result.runtimeResult.outcome).toBe('REFUSED');
    expect(result.runtimeResult.refusalReason).toBe('orchestration-invariant');
    expect(result.runtimeResult.modelDrafted).toBe(false);
    expect(result.authorizedReply).toBeUndefined();
    expect(result.observationBatch).toBeUndefined();
  };

  it('refuses a non-canonical continuity', async () => {
    const invoker = recordingInvoker(riyaAnswer(continuity(), []));
    const runtime = runtimeWith({ gatewayInvoker: invoker });
    // A hand-assembled state whose provenance contradicts its discovery: a store could return one
    // mid-migration, and it must not become the context a model reasons from.
    const forged = {
      ...continuity(),
      discovery: { ...continuity().discovery, budgetNote: 'around 8 lakh' },
    } as RiyaConversationContinuityStateV1;
    expectRefused(
      await runtime.processInboundForRiyaConversationEvolution({
        envelope: envelope(),
        continuity: forged,
        availabilitySnapshot: SNAPSHOT,
      }),
    );
    expect(invoker.invoked()).toBe(0);
  });

  it('refuses a continuity about a different tenant', async () => {
    const invoker = recordingInvoker(riyaAnswer(continuity(), []));
    expectRefused(
      await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
        envelope: envelope(),
        continuity: continuity({ tenantId: 'tenant.b' }),
        availabilitySnapshot: SNAPSHOT,
      }),
    );
    expect(invoker.invoked()).toBe(0);
  });

  it('refuses a continuity about a different conversation', async () => {
    const invoker = recordingInvoker(riyaAnswer(continuity(), []));
    expectRefused(
      await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
        envelope: envelope(),
        continuity: continuity({ conversationId: 'conv.other' }),
        availabilitySnapshot: SNAPSHOT,
      }),
    );
    expect(invoker.invoked()).toBe(0);
  });

  for (const phase of ['CONTACT', 'CONSENT', 'COMPLETE'] as const) {
    it(`refuses ${phase}: RWC-P6 owns it, and this slice will not reason past its ceiling`, async () => {
      const invoker = recordingInvoker(riyaAnswer(continuity(), []));
      const beyond = createRiyaConversationContinuityState({
        version: 1,
        tenantId: TENANT,
        conversationId: CONVERSATION,
        continuityRevision: 4,
        phase,
        discovery: {
          completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
          missingFields: [],
          serviceInterestRef: 'modular-kitchen',
          locationRef: 'loc.pune',
          budgetNote: 'around 8 lakh',
          timelineNote: 'next month',
        },
        fieldProvenance: {
          serviceInterest: 'user_stated',
          location: 'user_stated',
          budget: 'user_stated',
          timeline: 'user_stated',
        },
        summaryConfirmed: true,
        // COMPLETE is only a valid state once completion has been evidenced; the contract refuses
        // the phase without it, so the fixture supplies one for that case alone.
        ...(phase === 'COMPLETE' ? { completionEvidenceRef: 'evidence.p6.0001' } : {}),
      });
      expectRefused(
        await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
          envelope: envelope(),
          continuity: beyond,
          availabilitySnapshot: SNAPSHOT,
        }),
      );
      expect(invoker.invoked()).toBe(0);
    });
  }

  it('refuses when no dedicated evolution prompt binding is configured', async () => {
    const invoker = recordingInvoker(riyaAnswer(continuity(), []));
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        promptRegistry: createPromptRegistry([REPLY_PROMPT, EVOLUTION_PROMPT]),
        gatewayInvoker: invoker,
      }),
    );
    expectRefused(
      await runtime.processInboundForRiyaConversationEvolution({
        envelope: envelope(),
        continuity: continuity(),
        availabilitySnapshot: SNAPSHOT,
      }),
    );
    // There is deliberately NO fallback to the ordinary CLIENT reply prompt, even though it is
    // configured and would resolve. Borrowing it would mean an un-evaluated question going out under
    // an evaluated prompt's credentials.
    expect(invoker.invoked()).toBe(0);
  });

  for (const missing of ['evaluationRef', 'evaluationPromptDigest'] as const) {
    it(`refuses a binding without ${missing}: a half-supplied evaluation is not an evaluation`, async () => {
      const invoker = recordingInvoker(riyaAnswer(continuity(), []));
      // Rebuilt without the key rather than deleted from a copy: an own key holding `undefined`
      // is not the same as an absent one, and absence is what a half-supplied binding looks like.
      const partial = Object.fromEntries(
        Object.entries(EVOLUTION_BINDING).filter(([key]) => key !== missing),
      ) as typeof EVOLUTION_BINDING;
      expectRefused(
        await runtimeWith({
          gatewayInvoker: invoker,
          riyaConversationEvolutionPromptBinding: partial,
        }).processInboundForRiyaConversationEvolution({
          envelope: envelope(),
          continuity: continuity(),
          availabilitySnapshot: SNAPSHOT,
        }),
      );
      expect(invoker.invoked()).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// The happy path: one call, one answer, two products.
// ---------------------------------------------------------------------------

describe('one call, one model invocation, one Core decision', () => {
  it('reaches the DEDICATED evolution prompt and task class, not the reply prompt', async () => {
    const current = continuity();
    const invoker = recordingInvoker(
      riyaAnswer(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(invoker.request()?.promptId).toBe('riya.conversation.evolution');
    expect(invoker.request()?.promptDigest).toBe(EVOLUTION_PROMPT.contentDigest);
    expect(invoker.request()?.metadata['taskClass']).toBe(RIYA_CONVERSATION_EVOLUTION_TASK_CLASS);
    expect(invoker.request()?.metadata['evaluationRef']).toBe('evref-p4b-0001');
    expect(invoker.request()?.promptId).not.toBe('reply.client');
  });

  it('sends the continuity projection as the one user message', async () => {
    const current = continuity();
    const invoker = recordingInvoker(
      riyaAnswer(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    await runtimeWith({ gatewayInvoker: invoker }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    const messages = invoker.request()?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe(EVOLUTION_PROMPT.systemTemplate);
    const payload = JSON.parse(String(messages[1]?.content)) as {
      version: number;
      phase: string;
      message: string;
    };
    expect(payload.version).toBe(1);
    expect(payload.phase).toBe('INTRO');
    expect(payload.message).toBe('I want a modular kitchen');
  });

  it('invokes the gateway EXACTLY once and Core at most once', async () => {
    const current = continuity();
    const invoker = recordingInvoker(
      riyaAnswer(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    const core = countingCoreTransport();
    await runtimeWith({
      gatewayInvoker: invoker,
      coreTransport: core,
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    // The whole design collapses if this is ever 2: a separate extraction call would double the
    // cost, double the latency, and could disagree with the reply about the same sentence.
    expect(invoker.invoked()).toBe(1);
    expect(core.count()).toBeLessThanOrEqual(1);
  });

  it('returns the canonical batch, the reply and an ordinary content-free runtime result', async () => {
    const current = continuity();
    const invoker = recordingInvoker(
      riyaAnswer(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    const result = await runtimeWith({
      gatewayInvoker: invoker,
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });

    expect(Object.keys(result).sort()).toStrictEqual([
      'authorizedReply',
      'observationBatch',
      'runtimeResult',
    ]);
    expect(result.observationBatch?.observations).toHaveLength(1);
    expect(result.observationBatch?.observations[0]).toMatchObject({
      field: 'serviceInterest',
      operation: 'SET',
      provenance: 'user_stated',
    });
    // The ordinary result is still exactly the ten keys, and still content-free.
    expect(Object.keys(result.runtimeResult)).toHaveLength(10);
    expect(JSON.stringify(result.runtimeResult)).not.toContain('modular-kitchen');
    expect(JSON.stringify(result.runtimeResult)).not.toContain('Thanks');
  });

  it('the same answer through the OLD method produces no batch at all', async () => {
    // Proof the capability is opt-in by method, not by configuration: the identical run reported
    // through `processInboundForCoreAuthorizedReply` carries no observations anywhere.
    const result = await runtimeWith().processInboundForCoreAuthorizedReply(envelope());
    expect(JSON.stringify(result)).not.toContain('observationBatch');
  });
});

// ---------------------------------------------------------------------------
// When the batch exists, and when it does not.
// ---------------------------------------------------------------------------

describe('a batch exists only when the structured answer passed every M4 gate', () => {
  it('no batch when the model was never invoked', async () => {
    const current = continuity();
    // No invoker at all -- the key is omitted rather than set to `undefined`, which is the same
    // distinction the runtime config itself makes under `exactOptionalPropertyTypes`.
    const base = syntheticRuntimeConfig({
      promptRegistry: createPromptRegistry([REPLY_PROMPT, EVOLUTION_PROMPT]),
      riyaConversationEvolutionPromptBinding: EVOLUTION_BINDING,
    });
    const { gatewayInvoker: _none, ...withoutInvoker } = base;
    const result = await createJarvisRuntime(
      withoutInvoker,
    ).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.observationBatch).toBeUndefined();
    expect(result.runtimeResult.modelDrafted).toBe(false);
  });

  it('no batch when the structured answer is invalid', async () => {
    const current = continuity();
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker({ nope: true }),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.observationBatch).toBeUndefined();
  });

  it('no batch when the claimed question plan disagrees with the reducer', async () => {
    const current = continuity();
    const answer = riyaAnswer(current, [SET('serviceInterest', 'modular-kitchen')]) as {
      evolution: { questionPlan: { phase: string; questionFields: string[] } };
    };
    const wrong = {
      ...answer,
      evolution: {
        ...answer.evolution,
        questionPlan: { phase: 'SUMMARY', questionFields: [] },
      },
    };
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(wrong),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    // A disagreement refuses the WHOLE answer rather than keeping the half it liked.
    expect(result.observationBatch).toBeUndefined();
  });

  it('no batch when the reply cites something the plan never authorized', async () => {
    const current = continuity();
    const answer = riyaAnswer(current, [SET('serviceInterest', 'modular-kitchen')]) as {
      reply: Record<string, unknown>;
    };
    const forgedCitation = {
      ...answer,
      reply: { ...answer.reply, citations: [{ knowledgeId: 'kb.not-authorized', version: 3 }] },
    };
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(forgedCitation),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.observationBatch).toBeUndefined();
  });

  it('a batch MAY coexist with a Core rejection, because extraction already validated', async () => {
    const current = continuity();
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')])),
      coreTransport: scriptedCoreTransport('REJECTED'),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });

    expect(result.runtimeResult.outcome).toBe('CORE_REJECTED');
    // Core declining to send a reply does not unsay the sentence the client typed.
    expect(result.observationBatch?.observations).toHaveLength(1);
    // And the RWC-P2D gate is unchanged: a rejected proposal materializes no body.
    expect(result.authorizedReply).toBeUndefined();
  });

  it('the authorizedReply gate is exactly the one RWC-P2D set', async () => {
    const current = continuity();
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')])),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });
    if (result.runtimeResult.outcome === 'CORE_ACCEPTED') {
      expect(result.authorizedReply?.proposalId).toBe(result.runtimeResult.proposalId);
      expect(result.authorizedReply?.boundRevision).toBe(result.runtimeResult.boundRevision);
    } else {
      expect(result.authorizedReply).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// A state change AFTER M4 returns (owner correction).
// ---------------------------------------------------------------------------

describe('observations never outlive the orchestration that produced them', () => {
  /**
   * Drive a state change that lands AFTER M4's post-gateway gate but BEFORE M2's double gate.
   *
   * That window is real and narrow, and it is the only one that matters here: a change DURING the
   * gateway round-trip is already caught by M4 itself, which then releases no detail at all. The
   * scripted source hands out one state per read, so the drift is placed by READ ORDER -- the first
   * three reads are the ones the pre-gate and M4 make, and everything after them sees the new state.
   */
  const driftingAfterModel = (drifted: ConversationControlState) =>
    scriptedAuthoritativeState(
      clearControlState(),
      clearControlState(),
      clearControlState(),
      drifted,
    );

  const cases: readonly { readonly label: string; readonly drifted: ConversationControlState }[] = [
    { label: 'the conversation revision moved', drifted: clearControlState({ revision: 9 }) },
    {
      label: 'a human took the conversation over',
      drifted: clearControlState({ humanTakeover: true }),
    },
    { label: 'the conversation was cancelled', drifted: clearControlState({ cancelled: true }) },
  ];

  for (const { label, drifted } of cases) {
    it(`${label} after the model answered: REFUSED, and NO observations`, async () => {
      const current = continuity();
      const invoker = recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')]));
      const result = await runtimeWith({
        gatewayInvoker: invoker,
        authoritativeState: driftingAfterModel(drifted),
      }).processInboundForRiyaConversationEvolution({
        envelope: envelope(),
        continuity: current,
        availabilitySnapshot: SNAPSHOT,
      });

      // The model DID answer -- this is not a pre-gateway refusal.
      expect(invoker.invoked()).toBe(1);
      expect(result.runtimeResult.outcome).toBe('REFUSED');
      // The run did not pass its own final gate, so nothing extracted inside that window survives it.
      // Persisting here would record a fact from a turn the runtime refused.
      expect(result.observationBatch).toBeUndefined();
      expect(result.authorizedReply).toBeUndefined();
    });
  }

  it('a Core REJECTION is a different thing entirely, and still carries the batch', async () => {
    // ADR-0099 s12 is unaffected. A Core rejection arrives on a SUCCESSFUL orchestration: the run
    // passed every state gate, and only the business decision went the other way.
    const current = continuity();
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')])),
      coreTransport: scriptedCoreTransport('REJECTED'),
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });

    expect(result.runtimeResult.outcome).toBe('CORE_REJECTED');
    expect(result.observationBatch?.observations).toHaveLength(1);
  });

  it('an unreachable Core transport still carries the batch', async () => {
    const current = continuity();
    const unavailable = { send: () => Promise.reject(new Error('core at 10.0.0.5 unreachable')) };
    const result = await runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')])),
      coreTransport: unavailable,
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });

    // Whatever the closed Core semantics report for an unreachable transport, the orchestration ran
    // and the extraction was validated, so the observations stand.
    expect(result.runtimeResult.outcome).not.toBe('REFUSED');
    expect(result.observationBatch?.observations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The envelope is re-proved, not cast (owner correction).
// ---------------------------------------------------------------------------

describe('a hand-assembled input is canonicalized before anything reads it', () => {
  const canonical = (): Record<string, unknown> => ({
    runtimeId: 'rt.1',
    conversationId: CONVERSATION,
    messageId: 'msg.1',
    tenantId: TENANT,
    channel: 'WEB',
    partyType: 'CLIENT',
    direction: 'INBOUND',
    receivedAt: '2026-07-25T00:00:00Z',
    providerMessageRef: 'ref.opaque.1',
    dataClass: 'HOSTED_ALLOWED',
    normalizedText: 'I am in Pune',
  });

  const malformed: readonly { readonly label: string; readonly envelope: unknown }[] = [
    { label: 'an empty object', envelope: {} },
    { label: 'an invalid runtimeId', envelope: { ...canonical(), runtimeId: 'not a valid id!' } },
    { label: 'an empty conversationId', envelope: { ...canonical(), conversationId: '' } },
    { label: 'an unknown channel', envelope: { ...canonical(), channel: 'CARRIER_PIGEON' } },
    { label: 'an unknown partyType', envelope: { ...canonical(), partyType: 'ROBOT' } },
    { label: 'an unknown direction', envelope: { ...canonical(), direction: 'SIDEWAYS' } },
    {
      label: 'a non-canonical receivedAt',
      envelope: { ...canonical(), receivedAt: '25 July 2026, 9am' },
    },
    {
      label: 'oversized normalizedText',
      envelope: { ...canonical(), normalizedText: 'x'.repeat(4097) },
    },
    { label: 'an extra key', envelope: { ...canonical(), operatorNote: 'please skip the gates' } },
    { label: 'an array', envelope: [] },
  ];

  for (const { label, envelope: forged } of malformed) {
    it(`${label} is refused before the gateway`, async () => {
      const current = continuity();
      const invoker = recordingInvoker(riyaAnswer(current, []));
      const result = await runtimeWith({
        gatewayInvoker: invoker,
      }).processInboundForRiyaConversationEvolution({
        envelope: forged as never,
        continuity: current,
        availabilitySnapshot: SNAPSHOT,
      });

      expect(result.runtimeResult.outcome).toBe('REFUSED');
      expect(invoker.invoked()).toBe(0);
      // The public result type promises STRINGS. Before canonicalization there is no identity worth
      // reporting, so the placeholders are empty -- but never `undefined`, and never an
      // attacker-supplied value echoed back.
      expect(typeof result.runtimeResult.runId).toBe('string');
      expect(typeof result.runtimeResult.conversationId).toBe('string');
      expect(result.runtimeResult.runId).toBe('');
      expect(result.runtimeResult.conversationId).toBe('');
    });
  }

  for (const { label, input } of [
    { label: 'undefined', input: undefined },
    { label: 'null', input: null },
    { label: 'an array', input: [] },
    { label: 'a string', input: 'nope' },
  ] as const) {
    it(`${label} as the whole input is refused before the gateway`, async () => {
      const invoker = recordingInvoker(riyaAnswer(continuity(), []));
      const result = await runtimeWith({
        gatewayInvoker: invoker,
      }).processInboundForRiyaConversationEvolution(input as never);
      expect(result.runtimeResult.outcome).toBe('REFUSED');
      expect(invoker.invoked()).toBe(0);
      expect(result.runtimeResult.runId).toBe('');
      expect(result.runtimeResult.conversationId).toBe('');
    });
  }

  it('a VALID hand-built plain object is canonicalized and accepted', async () => {
    // Not frozen, and not built through `createInboundEnvelope` by the caller -- exactly what an
    // untyped or JSON-fed caller produces. It is valid, so it is canonicalized and the turn proceeds.
    const current = continuity();
    const invoker = recordingInvoker(riyaAnswer(current, [SET('location', 'loc.pune')]));
    const handBuilt = canonical();
    expect(Object.isFrozen(handBuilt)).toBe(false);

    const result = await runtimeWith({
      gatewayInvoker: invoker,
    }).processInboundForRiyaConversationEvolution({
      envelope: handBuilt as never,
      continuity: current,
      availabilitySnapshot: SNAPSHOT,
    });

    expect(invoker.invoked()).toBe(1);
    expect(result.observationBatch?.observations).toHaveLength(1);
    // The CANONICAL envelope is what reached the run: the identity on the result is the
    // constructor's output, not the caller's object.
    expect(result.runtimeResult.runId).toBe('rt.1');
    expect(result.runtimeResult.conversationId).toBe(CONVERSATION);
  });

  it('a refusal AFTER canonicalization reports the canonical identity, not empty strings', async () => {
    // The identity is trustworthy from that point on, so a later refusal can say which conversation
    // it was about. Here the continuity is about a different tenant.
    const invoker = recordingInvoker(riyaAnswer(continuity(), []));
    const result = await runtimeWith({
      gatewayInvoker: invoker,
    }).processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: continuity({ tenantId: 'tenant.b' }),
      availabilitySnapshot: SNAPSHOT,
    });
    expect(result.runtimeResult.outcome).toBe('REFUSED');
    expect(result.runtimeResult.runId).toBe('rt.1');
    expect(result.runtimeResult.conversationId).toBe(CONVERSATION);
    expect(invoker.invoked()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No global capture.
// ---------------------------------------------------------------------------

describe('two concurrent runs cannot see one another observations', () => {
  it('each call gets exactly its own batch', async () => {
    const a = continuity();
    const b = continuity({ conversationId: 'conv.2' });

    const runtimeA = runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(a, [SET('serviceInterest', 'modular-kitchen')])),
    });
    const runtimeB = runtimeWith({
      gatewayInvoker: recordingInvoker(riyaAnswer(b, [SET('location', 'loc.pune')])),
      // The authoritative source is tenant+conversation scoped, so a second conversation needs its
      // own state rather than borrowing the first's.
      authoritativeState: scriptedAuthoritativeState(
        clearControlState({ conversationId: 'conv.2' }),
      ),
    });

    const [resultA, resultB] = await Promise.all([
      runtimeA.processInboundForRiyaConversationEvolution({
        envelope: syntheticInboundEnvelope({
          tenantId: TENANT,
          conversationId: CONVERSATION,
          normalizedText: 'kitchen please',
        }),
        continuity: a,
        availabilitySnapshot: SNAPSHOT,
      }),
      runtimeB.processInboundForRiyaConversationEvolution({
        envelope: syntheticInboundEnvelope({
          tenantId: TENANT,
          conversationId: 'conv.2',
          normalizedText: 'I am in Pune',
        }),
        continuity: b,
        availabilitySnapshot: SNAPSHOT,
      }),
    ]);

    expect(resultA.observationBatch?.observations[0]?.field).toBe('serviceInterest');
    expect(resultB.observationBatch?.observations[0]?.field).toBe('location');
  });

  it('ONE runtime instance, two turns: the second does not inherit the first batch', async () => {
    // The capture lives inside ONE internal run, not on the runtime object. A module-level or
    // instance-level capture would let a turn that observed nothing report the previous turn's
    // observations -- and the service would then persist a fact twice.
    const a = continuity();
    const answers = [riyaAnswer(a, [SET('serviceInterest', 'modular-kitchen')]), riyaAnswer(a, [])];
    let call = 0;
    const sequenced: ModelGatewayInvoker = {
      invoke(request: ModelRequest) {
        const answer = answers[Math.min(call, answers.length - 1)];
        call += 1;
        return recordingInvoker(answer).invoke(request);
      },
    };
    const runtime = runtimeWith({ gatewayInvoker: sequenced });

    const first = await runtime.processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: a,
      availabilitySnapshot: SNAPSHOT,
    });
    const second = await runtime.processInboundForRiyaConversationEvolution({
      envelope: envelope(),
      continuity: a,
      availabilitySnapshot: SNAPSHOT,
    });
    expect(first.observationBatch?.observations).toHaveLength(1);
    expect(second.observationBatch?.observations).toHaveLength(0);
  });
});
