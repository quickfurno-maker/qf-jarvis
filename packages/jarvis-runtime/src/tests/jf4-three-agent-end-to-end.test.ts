/**
 * JF-4B/C/D owner correction §16 — whole turns, through ONE governed RAG (ADR-0150 §4).
 *
 * The other JF-4 specs prove pieces in isolation: routing in `jf4-three-agent-routing`, the behaviour
 * mux in `jf4-three-agent-mux`, the authority boundary in `jf4-three-agent-rag`. None of them ran a
 * complete `processInbound`, and that is exactly how a `PROSPECT` turn came to be routable by
 * `assignAgent` and still rejected by the orchestration context schema, which carried its own
 * three-value party list. This file runs the whole composition for each party type and MEASURES what
 * happened, so a gap like that cannot pass again.
 *
 * ### What is synthetic here, and what is not
 *
 * The knowledge RECORDS are synthetic and say so in their own content: invented for a spec, not
 * business truth. Everything that decides is real — `assignAgent`, the closed actor to scope/purpose
 * table, the governed-knowledge authority, the orchestrator's gates, and the composed runtime. No
 * provider is called and no credential exists. Durable `PROSPECT` is proved against a real PostgreSQL
 * by `jf4-durable-prospect.integration.test.ts`; nothing here touches a database.
 *
 * ### The V1 limit these specs record rather than hide
 *
 * Aarohi has no model scope in Production V1. `MODEL_AGENT_SCOPES` and `PROMPT_AGENT_SCOPES` are
 * `CLIENT | VENDOR | COORDINATION | SYSTEM`, so a model-eligible acquisition turn reaches the draft
 * step and FAILS CLOSED — which matches the Aarohi domain itself, where AVG-7 pins `modelCall` and
 * `promptResolution` to literal `false`. The measurement below asserts that refusal explicitly, with
 * ZERO gateway calls, rather than asserting a success Aarohi is not yet entitled to.
 *
 * What grounding buys her today is therefore the boundary, not a draft: the retrieval happens, under
 * the PROSPECT scope, from the one shared authority, and no other agent can read what it returns.
 */
import { assignAgent } from '@qf-jarvis/agent-runtime';
import type { RuntimePolicy } from '@qf-jarvis/agent-runtime';
import {
  createGovernedKnowledgeRegistry,
  createKnowledgeRecord,
  retrieveGovernedKnowledge,
} from '@qf-jarvis/governed-knowledge';
import type {
  KnowledgeEvent,
  KnowledgeObservabilityHook,
  KnowledgeRecordInput,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptAgentScope } from '@qf-jarvis/prompt-registry';
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import { AGENT_KNOWLEDGE_BINDINGS } from '../contracts/agent-knowledge-policy.js';
import type { AgentGroundedKnowledgePolicy } from '../contracts/agent-knowledge-policy.js';
import type { ConversationControlState } from '../contracts/authoritative-state.js';
import type { GovernedRetrievalPort, JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import {
  clearControlState,
  controllableAuthoritativeState,
  mutableAuthoritativeState,
  syntheticInboundEnvelope,
  syntheticPromptDefinition,
  syntheticRuntimeConfig,
} from '../testing/index.js';

type Party = 'CLIENT' | 'VENDOR' | 'PROSPECT' | 'UNKNOWN';
type Actor = 'RIYA' | 'ANISHA' | 'AAROHI';

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';
const POLICY = { unknownRouting: 'JARVIS' } as unknown as RuntimePolicy;

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

const TOPIC_OF: Readonly<Record<Actor, string>> = Object.freeze({
  RIYA: 'topic-riya',
  ANISHA: 'topic-anisha',
  AAROHI: 'topic-aarohi',
});

/** One synthetic record readable by EXACTLY one agent's scope and purpose. */
function privateTo(actor: Actor, seed: string): KnowledgeRecordInput {
  const { agentScope, purpose } = AGENT_KNOWLEDGE_BINDINGS[actor];
  return createKnowledgeRecord({
    knowledgeId: `kb.private.${actor.toLowerCase()}`,
    version: 1,
    topic: TOPIC_OF[actor],
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: `SYNTHETIC ${actor}-ONLY RECORD. Invented for a spec; not business truth.`,
    contentDigest: digest(seed),
    sourceRef: 'test://synthetic',
    sourceRevision: 'rev-1',
    owner: 'owner.test',
    approvedBy: 'approver.test',
    approvedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-02T00:00:00Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: [agentScope],
      allowedPurposes: [purpose],
    },
  });
}

