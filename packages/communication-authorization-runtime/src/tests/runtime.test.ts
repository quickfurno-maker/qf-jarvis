/**
 * QFJ-P08 — the communication authorization correlation runtime (ADR-0083).
 *
 * The property everything here serves:
 *
 *   **Founder approval does not override an opt-out.**
 *
 * A human can approve a message to a client who has withdrawn consent. Core refuses it. That refusal
 * is an ordinary, successful, authoritative observation — not an error, not a retry, not something to
 * be reinterpreted — and no field of the result can be read as permission to send anyway.
 *
 * The rest follows from it: an `authorized` outcome needs a re-proved, per-action-APPROVED human
 * decision; Core's open refusal taxonomy is never closed; and nothing here ever becomes a permission
 * that travels forward in time.
 */
import { COMMUNICATION_REFUSAL_REASONS } from '@qf-jarvis/contracts';
import { describe, expect, it } from 'vitest';

import {
  COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES,
  CommunicationAuthorizationRuntimeError,
  createCommunicationAuthorizationRuntime,
} from '../index.js';
import {
  COMMUNICATION_ID,
  COMMUNICATION_REQUEST_ID,
  COMM_CREATED_AT,
  COMM_EXPIRES_AT,
  CORRELATION_ID,
  DECIDED_AT,
  OTHER_CORRELATION_ID,
  approvalEvidence,
  authorized,
  communicationRequest,
  multiActionApprovedEvidence,
  partiallyApprovedEvidence,
  rejected,
} from './fixtures.js';

const runtime = createCommunicationAuthorizationRuntime();

function expectCode(call: () => unknown, code: string, label = code): void {
  expect(call, label).toThrow(expect.objectContaining({ code }));
}

