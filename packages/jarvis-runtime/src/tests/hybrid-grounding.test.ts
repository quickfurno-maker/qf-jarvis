import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import { AAROHI_ACQUISITION_PROMPT_V1 } from '@qf-jarvis/aarohi-prompts';
import { ANISHA_VENDOR_JOURNEY_PROMPT_V1 } from '@qf-jarvis/anisha-prompts';
import type { HybridKnowledgeHit, HybridKnowledgeSearchRequest } from '@qf-jarvis/knowledge-index';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import { createAgentHybridGroundedKnowledgeBridge } from '../composition/riya-grounded-knowledge.js';
import {
  AGENT_KNOWLEDGE_BINDINGS,
  type GroundedAgentActor,
  type HybridKnowledgeRetrievalPort,
} from '../contracts/agent-knowledge-policy.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import {
  clearControlState,
  mutableAuthoritativeState,
  syntheticInboundEnvelope,
  syntheticPromptDefinition,
  syntheticRuntimeConfig,
} from '../testing/index.js';

const TENANT = 'tenant.hybrid';
const CONVERSATION = 'conv.hybrid';
const KNOWLEDGE_REVISION = 'knowledge.release.synthetic.v1';
const CONTENT = 'SYNTHETIC GOVERNED KNOWLEDGE: installation follows a measured-site review.';
const DIGEST = 'a'.repeat(64);

const PARTY: Readonly<Record<GroundedAgentActor, 'CLIENT' | 'VENDOR' | 'PROSPECT'>> = Object.freeze(
  {
    RIYA: 'CLIENT',
    ANISHA: 'VENDOR',
    AAROHI: 'PROSPECT',
  },
);

function hit(): HybridKnowledgeHit {
  return Object.freeze({
    chunkId: 'kb.hybrid',
    parentKnowledgeId: 'doc.hybrid',
    parentVersion: 7,
    topic: 'installation',
    content: CONTENT,
    contentFormat: 'PLAIN_TEXT',
    headingPath: Object.freeze(['Installation']),
    citation: Object.freeze({
      knowledgeId: 'kb.hybrid',
      version: 1,
      sourceRef: 'synthetic://hybrid',
      sourceRevision: 'rev.7',
      authorityTier: 'APPROVED_INTERNAL_DOCUMENT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      expiresAt: undefined,
      contentDigest: DIGEST,
    }),
    fusedScore: 0.02,
    rerankScore: 0.7,
  });
}

function recordingHybridPort(): {
  readonly port: HybridKnowledgeRetrievalPort;
  readonly seen: readonly HybridKnowledgeSearchRequest[];
} {
  const seen: HybridKnowledgeSearchRequest[] = [];
  return {
    seen,
    port: Object.freeze({
      knowledgeRevision: KNOWLEDGE_REVISION,
      retrieve(request: HybridKnowledgeSearchRequest) {
        seen.push(request);
        return Promise.resolve(
          Object.freeze({
            ok: true as const,
            reason: 'hybrid-served' as const,
            hits: Object.freeze([hit()]),
          }),
        );
      },
    }),
  };
}

function envelope(actor: GroundedAgentActor): InboundEnvelope {
  return syntheticInboundEnvelope({
    channel: 'WEB',
    tenantId: TENANT,
    conversationId: CONVERSATION,
    partyType: PARTY[actor],
    normalizedText: 'How does installation scheduling work?',
    receivedAt: '2026-09-22T10:00:00.000Z',
  });
}

