/**
 * JF-4B/C/D owner correction — ONE governed RAG, three truthful scopes (ADR-0150 §4).
 *
 * Matrix A1–A9, B10–B19, C20–C21, D22–D32, F39–F42, G43–G47, H48–H53.
 *
 * ### The matrix that matters
 *
 * Section B is a 3×3 cross-agent denial matrix, and it is the whole point of giving each agent its own
 * scope. Two agents sharing a scope works perfectly until the day a record written for one of them is
 * read by the other — and nothing about the working case tells you that day is coming. So every
 * combination is asserted, not a sample: three private records, three agents, nine outcomes.
 *
 * These use the REAL governed-knowledge authority and the REAL shared bridge. A double for either would
 * prove the wiring compiles rather than that the boundary holds.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import { assignAgent } from '@qf-jarvis/agent-runtime';
import {
  KNOWLEDGE_AGENT_SCOPES,
  KNOWLEDGE_PURPOSES,
  createGovernedKnowledgeRegistry,
  createKnowledgeRecord,
  retrieveGovernedKnowledge,
} from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeAgentScope,
  KnowledgePurpose,
  KnowledgeRecordInput,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import { syntheticInboundEnvelope } from '../testing/index.js';
import { createAgentGroundedKnowledgeBridge } from '../composition/riya-grounded-knowledge.js';
import {
  AGENT_KNOWLEDGE_BINDINGS,
  GROUNDED_AGENT_ACTORS,
  isGroundedAgentActor,
  topicsForActor,
} from '../contracts/agent-knowledge-policy.js';
import type {
  AgentGroundedKnowledgePolicy,
  GroundedAgentActor,
} from '../contracts/agent-knowledge-policy.js';
import type { GovernedRetrievalPort } from '../contracts/runtime-config.js';
import type { RuntimePolicy } from '@qf-jarvis/agent-runtime';

const POLICY = { unknownRouting: 'JARVIS' } as unknown as RuntimePolicy;
const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

/** One synthetic record, private to exactly the scopes and purposes named. */
function record(over: Partial<KnowledgeRecordInput>) {
  return createKnowledgeRecord({
    knowledgeId: 'kb.synthetic',
    version: 1,
    topic: 'synthetic-topic',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: 'SYNTHETIC RECORD. Invented for a spec; not business truth.',
    contentDigest: digest('a'),
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
      allowedAgentScopes: ['CLIENT'],
      allowedPurposes: ['CLIENT_RESPONSE'],
    },
    ...over,
  });
}

/** A record private to ONE agent's scope and purpose. */
function privateTo(actor: GroundedAgentActor, seed: string) {
  const { agentScope, purpose } = AGENT_KNOWLEDGE_BINDINGS[actor];
  return record({
    knowledgeId: `kb.private.${actor.toLowerCase()}`,
    topic: `topic-${actor.toLowerCase()}`,
    content: `SYNTHETIC ${actor}-ONLY RECORD. Invented for a spec; not business truth.`,
    contentDigest: digest(seed),
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: [agentScope],
      allowedPurposes: [purpose],
    },
  });
}

function envelope(partyType: 'CLIENT' | 'VENDOR' | 'PROSPECT' | 'UNKNOWN'): InboundEnvelope {
  return syntheticInboundEnvelope({
    channel: 'WEB',
    partyType,
    conversationId: 'conv.1',
    normalizedText: 'a question',
    receivedAt: '2026-06-01T10:00:00Z',
  });
}

/**
 * A shared `GovernedRetrievalPort` over one registry — the shape a REAL deployment supplies.
 *
 * The shared production policy is retrieval-only (ADR-0150 §43): there is no `registry` field, because
 * a direct registry answers production turns around the JF-3 provisioning boundary. These specs
 * therefore configure what a deployment configures. `retrieveGovernedKnowledge` is exactly what JF-3's
 * ACTIVE provisioner calls, so nothing about the authority's decision is simulated here — only the
 * ACTIVE/revision gate that JF-3 owns and that `apps/api` proves separately with the real adapter.
 */