describe('public API', () => {
  it('exports exactly three root runtime symbols and no default', async () => {
    const barrel: Record<string, unknown> = await import('../index.js');
    expect(Object.keys(barrel).sort()).toEqual([
      'COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES',
      'CommunicationAuthorizationRuntimeError',
      'createCommunicationAuthorizationRuntime',
    ]);
    expect(barrel['default']).toBeUndefined();
  });

  it('exposes exactly ONE method, and nothing that authorizes, sends or consents', () => {
    expect(Object.keys(runtime)).toEqual(['validate']);
    expect(Object.isFrozen(runtime)).toBe(true);
    const surface = runtime as unknown as Record<string, unknown>;
    for (const forbidden of [
      'authorize',
      'approve',
      'send',
      'execute',
      'dispatch',
      'deliver',
      'consent',
      'optIn',
      'optOut',
      'grant',
      'suppress',
      'stop',
      'checkEligibility',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('exposes exactly seven error codes with fixed, content-free messages', () => {
    expect([...COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES].sort()).toEqual([
      'approval-invalid',
      'approval-not-approved',
      'approval-required',
      'authorization-invalid',
      'binding-mismatch',
      'invalid-input',
      'request-invalid',
    ]);
    expect(Object.isFrozen(COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES)).toBe(true);
    for (const code of COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES) {
      const error = new CommunicationAuthorizationRuntimeError(code);
      expect(error.name).toBe('CommunicationAuthorizationRuntimeError');
      expect(error.code).toBe(code);
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });

  it('refuses input that is not a validation request at all', () => {
    for (const input of [undefined, null, 'authorize it', 42, []]) {
      expectCode(() => runtime.validate(input as never), 'invalid-input', String(input));
    }
  });
});

describe('an AUTHORIZED communication', () => {
  it('is observed when Core said yes and a human approved this exact action', () => {
    const approval = approvalEvidence('a1a1a1a1');
    const request = communicationRequest();
    const authorization = authorized(approval.decision.decisionId);

    const observation = runtime.validate({ request, authorization, approval } as never);

    expect(observation.authorization.outcome).toBe('authorized');
    expect(observation.request.communicationRequestId).toBe(COMMUNICATION_REQUEST_ID);
    expect(observation.approvalCorrelation?.actionDecision.decision).toBe('approved');
    expect(observation.approvalCorrelation?.decision.decisionId).toBe(approval.decision.decisionId);
    // A refusal classification on an authorization would be a category error.
    expect(observation.knownRefusalReason).toBeUndefined();
  });

  it('accepts a channel Core CHANGED from the one Jarvis proposed', () => {
    // The contract exists to let Core decide eligibility per channel. Requiring the authorized
    // channel to equal the proposed one would make Jarvis second-guess the authority.
    const approval = approvalEvidence('a2a2a2a2');
    const observation = runtime.validate({
      request: communicationRequest({ proposedChannel: 'whatsapp' }),
      authorization: authorized(approval.decision.decisionId, { authorizedChannel: 'sms' }),
      approval,
    } as never);

    expect(observation.request.proposedChannel).toBe('whatsapp');
    expect(observation.authorization.authorizedChannel).toBe('sms');
  });

  it('refuses an authorization with NO approval evidence at all', () => {
    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest(),
          authorization: authorized('eeeeeeee-0000-4000-8000-000000009999'),
        } as never),
      'approval-required',
    );
  });

  it('refuses malformed approval evidence', () => {
    const approval = approvalEvidence('a3a3a3a3');
    for (const [label, broken] of [
      ['not an object', 'the approval'],
      ['empty', {}],
      ['no decision', { source: approval.source, request: approval.request }],
      ['no source', { request: approval.request, decision: approval.decision }],
      [
        'a decision Core could not have issued',
        { ...approval, decision: { ...approval.decision, issuer: 'qf-jarvis' } },
      ],
      [
        'a caller-supplied conclusion instead of evidence',
        { actionDecision: { decision: 'approved' }, decision: approval.decision },
      ],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            request: communicationRequest(),
            authorization: authorized(approval.decision.decisionId),
            approval: broken,
          } as never),
        'approval-invalid',
        label,
      );
    }
  });

  it('refuses when the SELECTED ACTION was rejected, even though the decision is approved overall', () => {
    // The partial-approval trap. `decision.outcome` is `approved` here -- because a DIFFERENT action
    // was approved -- while THIS action's verdict is `rejected`. A runtime reading the overall
    // outcome would authorize a communication nobody agreed to send.
    const approval = partiallyApprovedEvidence('a4a4a4a4');
    expect(approval.decision.outcome).toBe('approved');

    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest(),
          authorization: authorized(approval.decision.decisionId),
          approval,
        } as never),
      'approval-not-approved',
    );
  });

  it('proves an approved action in Core’s named decision but does not invent communication-action identity', () => {
    // THE limit of the guarantee, written as a test so it cannot be forgotten.
    //
    // One `ApprovalDecisionV1` covering TWO actions, both approved. The supplied evidence selects the
    // first. Validation succeeds -- the authorization names that decision, and an approved action
    // exists within it on the same correlation thread.
    //
    // What the observation does NOT say is which of those two actions the communication request
    // represents. `CommunicationAuthorizationV1` carries a decision id and no `approvalRequestId`,
    // `proposedActionId` or `actionFingerprint`, so there is no field by which the comparison could
    // be made -- and Jarvis must not infer one from `actionType`, parameters, summary, template or
    // purpose. Core owns that binding, because Core issues the authorization (ADR-0083 §11).
    const { evidence, selectedActionId, otherActionId } = multiActionApprovedEvidence('a7a7a7a7');
    expect(evidence.decision.actionDecisions).toHaveLength(2);
    expect(selectedActionId).not.toBe(otherActionId);

    const observation = runtime.validate({
      request: communicationRequest(),
      authorization: authorized(evidence.decision.decisionId),
      approval: evidence,
    } as never);

    expect(observation.authorization.outcome).toBe('authorized');
    // The action id belongs to the SUPPLIED EVIDENCE, and says so.
    expect(observation.approvalCorrelation?.proposedActionId).toBe(selectedActionId);
    expect(observation.approvalCorrelation?.actionDecision.decision).toBe('approved');
    expect(observation.approvalCorrelation?.decision.decisionId).toBe(evidence.decision.decisionId);
    // ...and it is NOT the other approved action in the same decision, which the observation is
    // equally unable to rule out as the one this communication is about.
    expect(observation.approvalCorrelation?.proposedActionId).not.toBe(otherActionId);

    // And no field claims it is the communication's action, or an execution action.
    const surface = observation as unknown as Record<string, unknown>;
    for (const forbidden of [
      'approvedActionId',
      'communicationActionId',
      'actionBinding',
      'executionActionId',
      'canExecute',
      'canSend',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
    expect(Object.keys(observation).sort()).toEqual([
      'approvalCorrelation',
      'authorization',
      'request',
    ]);
  });

  it('refuses when Core names a DIFFERENT approval decision', () => {
    const approval = approvalEvidence('a5a5a5a5');
    const other = approvalEvidence('a6a6a6a6');
    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest(),
          authorization: authorized(other.decision.decisionId),
          approval,
        } as never),
      'binding-mismatch',
    );
  });
});

