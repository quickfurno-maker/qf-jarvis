import { describe, expect, it } from 'vitest';

import { runAosLeadDeliveryShadowCycle } from '../index.js';

const at = '2026-10-01T10:00:00.000Z';

function projection(minutesPending: number) {
  const assigned = new Date(Date.parse(at) - minutesPending * 60_000).toISOString();
  return {
    leadRef: 'lead:opaque-delivery',
    requirementRef: 'requirement:opaque-delivery',
    evidenceRef: 'core:lead-delivery:opaque',
    observedAt: at,
    vendorAssignments: [
      {
        assignmentRef: 'assignment:one',
        vendorRef: 'vendor:one',
        assignedAt: '2026-10-01T09:00:00.000Z',
        firstContactConfirmed: true,
        firstContactConfirmedAt: '2026-10-01T09:05:00.000Z',
      },
      {
        assignmentRef: 'assignment:two',
        vendorRef: 'vendor:two',
        assignedAt: '2026-10-01T09:00:00.000Z',
        firstContactConfirmed: true,
        firstContactConfirmedAt: '2026-10-01T09:06:00.000Z',
      },
      {
        assignmentRef: 'assignment:three',
        vendorRef: 'vendor:three',
        assignedAt: assigned,
        firstContactConfirmed: false,
      },
    ],
  };
}

describe('AOS vendor-specific lead-delivery projection', () => {
  it('targets the exact non-responsive vendor for Anisha after the governed SLA', async () => {
    const result = await runAosLeadDeliveryShadowCycle({
      cycleId: 'aos.lead-delivery.vendor-reminder',
      generatedAt: at,
      projections: [projection(25)],
    });

    const vendorCase = result.shadow.cases.find((one) => one.case.subjectRef === 'vendor:three');
    expect(vendorCase).toMatchObject({
      reason: 'DETERMINISTIC_RECOMMENDATION',
      recommendation: {
        action: 'REQUEST_VENDOR_REMINDER',
        requiresOwnerReview: false,
        executionAuthorized: false,
      },
    });
    expect(vendorCase?.case.caseKey).toContain('assignment:three');
  });

  it('creates a separate lead-level replacement review after 30 minutes', async () => {
    const result = await runAosLeadDeliveryShadowCycle({
      cycleId: 'aos.lead-delivery.replacement',
      generatedAt: at,
      projections: [projection(35)],
    });

    const replacement = result.shadow.cases.find(
      (one) => one.case.subjectRef === 'lead:opaque-delivery',
    );
    expect(replacement).toMatchObject({
      recommendation: {
        action: 'REQUEST_REPLACEMENT_BATCH',
        requiresCoreDecision: true,
        requiresOwnerReview: true,
        executionAuthorized: false,
      },
    });
  });

  it('never recommends a 4th vendor from the vendor-specific reminder case', async () => {
    const result = await runAosLeadDeliveryShadowCycle({
      cycleId: 'aos.lead-delivery.separation',
      generatedAt: at,
      projections: [projection(35)],
    });

    const vendorCase = result.shadow.cases.find((one) => one.case.subjectRef === 'vendor:three');
    expect(vendorCase?.recommendation?.action).toBe('REQUEST_VENDOR_REMINDER');
    expect(vendorCase?.recommendation?.action).not.toBe('REQUEST_REPLACEMENT_BATCH');
  });

  it('produces no contact-gap case when all three contacts are confirmed', async () => {
    const complete = projection(25);
    const assignments = complete.vendorAssignments.map((one) =>
      one.vendorRef === 'vendor:three'
        ? {
            ...one,
            firstContactConfirmed: true as const,
            firstContactConfirmedAt: '2026-10-01T09:40:00.000Z',
          }
        : one,
    );
    const result = await runAosLeadDeliveryShadowCycle({
      cycleId: 'aos.lead-delivery.complete',
      generatedAt: at,
      projections: [{ ...complete, vendorAssignments: assignments }],
    });
    expect(result.detections).toBe(0);
    expect(result.shadow.recommendations).toBe(0);
  });
});
