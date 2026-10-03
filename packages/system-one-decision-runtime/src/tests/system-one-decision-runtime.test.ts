import { describe, expect, it } from 'vitest';

import { SYSTEM_ONE_ADVISORY_AUTHORITY, createSystemOneDecisionRequest } from '../index.js';

describe('system-one decision runtime', () => {
  it('builds one frozen agent-neutral request for current or future agents', () => {
    const request = createSystemOneDecisionRequest({
      runId: 'run.jev.1',
      actorRef: 'agent.future-concierge',
      purposeRef: 'decision.turn-routing.v1',
      dataClass: 'MINIMIZED_BUSINESS',
      mode: 'SHADOW',
      state: { message: 'Need help choosing a product category.', signals: ['new-user'] },
      questions: {
        route: {
          type: 'choice',
          instructions: 'Choose the best governed specialist.',
          criteria: {
            RIYA: 'Existing client sales/support',
            ANISHA: 'Vendor journey',
            AAROHI: 'Prospect acquisition',
          },
        },
        urgency: {
          type: 'score',
          instructions: 'Rate urgency.',
          criteria: ['can wait', 'soon', 'now'],
        },
        needs_review: {
          type: 'noul',
          instructions: 'Does this need human review?',
        },
      },
      timeoutMs: 2_000,
    });

    expect(request.protocol).toBe('qfj.system-one-decision.v1');
    expect(request.actorRef).toBe('agent.future-concierge');
    expect(request.questions['route']?.type).toBe('choice');
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.questions)).toBe(true);
    expect(Object.isFrozen(request.state)).toBe(true);
  });

  it('keeps every decision result structurally non-authoritative', () => {
    expect(SYSTEM_ONE_ADVISORY_AUTHORITY).toEqual({
      businessAuthority: false,
      approvalGranted: false,
      executionAuthorized: false,
    });
    expect(Object.isFrozen(SYSTEM_ONE_ADVISORY_AUTHORITY)).toBe(true);
  });

  it('accepts the official Jev choice cardinality ceiling', () => {
    const criteria = Object.fromEntries(
      Array.from({ length: 255 }, (_, i) => [`choice-${String(i)}`, `option ${String(i)}`]),
    );
    expect(() =>
      createSystemOneDecisionRequest({
        runId: 'run.cardinality.255',
        actorRef: 'agent.riya',
        purposeRef: 'decision.rank.v1',
        dataClass: 'PUBLIC',
        mode: 'SHADOW',
        state: 'state',
        questions: { pick: { type: 'choice', criteria } },
        timeoutMs: 1_000,
      }),
    ).not.toThrow();
  });

  it('fails closed on oversized choice sets, cyclic state and invalid actor refs', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`choice-${String(i)}`, 'x']),
    );
    expect(() =>
      createSystemOneDecisionRequest({
        runId: 'run.cardinality.256',
        actorRef: 'agent.riya',
        purposeRef: 'decision.rank.v1',
        dataClass: 'PUBLIC',
        mode: 'SHADOW',
        state: 'state',
        questions: { pick: { type: 'choice', criteria: tooMany } },
        timeoutMs: 1_000,
      }),
    ).toThrow('system-one-decision-request-invalid');

    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() =>
      createSystemOneDecisionRequest({
        runId: 'run.cycle',
        actorRef: 'agent.riya',
        purposeRef: 'decision.test.v1',
        dataClass: 'PUBLIC',
        mode: 'SHADOW',
        state: cyclic as never,
        questions: { yes: { type: 'noul' } },
        timeoutMs: 1_000,
      }),
    ).toThrow('system-one-decision-request-invalid');

    expect(() =>
      createSystemOneDecisionRequest({
        runId: 'run.bad-actor',
        actorRef: 'agent has spaces',
        purposeRef: 'decision.test.v1',
        dataClass: 'PUBLIC',
        mode: 'SHADOW',
        state: 'x',
        questions: { yes: { type: 'noul' } },
        timeoutMs: 1_000,
      }),
    ).toThrow('system-one-decision-request-invalid');
  });
});
