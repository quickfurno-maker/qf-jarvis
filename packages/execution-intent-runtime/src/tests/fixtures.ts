/**
 * Governed fixtures for the execution intent correlation runtime.
 *
 * Not a test file, and excluded from the emitting build.
 *
 * The recommendation, the approval request and the Core approval decision are built through the REAL
 * merged runtimes — a hand-assembled approval would prove only that this package agrees with a
 * fixture. The execution intent is a plain value parsed by `executionIntentV1Schema` inside the
 * runtime, because QuickFurno Core is its producer and Jarvis has no builder for it, on purpose.
 */
import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionV1, ApprovalRequestV1 } from '@qf-jarvis/contracts';

import type { ExecutionApprovalEvidence } from '../contracts/input.js';

export const REC_CREATED_AT = '2026-08-02T09:00:00Z';
export const REC_EXPIRES_AT = '2026-08-04T09:00:00Z';
export const REQ_CREATED_AT = '2026-08-02T10:00:00Z';
export const REQ_EXPIRES_AT = '2026-08-03T10:00:00Z';
export const DECIDED_AT = '2026-08-02T11:00:00Z';

/** The intent's own window, comfortably inside the recommendation's. */
export const ISSUED_AT = '2026-08-02T12:00:00Z';
export const INTENT_EXPIRES_AT = '2026-08-03T12:00:00Z';

export const CORRELATION_ID = 'aaaaaaaa-2222-4333-8444-555555555555';
export const OTHER_CORRELATION_ID = 'bbbbbbbb-2222-4333-8444-555555555555';

/**
 * The governed parameters the fixture action carries.
 *
 * Deliberately nested and with an array, so the structural comparison has something to be right
 * about: key order must not matter, array order must.
 */
export const ACTION_PARAMETERS: Readonly<Record<string, unknown>> = Object.freeze({
  delayHours: 48,
  escalate: false,
  tags: ['sample', 'overdue'],
  window: { start: '09:00', end: '18:00' },
});

let counter = 0;
function nextSuffix(): string {
  counter += 1;
  return String(counter).padStart(12, '0');
}

function actionDraft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,
    summary: 'Follow up with the vendor about the delayed sample.',
    parameters: { ...ACTION_PARAMETERS },
    ...over,
  };
}

