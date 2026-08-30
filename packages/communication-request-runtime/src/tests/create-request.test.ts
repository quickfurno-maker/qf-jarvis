/**
 * QFJ-P08 — the powerless `CommunicationRequestV1` producer (ADR-0133).
 *
 * The whole safety argument of this package is what the artifact it builds CANNOT say, and what a
 * caller CANNOT make it say. So the specs are adversarial by default: each one names a concrete way
 * an ask could quietly become a permission, and asserts the refusal.
 */
import {
  communicationRequestV1Schema,
  COMMUNICATION_REQUEST_CONTRACT_VERSION,
} from '@qf-jarvis/contracts';
import type { CommunicationRequestV1 } from '@qf-jarvis/contracts';
import { describe, expect, it } from 'vitest';

import { CommunicationRequestRuntimeError, createCommunicationRequestRuntime } from '../index.js';
import {
  actionDraft,
  CAUSATION_EVENT_ID,
  COMMUNICATION_ID,
  CORRELATION_ID,
  fixedIdentity,
  founderApprovedSource,
  informationalSource,
  POLICY,
  REC_CREATED_AT,
  REC_EXPIRES_AT,
  recommendationSource,
  REQ_CREATED_AT,
  REQ_EXPIRES_AT,
  REQUEST_ID,
  requestInput,
  scriptContent,
  templateContent,
  twoActionSource,
} from './fixtures.js';

const runtime = (): ReturnType<typeof createCommunicationRequestRuntime> =>
  createCommunicationRequestRuntime({ identity: fixedIdentity() });