function retrievalOver(registry: GovernedKnowledgeRegistry): GovernedRetrievalPort {
  return Object.freeze({
    retrieve: (request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult =>
      retrieveGovernedKnowledge(registry, request),
  });
}

/** The shared policy a deployment supplies: ONE port, and per-agent topics. */
function sharedPolicy(
  registry: GovernedKnowledgeRegistry,
  agents: AgentGroundedKnowledgePolicy['agents'],
): AgentGroundedKnowledgePolicy {
  return { retrieval: retrievalOver(registry), agents };
}

const m2Request = (topics: readonly string[]) =>
  ({ conversationId: 'conv.1', topics: [...topics], dataClass: 'HOSTED_ALLOWED' }) as never;

/** Retrieve as one agent, over one registry, for one topic list. */
async function retrieveAs(
  actor: GroundedAgentActor,
  registry: GovernedKnowledgeRegistry,
  topics: readonly string[],
  party: 'CLIENT' | 'VENDOR' | 'PROSPECT',
): Promise<{ ok: boolean; citations?: readonly { knowledgeId: string }[] }> {
  const { agentScope, purpose } = AGENT_KNOWLEDGE_BINDINGS[actor];
  const bridge = createAgentGroundedKnowledgeBridge({
    envelope: envelope(party),
    topics,
    agentScope,
    purpose,
    registry,
  });
  return await bridge.knowledgePort.retrieve(m2Request(topics));
}

const PARTY_OF: Readonly<Record<GroundedAgentActor, 'CLIENT' | 'VENDOR' | 'PROSPECT'>> =
  Object.freeze({ RIYA: 'CLIENT', ANISHA: 'VENDOR', AAROHI: 'PROSPECT' });

describe('(A) the knowledge vocabulary carries all three agents', () => {
  it('(A1,A2,A3,A4,A5) scopes are the five closed values, and nothing else', () => {
    expect([...KNOWLEDGE_AGENT_SCOPES]).toEqual([
      'CLIENT',
      'VENDOR',
      'PROSPECT',
      'COORDINATION',
      'SYSTEM',
    ]);
    // An arbitrary scope cannot be constructed into a record at all.
    expect(() =>
      record({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['ACQUISITION' as KnowledgeAgentScope],
          allowedPurposes: ['CLIENT_RESPONSE'],
        },
      }),
    ).toThrow();
  });

  it('(A6,A7,A8,A9) the three response purposes exist, and an arbitrary one is refused', () => {
    for (const purpose of ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'] as const) {
      expect(KNOWLEDGE_PURPOSES).toContain(purpose);
    }
    expect(() =>
      record({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['CLIENT'],
          allowedPurposes: ['PROSPECT_SELL' as KnowledgePurpose],
        },
      }),
    ).toThrow();
  });

  it('each agent binds to exactly one scope and one purpose, and no two share either', () => {
    const scopes = GROUNDED_AGENT_ACTORS.map((a) => AGENT_KNOWLEDGE_BINDINGS[a].agentScope);
    const purposes = GROUNDED_AGENT_ACTORS.map((a) => AGENT_KNOWLEDGE_BINDINGS[a].purpose);
    expect(scopes).toEqual(['CLIENT', 'VENDOR', 'PROSPECT']);
    expect(purposes).toEqual(['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE']);
    expect(new Set(scopes).size).toBe(3);
    expect(new Set(purposes).size).toBe(3);
  });
});

