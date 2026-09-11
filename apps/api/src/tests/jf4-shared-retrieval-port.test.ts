/**
 * JF-4 FINAL owner correction §7 — ONE JF-3 retrieval port, shared by all three agents (ADR-0150 §43).
 *
 * ### The chain being proven, end to end
 *
 * ```
 * one revision-bound pack  →  one governed exact backend  →  one ACTIVE JF-3 RagProvisioner
 *                          →  createGovernedRagRetrievalPort  (the JF-4A adapter, reused)
 *                          →  ONE GovernedRetrievalPort
 *                          →  ONE AgentGroundedKnowledgePolicy
 *                          →  Riya / Anisha / Aarohi, each under its own scope and topics
 * ```
 *
 * Every link is the real one. The pack, the backend, the provisioner and the authority are the
 * production implementations; the adapter is the existing JF-4A one and **no second adapter is
 * created**. What is synthetic is the pack's CONTENT — three records invented for this spec, which say
 * so in their own text — and that is the only thing that could be.
 *
 * ### What this does NOT claim
 *
 * No live production provisioner is running. JF-6 still owns the deployment assembly that supplies a
 * real approved pack; this spec proves the SEAM, with a deterministic pack standing in for the approved
 * one. Nothing is deployed, no credential exists and no provider is called.
 */
import { createKnowledgeRecord } from '@qf-jarvis/governed-knowledge';
import type {
  KnowledgeRecordInput,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';
import { createJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type { GovernedRetrievalPort, JarvisRuntimeConfig } from '@qf-jarvis/jarvis-runtime';
import {
  clearControlState,
  mutableAuthoritativeState,
  syntheticInboundEnvelope,
  syntheticPromptDefinition,
  syntheticRuntimeConfig,
} from '@qf-jarvis/jarvis-runtime/testing';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptAgentScope } from '@qf-jarvis/prompt-registry';
import {
  createGovernedExactBackend,
  createRagProvisioner,
  createRevisionBoundKnowledgePack,
} from '@qf-jarvis/rag-provisioning';
import { activeProfileInput } from '@qf-jarvis/rag-provisioning/testing';
import { describe, expect, it } from 'vitest';

import { createGovernedRagRetrievalPort } from '../riya-customer-orchestration/index.js';

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

/** actor -> the party that routes to it, its knowledge scope/purpose, and its one exact topic. */
const AGENTS = [
  {
    actor: 'RIYA',
    party: 'CLIENT',
    scope: 'CLIENT',
    purpose: 'CLIENT_RESPONSE',
    topic: 'jf4-shared-riya',
    prompt: { family: 'reply.client', scope: 'CLIENT' as PromptAgentScope },
  },
  {
    actor: 'ANISHA',
    party: 'VENDOR',
    scope: 'VENDOR',
    purpose: 'VENDOR_RESPONSE',
    topic: 'jf4-shared-anisha',
    prompt: { family: 'reply.vendor', scope: 'VENDOR' as PromptAgentScope },
  },
  {
    actor: 'AAROHI',
    party: 'PROSPECT',
    scope: 'PROSPECT',
    purpose: 'PROSPECT_RESPONSE',
    topic: 'jf4-shared-aarohi',
    // Aarohi has no model/prompt scope in Production V1 (ADR-0150 §41), so her turn refuses at the
    // draft step. The retrieval this spec measures happens BEFORE that, which is the point.
    prompt: { family: 'reply.client', scope: 'CLIENT' as PromptAgentScope },
  },
] as const;

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

/** One synthetic record private to exactly one agent's scope and purpose. */
function record(agent: (typeof AGENTS)[number], seed: string): KnowledgeRecordInput {
  return createKnowledgeRecord({
    knowledgeId: `kb.jf4.shared.${agent.actor.toLowerCase()}`,
    version: 1,
    topic: agent.topic,
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: `SYNTHETIC ${agent.actor}-ONLY RECORD. Invented for a spec; not business truth.`,
    contentDigest: digest(seed),
    sourceRef: 'test://jf4/shared',
    sourceRevision: 'rev-1',
    owner: 'owner.test',
    approvedBy: 'approver.test',
    approvedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-02T00:00:00Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: [agent.scope],
      allowedPurposes: [agent.purpose],
    },
  });
}

/** What one retrieval asked for, recorded content-free. */
interface Observed {
  readonly agentScope: string;
  readonly purpose: string;
  readonly topics: readonly string[];
  readonly ok: boolean;
  readonly recordCount: number;
}

/**
 * The whole deployment, built once: ONE pack, ONE provisioner, ONE adapter call, ONE port, ONE policy.
 *
 * The returned `shared` port is an observing decorator around the single JF-3 port so a spec can say
 * WHAT each agent asked for. It delegates every call to that one instance and changes nothing about the
 * request or the result — the identity assertions below are about `jf3Port`, not the decorator.
 */
