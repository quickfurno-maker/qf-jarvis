import { describe, expect, it } from 'vitest';
import { parseQuickFurnoOperatorObservation, parseQuickFurnoOperatorRequest } from './index.js';

describe('QuickFurno operator observation contract', () => {
  it('accepts a bounded content-free operational snapshot', () => {
    const parsed = parseQuickFurnoOperatorObservation({
      protocol: 'qfj.quickfurno-operator-observation.v1',
      emittedAt: '2026-09-24T12:00:00.000Z',
      approvalQueue: [],
      approvalBreakdown: [{ id: 'proposable', label: 'Awaiting operator', value: 2 }],
      conversationControl: [],
      conversationActivity: [
        { label: '11:00', value: 4 },
        { label: '12:00', value: 6 },
      ],
      agentWorkload: [{ id: 'riya', label: 'Riya', value: 5 }],
      businessAnalytics: [{ id: 'vendors-active', label: 'Active vendors', value: 12 }],
      coreAutomationExecution: [{ id: 'jobs-succeeded', label: 'Succeeded', value: 31 }],
    });
    expect(parsed.businessAnalytics[0]?.value).toBe(12);
  });

  it('parses the signed-request body independently of transport auth', () => {
    const parsed = parseQuickFurnoOperatorRequest({
      protocol: 'qfj.quickfurno-operator-snapshot.request.v1',
      requestId: 'a55734fb-32e4-4b41-804c-1c35dce8f9e9',
      issuedAt: '2026-09-24T12:00:00.000Z',
    });
    expect(parsed.requestId).toMatch(/-/);
  });
});
