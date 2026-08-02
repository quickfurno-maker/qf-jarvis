/**
 * QFJ-P08 — correlating a decision QuickFurno Core has already issued (ADR-0080).
 *
 * This method obtains nothing. The decision arrived from a boundary outside this package, and all
 * three inputs — source, request and decision — are untrusted structural values. A request in
 * particular may have been serialized to a queue and read back by something that is not this
 * runtime.
 *
 * The three properties under test:
 *
 * 1. **Anti-substitution.** The fingerprint is recomputed from the content supplied NOW. Same
 *    recommendation id, same action id, valid Core `approved` — and it still fails if the action
 *    content changed. That is the whole reason the digest exists.
 * 2. **Partial approval is honoured, not reconciled.** An overall `approved` outcome with the
 *    requested action `rejected` is a valid, common Core answer, and the per-action verdict is what
 *    describes the action.
 * 3. **The result confers nothing.** It is an observation about a record, with no field in which a
 *    permission could be expressed.
 */
import { describe, expect, it } from 'vitest';

import type { ApprovalRequestV1 } from '@qf-jarvis/contracts';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';

import { ApprovalRuntimeError, createApprovalRuntime } from '../index.js';
import {
  CORRELATION_ID,
  DECIDED_AT,
  OTHER_ACTION_ID,
  POLICY,
  REC_EXPIRES_AT,
  REQ_CREATED_AT,
  REQ_EXPIRES_AT,
  coreDecision,
  fixedApprovalIdentity,
  recommendationSource,
  twoActionSource,
} from './fixtures.js';

const subject = createApprovalRuntime({ identity: fixedApprovalIdentity() });

/** A source, its first action's request, and a decision approving that action. */
function scenario(source: RecommendationRuntimeResult = recommendationSource()): {
  readonly source: RecommendationRuntimeResult;
  readonly request: ApprovalRequestV1;
  readonly actionId: string;
} {
  const action = source.recommendation.proposedActions[0];
  if (action === undefined) {
    throw new Error('unreachable');
  }
  const request = subject.createRequest({
    source,
    proposedActionId: action.actionId,
    createdAt: REQ_CREATED_AT,
    expiresAt: REQ_EXPIRES_AT,
    policy: POLICY,
  });
  return { source, request, actionId: action.actionId };
}

function decisionFor(
  source: RecommendationRuntimeResult,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return coreDecision({
    recommendationId: source.recommendation.recommendationId,
    correlationId: source.recommendation.correlationId,
    ...over,
  });
}

function expectCode(fn: () => unknown, code: string, label = code): void {
  try {
    fn();
  } catch (error) {
    expect(error, label).toBeInstanceOf(ApprovalRuntimeError);
    expect((error as ApprovalRuntimeError).code, label).toBe(code);
    return;
  }
  throw new Error(`Expected ${label} to throw ${code}`);
}

// ---------------------------------------------------------------------------
// Correlation succeeds.
// ---------------------------------------------------------------------------