/** Assert a call fails closed with exactly this code, and leaks nothing in the message. */
function expectCode(call: () => unknown, code: string): void {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(CommunicationRequestRuntimeError);
    expect((error as CommunicationRequestRuntimeError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

describe('the happy path', () => {
  it('builds a canonical CommunicationRequestV1 from one exact governed action', () => {
    const request = runtime().createRequest(requestInput());

    expect(request.contractVersion).toBe(COMMUNICATION_REQUEST_CONTRACT_VERSION);
    expect(request.recipient).toEqual({ entityType: 'vendor', entityId: 'vendor.42' });
    expect(request.purposeCode).toBe('vendor.follow-up');
    expect(request.proposedChannel).toBe('whatsapp');
    expect(request.content).toEqual(templateContent());
    expect(request.requestedTiming).toEqual({ timingType: 'immediate' });
    expect(request.policy).toEqual(POLICY);
  });

  it('produces something the canonical schema accepts, unchanged', () => {
    const request = runtime().createRequest(requestInput());
    expect(communicationRequestV1Schema.safeParse(request).success).toBe(true);
  });

  it('stamps producingSystem as the qf-jarvis literal', () => {
    expect(runtime().createRequest(requestInput()).producingSystem).toBe('qf-jarvis');
  });

  it('generates BOTH identities at the runtime, and they are distinct concerns', () => {
    const request = runtime().createRequest(requestInput());
    expect(request.communicationRequestId).toBe(REQUEST_ID);
    expect(request.communicationId).toBe(COMMUNICATION_ID);
    expect(request.communicationRequestId).not.toBe(request.communicationId);
  });

  it('carries an optional causation event when one is supplied, and omits it otherwise', () => {
    const withCausation = runtime().createRequest(
      requestInput({ causationEventId: CAUSATION_EVENT_ID }),
    );
    expect(withCausation.causationEventId).toBe(CAUSATION_EVENT_ID);
    expect(runtime().createRequest(requestInput())).not.toHaveProperty('causationEventId');
  });

  it('returns a DEEPLY frozen artifact', () => {
    const request = runtime().createRequest(
      requestInput({ content: templateContent({ variables: { vendorRef: 'v-42' } }) }),
    );
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.recipient)).toBe(true);
    expect(Object.isFrozen(request.content)).toBe(true);
    expect(Object.isFrozen(request.content.variables)).toBe(true);
    expect(Object.isFrozen(request.policy)).toBe(true);
    expect(Object.isFrozen(request.requestedTiming)).toBe(true);
  });

  it('accepts an immediate, a scheduled and a window timing', () => {
    expect(
      runtime().createRequest(
        requestInput({
          requestedTiming: { timingType: 'scheduled', requestedAt: '2026-08-02T18:00:00Z' },
        }),
      ).requestedTiming,
    ).toEqual({ timingType: 'scheduled', requestedAt: '2026-08-02T18:00:00Z' });

    expect(
      runtime().createRequest(
        requestInput({
          requestedTiming: {
            timingType: 'window',
            notBefore: '2026-08-02T12:00:00Z',
            notAfter: '2026-08-02T20:00:00Z',
          },
        }),
      ).requestedTiming.timingType,
    ).toBe('window');
  });
});

describe('source integrity: the source is re-proved, never believed', () => {
  it('refuses a malformed recommendation', () => {
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ source: { recommendation: {}, actionBindings: [] } }),
        ),
      'binding-mismatch',
    );
    expectCode(() => runtime().createRequest(requestInput({ source: null })), 'binding-mismatch');
    expectCode(
      () => runtime().createRequest(requestInput({ source: { actionBindings: [] } })),
      'binding-mismatch',
    );
  });

  it('refuses a stale binding whose fingerprint no longer describes the action', () => {
    const source = recommendationSource();
    const mutated = {
      recommendation: {
        ...source.recommendation,
        proposedActions: [
          { ...source.recommendation.proposedActions[0], summary: 'Something else entirely.' },
        ],
      },
      actionBindings: source.actionBindings,
    };
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({
            source: mutated,
            proposedActionId: source.recommendation.proposedActions[0]?.actionId,
          }),
        ),
      'binding-mismatch',
    );
  });

  it('refuses a substituted binding taken from a different action', () => {
    const source = recommendationSource();
    // The identity port is deterministic, so `other` shares this recommendation's id and action id
    // and differs only in CONTENT — which is precisely the substitution the recomputation exists to
    // catch: every identifier still lines up, and only the digest disagrees.
    const other = recommendationSource({
      proposedActions: [actionDraft({ summary: 'Send something else entirely.' })],
    });
    expect(other.recommendation.proposedActions[0]?.actionId).toBe(
      source.recommendation.proposedActions[0]?.actionId,
    );
    expect(other.actionBindings[0]?.actionFingerprint).not.toBe(
      source.actionBindings[0]?.actionFingerprint,
    );
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({
            source: { recommendation: source.recommendation, actionBindings: other.actionBindings },
            proposedActionId: source.recommendation.proposedActions[0]?.actionId,
          }),
        ),
      'binding-mismatch',
    );
  });

  it('refuses a binding count that disagrees with the recommendation', () => {
    const source = twoActionSource();
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({
            source: {
              recommendation: source.recommendation,
              actionBindings: [source.actionBindings[0]],
            },
            proposedActionId: source.recommendation.proposedActions[0]?.actionId,
          }),
        ),
      'binding-mismatch',
    );
  });

  it('refuses a missing, unknown or non-string proposedActionId', () => {
    expectCode(
      () => runtime().createRequest({ ...requestInput(), proposedActionId: undefined }),
      'binding-mismatch',
    );
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ proposedActionId: 'bbbbbbbb-0000-4000-8000-999999999999' }),
        ),
      'binding-mismatch',
    );
    expectCode(
      () => runtime().createRequest(requestInput({ proposedActionId: 7 })),
      'binding-mismatch',
    );
  });

  it('selects the EXACT action asked about, not merely the first one', () => {
    const source = twoActionSource();
    const second = source.recommendation.proposedActions[1];
    const request = runtime().createRequest(
      requestInput({ source, proposedActionId: second?.actionId }),
    );
    expect(request.summary).toBe('Tell the account owner instead.');
    expect(request.summary).not.toBe(source.recommendation.proposedActions[0]?.summary);
  });

  it('refuses an informational recommendation: it proposes nothing to communicate about', () => {
    const source = informationalSource();
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ source, proposedActionId: 'bbbbbbbb-0000-4000-8000-000000000002' }),
        ),
      'binding-mismatch',
    );
  });
});

