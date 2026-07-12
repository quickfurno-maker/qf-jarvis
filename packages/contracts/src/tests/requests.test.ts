/**
 * Requests: Jarvis asking, and structurally unable to answer.
 *
 * Three separations are asserted here, and each one is load-bearing:
 *
 * 1. **A request is not a decision.** An approval request carries no outcome, and there is
 *    no field in which one could be written.
 * 2. **A timeout is not an approval.** An unanswered request *expires*. Silence is never
 *    consent.
 * 3. **A communication request is not an authorization, and an authorization is not a
 *    delivery.** Three separate contracts, and the schema refuses to let any of them
 *    impersonate the next.
 */

import { describe, expect, it } from 'vitest';

import {
  APPROVAL_LEVELS,
  COMMUNICATION_REFUSAL_REASONS,
  safeParseApprovalRequest,
  safeParseCommunicationAuthorization,
  safeParseCommunicationRequest,
  safeParseCommunicationResult,
} from '../index.js';
import {
  cloneFixture,
  validApprovalRequest,
  validCommunicationAuthorization,
  validCommunicationAuthorizationOptedOut,
  validCommunicationRequest,
  validCommunicationRequestVoice,
  validCommunicationResultDelivered,
} from '../fixtures/index.js';

describe('an approval request has no authority, and cannot be given any', () => {
  it('accepts an honest request', () => {
    expect(safeParseApprovalRequest(cloneFixture(validApprovalRequest)).success).toBe(true);
  });

  it.each(['outcome', 'approved', 'authorized', 'decision', 'decidedBy', 'decidedAt'])(
    'refuses a request carrying "%s"',
    (field) => {
      // Strict object. If any of these parsed, Jarvis could approve its own recommendation
      // by adding a field to it.
      const request = { ...cloneFixture(validApprovalRequest), [field]: 'approved' };
      expect(safeParseApprovalRequest(request).success).toBe(false);
    },
  );

  it('refuses a request produced by QuickFurno Core', () => {
    const request = { ...cloneFixture(validApprovalRequest), producingSystem: 'quickfurno-core' };
    expect(safeParseApprovalRequest(request).success).toBe(false);
  });

  it('carries no execution field — it cannot be mistaken for an intent', () => {
    const request = {
      ...cloneFixture(validApprovalRequest),
      idempotencyKey: 'SYNTHETIC-IDEMPOTENCY-KEY-0001',
    };
    expect(safeParseApprovalRequest(request).success).toBe(false);
  });
});

describe('a timeout is never an approval', () => {
  it('requires an expiry', () => {
    const request = cloneFixture(validApprovalRequest);
    const { expiresAt: _removed, ...withoutExpiry } = request;

    expect(safeParseApprovalRequest(withoutExpiry).success).toBe(false);
  });

  it('has no field in which a timeout could grant approval', () => {
    const result = safeParseApprovalRequest(cloneFixture(validApprovalRequest));

    expect(result.success).toBe(true);
    if (result.success) {
      // An unanswered request dies. It does not ripen.
      expect(result.data).not.toHaveProperty('approveOnTimeout');
      expect(result.data).not.toHaveProperty('autoApproveAfter');
      expect(result.data).not.toHaveProperty('defaultOutcome');
    }
  });

  it.each(['approveOnTimeout', 'autoApproveAfter', 'defaultOutcome', 'timeoutAction'])(
    'refuses "%s"',
    (field) => {
      const request = { ...cloneFixture(validApprovalRequest), [field]: 'approved' };
      expect(safeParseApprovalRequest(request).success).toBe(false);
    },
  );

  it('refuses an expiry that precedes creation', () => {
    const request = { ...cloneFixture(validApprovalRequest), expiresAt: '2026-07-11T08:00:00Z' };
    expect(safeParseApprovalRequest(request).success).toBe(false);
  });
});