/** A hook that records every content-free governed-knowledge event, in order. */
function recordingObservability(): KnowledgeObservabilityHook & {
  readonly events: () => readonly KnowledgeEvent[];
} {
  const seen: KnowledgeEvent[] = [];
  return {
    onEvent(event: KnowledgeEvent): void {
      seen.push(event);
    },
    events: () => [...seen],
  };
}

/**
 * The whole deployment for one scenario: ONE registry holding all three private records, ONE
 * observability hook, and a topic list per agent.
 *
 * `topics` is all a deployment configures. Nothing here names a scope or a purpose, because the policy
 * has no field for either — which is the property being measured.
 */
function deployment(topics: Readonly<Partial<Record<Actor, readonly string[]>>>): {
  readonly observability: ReturnType<typeof recordingObservability>;
  readonly retrieval: GovernedRetrievalPort;
  readonly policy: AgentGroundedKnowledgePolicy;
} {
  const registry = createGovernedKnowledgeRegistry([
    privateTo('RIYA', 'a'),
    privateTo('ANISHA', 'b'),
    privateTo('AAROHI', 'c'),
  ]);
  const observability = recordingObservability();
  const agents: Record<string, { readonly topics: readonly string[] }> = {};
  for (const [actor, list] of Object.entries(topics)) {
    agents[actor] = { topics: list };
  }
  // ONE retrieval port, as a real deployment supplies (ADR-0150 §43). The observability hook goes to
  // whoever performs the lookup -- which on this path is the port -- and not to the policy, which has
  // no field for one precisely because it does not perform the lookup.
  const retrieval: GovernedRetrievalPort = Object.freeze({
    retrieve: (request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult =>
      retrieveGovernedKnowledge(registry, request, { observability }),
  });
  return { observability, retrieval, policy: { retrieval, agents } };
}

/**
 * One "process": a fresh runtime over a state holder, with countable collaborators.
 *
 * The prompt scope is a parameter because a runtime configuration carries ONE prompt family and one
 * registry, so a vendor scenario supplies a VENDOR-scoped prompt exactly as a vendor deployment would.
 */
function process_(
  holder: { state: ConversationControlState },
  policy: AgentGroundedKnowledgePolicy,
  prompt: { readonly family: string; readonly scope: PromptAgentScope } = {
    family: 'reply.client',
    scope: 'CLIENT',
  },
) {
  const definition = syntheticPromptDefinition(prompt.family, prompt.scope);
  const citationKnowledgeId =
    holder.state.partyType === 'CLIENT'
      ? 'kb.private.riya'
      : holder.state.partyType === 'VENDOR'
        ? 'kb.private.anisha'
        : undefined;
  const gatewayInvoker = scriptedGatewayInvoker(
    structuredReply({
      citations:
        citationKnowledgeId === undefined ? [] : [{ knowledgeId: citationKnowledgeId, version: 1 }],
    }),
  );
  const coreTransport = scriptedCoreTransport('ACCEPTED');
  const config: JarvisRuntimeConfig = syntheticRuntimeConfig({
    authoritativeState: mutableAuthoritativeState(() => holder.state),
    agentGroundedKnowledge: policy,
    promptFamily: prompt.family,
    promptRegistry: createPromptRegistry([definition]),
    evaluationPromptDigest: definition.contentDigest,
    gatewayInvoker,
    coreTransport,
  });
  return {
    runtime: createJarvisRuntime(config),
    gatewayCalls: () => gatewayInvoker.invoked(),
    coreCalls: () => coreTransport.invoked(),
  };
}

const envelopeFor = (party: Party) =>
  syntheticInboundEnvelope({
    channel: 'WEB',
    partyType: party,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    normalizedText: 'a question about what you offer',
  });

const stateFor = (party: Party): ConversationControlState =>
  clearControlState({ tenantId: TENANT, conversationId: CONVERSATION, partyType: party });

// ---------------------------------------------------------------------------
// Ownership, through the runtime's own operations surface.
// ---------------------------------------------------------------------------

describe('the runtime itself reports who owns each party', () => {
  it('names AAROHI for a PROSPECT conversation, and the other three unchanged', async () => {
    // `readConversationOperationsSnapshot` derives the actor with the SAME `assignAgent` the inbound
    // path uses (ADR-0076), so this is the composition's own answer rather than a re-implementation.
    const expected: readonly (readonly [Party, string])[] = [
      ['CLIENT', 'RIYA'],
      ['VENDOR', 'ANISHA'],
      ['PROSPECT', 'AAROHI'],
      ['UNKNOWN', 'JARVIS'],
    ];
    for (const [party, actor] of expected) {
      const source = controllableAuthoritativeState(stateFor(party));
      const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: source }));
      const snapshot = await runtime.readConversationOperationsSnapshot({
        tenantId: TENANT,
        conversationId: CONVERSATION,
      });
      expect(snapshot.ok, party).toBe(true);
      expect(snapshot.ok ? snapshot.snapshot.assignedActor : undefined, party).toBe(actor);
      expect(snapshot.ok ? snapshot.snapshot.partyType : undefined, party).toBe(party);
    }
  });
});