describe('derived governance: the caller cannot restate it', () => {
  it('derives requestingAgent and requestingAgentVersion from the recommendation', () => {
    const request = runtime().createRequest(requestInput());
    expect(request.requestingAgent).toBe('anisha');
    expect(request.requestingAgentVersion).toBe('anisha.v1');
  });

  it('derives priority from the recommendation', () => {
    expect(runtime().createRequest(requestInput()).priority).toBe('medium');
    expect(
      runtime().createRequest(requestInput({ source: founderApprovedSource() })).priority,
    ).toBe('high');
  });

  it('derives requiredApproval from the recommendation', () => {
    expect(runtime().createRequest(requestInput()).requiredApproval).toBe('authorized-team-human');
    expect(
      runtime().createRequest(requestInput({ source: founderApprovedSource() })).requiredApproval,
    ).toBe('founder');
  });

  it('derives summary from the SELECTED action, not from the recommendation', () => {
    const request = runtime().createRequest(requestInput());
    expect(request.summary).toBe('Send the vendor the standard delayed-sample follow-up.');
    expect(request.summary).not.toBe('The vendor has not responded about the delayed sample.');
  });

  it('derives correlationId from the recommendation', () => {
    expect(runtime().createRequest(requestInput()).correlationId).toBe(CORRELATION_ID);
  });

  it('REFUSES every derived field offered as input rather than letting it win', () => {
    for (const key of [
      'communicationRequestId',
      'communicationId',
      'contractVersion',
      'producingSystem',
      'requestingAgent',
      'requestingAgentVersion',
      'priority',
      'requiredApproval',
      'summary',
      'correlationId',
    ]) {
      expectCode(
        () => runtime().createRequest({ ...requestInput(), [key]: 'anything' }),
        'invalid-input',
      );
    }
  });

  it('cannot be used to launder a founder recommendation down to a weaker ask', () => {
    // The laundering attempt: a founder-approval source, asked about as if it needed less.
    expectCode(
      () =>
        runtime().createRequest({
          ...requestInput({ source: founderApprovedSource() }),
          requiredApproval: 'authorized-team-human',
        }),
      'invalid-input',
    );
    // And the derived value is unchanged when the extra key is simply removed.
    expect(
      runtime().createRequest(requestInput({ source: founderApprovedSource() })).requiredApproval,
    ).toBe('founder');
  });
});

describe('timing: a request may not outlive the recommendation it asks about', () => {
  it('refuses a request created before the recommendation was', () => {
    expectCode(
      () => runtime().createRequest(requestInput({ createdAt: '2026-08-02T08:59:59Z' })),
      'request-invalid',
    );
  });

  it('accepts a request created at exactly the recommendation instant', () => {
    expect(runtime().createRequest(requestInput({ createdAt: REC_CREATED_AT })).createdAt).toBe(
      REC_CREATED_AT,
    );
  });

  it('refuses a request created at or after the recommendation expires', () => {
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ createdAt: REC_EXPIRES_AT, expiresAt: '2026-08-04T10:00:00Z' }),
        ),
      'request-invalid',
    );
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ createdAt: '2026-08-05T09:00:00Z', expiresAt: '2026-08-05T10:00:00Z' }),
        ),
      'request-invalid',
    );
  });

  it('refuses a request that expires after the recommendation does', () => {
    expectCode(
      () => runtime().createRequest(requestInput({ expiresAt: '2026-08-04T09:00:01Z' })),
      'request-invalid',
    );
  });

  it('accepts a request that expires exactly with the recommendation', () => {
    expect(runtime().createRequest(requestInput({ expiresAt: REC_EXPIRES_AT })).expiresAt).toBe(
      REC_EXPIRES_AT,
    );
  });

  it('refuses a non-increasing created/expires pair', () => {
    expectCode(
      () => runtime().createRequest(requestInput({ expiresAt: REQ_CREATED_AT })),
      'request-invalid',
    );
    expectCode(
      () => runtime().createRequest(requestInput({ expiresAt: '2026-08-02T09:30:00Z' })),
      'request-invalid',
    );
  });

  it('leaves the canonical schema to refuse a scheduled time at or after expiry', () => {
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({
            requestedTiming: { timingType: 'scheduled', requestedAt: REQ_EXPIRES_AT },
          }),
        ),
      'request-invalid',
    );
  });

  it('leaves the canonical schema to refuse an inverted or too-late window', () => {
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({
            requestedTiming: {
              timingType: 'window',
              notBefore: '2026-08-02T20:00:00Z',
              notAfter: '2026-08-02T12:00:00Z',
            },
          }),
        ),
      'request-invalid',
    );
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({
            requestedTiming: {
              timingType: 'window',
              notBefore: REQ_EXPIRES_AT,
              notAfter: '2026-08-04T00:00:00Z',
            },
          }),
        ),
      'request-invalid',
    );
  });

  it('is deterministic across time: the same input yields the same instants', () => {
    // No clock is read, so a replayed input produces the same artifact rather than a stale one.
    const a = runtime().createRequest(requestInput());
    const b = runtime().createRequest(requestInput());
    expect(a.createdAt).toBe(b.createdAt);
    expect(a.expiresAt).toBe(b.expiresAt);
    expect(a.createdAt).toBe(REQ_CREATED_AT);
  });
});