describe('a valid Core decision correlates to its request', () => {
  it('correlates a single-action approval', () => {
    const { source, request, actionId } = scenario();
    const decision = decisionFor(source, {
      outcome: 'approved',
      actionDecisions: [{ actionId, decision: 'approved' }],
    });

    const result = subject.validateDecision({ source, request, decision });
    expect(result.approvalRequestId).toBe(request.approvalRequestId);
    expect(result.recommendationId).toBe(source.recommendation.recommendationId);
    expect(result.proposedActionId).toBe(actionId);
    expect(result.actionFingerprint).toBe(request.actionFingerprint);
    expect(result.decision.outcome).toBe('approved');
    expect(result.actionDecision).toEqual({ actionId, decision: 'approved' });
  });

  it('correlates a single-action rejection', () => {
    const { source, request, actionId } = scenario();
    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'rejected',
        actionDecisions: [{ actionId, decision: 'rejected' }],
      }),
    });
    expect(result.decision.outcome).toBe('rejected');
    expect(result.actionDecision.decision).toBe('rejected');
  });

  it('correlates changes-requested as a FINAL observation, not a pending state', () => {
    // `changes-requested` is an authoritative Core answer. It is not pending, not an implicit
    // retry, and not an implicit new recommendation -- a future workflow may create one, but this
    // package does not, and it does not mutate the recommendation it was given.
    const { source, request, actionId } = scenario();
    const before = JSON.stringify(source.recommendation);
    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'changes-requested',
        actionDecisions: [{ actionId, decision: 'rejected' }],
      }),
    });
    expect(result.decision.outcome).toBe('changes-requested');
    expect(result.actionDecision.decision).toBe('rejected');
    expect(JSON.stringify(source.recommendation)).toBe(before);
  });

  it('accepts a human decider and a named, versioned policy decider', () => {
    const { source, request, actionId } = scenario();
    for (const decidedBy of [
      { actorType: 'human', actor: { entityType: 'operator', entityId: 'human.approver.1' } },
      { actorType: 'policy', policyId: 'auto.approval', policyVersion: 4 },
    ]) {
      const result = subject.validateDecision({
        source,
        request,
        decision: decisionFor(source, {
          decidedBy,
          outcome: 'approved',
          actionDecisions: [{ actionId, decision: 'approved' }],
        }),
      });
      expect(result.decision.decidedBy).toEqual(decidedBy);
    }
  });

  it('preserves validUntil when Core time-boxes the authorization', () => {
    const { source, request, actionId } = scenario();
    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'approved',
        actionDecisions: [{ actionId, decision: 'approved' }],
        validUntil: '2026-08-02T18:00:00Z',
      }),
    });
    expect(result.decision.validUntil).toBe('2026-08-02T18:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Partial approval.
// ---------------------------------------------------------------------------

describe('partial approval', () => {
  it('returns the REQUESTED action verdict, even when the overall outcome differs', () => {
    // The case that would be easy to get wrong: overall `approved`, but the action this request
    // asked about was rejected. Converting the outcome into the action's verdict would tell a
    // caller that a rejected action was approved.
    const source = twoActionSource();
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const { request } = scenario(source);

    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'approved',
        actionDecisions: [
          { actionId: first.actionId, decision: 'rejected' },
          { actionId: second.actionId, decision: 'approved' },
        ],
      }),
    });

    expect(result.proposedActionId).toBe(first.actionId);
    expect(result.decision.outcome).toBe('approved');
    // The per-action verdict wins for the action.
    expect(result.actionDecision).toEqual({ actionId: first.actionId, decision: 'rejected' });
  });

  it('returns approved for the requested action when another is rejected', () => {
    const source = twoActionSource();
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const { request } = scenario(source);
    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'approved',
        actionDecisions: [
          { actionId: first.actionId, decision: 'approved' },
          { actionId: second.actionId, decision: 'rejected' },
        ],
      }),
    });
    expect(result.actionDecision).toEqual({ actionId: first.actionId, decision: 'approved' });
  });

  it('accepts a multi-action decision, so long as every action belongs to the recommendation', () => {
    // `ApprovalDecisionV1` is recommendation-level: Core may legitimately answer about several
    // actions at once, and this must NOT require the decision to cover only the requested one.
    const source = twoActionSource();
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const { request } = scenario(source);
    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'approved',
        actionDecisions: [
          { actionId: first.actionId, decision: 'approved' },
          { actionId: second.actionId, decision: 'approved' },
        ],
      }),
    });
    expect(result.decision.actionDecisions).toHaveLength(2);
    expect(result.actionDecision.actionId).toBe(first.actionId);
  });
});

// ---------------------------------------------------------------------------
// Anti-substitution.
// ---------------------------------------------------------------------------