/** A real governed recommendation. `tag` must be 8 lowercase hex characters. */
export function recommendationSource(
  tag: string,
  over: Record<string, unknown> = {},
): RecommendationRuntimeResult {
  let n = 0;
  return createRecommendationRuntime({
    identity: {
      nextRecommendationId: (): string => {
        n += 1;
        return `${tag}-0000-4000-8000-${String(n).padStart(12, '0')}`;
      },
      nextActionId: (): string => {
        n += 1;
        return `${tag}-1111-4000-8000-${String(n).padStart(12, '0')}`;
      },
    },
  }).create({
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

/** Two actions, for the partial-approval proof. */
export function twoActionSource(tag: string): RecommendationRuntimeResult {
  return recommendationSource(tag, {
    proposedActions: [
      actionDraft(),
      actionDraft({ actionType: 'notify.owner', summary: 'Tell the account owner.' }),
    ],
  });
}

/** A real approval request for one action of a real recommendation. */
export function approvalRequest(
  source: RecommendationRuntimeResult,
  actionIndex = 0,
): ApprovalRequestV1 {
  const action = source.recommendation.proposedActions[actionIndex];
  if (action === undefined) {
    throw new Error('fixture: no such action');
  }
  const id = `dddddddd-0000-4000-8000-${nextSuffix()}`;
  return createApprovalRuntime({
    identity: { nextApprovalRequestId: (): string => id },
  }).createRequest({
    source,
    proposedActionId: action.actionId,
    createdAt: REQ_CREATED_AT,
    expiresAt: REQ_EXPIRES_AT,
    policy: { policyId: 'approval.policy', policyVersion: 3 },
  });
}

/** A well-formed Core approval decision over the given per-action verdicts. */
export function coreDecision(
  source: RecommendationRuntimeResult,
  actionDecisions: readonly {
    readonly actionId: string;
    readonly decision: 'approved' | 'rejected';
  }[],
  over: Record<string, unknown> = {},
): ApprovalDecisionV1 {
  return {
    decisionId: `eeeeeeee-0000-4000-8000-${nextSuffix()}`,
    recommendationId: source.recommendation.recommendationId,
    contractVersion: 1,
    issuer: 'quickfurno-core',
    decidedBy: {
      actorType: 'human',
      actor: { entityType: 'operator', entityId: 'human.approver.1' },
    },
    decidedAt: DECIDED_AT,
    outcome: actionDecisions.some((entry) => entry.decision === 'approved')
      ? 'approved'
      : 'rejected',
    actionDecisions: [...actionDecisions],
    reasonCode: 'core.decided',
    correlationId: source.recommendation.correlationId,
    ...over,
  } as unknown as ApprovalDecisionV1;
}

/** One prepared scenario: real evidence, plus the identities an intent must reproduce. */
export interface Scenario {
  /** EXACTLY the three keys the approval runtime's strict input schema accepts. */
  readonly evidence: ExecutionApprovalEvidence;
  readonly source: RecommendationRuntimeResult;
  readonly recommendationId: string;
  readonly decisionId: string;
  readonly actionId: string;
  readonly actionType: string;
  readonly actionContractVersion: number;
  readonly parameters: Record<string, unknown>;
}

function build(
  source: RecommendationRuntimeResult,
  actionIndex: number,
  verdicts: readonly { readonly actionId: string; readonly decision: 'approved' | 'rejected' }[],
): Scenario {
  const request = approvalRequest(source, actionIndex);
  const decision = coreDecision(source, verdicts);
  const action = source.recommendation.proposedActions[actionIndex];
  if (action === undefined) {
    throw new Error('fixture: unreachable');
  }
  return {
    evidence: { source, request, decision },
    source,
    recommendationId: source.recommendation.recommendationId,
    decisionId: decision.decisionId,
    actionId: action.actionId,
    actionType: action.actionType,
    actionContractVersion: action.actionContractVersion,
    parameters: action.parameters,
  };
}

/** The happy path: one action, approved. */
export function scenario(tag: string): Scenario {
  const source = recommendationSource(tag);
  const action = source.recommendation.proposedActions[0];
  if (action === undefined) {
    throw new Error('fixture: unreachable');
  }
  return build(source, 0, [{ actionId: action.actionId, decision: 'approved' }]);
}

/**
 * Partial approval: TWO actions, the intent's one REJECTED, the other approved.
 *
 * The overall decision outcome is therefore `approved` while this action's verdict is `rejected` —
 * the exact shape that would slip through a runtime reading `decision.outcome`.
 */
export function partiallyApprovedScenario(tag: string): Scenario {
  const source = twoActionSource(tag);
  const [first, second] = source.recommendation.proposedActions;
  if (first === undefined || second === undefined) {
    throw new Error('fixture: unreachable');
  }
  return build(source, 0, [
    { actionId: first.actionId, decision: 'rejected' },
    { actionId: second.actionId, decision: 'approved' },
  ]);
}

/**
 * A Core-issued execution intent that faithfully reproduces the scenario's approved action.
 *
 * A plain value: Core is its producer, and a Jarvis-side builder for it would be the very capability
 * this package must not have.
 */
export function executionIntent(
  from: Scenario,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    executionIntentId: `ffffffff-0000-4000-8000-${nextSuffix()}`,
    contractVersion: 1,
    recommendationId: from.recommendationId,
    approvalDecisionId: from.decisionId,
    approvedActionId: from.actionId,
    actionType: from.actionType,
    actionContractVersion: from.actionContractVersion,
    parameters: { ...from.parameters },
    issuer: 'quickfurno-core',
    executor: 'n8n',
    issuedAt: ISSUED_AT,
    expiresAt: INTENT_EXPIRES_AT,
    idempotencyKey: `intent-${nextSuffix()}`,
    deliverySemantics: 'at-most-once',
    correlationId: CORRELATION_ID,
    ...over,
  };
}
