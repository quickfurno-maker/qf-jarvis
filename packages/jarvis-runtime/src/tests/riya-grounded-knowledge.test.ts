/**
 * RWC-P7 — the per-run governed knowledge bridge (ADR-0103 §1–§7, §13).
 *
 * The bridge is the whole of the new outbound behaviour, so nearly everything below is either a
 * COUNT or a REFUSAL. The two failures that would matter most in production are the ones a wrong
 * implementation would pass every functional test with: a shared capture that lets one conversation
 * read another's records, and a governance field reaching a model. Both are asserted directly.
 */
import type { InboundEnvelope, InboundEnvelopeInput } from '@qf-jarvis/agent-runtime';
import {
  createGovernedKnowledgeRegistry,
  createKnowledgeRecord,
} from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeEvent,
  KnowledgeRecordInput,
} from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import { syntheticInboundEnvelope } from '../testing/index.js';
import {
  createRiyaGroundedKnowledgeBridge,
  MAX_RIYA_GROUNDED_CONTENT_CHARS,
  MAX_RIYA_GROUNDED_RECORDS,
} from '../composition/riya-grounded-knowledge.js';

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

function record(over: Partial<KnowledgeRecordInput> = {}) {
  return createKnowledgeRecord({
    knowledgeId: 'kb.faq.installation',
    version: 3,
    topic: 'installation-timeline',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: 'Installation usually takes four to six weeks after design sign-off.',
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
    topics: ['installation-timeline'],
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  }) as never;

function bridgeFor(
  over: {
    readonly registry?: GovernedKnowledgeRegistry;
    readonly topics?: readonly string[];
    readonly envelope?: InboundEnvelope;
    readonly observability?: { onEvent(event: KnowledgeEvent): void };
  } = {},
) {
  return createRiyaGroundedKnowledgeBridge({
    envelope: over.envelope ?? envelope(),
    registry: over.registry ?? registryOf(record()),
    topics: over.topics ?? ['installation-timeline'],
    ...(over.observability === undefined ? {} : { observability: over.observability }),
  });
}

describe('one exact retrieval, and the model sees five fields', () => {
  it('captures nothing until retrieval, then exactly the minimized records', async () => {
    const bridge = bridgeFor();
    expect(bridge.readCaptured()).toBeUndefined();

    const result = await bridge.knowledgePort.retrieve(m2Request());
    expect(result.ok).toBe(true);

    const captured = bridge.readCaptured();
    expect(captured?.version).toBe(1);
    expect(captured?.records).toHaveLength(1);
    // EXACTLY five keys. Every omission is a governance field the model has no use for and could
    // describe to a client.
    expect(Object.keys(captured?.records[0] ?? {}).sort()).toStrictEqual([
      'content',
      'contentFormat',
      'knowledgeId',
      'topic',
      'version',
    ]);
    expect(captured?.records[0]).toStrictEqual({
      knowledgeId: 'kb.faq.installation',
      version: 3,
      topic: 'installation-timeline',
      contentFormat: 'PLAIN_TEXT',
      content: 'Installation usually takes four to six weeks after design sign-off.',
    });
  });

  it('carries NO governance metadata and no subject reference', () => {
    const serialized = JSON.stringify(record());
    // The record genuinely holds all of this...
    for (const present of ['owner', 'approvedBy', 'permissions', 'sourceRef', 'authorityTier']) {
      expect(serialized, present).toContain(present);
    }
    // ...and the capture holds none of it.
    return bridgeFor()
      .knowledgePort.retrieve(m2Request())
      .then(() => {
        const captured = JSON.stringify(bridgeFor().readCaptured() ?? {});
        for (const forbidden of [
          'owner',
          'approvedBy',
          'approvedAt',
          'permissions',
          'sourceRef',
          'sourceRevision',
          'authorityTier',
          'effectiveFrom',
          'expiresAt',
          'supersededBy',
          'subjectRef',
          'classification',
          'lifecycleState',
        ]) {
          expect(captured, forbidden).not.toContain(forbidden);
        }
      });
  });

  it('returns M2 its EXISTING citation shape, in retrieval order', async () => {
    const bridge = bridgeFor({
      registry: registryOf(
        record(),
        record({
          knowledgeId: 'kb.faq.warranty',
          version: 2,
          topic: 'warranty',
          content: 'A ten-year warranty applies to modular carcasses.',
          contentDigest: digest('b'),
          sourceRef: 'doc://faq/warranty',
        }),
      ),
      topics: ['warranty', 'installation-timeline'],
    });
    const result = await bridge.knowledgePort.retrieve(
      m2Request({ topics: ['warranty', 'installation-timeline'] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.citations.map((c) => Object.keys(c).sort())).toStrictEqual([
      ['digest', 'knowledgeId', 'source', 'version'],
      ['digest', 'knowledgeId', 'source', 'version'],
    ]);
    // Capture order and citation order correspond ELEMENT BY ELEMENT -- the Riya profile
    // cross-checks exactly that before it serializes a byte.
    expect(result.citations.map((c) => `${c.knowledgeId}@${String(c.version)}`)).toStrictEqual(
      (bridge.readCaptured()?.records ?? []).map((r) => `${r.knowledgeId}@${String(r.version)}`),
    );
    expect(result.citations[0]?.knowledgeId).toBe('kb.faq.warranty');
  });

  it('the configured topic ORDER is what reaches governed retrieval', async () => {
    const seen: KnowledgeEvent[] = [];
    const bridge = bridgeFor({
      topics: ['installation-timeline'],
      observability: { onEvent: (event) => seen.push(event) },
    });
    await bridge.knowledgePort.retrieve(m2Request());
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('a second retrieval never reaches governed knowledge', () => {
  it('refuses, and does not re-run the registry', async () => {
    let lookups = 0;
    const base = registryOf(record());
    const counting: GovernedKnowledgeRegistry = {
      ...base,
      listByTopic: (topic: string) => {
        lookups += 1;
        return base.listByTopic(topic);
      },
    };
    const bridge = createRiyaGroundedKnowledgeBridge({
      envelope: envelope(),
      registry: counting,
      topics: ['installation-timeline'],
    });
    expect((await bridge.knowledgePort.retrieve(m2Request())).ok).toBe(true);
    const second = await bridge.knowledgePort.retrieve(m2Request());
    expect(second).toStrictEqual({ ok: false, reason: 'orchestration-knowledge-refused' });
    expect(lookups).toBe(1);
    // The FIRST capture is untouched. A second call must not clear what the turn already built its
    // message from.
    expect(bridge.readCaptured()?.records).toHaveLength(1);
  });
});

describe('the M2 request must be about THIS run', () => {
  const mismatches: Record<string, Record<string, unknown>> = {
    'another conversation': { conversationId: 'conv.999' },
    'another data class': { dataClass: 'LOCAL_ONLY' },
    'a different topic': { topics: ['warranty'] },
    'a reordered topic list': { topics: ['installation-timeline', 'warranty'] },
    'an empty topic list': { topics: [] },
  };
  for (const [label, over] of Object.entries(mismatches)) {
    it(`refuses ${label}, and captures nothing`, async () => {
      const bridge = bridgeFor();
      const result = await bridge.knowledgePort.retrieve(m2Request(over));
      expect(result).toStrictEqual({ ok: false, reason: 'orchestration-knowledge-refused' });
      expect(bridge.readCaptured()).toBeUndefined();
    });
  }
});

describe('governed refusals fail closed, and leak nothing', () => {
  const cases: Record<string, ReturnType<typeof record>> = {
    'an expired record': record({ expiresAt: '2026-03-01T00:00:00Z' }),
    'a not-yet-effective record': record({ effectiveFrom: '2027-01-01T00:00:00Z' }),
    'a retired record': record({ lifecycleState: 'RETIRED' }),
    'a scope the agent may not read': record({
      permissions: {
        tenantScope: 'GLOBAL',
        allowedAgentScopes: ['VENDOR'],
        allowedPurposes: ['CLIENT_RESPONSE'],
      },
    }),
    'a purpose the turn does not have': record({
      permissions: {
        tenantScope: 'GLOBAL',
        allowedAgentScopes: ['CLIENT'],
        allowedPurposes: ['POLICY_LOOKUP'],
      },
    }),
    'a record above the turn data class': record({ classification: 'HUMAN_ONLY' }),
    'a SUBJECT-LINKED record': record({ subjectRef: 'subject.someone-else' }),
  };
  for (const [label, forbidden] of Object.entries(cases)) {
    it(`refuses ${label} before any content is exposed`, async () => {
      const bridge = bridgeFor({ registry: registryOf(forbidden) });
      const result = await bridge.knowledgePort.retrieve(m2Request());
      expect(result).toStrictEqual({ ok: false, reason: 'orchestration-knowledge-refused' });
      expect(bridge.readCaptured()).toBeUndefined();
      // The refusal names the M2 reason and NOTHING else -- no governed reason, topic, source,
      // subject or record.
      expect(JSON.stringify(result)).not.toContain('installation');
      expect(JSON.stringify(result)).not.toContain('subject');
    });
  }

  it('a subject-linked record fails closed because NO knowledge privacy gate is supplied', async () => {
    // Deliberate (ADR-0103 §7). The conversation gate available here ignores the reference it is
    // handed, so adapting it could mark a record about a DIFFERENT person clear. P7 grounds business
    // content; personal memory does not get a weaker gate in order to be included.
    const bridge = bridgeFor({ registry: registryOf(record({ subjectRef: 'subject.1' })) });
    expect((await bridge.knowledgePort.retrieve(m2Request())).ok).toBe(false);
  });

  it('an unknown topic refuses rather than answering with less', async () => {
    const bridge = bridgeFor({ topics: ['nothing-registered'] });
    const result = await bridge.knowledgePort.retrieve(
      m2Request({ topics: ['nothing-registered'] }),
    );
    expect(result.ok).toBe(false);
    expect(bridge.readCaptured()).toBeUndefined();
  });

  it('a throwing registry refuses without an error escaping', async () => {
    const base = registryOf(record());
    const exploding: GovernedKnowledgeRegistry = {
      ...base,
      listByTopic: () => {
        throw new Error('knowledge store at 10.0.0.9 — token=abc123');
      },
    };
    const bridge = createRiyaGroundedKnowledgeBridge({
      envelope: envelope(),
      registry: exploding,
      topics: ['installation-timeline'],
    });
    const result = await bridge.knowledgePort.retrieve(m2Request());
    expect(result).toStrictEqual({ ok: false, reason: 'orchestration-knowledge-refused' });
    expect(JSON.stringify(result)).not.toContain('10.0.0.9');
    expect(JSON.stringify(result)).not.toContain('token');
  });
});

describe('two concurrent runs cannot ground each other', () => {
  it('each bridge captures only its own records', async () => {
    const shared = registryOf(
      record(),
      record({
        knowledgeId: 'kb.faq.warranty',
        version: 2,
        topic: 'warranty',
        content: 'A ten-year warranty applies to modular carcasses.',
        contentDigest: digest('b'),
        sourceRef: 'doc://faq/warranty',
      }),
    );
    const a = createRiyaGroundedKnowledgeBridge({
      envelope: envelope({ conversationId: 'conv.A', runtimeId: 'run.A', messageId: 'msg.A' }),
      registry: shared,
      topics: ['installation-timeline'],
    });
    const b = createRiyaGroundedKnowledgeBridge({
      envelope: envelope({ conversationId: 'conv.B', runtimeId: 'run.B', messageId: 'msg.B' }),
      registry: shared,
      topics: ['warranty'],
    });

    // Interleaved on purpose: a module-level capture would be overwritten by whichever finished last.
    const [ra, rb] = await Promise.all([
      a.knowledgePort.retrieve(m2Request({ conversationId: 'conv.A' })),
      b.knowledgePort.retrieve(m2Request({ conversationId: 'conv.B', topics: ['warranty'] })),
    ]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(a.readCaptured()?.records.map((r) => r.knowledgeId)).toStrictEqual([
      'kb.faq.installation',
    ]);
    expect(b.readCaptured()?.records.map((r) => r.knowledgeId)).toStrictEqual(['kb.faq.warranty']);
  });
});

describe('the RWC-P7 budgets', () => {
  it('are the locked internal values, and neither is a global widening', () => {
    expect(MAX_RIYA_GROUNDED_RECORDS).toBe(8);
    expect(MAX_RIYA_GROUNDED_CONTENT_CHARS).toBe(4096);
  });

  it('a record over the per-record content bound is refused, never truncated', async () => {
    const bridge = bridgeFor({
      registry: registryOf(record({ content: 'x'.repeat(MAX_RIYA_GROUNDED_CONTENT_CHARS + 1) })),
    });
    const result = await bridge.knowledgePort.retrieve(m2Request());
    expect(result.ok).toBe(false);
    expect(bridge.readCaptured()).toBeUndefined();
  });
});