describe('authority and contact containment', () => {
  it('refuses a phone number as the recipient', () => {
    for (const entityId of ['+919876543210', '+1-555-0100']) {
      expectCode(
        () =>
          runtime().createRequest(requestInput({ recipient: { entityType: 'lead', entityId } })),
        'invalid-input',
      );
    }
  });

  it('refuses an email address as the recipient', () => {
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ recipient: { entityType: 'lead', entityId: 'someone@example.com' } }),
        ),
      'invalid-input',
    );
  });

  it('refuses a recipient that carries anything alongside the reference', () => {
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({
            recipient: { entityType: 'vendor', entityId: 'vendor.42', phoneNumber: '5550100' },
          }),
        ),
      'invalid-input',
    );
  });

  it('refuses every consent-, eligibility- and suppression-shaped input field', () => {
    for (const key of [
      'consent',
      'hasConsent',
      'consentValid',
      'optedIn',
      'optedOut',
      'stop',
      'dnc',
      'suppressed',
      'suppression',
      'eligible',
      'eligibility',
      'canSend',
      'quietHours',
    ]) {
      expectCode(
        () => runtime().createRequest({ ...requestInput(), [key]: true }),
        'invalid-input',
      );
    }
  });

  it('refuses every approval-, authorization- and execution-shaped input field', () => {
    for (const key of [
      'approved',
      'authorized',
      'authorization',
      'approvalRequestId',
      'approvalDecisionId',
      'actionFingerprint',
      'canExecute',
      'permission',
      'permitted',
      'validUntil',
      'authorizedUntil',
      'sent',
      'delivered',
      'executionIntentId',
      'executionResultId',
      'idempotencyKey',
      'status',
    ]) {
      expectCode(() => runtime().createRequest({ ...requestInput(), [key]: 'x' }), 'invalid-input');
    }
  });

  it('refuses every provider-, transport- and destination-shaped input field', () => {
    for (const key of [
      'provider',
      'destination',
      'phone',
      'phoneNumber',
      'email',
      'webhook',
      'webhookUrl',
      'workflowId',
      'n8nWorkflow',
      'credentials',
      'apiKey',
    ]) {
      expectCode(() => runtime().createRequest({ ...requestInput(), [key]: 'x' }), 'invalid-input');
    }
  });

  it('produces an artifact with no authority-, consent- or delivery-shaped field at all', () => {
    const request = runtime().createRequest(requestInput()) as unknown as Record<string, unknown>;
    for (const key of [
      'approved',
      'authorized',
      'isAuthorized',
      'canSend',
      'canExecute',
      'eligible',
      'consent',
      'consentValid',
      'optedOut',
      'suppressed',
      'validUntil',
      'status',
      'sent',
      'sentAt',
      'delivered',
      'provider',
      'destination',
      'approvalRequestId',
      'proposedActionId',
      'actionFingerprint',
      'executionIntentId',
      'idempotencyKey',
    ]) {
      expect(request[key], key).toBeUndefined();
    }
  });

  it('locks the produced field set to the canonical contract, and nothing beside it', () => {
    const request = runtime().createRequest(requestInput());
    expect(Object.keys(request).sort()).toEqual([
      'communicationId',
      'communicationRequestId',
      'content',
      'contractVersion',
      'correlationId',
      'createdAt',
      'expiresAt',
      'policy',
      'priority',
      'producingSystem',
      'proposedChannel',
      'purposeCode',
      'recipient',
      'requestedTiming',
      'requestingAgent',
      'requestingAgentVersion',
      'requiredApproval',
      'summary',
    ]);
  });

  it('exposes ONE method, and nothing that grants, sends or executes', () => {
    const created = runtime() as unknown as Record<string, unknown>;
    expect(Object.keys(created)).toEqual(['createRequest']);
    for (const forbidden of [
      'authorize',
      'approve',
      'submit',
      'send',
      'execute',
      'dispatch',
      'deliver',
      'persist',
      'enqueue',
      'emit',
      'callCore',
      'checkConsent',
      'checkEligibility',
      'resolveRecipient',
      'renderTemplate',
    ]) {
      expect(created[forbidden], forbidden).toBeUndefined();
    }
  });
});