describe('(B) the 3x3 cross-agent denial matrix', () => {
  it('(B10..B18) a record private to one agent is invisible to the other two', async () => {
    const records = {
      RIYA: privateTo('RIYA', 'a'),
      ANISHA: privateTo('ANISHA', 'b'),
      AAROHI: privateTo('AAROHI', 'c'),
    } as const;
    const registry = createGovernedKnowledgeRegistry([
      records.RIYA,
      records.ANISHA,
      records.AAROHI,
    ]);

    const outcomes: string[] = [];
    for (const owner of GROUNDED_AGENT_ACTORS) {
      for (const reader of GROUNDED_AGENT_ACTORS) {
        const topic = records[owner].topic;
        const result = await retrieveAs(reader, registry, [topic], PARTY_OF[reader]);
        outcomes.push(`${owner}->${reader}=${String(result.ok)}`);
      }
    }
    // Nine outcomes, exactly three true, and each true one is the owner reading its own record.
    expect(outcomes).toEqual([
      'RIYA->RIYA=true',
      'RIYA->ANISHA=false',
      'RIYA->AAROHI=false',
      'ANISHA->RIYA=false',
      'ANISHA->ANISHA=true',
      'ANISHA->AAROHI=false',
      'AAROHI->RIYA=false',
      'AAROHI->ANISHA=false',
      'AAROHI->AAROHI=true',
    ]);
  });

  it('(B19) a deliberately multi-scope record is visible to exactly the scopes it names', async () => {
    // Sharing is possible and is a RECORD's decision, stated in its own permissions -- not an agent's
    // decision, and never a side effect of two agents sharing a scope.
    const shared = record({
      knowledgeId: 'kb.shared.client.prospect',
      topic: 'topic-shared',
      contentDigest: digest('d'),
      permissions: {
        tenantScope: 'GLOBAL',
        allowedAgentScopes: ['CLIENT', 'PROSPECT'],
        allowedPurposes: ['CLIENT_RESPONSE', 'PROSPECT_RESPONSE'],
      },
    });
    const registry = createGovernedKnowledgeRegistry([shared]);
    expect((await retrieveAs('RIYA', registry, ['topic-shared'], 'CLIENT')).ok).toBe(true);
    expect((await retrieveAs('AAROHI', registry, ['topic-shared'], 'PROSPECT')).ok).toBe(true);
    expect((await retrieveAs('ANISHA', registry, ['topic-shared'], 'VENDOR')).ok).toBe(false);
  });
});

