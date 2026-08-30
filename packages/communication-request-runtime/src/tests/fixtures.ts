/**
 * Deterministic fixtures for the communication-request-runtime specs.
 *
 * Not a test file, and not shipped: `tsconfig.build.json` excludes `src/tests`. Every recommendation
 * is built through the REAL `@qf-jarvis/recommendation-runtime`, so the sources these specs validate
 * are the ones the merged producer actually emits — a hand-assembled `RecommendationRuntimeResult`
 * would prove only that this package agrees with a fixture.
 */
import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import type {
  RecommendationRuntimeIdentityPort,
  RecommendationRuntimeResult,
} from '@qf-jarvis/recommendation-runtime';

import type { CommunicationRequestRuntimeIdentityPort } from '../index.js';

export const REC_CREATED_AT = '2026-08-02T09:00:00Z';
export const REC_EXPIRES_AT = '2026-08-04T09:00:00Z';
export const REQ_CREATED_AT = '2026-08-02T10:00:00Z';
export const REQ_EXPIRES_AT = '2026-08-03T10:00:00Z';

export const CORRELATION_ID = '11111111-2222-4333-8444-555555555555';
export const CAUSATION_EVENT_ID = '33333333-4444-4555-8666-777777777777';

export const REQUEST_ID = 'cccccccc-0000-4000-8000-000000000001';
export const COMMUNICATION_ID = 'dddddddd-0000-4000-8000-000000000001';

export const POLICY = Object.freeze({ policyId: 'communication.policy', policyVersion: 2 });

/** An opaque Core entity reference. Never a destination. */
export const RECIPIENT = Object.freeze({ entityType: 'vendor', entityId: 'vendor.42' });

/** A deterministic recommendation identity port, so action ids are predictable. */
function sequentialRecommendationIdentity(): RecommendationRuntimeIdentityPort {
  let n = 0;
  return {
    nextRecommendationId: (): string => {
      n += 1;
      return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
    nextActionId: (): string => {
      n += 1;
      return `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
  };
}

/** A deterministic communication-request identity port. */
export function fixedIdentity(
  requestId = REQUEST_ID,
  communicationId = COMMUNICATION_ID,
): CommunicationRequestRuntimeIdentityPort {
  return {
    nextCommunicationRequestId: (): string => requestId,
    nextCommunicationId: (): string => communicationId,
  };
}

export function actionDraft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,
    summary: 'Send the vendor the standard delayed-sample follow-up.',
    parameters: { delayHours: 48 },
    ...over,
  };
}

/**
 * A real, governed recommendation result.
 *
 * `client-or-vendor-facing-communication` + `authorized-team-human` by default: a legitimate pairing
 * that travels the communication path. Overrides let a spec produce the founder-approval,
 * informational and multi-action variants without restating the whole input.
 */
export function recommendationSource(
  over: Record<string, unknown> = {},
): RecommendationRuntimeResult {
  return createRecommendationRuntime({ identity: sequentialRecommendationIdentity() }).create({
    recommendationType: 'vendor.follow-up',
    createdAt: REC_CREATED_AT,
    expiresAt: REC_EXPIRES_AT,
    producingAgent: 'anisha',
    producingAgentVersion: 'anisha.v1',
    subject: { entityType: 'vendor', entityId: 'vendor.42' },
    priority: 'medium',
    confidence: 0.8,
    risk: 'client-or-vendor-facing-communication',
    requiredApproval: 'authorized-team-human',
    summary: 'The vendor has not responded about the delayed sample.',
    rationale: 'Two follow-ups have gone unanswered for six days, past the agreed sample window.',
    evidence: [
      {
        evidenceType: 'derived-signal',
        signalCode: 'vendor.unresponsive',
        description: 'No vendor reply for six days.',
      },
    ],
    proposedActions: [actionDraft()],
    composite: false,
    correlationId: CORRELATION_ID,
    ...over,
  });
}

/** A recommendation whose governance already carries explicit human approval. */
export function founderApprovedSource(
  over: Record<string, unknown> = {},
): RecommendationRuntimeResult {
  return recommendationSource({
    risk: 'money-related',
    requiredApproval: 'founder',
    priority: 'high',
    ...over,
  });
}

/** Two actions, so "the exact action" is a claim a spec can actually falsify. */
export function twoActionSource(): RecommendationRuntimeResult {
  return recommendationSource({
    proposedActions: [
      actionDraft(),
      actionDraft({ actionType: 'notify.owner', summary: 'Tell the account owner instead.' }),
    ],
  });
}

/** An informational recommendation: zero actions, zero bindings, nothing to communicate about. */
export function informationalSource(): RecommendationRuntimeResult {
  return recommendationSource({
    risk: 'informational',
    requiredApproval: 'none',
    proposedActions: [],
  });
}

/** A well-formed messaging content reference. */
export function templateContent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contentType: 'template',
    templateId: 'vendor.follow-up.v2',
    templateVersion: 2,
    ...over,
  };
}

/** A well-formed voice content reference. */
export function scriptContent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contentType: 'script',
    templateId: 'vendor.follow-up.voice',
    templateVersion: 1,
    ...over,
  };
}

/**
 * A complete, valid `createRequest` input. Every field overridable so a spec can break exactly one.
 *
 * `source` defaults to a freshly built governed recommendation; a spec that needs the SAME source
 * for both the input and an assertion passes its own.
 *
 * The default `proposedActionId` is read DEFENSIVELY, because several specs deliberately pass a
 * malformed source. Reaching into one confidently would make the fixture throw a `TypeError` before
 * the runtime ever saw the input — which would prove nothing about the runtime's refusal.
 */
export function requestInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  const source = over['source'] ?? recommendationSource();
  const loose = source as {
    recommendation?: { proposedActions?: readonly { actionId?: string }[] };
  } | null;
  return {
    source,
    proposedActionId: loose?.recommendation?.proposedActions?.[0]?.actionId,
    recipient: { ...RECIPIENT },
    purposeCode: 'vendor.follow-up',
    proposedChannel: 'whatsapp',
    content: templateContent(),
    requestedTiming: { timingType: 'immediate' },
    createdAt: REQ_CREATED_AT,
    expiresAt: REQ_EXPIRES_AT,
    policy: { ...POLICY },
    ...over,
  };
}