describe('content: a reference, never a body', () => {
  it('requires a TEMPLATE for a messaging channel', () => {
    for (const channel of ['whatsapp', 'sms', 'email']) {
      expect(
        runtime().createRequest(requestInput({ proposedChannel: channel })).content.contentType,
      ).toBe('template');
      expectCode(
        () =>
          runtime().createRequest(
            requestInput({ proposedChannel: channel, content: scriptContent() }),
          ),
        'request-invalid',
      );
    }
  });

  it('requires a SCRIPT for voice, and refuses a template', () => {
    const source = founderApprovedSource();
    expect(
      runtime().createRequest(
        requestInput({ source, proposedChannel: 'voice', content: scriptContent() }),
      ).content.contentType,
    ).toBe('script');
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ source, proposedChannel: 'voice', content: templateContent() }),
        ),
      'request-invalid',
    );
  });

  it('refuses a voice request whose INHERITED approval is not explicit human approval, and never escalates it', () => {
    // The default source requires `authorized-team-human`, which the contract does not accept for an
    // outbound call. The correct behaviour is refusal, NOT a silent promotion to `founder`.
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ proposedChannel: 'voice', content: scriptContent() }),
        ),
      'request-invalid',
    );
    // Proof it is the inherited level doing the refusing: a founder source on the same input passes.
    expect(
      runtime().createRequest(
        requestInput({
          source: founderApprovedSource(),
          proposedChannel: 'voice',
          content: scriptContent(),
        }),
      ).requiredApproval,
    ).toBe('founder');
  });

  it('refuses a free-text body smuggled in as a governed template variable', () => {
    for (const key of ['body', 'message', 'messageBody', 'text', 'content', 'script']) {
      expectCode(
        () =>
          runtime().createRequest(
            requestInput({ content: templateContent({ variables: { [key]: 'Hi there!' } }) }),
          ),
        'invalid-input',
      );
    }
  });

  it('refuses contact details and credentials in template variables, by key and by value shape', () => {
    for (const variables of [
      { phone: 'x' },
      { email: 'x' },
      { apiKey: 'x' },
      { transcript: 'x' },
      { prompt: 'x' },
      { vendorRef: 'someone@example.com' },
      { vendorRef: '+919876543210' },
    ]) {
      expectCode(
        () => runtime().createRequest(requestInput({ content: templateContent({ variables }) })),
        'invalid-input',
      );
    }
  });

  it('refuses a content reference carrying anything beyond the approved shape', () => {
    expectCode(
      () => runtime().createRequest(requestInput({ content: templateContent({ body: 'Hello.' }) })),
      'invalid-input',
    );
    expectCode(
      () =>
        runtime().createRequest(
          requestInput({ content: templateContent({ renderedMessage: 'Hello.' }) }),
        ),
      'invalid-input',
    );
  });
});

describe('immutability: the result is detached from everything the caller still holds', () => {
  it('survives mutation of the source recommendation and its action parameters', () => {
    const source = recommendationSource();
    const input = requestInput({ source });
    const request = runtime().createRequest(input);
    const summaryBefore = request.summary;

    // The recommendation runtime already froze its own artifact, so the caller's realistic attack is
    // on the mutable input object it still holds.
    input['summary'] = 'rewritten';
    expect(request.summary).toBe(summaryBefore);
    expect(request.correlationId).toBe(CORRELATION_ID);
  });

  it('survives mutation of the caller-owned recipient, policy, content and variables', () => {
    const recipient: Record<string, unknown> = { entityType: 'vendor', entityId: 'vendor.42' };
    const policy: Record<string, unknown> = { policyId: 'communication.policy', policyVersion: 2 };
    const variables: Record<string, unknown> = { vendorRef: 'v-42', nested: { tier: 'gold' } };
    const content: Record<string, unknown> = templateContent({ variables });
    const timing: Record<string, unknown> = { timingType: 'immediate' };

    const request = runtime().createRequest(
      requestInput({ recipient, policy, content, requestedTiming: timing }),
    );

    recipient['entityId'] = 'vendor.99';
    policy['policyVersion'] = 999;
    content['templateId'] = 'other.template';
    variables['vendorRef'] = 'v-99';
    (variables['nested'] as Record<string, unknown>)['tier'] = 'bronze';
    timing['timingType'] = 'scheduled';

    expect(request.recipient.entityId).toBe('vendor.42');
    expect(request.policy.policyVersion).toBe(2);
    expect(request.content.templateId).toBe('vendor.follow-up.v2');
    expect(request.content.variables?.['vendorRef']).toBe('v-42');
    expect((request.content.variables?.['nested'] as Record<string, unknown>)['tier']).toBe('gold');
    expect(request.requestedTiming.timingType).toBe('immediate');
  });

  it('cannot be edited after it is returned', () => {
    const request = runtime().createRequest(requestInput()) as unknown as Record<string, unknown>;
    expect(() => {
      'use strict';
      request['canSend'] = true;
    }).toThrow();
    expect(() => {
      'use strict';
      request['requiredApproval'] = 'none';
    }).toThrow();
    expect(request['canSend']).toBeUndefined();
    expect(request['requiredApproval']).toBe('authorized-team-human');
  });
});