describe('the requested authority is a floor, and money escalates', () => {
  it('refuses a request that asks for no approval at all', () => {
    const request = { ...cloneFixture(validApprovalRequest), requestedAuthority: 'none' };
    expect(safeParseApprovalRequest(request).success).toBe(false);
  });

  it.each(APPROVAL_LEVELS.filter((level) => level !== 'stronger-approval' && level !== 'founder'))(
    'refuses a money-related request asking only for "%s"',
    (requestedAuthority) => {
      const request = {
        ...cloneFixture(validApprovalRequest),
        risk: 'money-related',
        requestedAuthority,
      };
      expect(safeParseApprovalRequest(request).success).toBe(false);
    },
  );

  it.each(['stronger-approval', 'founder'])(
    'accepts a money-related request asking for "%s"',
    (requestedAuthority) => {
      const request = {
        ...cloneFixture(validApprovalRequest),
        risk: 'money-related',
        requestedAuthority,
      };
      expect(safeParseApprovalRequest(request).success).toBe(true);
    },
  );

  it('refuses an outbound voice call that does not ask for an explicit human', () => {
    const request = {
      ...cloneFixture(validApprovalRequest),
      risk: 'outbound-voice-call',
      requestedAuthority: 'delegated-approver',
    };
    expect(safeParseApprovalRequest(request).success).toBe(false);
  });
});

describe('a communication request is not an authorization', () => {
  it('accepts an honest request', () => {
    expect(safeParseCommunicationRequest(cloneFixture(validCommunicationRequest)).success).toBe(
      true,
    );
  });

  it.each(['hasConsent', 'optedIn', 'withinQuietHours', 'suppressed', 'doNotContact'])(
    'refuses a request that copies Core consent state as "%s"',
    (field) => {
      // A stale copy of a permission is the most dangerous field in any system that reaches
      // real people. Unknown or stale consent is not permission.
      const request = { ...cloneFixture(validCommunicationRequest), [field]: true };
      expect(safeParseCommunicationRequest(request).success).toBe(false);
    },
  );

  it.each(['delivered', 'sent', 'sentAt', 'status', 'providerReference'])(
    'refuses a request that claims delivery via "%s"',
    (field) => {
      const request = { ...cloneFixture(validCommunicationRequest), [field]: 'yes' };
      expect(safeParseCommunicationRequest(request).success).toBe(false);
    },
  );

  it('refuses a phone number as the recipient', () => {
    const request = {
      ...cloneFixture(validCommunicationRequest),
      recipient: { entityType: 'client', entityId: '+919876543210' },
    };
    expect(safeParseCommunicationRequest(request).success).toBe(false);
  });

  it('refuses an email address as the recipient', () => {
    const request = {
      ...cloneFixture(validCommunicationRequest),
      recipient: { entityType: 'client', entityId: 'someone@example.com' },
    };
    expect(safeParseCommunicationRequest(request).success).toBe(false);
  });

  it('refuses a communication that requires no approval', () => {
    const request = { ...cloneFixture(validCommunicationRequest), requiredApproval: 'none' };
    expect(safeParseCommunicationRequest(request).success).toBe(false);
  });

  it('requires explicit human approval on every voice call', () => {
    expect(
      safeParseCommunicationRequest(cloneFixture(validCommunicationRequestVoice)).success,
    ).toBe(true);

    const weaker = {
      ...cloneFixture(validCommunicationRequestVoice),
      requiredApproval: 'delegated-approver',
    };
    expect(safeParseCommunicationRequest(weaker).success).toBe(false);
  });

  it('requires a voice call to be spoken from an approved script, not a message template', () => {
    const request = {
      ...cloneFixture(validCommunicationRequestVoice),
      content: { contentType: 'template', templateId: 'client.follow-up', templateVersion: 2 },
    };
    expect(safeParseCommunicationRequest(request).success).toBe(false);
  });
});

