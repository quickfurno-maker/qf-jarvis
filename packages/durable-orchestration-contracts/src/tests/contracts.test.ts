import { describe, expect, it } from 'vitest';
import {
  DURABLE_ORCHESTRATION_PROTOCOL,
  durableJourneyStartV1Schema,
  durableJourneyWorkflowId,
} from '../index.js';

describe('durable orchestration contracts', () => {
  it('keeps workflow history input reference-only', () => {
    const input = durableJourneyStartV1Schema.parse({
      protocol: DURABLE_ORCHESTRATION_PROTOCOL,
      journeyId: 'lead.8421',
      kind: 'CLIENT_SUCCESS',
      actor: 'RIYA',
      subjectRef: 'client.44',
      conversationRef: 'conversation.19',
      startedFromEventRef: 'event.99',
      policyRevision: 'policy.7',
    });
    expect(durableJourneyWorkflowId(input)).toBe('qfj:client_success:lead.8421');
    const rendered = JSON.stringify(input);
    for (const forbidden of [
      'phone',
      'email',
      'messageBody',
      'modelOutput',
      'credential',
      'consent',
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it('refuses cross-agent journey ownership', () => {
    expect(() =>
      durableJourneyStartV1Schema.parse({
        protocol: DURABLE_ORCHESTRATION_PROTOCOL,
        journeyId: 'lead.1',
        kind: 'CLIENT_SUCCESS',
        actor: 'ANISHA',
        subjectRef: 'client.1',
        startedFromEventRef: 'event.1',
        policyRevision: 'policy.1',
      }),
    ).toThrow();
  });
});