describe('a Core REFUSAL is an ordinary, authoritative observation', () => {
  it('stands even though a human approved the action — founder approval does not override opt-out', () => {
    // THE central P08 invariant. The approval is real, valid, and says approved. Core says the
    // recipient opted out. The refusal wins, it is not an error, and nothing in the result can be
    // read as permission to send anyway.
    const approval = approvalEvidence('b1b1b1b1');
    expect(approval.decision.actionDecisions[0]?.decision).toBe('approved');

    const observation = runtime.validate({
      request: communicationRequest(),
      authorization: rejected('recipient-opted-out'),
      approval,
    } as never);

    expect(observation.authorization.outcome).toBe('rejected');
    expect(observation.authorization.reasonCode).toBe('recipient-opted-out');
    expect(observation.knownRefusalReason).toBe('recipient-opted-out');
    // The approval is still reported -- it happened -- and it authorizes nothing.
    expect(observation.approvalCorrelation?.actionDecision.decision).toBe('approved');
    const surface = observation as unknown as Record<string, unknown>;
    for (const forbidden of ['canSend', 'isAuthorized', 'eligible', 'permitted', 'override']) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('is observed for EVERY refusal the architecture names', () => {
    // Including the ones that must never be silently retried: opt-out, consent withdrawn,
    // do-not-contact, suppression, STOP, quiet hours, attempt limits.
    expect(COMMUNICATION_REFUSAL_REASONS).toHaveLength(10);
    for (const reason of COMMUNICATION_REFUSAL_REASONS) {
      const observation = runtime.validate({
        request: communicationRequest(),
        authorization: rejected(reason),
      } as never);
      expect(observation.authorization.outcome, reason).toBe('rejected');
      expect(observation.authorization.reasonCode, reason).toBe(reason);
      expect(observation.knownRefusalReason, reason).toBe(reason);
      // No approval was needed to record a safe refusal, and none was invented.
      expect(observation.approvalCorrelation, reason).toBeUndefined();
    }
  });

  it('needs NO approval evidence, because Core may refuse before anyone is asked', () => {
    for (const reason of [
      'recipient-opted-out',
      'consent-withdrawn',
      'suppressed',
      'stop-received',
    ]) {
      const observation = runtime.validate({
        request: communicationRequest(),
        authorization: rejected(reason),
      } as never);
      expect(observation.approvalCorrelation, reason).toBeUndefined();
      expect(observation.knownRefusalReason, reason).toBe(reason);
    }
  });

  it('creates no local STOP, consent or suppression state from the refusal', () => {
    // The runtime observes that Core reported a STOP. It does not RECORD one: interpreting STOP is
    // Core's authority, and a local copy is the parallel state communication-model.md forbids.
    const observation = runtime.validate({
      request: communicationRequest(),
      authorization: rejected('stop-received'),
    } as never);
    expect(Object.keys(observation).sort()).toEqual([
      'authorization',
      'knownRefusalReason',
      'request',
    ]);
    const surface = observation as unknown as Record<string, unknown>;
    for (const forbidden of [
      'stopState',
      'startState',
      'optedOut',
      'doNotContact',
      'suppressed',
      'consentValid',
      'suppressionList',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('preserves an UNKNOWN Core reason verbatim, and classifies it as nothing', () => {
    // `reasonCode` is open because Core owns its taxonomy. An unknown refusal is exactly as binding
    // as a named one -- so it is recorded faithfully, mapped to no bucket, and never softened.
    for (const reason of [
      'core.regional-embargo',
      'vendor-tier-restricted',
      'core.new-reason-invented-tomorrow',
    ]) {
      const observation = runtime.validate({
        request: communicationRequest(),
        authorization: rejected(reason),
      } as never);
      expect(observation.authorization.outcome, reason).toBe('rejected');
      expect(observation.authorization.reasonCode, reason).toBe(reason);
      expect(observation.knownRefusalReason, reason).toBeUndefined();
      expect(Object.keys(observation)).not.toContain('knownRefusalReason');
    }
  });

  it('still fails closed on approval evidence that does not hold up', () => {
    // A refusal does not excuse broken evidence: if a caller attaches an approval, it must be one.
    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest(),
          authorization: rejected('quiet-hours'),
          approval: { source: {}, request: {}, decision: {} },
        } as never),
      'approval-invalid',
    );
    // And it must belong to THIS conversation.
    const foreign = approvalEvidence('b2b2b2b2');
    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest({ correlationId: OTHER_CORRELATION_ID }),
          authorization: rejected('quiet-hours', { correlationId: OTHER_CORRELATION_ID }),
          approval: foreign,
        } as never),
      'binding-mismatch',
      'foreign correlation thread',
    );
  });

  it('is unaffected by the approval verdict — a rejected action does not change a Core refusal', () => {
    const approval = partiallyApprovedEvidence('b3b3b3b3');
    const observation = runtime.validate({
      request: communicationRequest(),
      authorization: rejected('do-not-contact'),
      approval,
    } as never);
    // Not `approval-not-approved`: that rule guards an AUTHORIZATION. Core already said no, and the
    // refusal is what gets observed regardless of what the human said.
    expect(observation.authorization.outcome).toBe('rejected');
    expect(observation.knownRefusalReason).toBe('do-not-contact');
    expect(observation.approvalCorrelation?.actionDecision.decision).toBe('rejected');
  });
});

