/**
 * The eighteen communication states — exactly eighteen, exactly these.
 */

import { describe, expect, it } from 'vitest';

import {
  cloneFixture,
  validCommunicationDelivered,
  validCommunicationDraft,
  validCommunicationRejectedOptOut,
} from '../fixtures/index.js';
import {
  COMMUNICATION_REJECTION_REASONS,
  COMMUNICATION_STATE_COUNT,
  COMMUNICATION_STATE_LABELS,
  COMMUNICATION_STATES,
  communicationStateSchema,
  safeParseCommunicationStateRecord,
  STATES_JARVIS_MAY_NOT_ORIGINATE,
} from '../index.js';

/** Verbatim from docs/architecture/communication-model.md, in document order. */
const AUTHORITATIVE_EIGHTEEN = [
  'draft',
  'authorization-requested',
  'rejected',
  'authorized',
  'scheduled',
  'execution-submitted',
  'provider-accepted',
  'delivered',
  'read',
  'answered',
  'no-answer',
  'busy',
  'failed',
  'follow-up-requested',
  'human-handoff-required',
  'completed',
  'cancelled',
  'expired',
];

describe('the eighteen states', () => {
  it('is exactly eighteen', () => {
    expect(COMMUNICATION_STATES).toHaveLength(COMMUNICATION_STATE_COUNT);
    expect(COMMUNICATION_STATE_COUNT).toBe(18);
  });

  it('matches the authoritative list exactly, in order', () => {
    expect([...COMMUNICATION_STATES]).toStrictEqual(AUTHORITATIVE_EIGHTEEN);
  });

  it('has a display label for every state', () => {
    for (const state of COMMUNICATION_STATES) {
      expect(COMMUNICATION_STATE_LABELS[state]).toBeTruthy();
    }
    expect(Object.keys(COMMUNICATION_STATE_LABELS)).toHaveLength(18);
  });

  it.each(AUTHORITATIVE_EIGHTEEN)('accepts the state %s', (state) => {
    expect(communicationStateSchema.safeParse(state).success).toBe(true);
  });

  it.each([
    'opted-out',
    'sent',
    'pending',
    'auto-approved',
    'delivered-maybe',
    'unknown',
    'Draft',
    'DELIVERED',
  ])('refuses %s, which is not one of the eighteen', (state) => {
    expect(communicationStateSchema.safeParse(state).success).toBe(false);
  });

  it('names the three states Jarvis may never originate', () => {
    expect([...STATES_JARVIS_MAY_NOT_ORIGINATE].sort()).toStrictEqual([
      'authorized',
      'completed',
      'delivered',
    ]);
  });
});

describe('opt-out is a rejection with a reason, not a nineteenth state', () => {
  it('has no opted-out state', () => {
    expect(COMMUNICATION_STATES).not.toContain('opted-out');
  });

  it('represents an opt-out as rejected plus a machine-readable reason', () => {
    const record = cloneFixture(validCommunicationRejectedOptOut);

    const result = safeParseCommunicationStateRecord(record);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.state).toBe('rejected');
      expect(result.data.reasonCode).toBe(COMMUNICATION_REJECTION_REASONS.optedOut);
      // A refusal is a decision Core made and recorded. It must be pointable-at.
      expect(result.data.approvalDecisionId).toBeDefined();
    }
  });
});

describe('a state only becomes authoritative when Core has the record to prove it', () => {
  it.each(['delivered', 'read', 'answered', 'no-answer', 'busy', 'failed'])(
    'refuses %s without a Core-recorded execution result',
    (state) => {
      const forged = { ...cloneFixture(validCommunicationDraft), state };
      expect(safeParseCommunicationStateRecord(forged).success).toBe(false);
    },
  );

  it.each(['rejected', 'authorized', 'scheduled'])(
    'refuses %s without a Core approval decision',
    (state) => {
      const forged = { ...cloneFixture(validCommunicationDraft), state };
      expect(safeParseCommunicationStateRecord(forged).success).toBe(false);
    },
  );

  it.each(['execution-submitted', 'provider-accepted'])(
    'refuses %s without a Core-issued execution intent',
    (state) => {
      const forged = { ...cloneFixture(validCommunicationDraft), state };
      expect(safeParseCommunicationStateRecord(forged).success).toBe(false);
    },
  );

  it('accepts delivered when Core recorded the result', () => {
    expect(
      safeParseCommunicationStateRecord(cloneFixture(validCommunicationDelivered)).success,
    ).toBe(true);
  });

  it('accepts a draft, which asks nothing of anyone', () => {
    expect(safeParseCommunicationStateRecord(cloneFixture(validCommunicationDraft)).success).toBe(
      true,
    );
  });
});

describe('the recipient is a reference, never a person', () => {
  it.each([
    ['an E.164 phone number', '+919876543210'],
    ['an email address', 'someone@example.invalid'],
  ])('refuses %s as an entity id', (_label, entityId) => {
    const forged = {
      ...cloneFixture(validCommunicationDraft),
      recipient: { entityType: 'client', entityId },
    };

    expect(safeParseCommunicationStateRecord(forged).success).toBe(false);
  });

  it('accepts a purely numeric entity id — and this is the limit of the structural check', () => {
    // Stated honestly rather than over-claimed. The entity-id character set
    // excludes "@" and "+", so an email address and an E.164 number cannot parse.
    // A *bare* digit run cannot be excluded, because QuickFurno Core owns its own
    // identifier scheme and may legitimately use numeric ids — assuming otherwise
    // would be inventing a fact about a system Phase 2 has not integrated with.
    //
    // The real control is not this regex. It is that `recipient` is a *reference*:
    // Core resolves the actual contact from its own records, against consent it
    // owns, at execution time. A reference that resolves to nothing is refused by
    // Core; it is not dialled.
    const numeric = {
      ...cloneFixture(validCommunicationDraft),
      recipient: { entityType: 'client', entityId: '919876543210' },
    };

    expect(safeParseCommunicationStateRecord(numeric).success).toBe(true);
  });

  it('refuses contact details attached beside the reference', () => {
    const forged = {
      ...cloneFixture(validCommunicationDraft),
      recipient: {
        entityType: 'client',
        entityId: 'CORE-CLIENT-00311',
        phoneNumber: '+919876543210',
      },
    };

    expect(safeParseCommunicationStateRecord(forged).success).toBe(false);
  });

  it('refuses a consent boolean copied from Core', () => {
    const forged = { ...cloneFixture(validCommunicationDraft), hasConsent: true };
    expect(safeParseCommunicationStateRecord(forged).success).toBe(false);
  });
});
