import { describe, expect, it } from 'vitest';

import { createGovernedClientActionProposalV1, type ClientNextBestAction } from '../index.js';

const U = {
  match: '00000000-0000-4000-8000-000000000101',
  reassign: '00000000-0000-4000-8000-000000000102',
  extra: '00000000-0000-4000-8000-000000000103',
  confirmation: '00000000-0000-4000-8000-000000000104',
  event: '00000000-0000-4000-8000-000000000105',
  correlation: '00000000-0000-4000-8000-000000000106',
  batch: '00000000-0000-4000-8000-000000000107',
} as const;

const client = { entityType: 'client', entityId: 'client.42' } as const;
const lead = { entityType: 'lead', entityId: 'lead.9' } as const;
const category = { entityType: 'category', entityId: 'interior-design' } as const;
const policy = { policyId: 'client-os', policyVersion: 1 } as const;

function nba(action: ClientNextBestAction['action']): ClientNextBestAction {
  return {
    action,
    reasonCode: 'CLIENT_OS_TEST',
    requiresCoreDecision: true,
    businessEffect: false,
    executionAuthorized: false,
  };
}

const confirmation = {
  confirmationId: U.confirmation,
  contractVersion: 1,
  confirmedBy: client,
  confirmedAt: '2026-09-30T05:00:00.000Z',
  confirmationChannelCode: 'whatsapp',
  evidenceEventId: U.event,
  statementCode: 'client-confirmed-action',
} as const;

const evidence = [
  {
    evidenceType: 'canonical-event',
    eventId: U.event,
    eventType: 'qf.client.action-confirmed',
    description: 'Client explicitly confirmed the requested action.',
  },
] as const;

function matchPayload() {
  return {
    matchRequestId: U.match,
    contractVersion: 1,
    client,
    lead,
    category,
    expectedLeadRevision: 7,
    producingSystem: 'qf-jarvis',
    requestingAgent: 'riya',
    requestingAgentVersion: 'riya.v2',
    evidence,
    clientConfirmation: confirmation,
    reasonCode: 'client-requested-match',
    policy,
    createdAt: '2026-09-30T05:01:00.000Z',
    expiresAt: '2026-09-30T05:11:00.000Z',
    correlationId: U.correlation,
    causationEventId: U.event,
  } as const;
}

function reassignmentPayload() {
  return {
    reassignmentRequestId: U.reassign,
    contractVersion: 1,
    lead,
    category,
    client,
    currentBatchId: U.batch,
    producingSystem: 'qf-jarvis',
    requestingAgent: 'riya',
    requestingAgentVersion: 'riya.v2',
    dissatisfaction: {
      reasonCode: 'client-dissatisfied',
      severity: 'moderate',
      evidence,
    },
    clientConfirmation: {
      ...confirmation,
      statementCode: 'client-requested-replacement-vendors',
    },
    summary: 'Client explicitly requested replacement vendors.',
    policy,
    createdAt: '2026-09-30T05:01:00.000Z',
    expiresAt: '2026-09-30T05:11:00.000Z',
    correlationId: U.correlation,
    causationEventId: U.event,
  } as const;
}

function extraVendorPayload() {
  return {
    extraVendorReviewRequestId: U.extra,
    contractVersion: 1,
    client,
    lead,
    category,
    currentBatchId: U.batch,
    expectedLeadRevision: 7,
    producingSystem: 'qf-jarvis',
    requestingAgent: 'riya',
    requestingAgentVersion: 'riya.v2',
    evidence,
    clientConfirmation: {
      ...confirmation,
      statementCode: 'client-requested-more-vendor-options',
    },
    summary: 'Client requested another vendor option for comparison.',
    reasonCode: 'client-requested-more-comparison',
    policy,
    createdAt: '2026-09-30T05:01:00.000Z',
    expiresAt: '2026-09-30T05:11:00.000Z',
    correlationId: U.correlation,
  } as const;
}

describe('governed client action planner', () => {
  it('turns REQUEST_MATCH into an inert validated Core request', () => {
    const proposal = createGovernedClientActionProposalV1({
      nextBestAction: nba('REQUEST_MATCH'),
      draft: { kind: 'CLIENT_MATCH_REQUEST', payload: matchPayload() },
    });
    expect(proposal.actionKind).toBe('CLIENT_MATCH_REQUEST');
    expect(proposal.requiresCoreDecision).toBe(true);
    expect(proposal.businessEffect).toBe(false);
    expect(proposal.executionAuthorized).toBe(false);
    expect(JSON.stringify(proposal).toLowerCase()).not.toContain('"authorized":true');
  });

  it('supports reassignment only for the matching NBA action', () => {
    const proposal = createGovernedClientActionProposalV1({
      nextBestAction: nba('REQUEST_REASSIGNMENT'),
      draft: { kind: 'CLIENT_REASSIGNMENT_REQUEST', payload: reassignmentPayload() },
    });
    expect(proposal.actionKind).toBe('CLIENT_REASSIGNMENT_REQUEST');
    expect(proposal.payload).not.toHaveProperty('vendor');
    expect(proposal.payload).not.toHaveProperty('vendors');
  });

  it('supports extra-vendor review without carrying vendor choices', () => {
    const proposal = createGovernedClientActionProposalV1({
      nextBestAction: nba('REQUEST_EXTRA_VENDOR_REVIEW'),
      draft: { kind: 'CLIENT_EXTRA_VENDOR_REVIEW_REQUEST', payload: extraVendorPayload() },
    });
    const serialized = JSON.stringify(proposal).toLowerCase();
    expect(serialized).not.toContain('vendorid');
    expect(serialized).not.toContain('vendorcount');
    expect(serialized).not.toContain('requestedcount');
    expect(proposal.executionAuthorized).toBe(false);
  });

  it('refuses an NBA/payload mismatch', () => {
    expect(() =>
      createGovernedClientActionProposalV1({
        nextBestAction: nba('REQUEST_MATCH'),
        draft: {
          kind: 'CLIENT_EXTRA_VENDOR_REVIEW_REQUEST',
          payload: extraVendorPayload(),
        },
      }),
    ).toThrow('governed-client-action-next-best-action-mismatch');
  });

  it.each([
    'ANSWER_CLIENT',
    'ASK_MISSING_FIELD',
    'SURFACE_ADDITIONAL_SERVICE',
    'ASK_SATISFACTION',
  ] as const)('does not let conversational NBA %s cross the Core action boundary', (action) => {
    const nonAuthoritative = {
      ...nba(action),
      requiresCoreDecision: false,
    };
    expect(() =>
      createGovernedClientActionProposalV1({
        nextBestAction: nonAuthoritative,
        draft: { kind: 'CLIENT_MATCH_REQUEST', payload: matchPayload() },
      }),
    ).toThrow('governed-client-action-authority-invalid');
  });

  it('refuses a malformed Core request instead of forwarding it', () => {
    const malformed = {
      ...matchPayload(),
      clientConfirmation: undefined,
    };
    expect(() =>
      createGovernedClientActionProposalV1({
        nextBestAction: nba('REQUEST_MATCH'),
        draft: { kind: 'CLIENT_MATCH_REQUEST', payload: malformed },
      }),
    ).toThrow();
  });
});