describe('the artifacts must describe each other', () => {
  it('refuses a mismatched communication id, request id or correlation thread', () => {
    const approval = approvalEvidence('c1c1c1c1');
    for (const [label, over] of [
      ['wrong communication id', { communicationId: 'ffffffff-3333-4000-8000-000000000009' }],
      [
        'wrong communication request id',
        { communicationRequestId: 'ffffffff-4444-4000-8000-000000000009' },
      ],
      ['wrong correlation thread', { correlationId: OTHER_CORRELATION_ID }],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            request: communicationRequest(),
            authorization: authorized(approval.decision.decisionId, over),
            approval,
          } as never),
        'binding-mismatch',
        label,
      );
    }
  });

  it('refuses an approval from an unrelated correlation thread', () => {
    const approval = approvalEvidence('c2c2c2c2');
    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest({ correlationId: OTHER_CORRELATION_ID }),
          authorization: authorized(approval.decision.decisionId, {
            correlationId: OTHER_CORRELATION_ID,
          }),
          approval,
        } as never),
      'binding-mismatch',
    );
  });

  it('refuses an answer that PREDATES the question, on either outcome', () => {
    const approval = approvalEvidence('c3c3c3c3');
    const before = '2026-08-02T10:59:59Z';
    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest(),
          authorization: authorized(approval.decision.decisionId, { decidedAt: before }),
          approval,
        } as never),
      'binding-mismatch',
      'authorized before the request existed',
    );
    expectCode(
      () =>
        runtime.validate({
          request: communicationRequest(),
          authorization: rejected('quiet-hours', { decidedAt: before }),
        } as never),
      'binding-mismatch',
      'rejected before the request existed',
    );
    // The instant the request was CREATED is inside the window: createdAt <= decidedAt.
    expect(
      runtime.validate({
        request: communicationRequest(),
        authorization: rejected('quiet-hours', { decidedAt: COMM_CREATED_AT }),
      } as never).authorization.decidedAt,
    ).toBe(COMM_CREATED_AT);
  });

  it('refuses an AUTHORIZATION at or after the request expired', () => {
    // An expired ask cannot become authorized. Nothing may turn a dead request into a live one.
    const approval = approvalEvidence('c4c4c4c4');
    for (const [label, decidedAt] of [
      ['exactly at expiry', COMM_EXPIRES_AT],
      ['after expiry', '2026-08-03T05:00:00Z'],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            request: communicationRequest(),
            authorization: authorized(approval.decision.decisionId, { decidedAt }),
            approval,
          } as never),
        'binding-mismatch',
        label,
      );
    }
  });

  it('ACCEPTS a rejection at or after the request expired', () => {
    // The asymmetry is the point: a late refusal creates no permission and hides nothing, and
    // refusing to observe one would make the safest possible answer unrecordable.
    for (const [label, decidedAt] of [
      ['exactly at expiry', COMM_EXPIRES_AT],
      ['long after expiry', '2026-08-09T05:00:00Z'],
    ] as const) {
      const observation = runtime.validate({
        request: communicationRequest(),
        authorization: rejected('recipient-opted-out', { decidedAt }),
      } as never);
      expect(observation.authorization.outcome, label).toBe('rejected');
      expect(observation.knownRefusalReason, label).toBe('recipient-opted-out');
    }
  });

  it('compares instants through the contract, not as strings', () => {
    // RFC 3339 admits fractional seconds, and `...:00.5Z` sorts BEFORE `...:00Z` lexicographically
    // while being after it in time. A string comparison would call this authorization premature.
    const approval = approvalEvidence('c5c5c5c5');
    const observation = runtime.validate({
      request: communicationRequest({ createdAt: '2026-08-02T11:00:00Z' }),
      authorization: authorized(approval.decision.decisionId, {
        decidedAt: '2026-08-02T11:00:00.5Z',
      }),
      approval,
    } as never);
    expect(observation.authorization.decidedAt).toBe('2026-08-02T11:00:00.5Z');
  });
});