describe('anti-substitution', () => {
  it('fails closed when the action content changed under a stable actionId', () => {
    // Everything a substitution would keep: same recommendationId, same actionId, a genuine Core
    // `approved`. Only the CONTENT moved -- so only the recomputed digest disagrees, and that is
    // exactly what must stop it.
    const { source, request, actionId } = scenario();
    const original = source.recommendation.proposedActions[0];
    if (original === undefined) {
      throw new Error('unreachable');
    }

    const mutated: RecommendationRuntimeResult = {
      recommendation: {
        ...source.recommendation,
        proposedActions: [{ ...original, parameters: { channel: 'sms', delayHours: 1 } }],
      },
      // The binding still carries the ORIGINAL digest, as a stored one would.
      actionBindings: source.actionBindings,
    };

    expect(mutated.recommendation.recommendationId).toBe(source.recommendation.recommendationId);
    expect(mutated.recommendation.proposedActions[0]?.actionId).toBe(actionId);

    expectCode(
      () =>
        subject.validateDecision({
          source: mutated,
          request,
          decision: decisionFor(source, {
            outcome: 'approved',
            actionDecisions: [{ actionId, decision: 'approved' }],
          }),
        }),
      'binding-mismatch',
    );
  });

  it('fails closed when the request carries a stale fingerprint', () => {
    const { source, request, actionId } = scenario();
    const stale: ApprovalRequestV1 = { ...request, actionFingerprint: 'a'.repeat(64) };
    expectCode(
      () =>
        subject.validateDecision({
          source,
          request: stale,
          decision: decisionFor(source, {
            outcome: 'approved',
            actionDecisions: [{ actionId, decision: 'approved' }],
          }),
        }),
      'decision-mismatch',
    );
  });
});

// ---------------------------------------------------------------------------
// A foreign request is untrusted, and never silently repaired.
// ---------------------------------------------------------------------------