function deployment() {
  const pack = createRevisionBoundKnowledgePack(
    AGENTS.map((agent, index) => record(agent, String.fromCharCode(97 + index))),
  );
  const backend = createGovernedExactBackend({ pack });
  const provisioner = createRagProvisioner(
    activeProfileInput({ knowledgeRevision: pack.knowledgeRevision }),
    { backend },
  );

  // THE production access seam. Called exactly once; there is no second adapter in this repository.
  const jf3Port: GovernedRetrievalPort = createGovernedRagRetrievalPort(provisioner);

  const observed: Observed[] = [];
  const shared: GovernedRetrievalPort = Object.freeze({
    retrieve(request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult {
      const result = jf3Port.retrieve(request);
      observed.push({
        agentScope: request.agentScope,
        purpose: request.purpose,
        topics: [...request.selectors.topics],
        ok: result.ok,
        recordCount: result.ok ? result.records.length : 0,
      });
      return result;
    },
  });

  const policy: NonNullable<JarvisRuntimeConfig['agentGroundedKnowledge']> = {
    retrieval: shared,
    agents: {
      RIYA: { topics: [AGENTS[0].topic] },
      ANISHA: { topics: [AGENTS[1].topic] },
      AAROHI: { topics: [AGENTS[2].topic] },
    },
  };

  return { pack, provisioner, jf3Port, shared, policy, observed: () => [...observed] };
}

/** One turn for one agent, over the ONE shared policy. */
async function runTurn(
  policy: NonNullable<JarvisRuntimeConfig['agentGroundedKnowledge']>,
  agent: (typeof AGENTS)[number],
): Promise<void> {
  const definition = syntheticPromptDefinition(agent.prompt.family, agent.prompt.scope);
  const state = clearControlState({
    tenantId: TENANT,
    conversationId: CONVERSATION,
    partyType: agent.party,
  });
  const runtime = createJarvisRuntime(
    syntheticRuntimeConfig({
      authoritativeState: mutableAuthoritativeState(() => state),
      agentGroundedKnowledge: policy,
      promptFamily: agent.prompt.family,
      promptRegistry: createPromptRegistry([definition]),
      evaluationPromptDigest: definition.contentDigest,
    }),
  );
  await runtime.processInbound(
    syntheticInboundEnvelope({
      channel: 'WEB',
      partyType: agent.party,
      tenantId: TENANT,
      conversationId: CONVERSATION,
      normalizedText: 'a question about what you offer',
    }),
  );
}

describe('JF-4 §7 one JF-3 retrieval port, reused by all three agents', () => {
  it('the SAME port object serves Riya, Anisha and Aarohi, each under its own scope', async () => {
    const d = deployment();

    // Identity BEFORE any turn: one policy, one port, and the policy names it once.
    expect(d.policy.retrieval).toBe(d.shared);
    expect(Object.keys(d.policy).sort()).toEqual(['agents', 'retrieval']);
    expect('registry' in d.policy).toBe(false);

    for (const agent of AGENTS) {
      await runTurn(d.policy, agent);
    }

    const observed = d.observed();
    // Three turns, three retrievals, one each. Not four, and not one shared between agents.
    expect(observed).toHaveLength(3);
    expect(observed.map((o) => o.agentScope)).toEqual(['CLIENT', 'VENDOR', 'PROSPECT']);
    expect(observed.map((o) => o.purpose)).toEqual([
      'CLIENT_RESPONSE',
      'VENDOR_RESPONSE',
      'PROSPECT_RESPONSE',
    ]);
    expect(observed.map((o) => o.topics)).toEqual([
      ['jf4-shared-riya'],
      ['jf4-shared-anisha'],
      ['jf4-shared-aarohi'],
    ]);
    // Every one SERVED, through the real ACTIVE provisioner and the real authority. A refusal here
    // would mean the chain does not hold, and would have been invisible to an identity-only assertion.
    expect(observed.map((o) => o.ok)).toEqual([true, true, true]);
    expect(observed.map((o) => o.recordCount)).toEqual([1, 1, 1]);

    // And the port the policy still holds is the one it started with: nothing re-pointed it per agent.
    expect(d.policy.retrieval).toBe(d.shared);
  });

  it('the JF-3 provisioner and its pack revision are ONE, for all three agents', () => {
    const d = deployment();
    // One pack, one revision, one backend, one provisioner. There is no per-agent pack to disagree.
    expect(d.pack.knowledgeRevision).toMatch(/^qfj\.knowledge\.sha256\.[0-9a-f]{64}$/);
    expect(d.pack.registry.size).toBe(3);
    // The adapter returns a bounded synchronous port and nothing else.
    expect(Object.keys(d.jf3Port)).toEqual(['retrieve']);
    expect(typeof d.jf3Port.retrieve).toBe('function');
  });

  it('a cross-agent request through the SAME port is refused by the authority, not served', () => {
    // The shared port is not a shared VIEW. Asking for Aarohi's topic under the VENDOR scope reaches
    // the same provisioner and the same pack, and the record is still not served — so sharing one
    // authority reach does not share one body of readable knowledge.
    const d = deployment();
    const request: KnowledgeRetrievalRequest = Object.freeze({
      requestId: 'req.cross',
      tenantId: TENANT,
      agentScope: 'VENDOR',
      purpose: 'VENDOR_RESPONSE',
      dataClass: 'HOSTED_ALLOWED',
      asOf: '2026-06-01T00:00:00Z',
      maxRecords: 1,
      maxContentChars: 4096,
      requireCitation: true,
      selectors: Object.freeze({
        ids: Object.freeze([]),
        topics: Object.freeze([AGENTS[2].topic]),
      }),
    });
    const refused = d.jf3Port.retrieve(request);
    expect(refused.ok).toBe(false);

    // Its OWN topic, through the same port, is served — so the refusal is about the scope, not the port.
    const served = d.jf3Port.retrieve({
      ...request,
      requestId: 'req.own',
      selectors: Object.freeze({
        ids: Object.freeze([]),
        topics: Object.freeze([AGENTS[1].topic]),
      }),
    });
    expect(served.ok).toBe(true);
  });
});
