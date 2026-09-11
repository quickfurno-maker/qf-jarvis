/**
 * JF-4 — the injected retrieval seam on the RWC-P7 grounded bridge (ADR-0149 §12).
 *
 * ### What the seam is for, and what it must not change
 *
 * JF-3 built a provisioning boundary that decides whether a deployment may retrieve at all, under an
 * exact knowledge-revision binding. The RWC-P7 bridge decides what a retrieval asks for and what
 * reaches the model. Before JF-4 the bridge called the authority directly, so the production customer
 * path could not go through JF-3 without one of them duplicating the other.
 *
 * The seam injects WHO performs the lookup. These specs pin that it changes nothing else: the same
 * request, the same one-retrieval-per-run rule, the same envelope cross-check, the same minimization,
 * the same citations, the same fail-closed refusal. The strongest of them runs both forms over the
 * same records and asserts the outputs are identical.
 */
import type { InboundEnvelope, InboundEnvelopeInput } from '@qf-jarvis/agent-runtime';
import {
  createGovernedKnowledgeRegistry,
  createKnowledgeRecord,
  retrieveGovernedKnowledge,
} from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeRecordInput,
  KnowledgeRetrievalRequest,
} from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import { syntheticInboundEnvelope } from '../testing/index.js';
import { createRiyaGroundedKnowledgeBridge } from '../composition/riya-grounded-knowledge.js';

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);
const TOPIC = 'installation-timeline';