describe('neither artifact is ever repaired', () => {
  it('refuses an authorization issued by anything other than QuickFurno Core', () => {
    // A Jarvis-issued artifact is not a Core artifact with a wrong label. Normalizing one into the
    // other is how a system ends up authorizing itself.
    for (const issuer of ['qf-jarvis', 'n8n', 'quickfurno_core', 'QuickFurno-Core', '']) {
      expectCode(
        () =>
          runtime.validate({
            request: communicationRequest(),
            authorization: rejected('quiet-hours', { issuer }),
          } as never),
        'authorization-invalid',
        `issuer ${issuer}`,
      );
    }
  });

  it('refuses an authorization that contradicts its own contract', () => {
    const approval = approvalEvidence('d1d1d1d1');
    for (const [label, authorization] of [
      [
        'authorized with no channel',
        authorized(approval.decision.decisionId, { authorizedChannel: undefined }),
      ],
      [
        'authorized naming no approval',
        authorized(approval.decision.decisionId, { approvalDecisionId: undefined }),
      ],
      // A refusal that names an approval would read as though it rested on one.
      [
        'rejected naming an approval',
        rejected('quiet-hours', { approvalDecisionId: approval.decision.decisionId }),
      ],
      ['rejected authorizing a channel', rejected('quiet-hours', { authorizedChannel: 'sms' })],
      ['unknown outcome', rejected('quiet-hours', { outcome: 'maybe' })],
      ['no reason code', rejected('quiet-hours', { reasonCode: undefined })],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({ request: communicationRequest(), authorization, approval } as never),
        'authorization-invalid',
        label,
      );
    }
  });

  it('refuses a communication request that violates its own contract', () => {
    for (const [label, over] of [
      ['requiredApproval none', { requiredApproval: 'none' }],
      ['expiry before creation', { expiresAt: '2026-08-02T10:00:00Z' }],
      ['produced by something other than Jarvis', { producingSystem: 'quickfurno-core' }],
      // A voice call must be spoken from an approved script, and needs explicit human approval.
      ['voice call bound to a message template', { proposedChannel: 'voice' }],
      // Strict: a consent flag cannot be attached to the ask.
      ['a consent flag attached', { hasConsent: true }],
      ['a phone number attached', { recipientPhone: '+919876543210' }],
    ] as const) {
      expectCode(
        () =>
          runtime.validate({
            request: communicationRequest(over),
            authorization: rejected('quiet-hours'),
          } as never),
        'request-invalid',
        label,
      );
    }
  });
});