describe('hybrid bridge binds query and authority to the current turn', () => {
  for (const actor of ['RIYA', 'ANISHA', 'AAROHI'] as const) {
    it(actor + ' derives its closed scope/purpose and captures minimized content', async () => {
      const recorded = recordingHybridPort();
      const binding = AGENT_KNOWLEDGE_BINDINGS[actor];
      const bridge = createAgentHybridGroundedKnowledgeBridge({
        envelope: envelope(actor),
        topicFilters: ['installation'],
        agentScope: binding.agentScope,
        purpose: binding.purpose,
        candidatePool: 64,
        maxResults: 8,
        maxContentChars: 4096,
        retrieval: recorded.port,
      });

      const result = await bridge.knowledgePort.retrieve({
        conversationId: CONVERSATION,
        topics: ['installation'],
        dataClass: 'HOSTED_ALLOWED',
      });

      expect(result.ok).toBe(true);
      expect(recorded.seen).toHaveLength(1);
      expect(recorded.seen[0]?.queryText).toBe('How does installation scheduling work?');
      expect(recorded.seen[0]?.agentScope).toBe(binding.agentScope);
      expect(recorded.seen[0]?.purpose).toBe(binding.purpose);
      expect(recorded.seen[0]?.tenantId).toBe(TENANT);
      expect(bridge.readCaptured()).toEqual({
        version: 1,
        records: [
          {
            knowledgeId: 'kb.hybrid',
            version: 1,
            topic: 'installation',
            contentFormat: 'PLAIN_TEXT',
            content: CONTENT,
          },
        ],
      });

      // The bridge is one-shot per inbound run. A second M2 read cannot trigger a second search.
      const second = await bridge.knowledgePort.retrieve({
        conversationId: CONVERSATION,
        topics: ['installation'],
        dataClass: 'HOSTED_ALLOWED',
      });
      expect(second.ok).toBe(false);
      expect(recorded.seen).toHaveLength(1);
    });
  }

  it('refuses an envelope/M2 mismatch before semantic search', async () => {
    const recorded = recordingHybridPort();
    const binding = AGENT_KNOWLEDGE_BINDINGS.ANISHA;
    const bridge = createAgentHybridGroundedKnowledgeBridge({
      envelope: envelope('ANISHA'),
      topicFilters: [],
      agentScope: binding.agentScope,
      purpose: binding.purpose,
      candidatePool: 32,
      maxResults: 4,
      maxContentChars: 4096,
      retrieval: recorded.port,
    });
    const result = await bridge.knowledgePort.retrieve({
      conversationId: 'conv.someone-else',
      topics: [],
      dataClass: 'HOSTED_ALLOWED',
    });
    expect(result.ok).toBe(false);
    expect(recorded.seen).toHaveLength(0);
    expect(bridge.readCaptured()).toBeUndefined();
  });
});

function promptBindings(clientPrompt: ReturnType<typeof syntheticPromptDefinition>) {
  return {
    CLIENT: {
      promptFamily: clientPrompt.promptId,
      promptVersion: clientPrompt.promptVersion,
      evaluationRef: 'eval.hybrid.riya',
      evaluationPromptDigest: clientPrompt.contentDigest,
    },
    VENDOR: {
      promptFamily: ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptId,
      promptVersion: ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptVersion,
      evaluationRef: 'eval.hybrid.anisha',
      evaluationPromptDigest: ANISHA_VENDOR_JOURNEY_PROMPT_V1.contentDigest,
    },
    PROSPECT: {
      promptFamily: AAROHI_ACQUISITION_PROMPT_V1.promptId,
      promptVersion: AAROHI_ACQUISITION_PROMPT_V1.promptVersion,
      evaluationRef: 'eval.hybrid.aarohi',
      evaluationPromptDigest: AAROHI_ACQUISITION_PROMPT_V1.contentDigest,
    },
  } as const;
}