function record(over: Partial<KnowledgeRecordInput> = {}) {
  return createKnowledgeRecord({
    knowledgeId: 'kb.faq.installation',
    version: 3,
    topic: TOPIC,
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: 'SYNTHETIC JF-4 RECORD. Invented for a spec; not business truth.',
    contentDigest: digest('a'),
    sourceRef: 'doc://faq/installation',
    sourceRevision: 'rev-9',
    owner: 'owner.ops',
    approvedBy: 'approver.head',
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

const registryOf = (...records: ReturnType<typeof record>[]): GovernedKnowledgeRegistry =>
  createGovernedKnowledgeRegistry(records);

function envelope(over: Partial<InboundEnvelopeInput> = {}): InboundEnvelope {
  return syntheticInboundEnvelope({
    channel: 'WEB',
    normalizedText: 'how long does installation take?',
    receivedAt: '2026-06-01T10:00:00Z',
    ...over,
  });
}

const m2Request = (over: Record<string, unknown> = {}) =>
  ({
    conversationId: 'conv.1',
    topics: [TOPIC],
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  }) as never;

/** A port that delegates to the authority and records every request it was handed. */
function countingPort(registry: GovernedKnowledgeRegistry) {
  const seen: KnowledgeRetrievalRequest[] = [];
  return {
    seen,
    port: {
      retrieve: (request: KnowledgeRetrievalRequest) => {
        seen.push(request);
        return retrieveGovernedKnowledge(registry, request);
      },
    },
  };
}

describe('JF-4 injected retrieval', () => {
  it('routes the lookup through the injected port, exactly once per run', async () => {
    const registry = registryOf(record());
    const { port, seen } = countingPort(registry);
    const bridge = createRiyaGroundedKnowledgeBridge({
      envelope: envelope({ conversationId: 'conv.1' }),
      topics: [TOPIC],
      retrieval: port,
    });

    const result = await bridge.knowledgePort.retrieve(m2Request());
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);

    // A SECOND retrieval in one run never reaches the port at all -- the bridge's own rule, unchanged.
    const second = await bridge.knowledgePort.retrieve(m2Request());
    expect(second.ok).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it('builds the SAME governed request it always did', () => {
    const registry = registryOf(record());
    const { port, seen } = countingPort(registry);
    const env = envelope({ conversationId: 'conv.1' });
    const bridge = createRiyaGroundedKnowledgeBridge({
      envelope: env,
      topics: [TOPIC],
      retrieval: port,
    });

    void bridge.knowledgePort.retrieve(m2Request());
    const request = seen[0];
    // Built by the bridge from the RUN'S envelope, not by the port and not by the caller. This is
    // why the adapter on the other side contains no request builder.
    expect(request?.requestId).toBe(env.messageId);
    expect(request?.tenantId).toBe(env.tenantId);
    expect(request?.dataClass).toBe(env.dataClass);
    expect(request?.asOf).toBe(env.receivedAt);
    expect(request?.requireCitation).toBe(true);
    expect(request?.selectors.topics).toEqual([TOPIC]);
    expect(request?.agentScope).toBe('CLIENT');
    expect(request?.purpose).toBe('CLIENT_RESPONSE');
  });

  it('produces output IDENTICAL to the registry form, served and refused alike', async () => {
    // The load-bearing spec. If the two forms ever diverge, a deployment that moved to JF-3 would
    // start grounding on different rules than the one that did not -- silently, and for requests
    // nobody enumerated.
    const cases: readonly (readonly [
      string,
      GovernedKnowledgeRegistry,
      Record<string, unknown>,
    ])[] = [
      ['served', registryOf(record()), {}],
      ['absent topic', registryOf(record()), { topics: ['nope'] }],
      [
        'expired',
        registryOf(record({ sourceType: 'PACKAGE_REFERENCE', expiresAt: '2026-02-01T00:00:00Z' })),
        {},
      ],
      ['human-only', registryOf(record({ classification: 'HUMAN_ONLY' })), {}],
      ['subject-linked, no gate', registryOf(record({ subjectRef: 'subject.1' })), {}],
    ];

    for (const [name, registry, over] of cases) {
      const env = envelope({ conversationId: 'conv.1' });
      const topics = (over['topics'] as string[] | undefined) ?? [TOPIC];
      const request = m2Request(over['topics'] === undefined ? {} : { topics });

      const direct = await createRiyaGroundedKnowledgeBridge({
        envelope: env,
        topics,
        registry,
      }).knowledgePort.retrieve(request);
      const injected = await createRiyaGroundedKnowledgeBridge({
        envelope: env,
        topics,
        retrieval: countingPort(registry).port,
      }).knowledgePort.retrieve(request);

      expect(JSON.stringify(injected), name).toBe(JSON.stringify(direct));
    }
  });

  it('captures the SAME minimized five fields, and no governance metadata', async () => {
    const registry = registryOf(record());
    const env = envelope({ conversationId: 'conv.1' });
    const injected = createRiyaGroundedKnowledgeBridge({
      envelope: env,
      topics: [TOPIC],
      retrieval: countingPort(registry).port,
    });
    const direct = createRiyaGroundedKnowledgeBridge({ envelope: env, topics: [TOPIC], registry });

    await injected.knowledgePort.retrieve(m2Request());
    await direct.knowledgePort.retrieve(m2Request());

    expect(JSON.stringify(injected.readCaptured())).toBe(JSON.stringify(direct.readCaptured()));
    const captured = JSON.stringify(injected.readCaptured());
    // Owner, approver, permissions, source reference, authority tier, windows, supersession and any
    // subject reference are all left behind -- the minimization is the bridge's, and it still applies.
    for (const forbidden of [
      'owner.ops',
      'approver.head',
      'doc://faq/installation',
      'APPROVED_BUSINESS_RULE',
      'tenantScope',
      'subjectRef',
      'effectiveFrom',
    ]) {
      expect(captured).not.toContain(forbidden);
    }
  });

  it('still cross-checks the envelope, and a port that refuses is fail-closed', async () => {
    const registry = registryOf(record());
    const { port, seen } = countingPort(registry);
    const bridge = createRiyaGroundedKnowledgeBridge({
      envelope: envelope({ conversationId: 'conv.1' }),
      topics: [TOPIC],
      retrieval: port,
    });

    // A request for a DIFFERENT conversation never reaches the port: that mismatch is the shape of
    // defect that would ground one conversation in another's records.
    const wrong = await bridge.knowledgePort.retrieve(m2Request({ conversationId: 'conv.2' }));
    expect(wrong.ok).toBe(false);
    expect(seen).toHaveLength(0);

    // A throwing port is contained, and its value never reaches the caller.
    const throwing = createRiyaGroundedKnowledgeBridge({
      envelope: envelope({ conversationId: 'conv.1' }),
      topics: [TOPIC],
      retrieval: {
        retrieve: () => {
          throw new Error('SYNTHETIC PORT FAILURE with pretend content');
        },
      },
    });
    const failed = await throwing.knowledgePort.retrieve(m2Request());
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('SYNTHETIC PORT FAILURE');
    expect(throwing.readCaptured()).toBeUndefined();
  });
});