// ---------------------------------------------------------------------------
// One PROSPECT turn, measured end to end.
// ---------------------------------------------------------------------------

describe('a PROSPECT turn grounds under the PROSPECT scope and then fails closed', () => {
  it('retrieves EXACTLY ONCE under PROSPECT, for its own topic, with ZERO gateway calls', async () => {
    const { observability, policy } = deployment({
      RIYA: [TOPIC_OF.RIYA],
      ANISHA: [TOPIC_OF.ANISHA],
      AAROHI: [TOPIC_OF.AAROHI],
    });
    const holder = { state: stateFor('PROSPECT') };
    const turn = process_(holder, policy);

    const result = await turn.runtime.processInbound(envelopeFor('PROSPECT'));

    // The router chose the actor, and this spec only reads its answer.
    expect(assignAgent('PROSPECT', false, POLICY)).toBe('AAROHI');

    // ONE retrieval, under PROSPECT, for the one configured topic. No configuration supplied that
    // scope: the runtime derived it from the actor through the closed table.
    const events = observability.events();
    expect(events).toHaveLength(1);
    expect(events[0]?.agentScope).toBe('PROSPECT');
    expect(events[0]?.reason).toBe('knowledge-served');
    // One record served: the one private to PROSPECT. The served event is deliberately aggregate and
    // carries no per-record identity, so the COUNT is the measurement available here.
    expect(events[0]?.count).toBe(1);

    // The V1 limit, measured. Aarohi has no model scope, so the draft step refuses and the gateway is
    // never reached. `<= 1` is the requirement; the exact figure is recorded so a regression that
    // started calling a model for her would fail here rather than pass a loose bound.
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-draft-invalid');
    expect(result.modelDrafted).toBe(false);
    expect(turn.gatewayCalls()).toBe(0);
    expect(turn.gatewayCalls()).toBeLessThanOrEqual(1);
  });

  it('survives a reload: a brand new runtime over the same state answers identically', async () => {
    const { observability, policy } = deployment({ AAROHI: [TOPIC_OF.AAROHI] });
    const holder = { state: stateFor('PROSPECT') };

    const before = await process_(holder, policy).runtime.processInbound(envelopeFor('PROSPECT'));
    // A second runtime, built from nothing the first one left behind.
    const after = await process_(holder, policy).runtime.processInbound(envelopeFor('PROSPECT'));

    expect(after.outcome).toBe(before.outcome);
    expect(after.refusalReason).toBe(before.refusalReason);
    // Two turns, two retrievals, both under PROSPECT. Neither borrowed the other's single-use run.
    expect(observability.events().map((event) => event.agentScope)).toEqual([
      'PROSPECT',
      'PROSPECT',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The other two agents, over the SAME registry.
// ---------------------------------------------------------------------------

describe('the other agents are unchanged and cannot read the PROSPECT-only record', () => {
  it('a CLIENT turn still completes as RIYA and grounds under CLIENT', async () => {
    const { observability, policy } = deployment({
      RIYA: [TOPIC_OF.RIYA],
      AAROHI: [TOPIC_OF.AAROHI],
    });
    const holder = { state: stateFor('CLIENT') };
    const turn = process_(holder, policy);

    const result = await turn.runtime.processInbound(envelopeFor('CLIENT'));
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.assignedActor).toBe('RIYA');
    expect(observability.events().map((event) => event.agentScope)).toEqual(['CLIENT']);
    // One model call for one turn, not two, and Riya's behaviour is byte-unchanged by the correction.
    expect(turn.gatewayCalls()).toBe(1);
    expect(turn.coreCalls()).toBe(1);
  });

  it('a VENDOR turn completes as ANISHA and grounds under VENDOR', async () => {
    const { observability, policy } = deployment({
      ANISHA: [TOPIC_OF.ANISHA],
      AAROHI: [TOPIC_OF.AAROHI],
    });
    const holder = { state: stateFor('VENDOR') };
    const turn = process_(holder, policy, { family: 'reply.vendor', scope: 'VENDOR' });

    const result = await turn.runtime.processInbound(envelopeFor('VENDOR'));
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.assignedActor).toBe('ANISHA');

    const events = observability.events();
    expect(events).toHaveLength(1);
    expect(events[0]?.agentScope).toBe('VENDOR');
    expect(events[0]?.reason).toBe('knowledge-served');
    expect(events[0]?.count).toBe(1);
    expect(turn.gatewayCalls()).toBe(1);
  });

  it('and cannot read it even when a deployment WRONGLY gives Anisha Aarohi topics', async () => {
    // The strongest form of the claim. A deployment can misconfigure the topic list — that is the one
    // thing it supplies — but it cannot supply a scope, so the authority still refuses the record and
    // the turn fails CLOSED rather than answering from another agent's material.
    const { observability, policy } = deployment({ ANISHA: [TOPIC_OF.AAROHI] });
    const holder = { state: stateFor('VENDOR') };
    const turn = process_(holder, policy, { family: 'reply.vendor', scope: 'VENDOR' });

    const result = await turn.runtime.processInbound(envelopeFor('VENDOR'));
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-knowledge-refused');
    // Asked under VENDOR, as always. The topic was exact and the record exists — and it was still not
    // served, because it is private to the PROSPECT scope.
    const events = observability.events();
    expect(events).toHaveLength(1);
    expect(events[0]?.agentScope).toBe('VENDOR');
    // `knowledge-not-found`, not `knowledge-permission-denied`, and that is the stronger answer: a
    // record this scope may not read is INVISIBLE to it rather than merely refused, so the event
    // cannot tell a vendor turn that a prospect record exists.
    expect(events[0]?.reason).toBe('knowledge-not-found');
    expect(events[0]?.reason).not.toBe('knowledge-served');
    // A refused retrieval reaches no model at all.
    expect(turn.gatewayCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No configuration means no retrieval. Never "retrieve everything".
// ---------------------------------------------------------------------------

describe('no configuration means no retrieval', () => {
  it('an unconfigured agent reaches the authority ZERO times', async () => {
    const { observability, policy } = deployment({ RIYA: [TOPIC_OF.RIYA] });
    const holder = { state: stateFor('PROSPECT') };

    await process_(holder, policy).runtime.processInbound(envelopeFor('PROSPECT'));
    // Aarohi has no topics here, so the authority was never asked — and emphatically not asked for
    // everything, which is what a "retrieve all" fallback would have done.
    expect(observability.events()).toHaveLength(0);
  });

  it('an agent configured with an EMPTY topic list also reaches it ZERO times', async () => {
    const { observability, policy } = deployment({ AAROHI: [] });
    const holder = { state: stateFor('PROSPECT') };

    await process_(holder, policy).runtime.processInbound(envelopeFor('PROSPECT'));
    expect(observability.events()).toHaveLength(0);
  });

  it('an UNKNOWN turn grounds on nothing, because JARVIS is not a grounded business agent', async () => {
    const { observability, policy } = deployment({
      RIYA: [TOPIC_OF.RIYA],
      ANISHA: [TOPIC_OF.ANISHA],
      AAROHI: [TOPIC_OF.AAROHI],
    });
    const holder = { state: stateFor('UNKNOWN') };
    const turn = process_(holder, policy, { family: 'reply.coord', scope: 'COORDINATION' });

    const result = await turn.runtime.processInbound(envelopeFor('UNKNOWN'));
    expect(result.assignedActor).toBe('JARVIS');
    // Routed to a non-grounded actor, so no topic list was reachable and no agent's topics were
    // borrowed to fill the gap.
    expect(observability.events()).toHaveLength(0);
  });
});
