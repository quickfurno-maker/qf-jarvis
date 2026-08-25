/**
 * Shared JAO-6 test fixtures.
 *
 * The behaviour suite and the threat-model suite exercise the same slice from opposite directions,
 * so the valid request they both start from lives here. A fixture that drifts between two suites is
 * two different proofs wearing one name.
 */
import type { ApprovalRequestV1 } from '@qf-jarvis/contracts';
import type { ApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';

import type { Jao6ProposalReadyResult } from '../jao/governed-business-action-proposals/index.js';
import { createJao6ProposalRegistry } from '../jao/governed-business-action-proposals/proposal-registry.js';

export const CREATED_AT = '2026-08-25T09:00:00.000Z';
export const EXPIRES_AT = '2026-08-26T09:00:00.000Z';
export const CORRELATION_ID = '3f2c1a44-0d1e-4a7b-9c2e-1b0a5d6e7f80';
export const EVENT_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

/**
 * The reviewed closed action parameters.
 *
 * Every field is an enum code or a timestamp. There is no free-text field, which is the point: this
 * object becomes `proposedActions[0].parameters` verbatim, so anything here is inside the action
 * bytes the canonical fingerprint measures and inside the exact action a human approves.
 */
export function PARAMETERS(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    followUpReasonCode: 'quotation-response-overdue',
    topicCode: 'quotation',
    earliestFollowUpAt: '2026-08-25T12:00:00.000Z',
    latestFollowUpAt: '2026-08-26T08:00:00.000Z',
    ...over,
  };
}

/** A valid proposal request. Governance fields are absent because the policy owns them. */
export function REQUEST(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proposalPolicyId: 'jao6.vendor-follow-up',
    proposalPolicyVersion: 1,
    subject: { entityType: 'vendor', entityId: 'vendor.42' },
    priority: 'medium',
    confidence: 0.6,
    summary: 'Follow up with the vendor about the outstanding quotation.',
    rationale: 'The quotation request was acknowledged and no response has arrived since.',
    evidence: [
      {
        evidenceType: 'canonical-event',
        eventId: EVENT_ID,
        eventType: 'vendor.quotation-requested',
        description: 'The quotation request was recorded in Core.',
      },
    ],
    parameters: PARAMETERS(),
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    correlationId: CORRELATION_ID,
    ...over,
  };
}

/** The canonical registry, reached by DIRECT MODULE PATH because no barrel exports it. */
export function internalRegistry(): ReturnType<typeof createJao6ProposalRegistry> {
  return createJao6ProposalRegistry();
}

/** An approval runtime stub whose `createRequest` is whatever a spec needs it to be. */
export function stubApproval(createRequest: () => ApprovalRequestV1): ApprovalRuntime {
  return {
    createRequest,
    validateDecision: (): never => {
      throw new Error('JAO-6 never validates a decision; only QuickFurno Core issues one');
    },
  };
}

/** The honest runtime result, rebuilt from a real proposal so a stub can return it verbatim. */
export function honestSource(result: Jao6ProposalReadyResult): RecommendationRuntimeResult {
  return {
    recommendation: result.recommendation,
    actionBindings: result.actionBindings,
  };
}