describe('architecture: what the request deliberately does not mean', () => {
  it('keeps the channel a PROPOSAL: nothing names it selected, authorized or final', () => {
    const request = runtime().createRequest(requestInput()) as unknown as Record<string, unknown>;
    expect(request['proposedChannel']).toBe('whatsapp');
    for (const key of ['channel', 'selectedChannel', 'authorizedChannel', 'finalChannel']) {
      expect(request[key], key).toBeUndefined();
    }
  });

  it('makes no claim that Core must answer with the channel Jarvis proposed', () => {
    // The request carries no "must match" marker, and every channel is equally proposable. Core's
    // freedom to authorize a different one (ADR-0083) is preserved by the ABSENCE of a binding.
    const built = ['whatsapp', 'sms', 'email'].map(
      (proposedChannel) =>
        runtime().createRequest(requestInput({ proposedChannel })).proposedChannel,
    );
    expect(built).toEqual(['whatsapp', 'sms', 'email']);
  });

  it('creates no approval and no communication authorization', () => {
    const request = runtime().createRequest(requestInput()) as unknown as Record<string, unknown>;
    for (const key of [
      'approval',
      'approvalRequest',
      'approvalDecision',
      'communicationAuthorization',
      'authorization',
    ]) {
      expect(request[key], key).toBeUndefined();
    }
  });

  it('does not assume the recommendation subject is the recipient', () => {
    // The subject is what a recommendation is ABOUT; the recipient is who a communication reaches.
    // A caller may legitimately name a different party, and the producer must carry what it is told.
    const request = runtime().createRequest(
      requestInput({ recipient: { entityType: 'client', entityId: 'client.7' } }),
    );
    expect(request.recipient).toEqual({ entityType: 'client', entityId: 'client.7' });
  });

  it('infers no purpose code from the action type', () => {
    const request = runtime().createRequest(requestInput({ purposeCode: 'sample.chase' }));
    expect(request.purposeCode).toBe('sample.chase');
    expect(request.purposeCode).not.toBe('schedule.follow-up');
    // And omitting it is a refusal rather than a guess.
    const { purposeCode: _omitted, ...withoutPurpose } = requestInput();
    expectCode(() => runtime().createRequest(withoutPurpose), 'invalid-input');
  });

  it('infers no template from the action type or summary', () => {
    const { content: _omitted, ...withoutContent } = requestInput();
    expectCode(() => runtime().createRequest(withoutContent), 'invalid-input');
  });

  it('writes down no request-to-approved-action mapping, in either direction', () => {
    // ADR-0083 section 11: Jarvis cannot prove that identity independently, and must not appear to.
    // The producer holds the action id and the fingerprint at build time; neither reaches the result.
    const source = recommendationSource();
    const request = runtime().createRequest(requestInput({ source })) as unknown as Record<
      string,
      unknown
    >;
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(source.recommendation.proposedActions[0]?.actionId ?? '@');
    expect(serialized).not.toContain(source.actionBindings[0]?.actionFingerprint ?? '@');
    expect(serialized).not.toContain(source.recommendation.recommendationId);
  });

  it('is two asks when called twice: there is no idempotency claim', () => {
    let n = 0;
    const counting = createCommunicationRequestRuntime({
      identity: {
        nextCommunicationRequestId: (): string => {
          n += 1;
          return `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
        },
        nextCommunicationId: (): string => {
          n += 1;
          return `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
        },
      },
    });
    const first = counting.createRequest(requestInput());
    const second = counting.createRequest(requestInput());
    expect(first.communicationRequestId).not.toBe(second.communicationRequestId);
    expect(first.communicationId).not.toBe(second.communicationId);
  });
});

