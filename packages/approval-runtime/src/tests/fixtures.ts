/**
 * Deterministic fixtures for the approval-runtime specs.
 *
 * Not a test file, and not shipped: `tsconfig.build.json` excludes `src/tests`. Every recommendation
 * is built through the REAL `@qf-jarvis/recommendation-runtime`, so the sources these specs validate
 * are the ones the merged producer actually emits — a hand-assembled `RecommendationRuntimeResult`
 * would prove only that this package agrees with a fixture.
 */
import type { ActionDecision } from '@qf-jarvis/contracts';
import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import type {
  RecommendationRuntimeIdentityPort,
  RecommendationRuntimeResult,
} from '@qf-jarvis/recommendation-runtime';

import type { ApprovalRuntimeIdentityPort } from '../index.js';

export const REC_CREATED_AT = '2026-08-02T09:00:00Z';
export const REC_EXPIRES_AT = '2026-08-04T09:00:00Z';
export const REQ_CREATED_AT = '2026-08-02T10:00:00Z';
export const REQ_EXPIRES_AT = '2026-08-03T10:00:00Z';
export const DECIDED_AT = '2026-08-02T12:00:00Z';

export const CORRELATION_ID = '11111111-2222-4333-8444-555555555555';
export const DECISION_ID = '22222222-3333-4444-8555-666666666666';
export const OTHER_ACTION_ID = '99999999-8888-4777-8666-555555555555';

export const POLICY = Object.freeze({ policyId: 'approval.policy', policyVersion: 3 });

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

/** A deterministic approval-request identity port. */
export function fixedApprovalIdentity(
  id = 'cccccccc-0000-4000-8000-000000000001',
): ApprovalRuntimeIdentityPort {
  return { nextApprovalRequestId: (): string => id };
}

function actionDraft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,
    summary: 'Schedule a follow-up with the vendor.',
    parameters: { channel: 'whatsapp', delayHours: 48 },
    ...over,
  };
}

/**
 * A real, governed recommendation result.
 *
 * `client-or-vendor-facing-communication` + `authorized-team-human` by default: a legitimate pairing
 * that travels the approval path. Overrides let a spec produce the informational, money-related and
 * multi-action variants without restating the whole input.
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

/** Two actions, for partial-approval and multi-action decision coverage. */
export function twoActionSource(): RecommendationRuntimeResult {
  return recommendationSource({
    proposedActions: [
      actionDraft(),
      actionDraft({ actionType: 'notify.owner', summary: 'Tell the account owner.' }),
    ],
  });
}

/** An informational recommendation: zero actions, zero bindings, nothing to approve. */
export function informationalSource(): RecommendationRuntimeResult {
  return recommendationSource({
    risk: 'informational',
    requiredApproval: 'none',
    proposedActions: [],
  });
}

export { actionDraft };

/** A well-formed Core decision. Every field overridable so a spec can break exactly one thing. */
export function coreDecision(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decisionId: DECISION_ID,
    recommendationId: '',
    contractVersion: 1,
    issuer: 'quickfurno-core',
    decidedBy: {
      actorType: 'human',
      actor: { entityType: 'operator', entityId: 'human.approver.1' },
    },
    decidedAt: DECIDED_AT,
    outcome: 'approved',
    actionDecisions: [] as ActionDecision[],
    reasonCode: 'core.decided',
    correlationId: CORRELATION_ID,
    ...over,
  };
}
