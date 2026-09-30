import { describe, expect, it } from 'vitest';

import {
  safeParseClientMatchDecision,
  safeParseClientMatchRequest,
  safeParseExtraVendorReviewDecision,
  safeParseExtraVendorReviewRequest,
} from '../index.js';

const U = {
  matchRequest: '00000000-0000-4000-8000-000000000001',
  matchDecision: '00000000-0000-4000-8000-000000000002',
  confirmation: '00000000-0000-4000-8000-000000000003',
  evidenceEvent: '00000000-0000-4000-8000-000000000004',
  correlation: '00000000-0000-4000-8000-000000000005',
  batch: '00000000-0000-4000-8000-000000000006',
  extraRequest: '00000000-0000-4000-8000-000000000007',
  extraDecision: '00000000-0000-4000-8000-000000000008',
} as const;

const client = { entityType: 'client', entityId: 'client.42' } as const;
const lead = { entityType: 'lead', entityId: 'lead.9' } as const;
const category = { entityType: 'category', entityId: 'interior-design' } as const;
const confirmation = {
  confirmationId: U.confirmation,
  contractVersion: 1,
  confirmedBy: client,
  confirmedAt: '2026-09-30T05:00:00.000Z',
  confirmationChannelCode: 'whatsapp',
  evidenceEventId: U.evidenceEvent,
  statementCode: 'client-requested-vendor-match',
} as const;
const evidence = [
  {
    evidenceType: 'canonical-event',
    eventId: U.evidenceEvent,
    eventType: 'qf.client.match-requested',
    description: 'Client explicitly requested vendor matching.',
  },
] as const;
const policy = { policyId: 'client-matching', policyVersion: 1 } as const;

function matchRequest() {
  return {
    matchRequestId: U.matchRequest,
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
    causationEventId: U.evidenceEvent,
  } as const;
}

describe('ClientMatchRequestV1', () => {
  it('parses a bounded Riya request with no vendor selection or requested count', () => {
    const result = safeParseClientMatchRequest(matchRequest());
    expect(result.success).toBe(true);
    const serialized = JSON.stringify(matchRequest()).toLowerCase();
    expect(serialized).not.toContain('vendorid');
    expect(serialized).not.toContain('vendorcount');
    expect(serialized).not.toContain('batchsize');
  });

  it('rejects a confirmation from somebody other than the client', () => {
    const request = {
      ...matchRequest(),
      clientConfirmation: {
        ...confirmation,
        confirmedBy: { entityType: 'client', entityId: 'client.other' },
      },
    };
    expect(safeParseClientMatchRequest(request).success).toBe(false);
  });

  it('rejects a request justified by a future confirmation', () => {
    const request = {
      ...matchRequest(),
      clientConfirmation: {
        ...confirmation,
        confirmedAt: '2026-09-30T05:02:00.000Z',
      },
    };
    expect(safeParseClientMatchRequest(request).success).toBe(false);
  });
});

describe('ClientMatchDecisionV1', () => {
  const base = {
    matchDecisionId: U.matchDecision,
    contractVersion: 1,
    matchRequestId: U.matchRequest,
    issuer: 'quickfurno-core',
    decidedBy: { actorType: 'policy', policyId: 'client-matching', policyVersion: 1 },
    decidedAt: '2026-09-30T05:02:00.000Z',
    reasonCode: 'qualification-result',
    policy,
    correlationId: U.correlation,
  } as const;

  it('requires exact missing fields when Core says not ready', () => {
    expect(
      safeParseClientMatchDecision({
        ...base,
        outcome: 'not_ready',
        missingFieldCodes: ['location', 'budget'],
      }).success,
    ).toBe(true);
    expect(
      safeParseClientMatchDecision({
        ...base,
        outcome: 'not_ready',
      }).success,
    ).toBe(false);
  });

  it('requires a Core batch only when matching is authorized', () => {
    expect(
      safeParseClientMatchDecision({
        ...base,
        outcome: 'authorized',
        authorizedBatchId: U.batch,
      }).success,
    ).toBe(true);
    expect(
      safeParseClientMatchDecision({
        ...base,
        outcome: 'authorized',
      }).success,
    ).toBe(false);
    expect(
      safeParseClientMatchDecision({
        ...base,
        outcome: 'rejected',
        authorizedBatchId: U.batch,
      }).success,
    ).toBe(false);
  });
});
function extraVendorRequest() {
  return {
    extraVendorReviewRequestId: U.extraRequest,
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
    summary: 'Client requested another vendor option after the current batch.',
    reasonCode: 'client-requested-more-comparison',
    policy,
    createdAt: '2026-09-30T05:01:00.000Z',
    expiresAt: '2026-09-30T05:11:00.000Z',
    correlationId: U.correlation,
  } as const;
}

describe('ExtraVendorReviewRequestV1', () => {
  it('parses only as a review request and contains no vendor choice', () => {
    expect(safeParseExtraVendorReviewRequest(extraVendorRequest()).success).toBe(true);
    const serialized = JSON.stringify(extraVendorRequest()).toLowerCase();
    expect(serialized).not.toContain('vendorid');
    expect(serialized).not.toContain('vendorcount');
    expect(serialized).not.toContain('requestedcount');
  });

  it('still requires the client to have explicitly asked', () => {
    const request = {
      ...extraVendorRequest(),
      clientConfirmation: {
        ...extraVendorRequest().clientConfirmation,
        confirmedBy: { entityType: 'client', entityId: 'client.other' },
      },
    };
    expect(safeParseExtraVendorReviewRequest(request).success).toBe(false);
  });
});

describe('ExtraVendorReviewDecisionV1', () => {
  const base = {
    extraVendorReviewDecisionId: U.extraDecision,
    contractVersion: 1,
    extraVendorReviewRequestId: U.extraRequest,
    issuer: 'quickfurno-core',
    decidedBy: { actorType: 'policy', policyId: 'vendor-exposure', policyVersion: 1 },
    decidedAt: '2026-09-30T05:02:00.000Z',
    reasonCode: 'vendor-exposure-review',
    policy,
    correlationId: U.correlation,
  } as const;

  it('requires a batch only for an authorized additional batch', () => {
    expect(
      safeParseExtraVendorReviewDecision({
        ...base,
        outcome: 'authorized_additional_batch',
        authorizedBatchId: U.batch,
      }).success,
    ).toBe(true);
    expect(
      safeParseExtraVendorReviewDecision({
        ...base,
        outcome: 'authorized_additional_batch',
      }).success,
    ).toBe(false);
    expect(
      safeParseExtraVendorReviewDecision({
        ...base,
        outcome: 'wait_for_vendor_response',
        authorizedBatchId: U.batch,
      }).success,
    ).toBe(false);
  });

  it('supports Core refusing or deferring without creating vendor exposure', () => {
    for (const outcome of [
      'rejected',
      'wait_for_vendor_response',
      'human_review_required',
    ] as const) {
      expect(safeParseExtraVendorReviewDecision({ ...base, outcome }).success).toBe(true);
    }
  });
});