describe('the request is re-proved against the source', () => {
  it('refuses a request that is not a valid ApprovalRequestV1', () => {
    const { source, actionId } = scenario();
    const decision = decisionFor(source, {
      outcome: 'approved',
      actionDecisions: [{ actionId, decision: 'approved' }],
    });
    for (const request of [undefined, null, {}, 'request', { approvalRequestId: 'x' }]) {
      expectCode(
        () => subject.validateDecision({ source, request, decision }),
        'request-invalid',
        JSON.stringify(request),
      );
    }
  });

  it('refuses a request whose governance disagrees with the recommendation', () => {
    // Each of these is a field a laundering attempt would have to alter, and none is repaired.
    const { source, request, actionId } = scenario();
    const decision = decisionFor(source, {
      outcome: 'approved',
      actionDecisions: [{ actionId, decision: 'approved' }],
    });
    for (const over of [
      { risk: 'low-risk-reversible' },
      { requestedAuthority: 'delegated-approver' },
      { requestingAgent: 'jarvis' },
      { requestingAgentVersion: 'anisha.v2' },
      { correlationId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb' },
      { summary: 'A different description of the same action.' },
      { recommendationId: 'aaaaaaaa-0000-4000-8000-000000000099' },
      { proposedActionId: OTHER_ACTION_ID },
      // A request that outlives its recommendation.
      { expiresAt: '2026-08-05T09:00:00Z' },
      { createdAt: '2026-08-01T09:00:00Z' },
    ]) {
      const tampered = { ...request, ...over } as ApprovalRequestV1;
      const code = 'proposedActionId' in over ? 'binding-mismatch' : 'decision-mismatch';
      expectCode(
        () => subject.validateDecision({ source, request: tampered, decision }),
        code,
        JSON.stringify(over),
      );
    }
  });

  it('refuses a source whose bindings do not agree with its recommendation', () => {
    const { source, request, actionId } = scenario();
    const decision = decisionFor(source, {
      outcome: 'approved',
      actionDecisions: [{ actionId, decision: 'approved' }],
    });
    expectCode(
      () =>
        subject.validateDecision({
          source: { recommendation: source.recommendation, actionBindings: [] },
          request,
          decision,
        }),
      'binding-mismatch',
    );
  });
});

// ---------------------------------------------------------------------------
// Core's contract does the structural refusing.
// ---------------------------------------------------------------------------

describe('the governed approval-decision contract refuses a malformed decision', () => {
  it('refuses anything Core could not have issued', () => {
    const { source, request, actionId } = scenario();
    const approved = [{ actionId, decision: 'approved' }];
    for (const over of [
      // Not issued by Core. The literal is what makes authority unmanufacturable.
      { issuer: 'qf-jarvis' },
      { issuer: 'n8n' },
      // An agent as the decider: the shape does not exist, at any confidence.
      { decidedBy: { actorType: 'agent', agentId: 'anisha' } },
      { decidedBy: { actorType: 'human' } },
      { decidedBy: { actorType: 'human', humanId: 'human.approver.1' } },
      { decidedBy: { actorType: 'policy', policyId: 'auto.approval' } },
      // Contradictions the contract forbids.
      { outcome: 'rejected', actionDecisions: approved },
      { outcome: 'changes-requested', actionDecisions: approved },
      { outcome: 'approved', actionDecisions: [{ actionId, decision: 'rejected' }] },
      { outcome: 'approved', actionDecisions: [] },
      {
        outcome: 'approved',
        actionDecisions: [
          { actionId, decision: 'approved' },
          { actionId, decision: 'rejected' },
        ],
      },
      { outcome: 'pending', actionDecisions: approved },
      { validUntil: DECIDED_AT, outcome: 'approved', actionDecisions: approved },
      { contractVersion: 2 },
      { reasonCode: '' },
      { extra: true },
    ]) {
      expectCode(
        () => subject.validateDecision({ source, request, decision: decisionFor(source, over) }),
        'decision-invalid',
        JSON.stringify(over),
      );
    }
  });

  it('refuses a non-object decision', () => {
    const { source, request } = scenario();
    for (const decision of [undefined, null, 'approved', 7]) {
      expectCode(
        () => subject.validateDecision({ source, request, decision }),
        'decision-invalid',
        String(decision),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Correlation rules.
// ---------------------------------------------------------------------------

describe('correlation rules', () => {
  it('refuses a decision about a different recommendation or thread', () => {
    const { source, request, actionId } = scenario();
    const approved = [{ actionId, decision: 'approved' }];
    for (const over of [
      { recommendationId: 'aaaaaaaa-0000-4000-8000-000000000099', actionDecisions: approved },
      { correlationId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb', actionDecisions: approved },
    ]) {
      expectCode(
        () => subject.validateDecision({ source, request, decision: decisionFor(source, over) }),
        'decision-mismatch',
        JSON.stringify(over),
      );
    }
  });

  it('refuses a decision recorded outside the window that was open when it was asked', () => {
    // Expiry is not approval, and a late yes is not a yes: a decision recorded after the request or
    // the recommendation died is answering a question that had already gone.
    const { source, request, actionId } = scenario();
    const approved = [{ actionId, decision: 'approved' }];
    for (const decidedAt of [
      '2026-08-02T09:30:00Z', // before the request was created
      REQ_EXPIRES_AT, // exactly at request expiry
      '2026-08-03T20:00:00Z', // after request expiry
    ]) {
      expectCode(
        () =>
          subject.validateDecision({
            source,
            request,
            decision: decisionFor(source, { decidedAt, actionDecisions: approved }),
          }),
        'decision-mismatch',
        decidedAt,
      );
    }
  });

  it('refuses a decision recorded at or after the recommendation expired', () => {
    // A request may legitimately run to the recommendation's own expiry; a decision may not land on
    // or after it.
    const source = recommendationSource();
    const action = source.recommendation.proposedActions[0];
    if (action === undefined) {
      throw new Error('unreachable');
    }
    const request = subject.createRequest({
      source,
      proposedActionId: action.actionId,
      createdAt: REQ_CREATED_AT,
      expiresAt: REC_EXPIRES_AT,
      policy: POLICY,
    });
    expectCode(
      () =>
        subject.validateDecision({
          source,
          request,
          decision: decisionFor(source, {
            decidedAt: REC_EXPIRES_AT,
            actionDecisions: [{ actionId: action.actionId, decision: 'approved' }],
          }),
        }),
      'decision-mismatch',
    );
  });

  it('accepts a decision recorded exactly at the request creation instant', () => {
    const { source, request, actionId } = scenario();
    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        decidedAt: REQ_CREATED_AT,
        actionDecisions: [{ actionId, decision: 'approved' }],
      }),
    });
    expect(result.decision.decidedAt).toBe(REQ_CREATED_AT);
  });

  it('refuses a decision that says nothing about the requested action', () => {
    const source = twoActionSource();
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const { request } = scenario(source);
    expectCode(
      () =>
        subject.validateDecision({
          source,
          request,
          decision: decisionFor(source, {
            outcome: 'approved',
            actionDecisions: [{ actionId: second.actionId, decision: 'approved' }],
          }),
        }),
      'decision-mismatch',
    );
  });

  it('refuses a decision containing an action that is not in the recommendation', () => {
    // Core and Jarvis disagreeing about what was asked is never safe to average out.
    const { source, request, actionId } = scenario();
    expectCode(
      () =>
        subject.validateDecision({
          source,
          request,
          decision: decisionFor(source, {
            outcome: 'approved',
            actionDecisions: [
              { actionId, decision: 'approved' },
              { actionId: OTHER_ACTION_ID, decision: 'approved' },
            ],
          }),
        }),
      'decision-mismatch',
    );
  });

  it('refuses a non-object input', () => {
    const cases: readonly [string, unknown][] = [
      ['undefined', undefined],
      ['null', null],
      ['string', 'input'],
      ['array', []],
    ];
    for (const [label, bad] of cases) {
      expectCode(() => subject.validateDecision(bad), 'invalid-input', label);
    }
  });
});

// ---------------------------------------------------------------------------
// The result is an observation, and it is inert.
// ---------------------------------------------------------------------------

describe('the correlation result confers nothing', () => {
  it('carries no authorization, execution or consent field', () => {
    // An approval is not a communication authorization. Even a founder-approved action may not
    // reach a recipient who has opted out, and CommunicationAuthorizationV1 is a separate contract.
    const { source, request, actionId } = scenario();
    const result = subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'approved',
        actionDecisions: [{ actionId, decision: 'approved' }],
      }),
    });
    expect(Object.keys(result).sort()).toEqual([
      'actionDecision',
      'actionFingerprint',
      'approvalRequestId',
      'decision',
      'proposedActionId',
      'recommendationId',
    ]);
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of [
      'isAuthorized',
      'canExecute',
      'canSend',
      'communicationAuthorized',
      'communicationAllowed',
      'consented',
      'consentValid',
      'sendAllowed',
      'executable',
      'idempotencyKey',
      'recipient',
      'executor',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('is deeply frozen and shares no reference with the caller', () => {
    const { source, request, actionId } = scenario();
    const decision = decisionFor(source, {
      outcome: 'approved',
      actionDecisions: [{ actionId, decision: 'approved' }],
    });
    const result = subject.validateDecision({ source, request, decision });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.decision)).toBe(true);
    expect(Object.isFrozen(result.decision.actionDecisions)).toBe(true);
    expect(Object.isFrozen(result.actionDecision)).toBe(true);

    // Mutating the caller's decision afterwards must not alter what was returned.
    const entries = decision['actionDecisions'] as { decision: string }[];
    const firstEntry = entries[0];
    expect(firstEntry).toBeDefined();
    if (firstEntry === undefined) {
      throw new Error('unreachable');
    }
    firstEntry.decision = 'rejected';
    decision['outcome'] = 'rejected';
    expect(result.actionDecision.decision).toBe('approved');
    expect(result.decision.outcome).toBe('approved');
  });

  it('does not mutate the caller request or source', () => {
    const { source, request, actionId } = scenario();
    const requestBefore = JSON.stringify(request);
    const sourceBefore = JSON.stringify(source);
    subject.validateDecision({
      source,
      request,
      decision: decisionFor(source, {
        outcome: 'approved',
        actionDecisions: [{ actionId, decision: 'approved' }],
      }),
    });
    expect(JSON.stringify(request)).toBe(requestBefore);
    expect(JSON.stringify(source)).toBe(sourceBefore);
  });

  it('leaks no content in any refusal', () => {
    const { source, request } = scenario();
    const caught = ((): Error => {
      try {
        subject.validateDecision({
          source,
          request,
          decision: decisionFor(source, {
            outcome: 'approved',
            actionDecisions: [{ actionId: OTHER_ACTION_ID, decision: 'approved' }],
          }),
        });
      } catch (error) {
        return error as Error;
      }
      throw new Error('unreachable');
    })();

    const serialized = `${caught.message} ${String(caught.stack)}`;
    for (const secret of [
      OTHER_ACTION_ID,
      CORRELATION_ID,
      source.recommendation.recommendationId,
      request.actionFingerprint,
      'Schedule a follow-up',
      'approval.policy',
      'human.approver.1',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });
});