describe('the observation confers nothing', () => {
  it('carries exactly the four permitted fields and no authority flag', () => {
    const approval = approvalEvidence('e1e1e1e1');
    const observation = runtime.validate({
      request: communicationRequest(),
      authorization: authorized(approval.decision.decisionId),
      approval,
    } as never);

    expect(Object.keys(observation).sort()).toEqual([
      'approvalCorrelation',
      'authorization',
      'request',
    ]);
    const surface = observation as unknown as Record<string, unknown>;
    for (const forbidden of [
      'canSend',
      'canExecute',
      'isAuthorized',
      'authorized',
      'communicationAllowed',
      'consentValid',
      'eligible',
      'permitted',
      'permission',
      'validUntil',
      'authorizedUntil',
      'pending',
      'status',
      'expiresAt',
      'executionIntent',
      'idempotencyKey',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
    // A caller reads a FACT about Core's record, not a flag this package derived.
    expect(observation.authorization.outcome).toBe('authorized');
  });

  it('is deeply frozen, so Core’s artifact cannot be edited after the fact', () => {
    const approval = approvalEvidence('e2e2e2e2');
    const observation = runtime.validate({
      request: communicationRequest(),
      authorization: rejected('recipient-opted-out'),
      approval,
    } as never);

    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.authorization)).toBe(true);
    expect(Object.isFrozen(observation.request)).toBe(true);
    expect(Object.isFrozen(observation.approvalCorrelation)).toBe(true);
    // The forgery this prevents: flipping a refusal into an authorization downstream.
    expect(() => {
      (observation.authorization as { outcome: string }).outcome = 'authorized';
    }).toThrow();
    expect(observation.authorization.outcome).toBe('rejected');
  });

  it('returns both artifacts verbatim, adding and removing nothing', () => {
    const approval = approvalEvidence('e3e3e3e3');
    const request = communicationRequest();
    const authorization = authorized(approval.decision.decisionId);
    const observation = runtime.validate({ request, authorization, approval } as never);

    expect(observation.request).toEqual(request);
    expect(observation.authorization).toEqual(authorization);
    expect(observation.authorization.decidedAt).toBe(DECIDED_AT);
    expect(observation.request.correlationId).toBe(CORRELATION_ID);
    expect(observation.request.communicationId).toBe(COMMUNICATION_ID);
  });
});
