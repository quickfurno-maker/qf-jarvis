/**
 * Governed fixtures for the correlation runtime.
 *
 * Not a test file, and excluded from the emitting build.
 *
 * The recommendation, the approval request and the approval decision are built through the REAL
 * merged runtimes — a hand-assembled approval would prove only that this package agrees with a
 * fixture. The communication request and Core's authorization are built as plain values and parsed
 * by their own governed schemas inside the runtime, because Jarvis has no producer for the first
 * yet and Core is the producer of the second.
 */
import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionV1, ApprovalRequestV1 } from '@qf-jarvis/contracts';

import type { CommunicationAuthorizationEvidence } from '../contracts/input.js';

export const REC_CREATED_AT = '2026-08-02T09:00:00Z';
export const REC_EXPIRES_AT = '2026-08-04T09:00:00Z';
export const REQ_CREATED_AT = '2026-08-02T10:00:00Z';
export const REQ_EXPIRES_AT = '2026-08-03T10:00:00Z';

/** The communication ask's own window, and the instant Core answered inside it. */
export const COMM_CREATED_AT = '2026-08-02T11:00:00Z';
export const COMM_EXPIRES_AT = '2026-08-02T23:00:00Z';
export const DECIDED_AT = '2026-08-02T12:00:00Z';

export const CORRELATION_ID = 'aaaaaaaa-2222-4333-8444-555555555555';
export const OTHER_CORRELATION_ID = 'bbbbbbbb-2222-4333-8444-555555555555';
export const COMMUNICATION_ID = 'aaaaaaaa-3333-4000-8000-000000000001';
export const COMMUNICATION_REQUEST_ID = 'aaaaaaaa-4444-4000-8000-000000000001';

export const POLICY = Object.freeze({ policyId: 'communication.policy', policyVersion: 2 });

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
    parameters: { delayHours: 48 },
    ...over,
  };
}

/**
 * A real governed recommendation, on the shared correlation thread.
 *
 * `tag` must be 8 lowercase hex characters. `correlationId` defaults to the thread the
 * communication request also uses, because the runtime requires them to agree.
 */
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
    decidedAt: '2026-08-02T10:30:00Z',
    outcome: actionDecisions.some((entry) => entry.decision === 'approved')
      ? 'approved'
      : 'rejected',
    actionDecisions: [...actionDecisions],
    reasonCode: 'core.decided',
    correlationId: source.recommendation.correlationId,
    ...over,
  } as unknown as ApprovalDecisionV1;
}

/** One ready approval-evidence bundle: a real source, a real request, and a real Core decision. */
export function approvalEvidence(
  tag: string,
  verdict: 'approved' | 'rejected' = 'approved',
): CommunicationAuthorizationEvidence {
  const source = recommendationSource(tag);
  const request = approvalRequest(source);
  const decision = coreDecision(source, [
    { actionId: request.proposedActionId, decision: verdict },
  ]);
  // EXACTLY the three keys the approval runtime's input schema accepts -- it is strict, so a
  // convenience field bolted on here would make every fixture fail validation for the wrong reason.
  return { source, request, decision };
}

/**
 * Partial approval: TWO actions, the asked-about one REJECTED, the other approved.
 *
 * The overall decision outcome is therefore `approved` while this action's verdict is `rejected` —
 * the exact shape that would slip through a runtime reading `decision.outcome`.
 */
export function partiallyApprovedEvidence(tag: string): CommunicationAuthorizationEvidence {
  const source = twoActionSource(tag);
  const [first, second] = source.recommendation.proposedActions;
  if (first === undefined || second === undefined) {
    throw new Error('fixture: unreachable');
  }
  const request = approvalRequest(source, 0);
  const decision = coreDecision(source, [
    { actionId: first.actionId, decision: 'rejected' },
    { actionId: second.actionId, decision: 'approved' },
  ]);
  return { source, request, decision };
}

/**
 * A multi-action decision whose SELECTED action is APPROVED.
 *
 * The mirror of `partiallyApprovedEvidence`, and the one that shows the LIMIT of the guarantee
 * rather than a safety rule: one `ApprovalDecisionV1` covering two actions, with the supplied
 * approval request naming the approved one. Validation succeeds — and the observation still says
 * nothing about which of the two actions the communication request represents, because the
 * communication contracts carry no field that could say.
 */
export function multiActionApprovedEvidence(tag: string): {
  /** EXACTLY the three keys the approval runtime's strict input schema accepts. */
  readonly evidence: CommunicationAuthorizationEvidence;
  readonly selectedActionId: string;
  readonly otherActionId: string;
} {
  const source = twoActionSource(tag);
  const [first, second] = source.recommendation.proposedActions;
  if (first === undefined || second === undefined) {
    throw new Error('fixture: unreachable');
  }
  const request = approvalRequest(source, 0);
  const decision = coreDecision(source, [
    { actionId: first.actionId, decision: 'approved' },
    { actionId: second.actionId, decision: 'approved' },
  ]);
  return {
    evidence: { source, request, decision },
    selectedActionId: first.actionId,
    otherActionId: second.actionId,
  };
}

/**
 * A powerless communication request.
 *
 * A plain value, validated by `communicationRequestV1Schema` inside the runtime: Jarvis has no
 * producer for this contract yet, and inventing one here would be building the Mini Brain by
 * accident. Note what it carries — an OPAQUE Core entity reference, a versioned template reference,
 * and no consent field, no phone number and no provider destination.
 */
export function communicationRequest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    communicationRequestId: COMMUNICATION_REQUEST_ID,
    contractVersion: 1,
    communicationId: COMMUNICATION_ID,
    producingSystem: 'qf-jarvis',
    requestingAgent: 'anisha',
    requestingAgentVersion: 'anisha.v1',
    recipient: { entityType: 'vendor', entityId: 'vendor.42' },
    purposeCode: 'vendor.sample.follow-up',
    proposedChannel: 'whatsapp',
    content: {
      contentType: 'template',
      templateId: 'vendor.sample.follow-up',
      templateVersion: 1,
    },
    requestedTiming: { timingType: 'immediate' },
    createdAt: COMM_CREATED_AT,
    expiresAt: COMM_EXPIRES_AT,
    priority: 'medium',
    requiredApproval: 'authorized-team-human',
    policy: POLICY,
    summary: 'Ask the vendor about the delayed sample.',
    correlationId: CORRELATION_ID,
    ...over,
  };
}

/** Core's authorization: authorized, naming the channel it allowed and the approval it rests on. */
export function authorized(
  approvalDecisionId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractVersion: 1,
    communicationId: COMMUNICATION_ID,
    communicationRequestId: COMMUNICATION_REQUEST_ID,
    issuer: 'quickfurno-core',
    outcome: 'authorized',
    authorizedChannel: 'whatsapp',
    approvalDecisionId,
    decidedAt: DECIDED_AT,
    reasonCode: 'eligible',
    policy: POLICY,
    correlationId: CORRELATION_ID,
    ...over,
  };
}

/**
 * Core's authorization: REJECTED, carrying the reason.
 *
 * No `authorizedChannel` and no `approvalDecisionId` — the contract forbids both on a refusal, so
 * that a rejection can never be read as resting on someone's approval.
 */
export function rejected(
  reasonCode: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractVersion: 1,
    communicationId: COMMUNICATION_ID,
    communicationRequestId: COMMUNICATION_REQUEST_ID,
    issuer: 'quickfurno-core',
    outcome: 'rejected',
    decidedAt: DECIDED_AT,
    reasonCode,
    policy: POLICY,
    correlationId: CORRELATION_ID,
    ...over,
  };
}