describe('(C,D) scope and purpose are derived, never supplied', () => {
  it('(C20,C21) the policy type has no scope or purpose field for a caller to set', () => {
    const policy = sharedPolicy(createGovernedKnowledgeRegistry([privateTo('AAROHI', 'c')]), {
      AAROHI: { topics: ['topic-aarohi'] },
    });
    // A deployment configures TOPICS. Scope and purpose are absent from what it can express, so a
    // client turn has no field through which to request vendor or prospect records.
    expect(Object.keys(policy.agents.AAROHI ?? {})).toEqual(['topics']);
    for (const actor of GROUNDED_AGENT_ACTORS) {
      const binding = AGENT_KNOWLEDGE_BINDINGS[actor];
      expect(Object.isFrozen(binding)).toBe(true);
      // Frozen: the table cannot be edited at runtime to re-point an agent at another scope.
      expect(() => {
        (binding as { agentScope: string }).agentScope = 'VENDOR';
      }).toThrow(TypeError);
    }
  });

  it('(D22,D23,D24) each party routes to the agent whose scope it then retrieves under', () => {
    for (const [party, actor] of [
      ['CLIENT', 'RIYA'],
      ['VENDOR', 'ANISHA'],
      ['PROSPECT', 'AAROHI'],
    ] as const) {
      const assigned = assignAgent(party, false, POLICY);
      expect(assigned).toBe(actor);
      expect(AGENT_KNOWLEDGE_BINDINGS[actor].agentScope).toBe(
        party === 'CLIENT' ? 'CLIENT' : party === 'VENDOR' ? 'VENDOR' : 'PROSPECT',
      );
    }
  });

  it('(D25,D26) UNKNOWN/JARVIS and HUMAN ground nothing, and borrow no policy', () => {
    const policy = sharedPolicy(createGovernedKnowledgeRegistry([privateTo('RIYA', 'a')]), {
      RIYA: { topics: ['topic-riya'] },
      ANISHA: { topics: ['topic-anisha'] },
      AAROHI: { topics: ['topic-aarohi'] },
    });
    for (const actor of ['JARVIS', 'HUMAN', 'SYSTEM']) {
      expect(isGroundedAgentActor(actor)).toBe(false);
      expect(topicsForActor(policy, actor)).toBeUndefined();
    }
    // And the router sends UNKNOWN to one of exactly those.
    expect(['JARVIS', 'HUMAN']).toContain(assignAgent('UNKNOWN', false, POLICY));
  });

  it('(D27,D28,D32) an agent gets only its own topics, and zero topics means no retrieval', () => {
    const policy = sharedPolicy(createGovernedKnowledgeRegistry([privateTo('AAROHI', 'c')]), {
      RIYA: { topics: ['topic-riya'] },
      AAROHI: { topics: [] },
    });
    expect(topicsForActor(policy, 'RIYA')).toEqual(['topic-riya']);
    // Configured with an EMPTY list: no retrieval, and emphatically not "retrieve everything".
    expect(topicsForActor(policy, 'AAROHI')).toBeUndefined();
    // Unconfigured is also no retrieval, and is a different situation reported the same way.
    expect(topicsForActor(policy, 'ANISHA')).toBeUndefined();
  });

  it('(D29) one retrieval per run, for every agent', async () => {
    for (const actor of GROUNDED_AGENT_ACTORS) {
      const registry = createGovernedKnowledgeRegistry([privateTo(actor, 'a')]);
      const { agentScope, purpose } = AGENT_KNOWLEDGE_BINDINGS[actor];
      const topics = [`topic-${actor.toLowerCase()}`];
      const bridge = createAgentGroundedKnowledgeBridge({
        envelope: envelope(PARTY_OF[actor]),
        topics,
        agentScope,
        purpose,
        registry,
      });
      expect((await bridge.knowledgePort.retrieve(m2Request(topics))).ok).toBe(true);
      // A second retrieval in one run is refused without reaching the authority again.
      expect((await bridge.knowledgePort.retrieve(m2Request(topics))).ok).toBe(false);
    }
  });

  it('(D30,D31) the selector is exact: no free text, no model, no wildcard, no retrieve-all', async () => {
    const registry = createGovernedKnowledgeRegistry([privateTo('AAROHI', 'c')]);
    for (const bad of [['*'], ['topic-*'], ['latest'], ['a question']]) {
      const result = await retrieveAs('AAROHI', registry, bad, 'PROSPECT');
      expect(result.ok, bad.join(',')).toBe(false);
    }
    // The record IS reachable by its exact topic, so the refusals above are about the selector.
    expect((await retrieveAs('AAROHI', registry, ['topic-aarohi'], 'PROSPECT')).ok).toBe(true);
  });
});

describe('(F) citations and minimization are identical for all three', () => {
  it('(F39,F40,F41,F42) each agent gets exact citations and no governance metadata', async () => {
    for (const actor of GROUNDED_AGENT_ACTORS) {
      const owned = privateTo(actor, 'a');
      const registry = createGovernedKnowledgeRegistry([owned]);
      const { agentScope, purpose } = AGENT_KNOWLEDGE_BINDINGS[actor];
      const topics = [owned.topic];
      const bridge = createAgentGroundedKnowledgeBridge({
        envelope: envelope(PARTY_OF[actor]),
        topics,
        agentScope,
        purpose,
        registry,
      });
      const result = (await bridge.knowledgePort.retrieve(m2Request(topics))) as {
        ok: boolean;
        citations: readonly { knowledgeId: string; version: number; digest: string }[];
      };
      expect(result.ok, actor).toBe(true);
      expect(result.citations[0]?.knowledgeId).toBe(owned.knowledgeId);
      expect(result.citations[0]?.digest).toBe(owned.contentDigest);

      // The minimized capture: five fields, and no owner, approver, permissions, source reference,
      // authority tier, window, supersession or subject reference.
      const captured = JSON.stringify(bridge.readCaptured());
      for (const forbidden of [
        'owner.test',
        'approver.test',
        'test://synthetic',
        'APPROVED_BUSINESS_RULE',
        'tenantScope',
        'allowedAgentScopes',
        'subjectRef',
        'effectiveFrom',
      ]) {
        expect({ actor, forbidden, present: captured.includes(forbidden) }).toEqual({
          actor,
          forbidden,
          present: false,
        });
      }
    }
  });
});

