import { prepareGovernedAgentHandoff } from '@qf-jarvis/governed-agent-handoff';
import {
  createModelCapabilityProfile,
  createModelCapabilityRequirement,
  createProviderReleaseRef,
} from '@qf-jarvis/model-gateway';
import {
  createAdaptiveModelRoutingPolicy,
  decideAnswerPosture,
  selectAdaptiveModelRelease,
} from '@qf-jarvis/model-intelligence-control';
import { planWhatsAppMultimodalTurn } from '@qf-jarvis/multimodal-turn-planning';
import { createSemanticCacheEntry, findSemanticCacheHit } from '@qf-jarvis/semantic-context-engine';
import { describe, expect, it } from 'vitest';

import { runDigitalTwinSuite } from '../index.js';

const zeroEffects = {
  providerCalls: 0,
  coreMutations: 0,
  channelSends: 0,
  workflowStarts: 0,
  databaseWrites: 0,
} as const;

const fast = createModelCapabilityProfile({
  release: createProviderReleaseRef({
    releaseId: 'fast',
    providerId: 'provider.fast',
    modelId: 'model-fast',
    modelVersion: 'v1',
    executionClass: 'HOSTED',
    configDigest: 'digest.fast',
  }),
  taskClasses: ['RESPONSE_GENERATION'],
  resultModes: ['TEXT'],
  structuredOutputMode: 'unsupported',
  maxInputTokens: 16_000,
  maxCompletionTokens: 2_000,
  supportsTimeout: true,
  supportsCancellation: true,
  evaluationApprovalRef: 'evaluation.fast',
});
const strong = createModelCapabilityProfile({
  release: createProviderReleaseRef({
    releaseId: 'strong',
    providerId: 'provider.strong',
    modelId: 'model-strong',
    modelVersion: 'v1',
    executionClass: 'HOSTED',
    configDigest: 'digest.strong',
  }),
  taskClasses: ['RESPONSE_GENERATION'],
  resultModes: ['TEXT'],
  structuredOutputMode: 'unsupported',
  maxInputTokens: 64_000,
  maxCompletionTokens: 4_000,
  supportsTimeout: true,
  supportsCancellation: true,
  evaluationApprovalRef: 'evaluation.strong',
});

const routingPolicy = createAdaptiveModelRoutingPolicy({
  policyRef: 'qfj.digital-twin.routing.v1',
  releaseOrderByComplexity: {
    SIMPLE: ['fast', 'strong'],
    STANDARD: ['strong', 'fast'],
    COMPLEX: ['strong', 'fast'],
  },
  fallbackEnabled: false,
  certifiedFallbackByPrimary: { strong: 'fast' },
});

const promptDigest = 'b'.repeat(64);
const cache = createSemanticCacheEntry({
  entryId: 'cache.policy.1',
  scope: 'PUBLIC_KNOWLEDGE_ONLY',
  dataClass: 'HOSTED_ALLOWED',
  knowledgeRevision: 'knowledge.r1',
  promptDigest,
  releaseId: 'fast',
  agentScope: 'CLIENT',
  purpose: 'POLICY_LOOKUP',
  queryEmbedding: [1, 0, 0],
  responseText: 'Approved policy answer.',
  citations: [
    {
      knowledgeId: 'policy.1',
      version: 1,
      sourceRef: 'source.1',
      contentDigest: 'a'.repeat(64),
    },
  ],
});

describe('QF capability digital twin', () => {
  it('runs the new intelligence capabilities together with a zero-effect budget', async () => {
    const result = await runDigitalTwinSuite({
      scenarios: [
        {
          scenarioId: 'adaptive.simple',
          input: { kind: 'routing' },
          expectedDecision: 'PRIMARY_SELECTED',
          expectedArtifact: { releaseId: 'fast' },
        },
        {
          scenarioId: 'confidence.core-unavailable',
          input: { kind: 'confidence' },
          expectedDecision: 'VERIFY_CORE',
        },
        {
          scenarioId: 'multimodal.image-reference',
          input: { kind: 'multimodal' },
          expectedDecision: 'MEDIA_CONTENT_REQUIRED',
        },
        {
          scenarioId: 'handoff.vendor',
          input: { kind: 'handoff' },
          expectedDecision: 'HANDOFF_PROPOSAL_READY',
          expectedArtifact: { target: 'ANISHA' },
        },
        {
          scenarioId: 'semantic-cache.policy',
          input: { kind: 'cache' },
          expectedDecision: 'HIT',
        },
      ],
      candidate: {
        run(input: unknown) {
          const kind = (input as { kind: string }).kind;
          if (kind === 'routing') {
            const route = selectAdaptiveModelRelease({
              profiles: [fast, strong],
              requirement: createModelCapabilityRequirement({
                taskClass: 'RESPONSE_GENERATION',
                resultMode: 'TEXT',
                minInputTokens: 8_000,
                requiresTimeout: true,
                requiresCancellation: true,
              }),
              complexity: 'SIMPLE',
              policy: routingPolicy,
            });
            return Promise.resolve({
              decision: route.decision,
              artifact:
                route.decision === 'PRIMARY_SELECTED'
                  ? { releaseId: route.release.releaseId }
                  : undefined,
              effects: zeroEffects,
            });
          }
          if (kind === 'confidence') {
            const confidence = decideAnswerPosture({
              groundingRequired: false,
              retrievalHitCount: 0,
              citationCoverage: 0,
              groundingCoverage: 0,
              ambiguitySignals: 0,
              structuredOutputValid: true,
              safetyBlocked: false,
              requiresCoreAuthority: true,
              coreAuthority: 'UNAVAILABLE',
            });
            return Promise.resolve({ decision: confidence.posture, effects: zeroEffects });
          }
          if (kind === 'multimodal') {
            const plan = planWhatsAppMultimodalTurn({
              messageType: 'image',
              attachment: { kind: 'image', mediaId: 'media.1' },
            });
            return Promise.resolve({ decision: plan.decision, effects: zeroEffects });
          }
          if (kind === 'handoff') {
            const handoff = prepareGovernedAgentHandoff({
              fromAgent: 'RIYA',
              toAgent: 'ANISHA',
              partyType: 'VENDOR',
              conversationRef: 'conversation.1',
              coreAssignmentEvidenceRef: 'core.assignment.rev.1',
              reasonCode: 'party-reclassified',
            });
            return Promise.resolve({
              decision: handoff.decision,
              artifact:
                handoff.decision === 'HANDOFF_PROPOSAL_READY'
                  ? { target: handoff.proposal.toAgent }
                  : undefined,
              effects: zeroEffects,
            });
          }
          if (kind === 'cache') {
            const found = findSemanticCacheHit({
              entries: [cache],
              queryEmbedding: [0.999, 0.01, 0],
              knowledgeRevision: 'knowledge.r1',
              promptDigest,
              releaseId: 'fast',
              agentScope: 'CLIENT',
              purpose: 'POLICY_LOOKUP',
            });
            return Promise.resolve({ decision: found.decision, effects: zeroEffects });
          }
          return Promise.resolve({ decision: 'UNKNOWN', effects: zeroEffects });
        },
      },
    });

    expect(result).toMatchObject({ scenarioCount: 5, passed: 5, failed: 0 });
  });
});