describe('hybrid grounding reaches the generic model request without leaking governance metadata', () => {
  for (const actor of ['RIYA', 'ANISHA', 'AAROHI'] as const) {
    it(actor + ' sends message + minimized groundedKnowledge in one model call', async () => {
      const hybrid = recordingHybridPort();
      const clientPrompt = syntheticPromptDefinition();
      const inner = scriptedGatewayInvoker(
        structuredReply({
          replyBody: 'Synthetic grounded reply.',
          citations: [{ knowledgeId: 'kb.hybrid', version: 1 }],
        }),
      );
      const modelRequests: Parameters<typeof inner.invoke>[0][] = [];
      const gatewayInvoker = Object.freeze({
        invoke(request: Parameters<typeof inner.invoke>[0]) {
          modelRequests.push(request);
          return inner.invoke(request);
        },
      });

      const state = clearControlState({
        tenantId: TENANT,
        conversationId: CONVERSATION,
        partyType: PARTY[actor],
      });
      const base = syntheticRuntimeConfig({
        authoritativeState: mutableAuthoritativeState(() => state),
        promptRegistry: createPromptRegistry([
          clientPrompt,
          ANISHA_VENDOR_JOURNEY_PROMPT_V1,
          AAROHI_ACQUISITION_PROMPT_V1,
        ]),
        gatewayInvoker,
      });
      const {
        promptFamily: _family,
        promptVersion: _version,
        evaluationRef: _evaluationRef,
        evaluationPromptDigest: _evaluationDigest,
        ...rest
      } = base;

      const search = {
        topicFilters: ['installation'],
        candidatePool: 64,
        maxResults: 8,
        maxContentChars: 4096,
      } as const;
      const config: JarvisRuntimeConfig = {
        ...rest,
        promptBindings: promptBindings(clientPrompt),
        agentHybridKnowledge: {
          knowledgeRevision: KNOWLEDGE_REVISION,
          retrieval: hybrid.port,
          agents: { [actor]: search },
        },
      };

      const result = await createJarvisRuntime(config).processInbound(envelope(actor));
      expect(result.modelDrafted).toBe(true);
      expect(modelRequests).toHaveLength(1);
      expect(hybrid.seen).toHaveLength(1);

      const user = modelRequests[0]?.messages.find((message) => message.role === 'user')?.content;
      expect(user).toBeDefined();
      const payload = JSON.parse(user ?? '') as {
        message: string;
        groundedKnowledge: {
          version: number;
          records: readonly Record<string, unknown>[];
        };
      };
      expect(payload.message).toBe('How does installation scheduling work?');
      expect(payload.groundedKnowledge.version).toBe(1);
      expect(payload.groundedKnowledge.records).toEqual([
        {
          knowledgeId: 'kb.hybrid',
          version: 1,
          topic: 'installation',
          contentFormat: 'PLAIN_TEXT',
          content: CONTENT,
        },
      ]);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('APPROVED_INTERNAL_DOCUMENT');
      expect(serialized).not.toContain('sourceRevision');
      expect(serialized).not.toContain('tenantScope');
      expect(serialized).not.toContain('approvedBy');
      expect(JSON.stringify(modelRequests[0]?.metadata)).not.toContain(CONTENT);
    });
  }
});

describe('grounded citation requirement', () => {
  it('refuses a grounded reply that cites none of the knowledge supplied to the model', async () => {
    const actor = 'ANISHA' as const;
    const hybrid = recordingHybridPort();
    const clientPrompt = syntheticPromptDefinition();
    const inner = scriptedGatewayInvoker(
      structuredReply({ replyBody: 'Unsupported grounded reply.', citations: [] }),
    );
    const state = clearControlState({
      tenantId: TENANT,
      conversationId: CONVERSATION,
      partyType: PARTY[actor],
    });
    const base = syntheticRuntimeConfig({
      authoritativeState: mutableAuthoritativeState(() => state),
      promptRegistry: createPromptRegistry([
        clientPrompt,
        ANISHA_VENDOR_JOURNEY_PROMPT_V1,
        AAROHI_ACQUISITION_PROMPT_V1,
      ]),
      gatewayInvoker: inner,
    });
    const {
      promptFamily: _family,
      promptVersion: _version,
      evaluationRef: _evaluationRef,
      evaluationPromptDigest: _evaluationDigest,
      ...rest
    } = base;
    const config: JarvisRuntimeConfig = {
      ...rest,
      promptBindings: promptBindings(clientPrompt),
      agentHybridKnowledge: {
        knowledgeRevision: KNOWLEDGE_REVISION,
        retrieval: hybrid.port,
        agents: {
          ANISHA: {
            topicFilters: ['installation'],
            candidatePool: 64,
            maxResults: 8,
            maxContentChars: 4096,
          },
        },
      },
    };

    const result = await createJarvisRuntime(config).processInbound(envelope(actor));
    expect(result.outcome).toBe('REFUSED');
    expect(result.modelDrafted).toBe(false);
    expect(hybrid.seen).toHaveLength(1);
  });
});