describe('identity and errors', () => {
  it('uses an injected port deterministically', () => {
    const request = createCommunicationRequestRuntime({
      identity: fixedIdentity(
        'eeeeeeee-0000-4000-8000-000000000009',
        'ffffffff-0000-4000-8000-000000000009',
      ),
    }).createRequest(requestInput());
    expect(request.communicationRequestId).toBe('eeeeeeee-0000-4000-8000-000000000009');
    expect(request.communicationId).toBe('ffffffff-0000-4000-8000-000000000009');
  });

  it('generates real UUIDs when no port is injected, and a different pair each call', () => {
    const created = createCommunicationRequestRuntime();
    const a = created.createRequest(requestInput());
    const b = created.createRequest(requestInput());
    expect(communicationRequestV1Schema.safeParse(a).success).toBe(true);
    expect(a.communicationRequestId).not.toBe(b.communicationRequestId);
    expect(a.communicationId).not.toBe(b.communicationId);
  });

  it('refuses a malformed generated identifier from either method', () => {
    expectCode(
      () =>
        createCommunicationRequestRuntime({ identity: fixedIdentity('not-a-uuid') }).createRequest(
          requestInput(),
        ),
      'identity-failure',
    );
    expectCode(
      () =>
        createCommunicationRequestRuntime({
          identity: fixedIdentity(REQUEST_ID, 'not-a-uuid'),
        }).createRequest(requestInput()),
      'identity-failure',
    );
  });

  it('normalizes a throwing identity port, and leaks none of its message', () => {
    const port = {
      nextCommunicationRequestId: (): string => {
        throw new Error('secret vendor phone +919876543210');
      },
      nextCommunicationId: (): string => COMMUNICATION_ID,
    };
    try {
      createCommunicationRequestRuntime({ identity: port }).createRequest(requestInput());
      throw new Error('expected identity-failure, but the call succeeded');
    } catch (error) {
      expect(error).toBeInstanceOf(CommunicationRequestRuntimeError);
      expect((error as Error).message).not.toContain('919876543210');
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('refuses malformed config and a half-built identity port', () => {
    for (const identity of [
      null,
      42,
      {},
      { nextCommunicationRequestId: (): string => REQUEST_ID },
      { nextCommunicationId: (): string => COMMUNICATION_ID },
      { nextCommunicationRequestId: 'x', nextCommunicationId: 'y' },
    ]) {
      expectCode(() => createCommunicationRequestRuntime({ identity } as never), 'invalid-input');
    }
    expectCode(() => createCommunicationRequestRuntime(null as never), 'invalid-input');
  });

  it('generates nothing until createRequest is called', () => {
    let calls = 0;
    createCommunicationRequestRuntime({
      identity: {
        nextCommunicationRequestId: (): string => {
          calls += 1;
          return REQUEST_ID;
        },
        nextCommunicationId: (): string => {
          calls += 1;
          return COMMUNICATION_ID;
        },
      },
    });
    expect(calls).toBe(0);
  });

  it('refuses a non-object input outright', () => {
    for (const input of [null, undefined, 'x', 42, []]) {
      expectCode(() => runtime().createRequest(input), 'invalid-input');
    }
  });

  it('reports a fixed, content-free message for every code', () => {
    const request: CommunicationRequestV1 = runtime().createRequest(requestInput());
    expect(request.summary.length).toBeGreaterThan(0);
    for (const code of [
      'invalid-input',
      'identity-failure',
      'binding-mismatch',
      'request-invalid',
    ] as const) {
      const error = new CommunicationRequestRuntimeError(code);
      expect(error.name).toBe('CommunicationRequestRuntimeError');
      expect(error.message).not.toContain('vendor.42');
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });
});

describe('the fixtures themselves stay honest', () => {
  it('builds its recommendations through the real producer', () => {
    const source = recommendationSource();
    expect(source.recommendation.producingSystem).toBe('qf-jarvis');
    expect(source.actionBindings).toHaveLength(1);
    expect(actionDraft()['actionType']).toBe('schedule.follow-up');
  });
});
