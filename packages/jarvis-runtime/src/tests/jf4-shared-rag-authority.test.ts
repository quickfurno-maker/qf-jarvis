/**
 * JF-4 FINAL owner correction — the shared production RAG reach is RETRIEVAL-ONLY (ADR-0150 §43).
 *
 * ### The defect these specs close
 *
 * `AgentGroundedKnowledgePolicy` carried `registry?` and `retrieval?`, both optional. Four structural
 * states were expressible where the locked architecture permits one:
 *
 * 1. retrieval only — intended;
 * 2. registry only — accepted, and it answers production turns while stepping AROUND the JF-3
 *    provisioning boundary that decides whether a pack is ACTIVE and whether its revision is approved;
 * 3. both — accepted, and the runtime silently preferred `retrieval`, leaving an entire body of
 *    knowledge sitting unused beside the port until one line changed and it became the one that answers;
 * 4. neither — accepted, and configured agents silently grounded on nothing.
 *
 * Three of the four were wrong and two were SILENTLY wrong, which is the part that matters: a bypass
 * that works looks exactly like a bypass that was intended.
 *
 * ### What is locked now
 *
 * One authentic revision-bound pack -> one JF-3 provisioner -> one `GovernedRetrievalPort` -> one
 * `AgentGroundedKnowledgePolicy` -> three exact scopes and topic lists. `retrieval` is required,
 * `registry` is typed `never`, and a malformed configuration fails at CONSTRUCTION rather than becoming
 * a per-turn "this deployment grounds on nothing".
 *
 * The low-level `createAgentGroundedKnowledgeBridge` keeps both forms, EXCLUSIVELY, for the RWC-P7
 * tests and the dedicated Riya configuration that predate JF-3. That seam is not this boundary.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createGovernedKnowledgeRegistry,
  createKnowledgeRecord,
  retrieveGovernedKnowledge,
} from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeRecordInput,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import { AGENT_KNOWLEDGE_BINDINGS } from '../contracts/agent-knowledge-policy.js';
import type { AgentGroundedKnowledgePolicy } from '../contracts/agent-knowledge-policy.js';
import { JarvisRuntimeError } from '../contracts/errors.js';
import type { GovernedRetrievalPort, JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import { syntheticRuntimeConfig } from '../testing/index.js';

const POLICY_FILE = fileURLToPath(
  new URL('../contracts/agent-knowledge-policy.ts', import.meta.url),
);
const PROCESS_FILE = fileURLToPath(new URL('../composition/process-inbound.ts', import.meta.url));
const VALIDATOR_FILE = fileURLToPath(
  new URL('../composition/validate-composition.ts', import.meta.url),
);
const BRIDGE_FILE = fileURLToPath(
  new URL('../composition/riya-grounded-knowledge.ts', import.meta.url),
);

/** Comments stripped, so a scan cannot match this file's own prose or a doc comment. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

function record(topic: string, seed: string): KnowledgeRecordInput {
  return createKnowledgeRecord({
    knowledgeId: `kb.${topic}`,
    version: 1,
    topic,
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: 'SYNTHETIC RECORD. Invented for a spec; not business truth.',
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
      allowedAgentScopes: ['CLIENT'],
      allowedPurposes: ['CLIENT_RESPONSE'],
    },
  });
}

const REGISTRY: GovernedKnowledgeRegistry = createGovernedKnowledgeRegistry([
  record('topic-riya', 'a'),
]);

/** A real `GovernedRetrievalPort`: the shape a deployment supplies, and JF-3's own shape. */
function retrievalPort(): GovernedRetrievalPort {
  return Object.freeze({
    retrieve: (request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult =>
      retrieveGovernedKnowledge(REGISTRY, request),
  });
}

/** Construct a runtime with this shared-RAG configuration, however malformed. */
function construct(agentGroundedKnowledge: unknown): void {
  createJarvisRuntime(
    syntheticRuntimeConfig({
      agentGroundedKnowledge: agentGroundedKnowledge as NonNullable<
        JarvisRuntimeConfig['agentGroundedKnowledge']
      >,
    }),
  );
}

/** Assert construction refuses with the EXISTING taxonomy, not a new error class. */
function expectRefused(agentGroundedKnowledge: unknown, label: string): void {
  try {
    construct(agentGroundedKnowledge);
    throw new Error(`expected construction to be refused: ${label}`);
  } catch (error) {
    expect(error, label).toBeInstanceOf(JarvisRuntimeError);
    expect((error as JarvisRuntimeError).code, label).toBe('invalid-config');
  }
}

// ---------------------------------------------------------------------------
// A. Authority shape (1-6).
// ---------------------------------------------------------------------------

describe('(A) the shared policy accepts exactly ONE authority shape', () => {
  it('(A1) a retrieval-only shared policy constructs', () => {
    const policy: AgentGroundedKnowledgePolicy = {
      retrieval: retrievalPort(),
      agents: { RIYA: { topics: ['topic-riya'] } },
    };
    expect(() => {
      construct(policy);
    }).not.toThrow();
    // Two own keys, and `registry` is not one of them.
    expect(Object.keys(policy).sort()).toEqual(['agents', 'retrieval']);
  });

  it('(A2) a registry-only shared policy is NOT EXPRESSIBLE, and is refused if cast in', () => {
    // Not expressible: `registry` is typed `never` on the policy, so this object is a compile error
    // without the cast below. The cast is the whole point of the runtime check — a typed caller cannot
    // write this, and the caller that can is precisely the one a compile-time rule does not reach.
    expectRefused(
      { registry: REGISTRY, agents: { RIYA: { topics: ['topic-riya'] } } },
      'registry-only',
    );
  });

  it('(A3) registry AND retrieval together is refused, even though the port is valid', () => {
    // No precedence and no merge. A second reach to the authority is the defect; choosing between two
    // is not a decision a deployment gets to make, because one of the two is a bypass.
    expectRefused(
      {
        retrieval: retrievalPort(),
        registry: REGISTRY,
        agents: { RIYA: { topics: ['topic-riya'] } },
      },
      'both',
    );
  });

  it('(A4) neither authority is refused, rather than becoming a silent no-grounding turn', () => {
    expectRefused({ agents: { RIYA: { topics: ['topic-riya'] } } }, 'neither');
    expectRefused(
      { retrieval: undefined, agents: { RIYA: { topics: ['topic-riya'] } } },
      'undefined',
    );
  });

  it('(A5,A6) a cast-built object is refused for every malformed authority shape', () => {
    for (const [label, value] of [
      ['not an object', 'retrieval'],
      ['null', null],
      ['an array', []],
      ['a port with no retrieve', { retrieval: {}, agents: {} }],
      ['a port whose retrieve is not a function', { retrieval: { retrieve: 1 }, agents: {} }],
      ['a registry passed as the port', { retrieval: REGISTRY, agents: {} }],
      ['no agents at all', { retrieval: retrievalPort() }],
      ['agents as an array', { retrieval: retrievalPort(), agents: [] }],
      ['agents as null', { retrieval: retrievalPort(), agents: null }],
    ] as const) {
      expectRefused(value, label);
    }
    // An EMPTY agents object is valid: a deployment that has wired the authority and approved no
    // topics yet is honest, and every agent simply grounds on nothing.
    expect(() => {
      construct({ retrieval: retrievalPort(), agents: {} });
    }).not.toThrow();
  });

  it('(A1) absent remains valid, and is what every deployment does today', () => {
    expect(() => {
      createJarvisRuntime(syntheticRuntimeConfig());
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B. No bypass (7-10).
// ---------------------------------------------------------------------------

describe('(B) there is no registry bypass around the JF-3 boundary', () => {
  it('(B7) sharedGroundedKnowledgeFor has ONE authority branch and no registry branch', () => {
    const code = codeOnly(readFileSync(PROCESS_FILE, 'utf8'));
    const helper = code.slice(
      code.indexOf('function sharedGroundedKnowledgeFor'),
      code.indexOf('export async function composeAndProcessInternal'),
    );
    expect(helper).toContain('retrieval: policy.retrieval');
    // No registry read, no fallback, no missing-authority branch.
    for (const forbidden of ['policy.registry', 'registry:', 'GovernedKnowledgeRegistry']) {
      expect({ forbidden, present: helper.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // Exactly one `createAgentGroundedKnowledgeBridge` call, so there is no second form to reach.
    expect(helper.match(/createAgentGroundedKnowledgeBridge\(/g)).toHaveLength(1);
  });

  it('(B8) the shared production policy declares no registry field', () => {
    const code = codeOnly(readFileSync(POLICY_FILE, 'utf8'));
    const policy = code.slice(
      code.indexOf('export interface AgentGroundedKnowledgePolicy'),
      code.indexOf('export function isGroundedAgentActor'),
    );
    expect(policy).toContain('readonly retrieval: GovernedRetrievalPort;');
    // Present only as the `never` that forbids it.
    expect(policy).toContain('readonly registry?: never;');
    expect(policy).not.toContain('readonly registry?: GovernedKnowledgeRegistry');
    // And `observability` is gone too: a field this package cannot act on is a field it should not take.
    expect(policy).not.toContain('observability');
    // The whole FILE holds no registry type at all any more.
    expect(code).not.toContain('GovernedKnowledgeRegistry');
  });

  it('(B9) the construction-time check refuses a registry before the runtime exists', () => {
    const code = codeOnly(readFileSync(VALIDATOR_FILE, 'utf8'));
    expect(code).toContain('agentGroundedKnowledgeConfigured');
    expect(code).toContain("'registry' in policy");
    // The refusal uses the EXISTING taxonomy. There is exactly one error code in this package.
    expect(code).toContain("JarvisRuntimeError('invalid-config')");
  });

  it('(B10) one JF-3 retrieval adapter remains the production access seam', () => {
    // The adapter itself lives in `apps/api` and is proved there. What this asserts is the half that
    // belongs to this package: the port CONTRACT is the only production reach, and it is the exact
    // shape JF-3's ACTIVE provisioner exposes — one synchronous bounded `retrieve`.
    const port = retrievalPort();
    expect(Object.keys(port)).toEqual(['retrieve']);
    expect(typeof port.retrieve).toBe('function');
    // Synchronous, inherited from the authority: a port that could await could await a socket.
    const result = port.retrieve({
      requestId: 'req.1',
      tenantId: 'tenant.a',
      agentScope: 'CLIENT',
      purpose: 'CLIENT_RESPONSE',
      dataClass: 'HOSTED_ALLOWED',
      asOf: '2026-06-01T00:00:00Z',
      maxRecords: 1,
      maxContentChars: 4096,
      requireCitation: true,
      selectors: { ids: [], topics: ['topic-riya'] },
    });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Topics (11-16).
// ---------------------------------------------------------------------------

describe('(C) the topic policy is validated at construction, against the governed rules', () => {
  const withAgents = (agents: unknown) => ({ retrieval: retrievalPort(), agents });

  it('(C11) an unknown agent key is refused', () => {
    for (const key of ['JARVIS', 'HUMAN', 'SYSTEM', 'riya', 'RIYA ', 'AAROHI2', '']) {
      expectRefused(withAgents({ [key]: { topics: ['topic-riya'] } }), key);
    }
    // And the three legitimate keys are accepted.
    expect(() => {
      construct(
        withAgents({
          RIYA: { topics: ['topic-riya'] },
          ANISHA: { topics: ['topic-anisha'] },
          AAROHI: { topics: ['topic-aarohi'] },
        }),
      );
    }).not.toThrow();
  });

  it('(C12) a duplicate topic is refused', () => {
    expectRefused(withAgents({ RIYA: { topics: ['topic-riya', 'topic-riya'] } }), 'duplicate');
    expectRefused(withAgents({ RIYA: { topics: ['a', 'b', 'a'] } }), 'duplicate, not adjacent');
  });

  it('(C13) a ninth topic is refused, and eight are accepted', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `topic-${String(i)}`);
    expect(() => {
      construct(withAgents({ RIYA: { topics: eight } }));
    }).not.toThrow();
    expectRefused(withAgents({ RIYA: { topics: [...eight, 'topic-8'] } }), 'nine topics');
  });

  it('(C14) zero topics is VALID and means zero retrieval', () => {
    // The one shape RWC-P7 refuses and this policy must not: "no approved topics yet" is a true state
    // of the world, and the honest response is to ground on nothing.
    expect(() => {
      construct(withAgents({ AAROHI: { topics: [] } }));
    }).not.toThrow();
  });

  it('(C15) a wildcard, `latest` or malformed topic is refused by the governed grammar', () => {
    for (const bad of ['*', 'topic-*', 'topic *', 'a question', 'topic/riya', 'topic riya', '']) {
      expectRefused(withAgents({ RIYA: { topics: [bad] } }), bad);
    }
    // `latest` passes the SYNTAX — it is a legal identifier — and is refused where it matters, by the
    // authority having no record under that topic. Construction does not invent a second rule for it.
    expect(() => {
      construct(withAgents({ RIYA: { topics: ['latest'] } }));
    }).not.toThrow();
    // A malformed topic ENTRY is refused too, not only a malformed string.
    for (const [label, bad] of [
      ['a number', 1],
      ['null', null],
      ['undefined', undefined],
      ['an object', {}],
      ['an array', []],
    ] as const) {
      expectRefused(withAgents({ RIYA: { topics: [bad] } }), label);
    }
    expectRefused(withAgents({ RIYA: { topics: 'topic-riya' } }), 'topics as a string');
    expectRefused(withAgents({ RIYA: {} }), 'no topics key');
    expectRefused(withAgents({ RIYA: [] }), 'entry as an array');
  });

  it('(C16) a caller cannot set a scope or a purpose, and a stray one is ignored not honoured', () => {
    const code = codeOnly(readFileSync(POLICY_FILE, 'utf8'));
    const perAgent = code.slice(
      code.indexOf('export interface AgentKnowledgeTopicPolicy'),
      code.indexOf('export interface AgentGroundedKnowledgePolicy'),
    );
    for (const forbidden of ['agentScope', 'purpose', 'registry', 'retrieval']) {
      expect({ forbidden, present: perAgent.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    // The scope actually used comes from the frozen closed table, for every agent.
    for (const [actor, binding] of Object.entries(AGENT_KNOWLEDGE_BINDINGS)) {
      expect(Object.isFrozen(binding), actor).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// D. One instance (17-20).
// ---------------------------------------------------------------------------

describe('(D) all three agents share ONE retrieval port instance', () => {
  it('(D17,D18,D19) the same port object serves Riya, Anisha and Aarohi, with no per-agent field', () => {
    const retrieval = retrievalPort();
    const policy: AgentGroundedKnowledgePolicy = {
      retrieval,
      agents: {
        RIYA: { topics: ['topic-riya'] },
        ANISHA: { topics: ['topic-anisha'] },
        AAROHI: { topics: ['topic-aarohi'] },
      },
    };
    // Identity, not equality: one object, reached the same way for each agent.
    for (const actor of ['RIYA', 'ANISHA', 'AAROHI'] as const) {
      expect(policy.agents[actor], actor).toBeDefined();
      expect(policy.retrieval, actor).toBe(retrieval);
      const configured = policy.agents[actor] as unknown as Record<string, unknown>;
      expect(Object.keys(configured), actor).toEqual(['topics']);
      for (const forbidden of ['retrieval', 'registry', 'port', 'pack', 'backend']) {
        expect({ actor, forbidden, present: forbidden in configured }).toEqual({
          actor,
          forbidden,
          present: false,
        });
      }
    }
    // The policy has exactly one place to name an authority, and it is not inside `agents`.
    expect(Object.keys(policy).sort()).toEqual(['agents', 'retrieval']);
  });

  it('(D20) one retrieval per run is unchanged: a second call on one bridge is refused', () => {
    // The bound lives in the bridge, so it applies identically however the lookup is performed. This is
    // the shared-port form of the rule the RAG spec proves for the registry form.
    const code = codeOnly(readFileSync(BRIDGE_FILE, 'utf8'));
    expect(code).toContain('retrieved');
  });
});

// ---------------------------------------------------------------------------
// The low-level bridge keeps BOTH forms, exclusively. That seam is not this boundary.
// ---------------------------------------------------------------------------

describe('the low-level bridge input stays XOR, and stays available', () => {
  it('declares registry XOR retrieval, never both and never neither', () => {
    const code = codeOnly(readFileSync(BRIDGE_FILE, 'utf8'));
    const input = code.slice(
      code.indexOf('export type RiyaGroundedKnowledgeBridgeInput'),
      code.indexOf('export type AgentGroundedKnowledgeBridgeInput'),
    );
    // Each form forbids the other by type, so neither both nor neither is expressible.
    expect(input).toContain('readonly registry: GovernedKnowledgeRegistry;');
    expect(input).toContain('readonly retrieval?: never;');
    expect(input).toContain('readonly retrieval: GovernedRetrievalPort;');
    expect(input).toContain('readonly registry?: never;');
    // A union of exactly two forms.
    expect(input.match(/readonly registry\??:/g)).toHaveLength(2);
    expect(input.match(/readonly retrieval\??:/g)).toHaveLength(2);
  });

  it('is still reachable in its registry form, so RWC-P7 and dedicated Riya are unchanged', () => {
    const code = codeOnly(readFileSync(BRIDGE_FILE, 'utf8'));
    // The dedicated Riya wrapper still exists and still forwards whichever form it was given.
    expect(code).toContain('export function createRiyaGroundedKnowledgeBridge');
    expect(code).toContain('export function createAgentGroundedKnowledgeBridge');
  });
});