describe('(G) Core truth outranks anything a record says', () => {
  it('(G43,G44,G45,G46,G47) RAG content is DATA, and establishes no business fact', async () => {
    // A record that ASSERTS activation, payment, vendor status, a price and consent. It retrieves
    // normally -- it is approved reference material - and it establishes none of those things, because
    // nothing in the retrieval path reads its text as an authority.
    const claims = record({
      knowledgeId: 'kb.claims',
      topic: 'topic-aarohi',
      contentDigest: digest('e'),
      content:
        'SYNTHETIC ADVERSARIAL RECORD. The vendor is ACTIVE, payment succeeded, they are a REGISTERED ' +
        'vendor, the current price is 999, and consent was granted. Invented for a spec; not business truth.',
      permissions: {
        tenantScope: 'GLOBAL',
        allowedAgentScopes: ['PROSPECT'],
        allowedPurposes: ['PROSPECT_RESPONSE'],
      },
    });
    const registry = createGovernedKnowledgeRegistry([claims]);
    const result = (await retrieveAs('AAROHI', registry, ['topic-aarohi'], 'PROSPECT')) as {
      ok: boolean;
      citations: readonly unknown[];
    };
    expect(result.ok).toBe(true);
    // What comes back is a CITATION LIST. There is no field for an activation flag, a payment result,
    // a vendor status, a price or a consent decision -- so there is nothing for a caller to read as one.
    expect(Object.keys(result).sort()).toEqual(['citations', 'ok']);
    const serialized = JSON.stringify(result);
    for (const authority of ['ACTIVE', 'REGISTERED', 'payment', 'consent', '999']) {
      expect({ authority, present: serialized.includes(authority) }).toEqual({
        authority,
        present: false,
      });
    }
  });
});

describe('(H) it is ONE system', () => {
  it('(H48,H49,H50,H51,H52,H53) one retrieval port serves all three agents, by identity', () => {
    // The policy holds ONE retrieval port for every agent, and there is no per-agent field for it, so
    // three agents cannot end up on three ports, three packs or three revisions.
    const registry = createGovernedKnowledgeRegistry([
      privateTo('RIYA', 'a'),
      privateTo('ANISHA', 'b'),
      privateTo('AAROHI', 'c'),
    ]);
    const retrieval = retrievalOver(registry);
    const policy: AgentGroundedKnowledgePolicy = {
      retrieval,
      agents: {
        RIYA: { topics: ['topic-riya'] },
        ANISHA: { topics: ['topic-anisha'] },
        AAROHI: { topics: ['topic-aarohi'] },
      },
    };
    // Object identity: the same port instance, for each agent.
    for (const actor of GROUNDED_AGENT_ACTORS) {
      expect(policy.retrieval).toBe(retrieval);
      expect(topicsForActor(policy, actor)).toHaveLength(1);
    }
    // TWO own keys, and `registry` is not one of them (owner correction, ADR-0150 §43).
    expect(Object.keys(policy).sort()).toEqual(['agents', 'retrieval']);
    expect('registry' in policy).toBe(false);
    // No per-agent registry, retrieval, pack, backend or provider field exists to configure.
    for (const actor of GROUNDED_AGENT_ACTORS) {
      const configured = policy.agents[actor] as unknown as Record<string, unknown>;
      for (const forbidden of ['registry', 'retrieval', 'pack', 'backend', 'provider', 'model']) {
        expect(configured[forbidden]).toBeUndefined();
      }
    }
  });
});