describe('the consent boundary: Core decides, and a refusal is provable', () => {
  it('names the refusals that must be individually countable', () => {
    expect([...COMMUNICATION_REFUSAL_REASONS]).toContain('recipient-opted-out');
    expect([...COMMUNICATION_REFUSAL_REASONS]).toContain('consent-withdrawn');
    expect([...COMMUNICATION_REFUSAL_REASONS]).toContain('do-not-contact');
    expect([...COMMUNICATION_REFUSAL_REASONS]).toContain('suppressed');
    expect([...COMMUNICATION_REFUSAL_REASONS]).toContain('stop-received');
  });

  it('records an opt-out as a rejection with a reason, not as a nineteenth state', () => {
    const result = safeParseCommunicationAuthorization(
      cloneFixture(validCommunicationAuthorizationOptedOut),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outcome).toBe('rejected');
      expect(result.data.reasonCode).toBe('recipient-opted-out');
    }
  });

  it('refuses an authorization that rests on no human approval', () => {
    // Eligibility is not approval. A communication needs both, and a founder's approval
    // does not override an opt-out.
    const authorization = cloneFixture(validCommunicationAuthorization);
    const { approvalDecisionId: _removed, ...withoutApproval } = authorization;

    expect(safeParseCommunicationAuthorization(withoutApproval).success).toBe(false);
  });

  it('refuses an authorization issued by Jarvis', () => {
    const authorization = { ...cloneFixture(validCommunicationAuthorization), issuer: 'qf-jarvis' };
    expect(safeParseCommunicationAuthorization(authorization).success).toBe(false);
  });

  it('carries no consent snapshot that could travel forward in time', () => {
    const result = safeParseCommunicationAuthorization(
      cloneFixture(validCommunicationAuthorization),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      // A consent snapshot with a future expiry is precisely the stale permission that lets
      // a withdrawn consent be ignored. The runtime re-validates at execution time.
      expect(result.data).not.toHaveProperty('validUntil');
      expect(result.data).not.toHaveProperty('consentSnapshot');
    }
  });
});

describe('a communication result is QuickFurno Core’s truth', () => {
  it('accepts a delivered result', () => {
    expect(
      safeParseCommunicationResult(cloneFixture(validCommunicationResultDelivered)).success,
    ).toBe(true);
  });

  it('refuses a result issued by anyone but Core', () => {
    for (const issuer of ['qf-jarvis', 'n8n', 'qf-communications-runtime']) {
      const result = { ...cloneFixture(validCommunicationResultDelivered), issuer };
      expect(safeParseCommunicationResult(result).success).toBe(false);
    }
  });

  it('refuses "provider-accepted" recorded as a success', () => {
    // Provider accepted is not delivered. This is the collapse that shows a founder one
    // confident tick and lets them believe a conversation happened.
    const result = {
      ...cloneFixture(validCommunicationResultDelivered),
      lifecycleState: 'provider-accepted',
    };
    expect(safeParseCommunicationResult(result).success).toBe(false);
  });

  it('refuses "execution-submitted" recorded as a success', () => {
    const result = {
      ...cloneFixture(validCommunicationResultDelivered),
      lifecycleState: 'execution-submitted',
    };
    expect(safeParseCommunicationResult(result).success).toBe(false);
  });

  it('refuses an indeterminate outcome claimed as delivered', () => {
    const result = {
      ...cloneFixture(validCommunicationResultDelivered),
      outcome: 'indeterminate',
      failure: {
        failureCode: 'timeout',
        failureCategory: 'ambiguous',
        retryClassification: 'requires-reconciliation',
      },
    };
    expect(safeParseCommunicationResult(result).success).toBe(false);
  });

  it('refuses an indeterminate outcome marked retryable', () => {
    // An ambiguous outcome is reconciled, never retried. A retry here dials a real person
    // for the second time on one decision.
    const result = {
      ...cloneFixture(validCommunicationResultDelivered),
      lifecycleState: 'failed',
      outcome: 'indeterminate',
      failure: {
        failureCode: 'timeout',
        failureCategory: 'ambiguous',
        retryClassification: 'retryable',
      },
    };
    expect(safeParseCommunicationResult(result).success).toBe(false);
  });

  it.each(['transcript', 'recording', 'body', 'rawPayload', 'providerPayload'])(
    'refuses a result carrying "%s"',
    (field) => {
      const result = { ...cloneFixture(validCommunicationResultDelivered), [field]: 'content' };
      expect(safeParseCommunicationResult(result).success).toBe(false);
    },
  );
});
