/**
 * Common primitives: identifiers, timestamps, entity references, bounded text.
 */

import { describe, expect, it } from 'vitest';

import {
  actorReferenceSchema,
  AGENT_IDS,
  agentIdSchema,
  boundedText,
  contractVersionSchema,
  entityReferenceSchema,
  eventIdSchema,
  idempotencyKeySchema,
  isAtOrBefore,
  isStrictlyBefore,
  machineTokenSchema,
  RECOMMENDATION_STATES,
  SPECIALIST_AGENT_IDS,
  utcTimestampSchema,
} from '../index.js';

describe('identifiers', () => {
  it.each(['4f6b1e2a-0c3d-4e5f-8a9b-1c2d3e4f5a6b', '5a7c2f3b-1d4e-4f60-9bac-2d3e4f5a6b7c'])(
    'accepts the UUID %s',
    (id) => {
      expect(eventIdSchema.safeParse(id).success).toBe(true);
    },
  );

  it.each([
    ['not a uuid', 'CORE-LEAD-00042'],
    ['an integer', '12345'],
    ['empty', ''],
    ['a number', 42],
    ['null', null],
  ])('refuses %s as a contract-generated identifier', (_label, id) => {
    expect(eventIdSchema.safeParse(id).success).toBe(false);
  });

  it('requires a positive integer contract version', () => {
    expect(contractVersionSchema.safeParse(1).success).toBe(true);
    expect(contractVersionSchema.safeParse(0).success).toBe(false);
    expect(contractVersionSchema.safeParse(-1).success).toBe(false);
    expect(contractVersionSchema.safeParse(1.5).success).toBe(false);
    expect(contractVersionSchema.safeParse('1').success).toBe(false);
  });

  it('requires an idempotency key long enough not to collide', () => {
    expect(idempotencyKeySchema.safeParse('idem-8daf5c6e-4071-4293').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has spaces in it here').success).toBe(false);
  });
});

describe('UTC timestamps', () => {
  it.each(['2026-07-11T09:00:00Z', '2026-07-11T09:00:00.123Z'])('accepts %s', (value) => {
    expect(utcTimestampSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['a local offset', '2026-07-11T09:00:00+05:30'],
    ['no timezone at all', '2026-07-11T09:00:00'],
    ['a date only', '2026-07-11'],
    ['an impossible calendar date', '2026-02-30T00:00:00Z'],
    ['an impossible month', '2026-13-01T00:00:00Z'],
    ['epoch millis', 1783933200000],
  ])('refuses %s', (_label, value) => {
    expect(utcTimestampSchema.safeParse(value).success).toBe(false);
  });

  it('refuses a JavaScript Date, which is not JSON and carries a local interpretation', () => {
    expect(utcTimestampSchema.safeParse(new Date(0)).success).toBe(false);
  });

  it('orders timestamps deterministically, reading no clock', () => {
    expect(isStrictlyBefore('2026-07-11T09:00:00Z', '2026-07-11T09:00:01Z')).toBe(true);
    expect(isStrictlyBefore('2026-07-11T09:00:01Z', '2026-07-11T09:00:00Z')).toBe(false);
    expect(isStrictlyBefore('2026-07-11T09:00:00Z', '2026-07-11T09:00:00Z')).toBe(false);

    expect(isAtOrBefore('2026-07-11T09:00:00Z', '2026-07-11T09:00:00Z')).toBe(true);
  });
});

describe('entity references are opaque', () => {
  it('accepts an opaque Core identifier of any scheme', () => {
    for (const entityId of ['CORE-LEAD-00042', '12345', 'a.b:c-d', 'f47ac10b']) {
      expect(entityReferenceSchema.safeParse({ entityType: 'lead', entityId }).success).toBe(true);
    }
  });

  it('does not assume Core identifiers are UUIDs', () => {
    // The whole point: Core chooses its own identifier scheme, and Phase 2 has not
    // looked at it. Assuming UUID here would be inventing a fact about Core.
    expect(
      entityReferenceSchema.safeParse({ entityType: 'lead', entityId: 'CORE-LEAD-00042' }).success,
    ).toBe(true);
  });

  it.each([
    ['an email address', 'someone@example.invalid'],
    ['an E.164 number', '+919876543210'],
  ])('structurally refuses %s as an entity id', (_label, entityId) => {
    expect(entityReferenceSchema.safeParse({ entityType: 'client', entityId }).success).toBe(false);
  });

  it('refuses extra fields, so a reference cannot become a copy of Core records', () => {
    expect(
      entityReferenceSchema.safeParse({
        entityType: 'client',
        entityId: 'CORE-CLIENT-00311',
        name: 'A Person',
      }).success,
    ).toBe(false);
  });
});

describe('actors', () => {
  it('accepts a human and a versioned policy', () => {
    expect(
      actorReferenceSchema.safeParse({
        actorType: 'human',
        actor: { entityType: 'user', entityId: 'CORE-USER-00007' },
      }).success,
    ).toBe(true);

    expect(
      actorReferenceSchema.safeParse({
        actorType: 'policy',
        policyId: 'low-risk-internal-flag',
        policyVersion: 3,
      }).success,
    ).toBe(true);
  });

  it('has no agent variant, so an agent cannot be an authority', () => {
    expect(actorReferenceSchema.safeParse({ actorType: 'agent', agentId: 'jarvis' }).success).toBe(
      false,
    );
  });
});

describe('agents', () => {
  it('knows exactly the five approved agents', () => {
    expect([...AGENT_IDS].sort()).toStrictEqual(['anisha', 'jarvis', 'jitin', 'kabir', 'riya']);
  });

  it('excludes Jarvis from the specialists: it connects, it does not conclude', () => {
    expect([...SPECIALIST_AGENT_IDS].sort()).toStrictEqual(['anisha', 'jitin', 'kabir', 'riya']);
    expect(SPECIALIST_AGENT_IDS).not.toContain('jarvis');
  });

  it.each(['sofia', 'assistant', 'Kabir', 'gpt'])('refuses the unknown agent %s', (agent) => {
    expect(agentIdSchema.safeParse(agent).success).toBe(false);
  });
});

describe('bounded text and machine tokens', () => {
  const text = boundedText(20);

  it('accepts ordinary text within bounds', () => {
    expect(text.safeParse('A short sentence.').success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['padded', ' padded '],
    ['too long', 'x'.repeat(21)],
  ])('refuses %s text', (_label, value) => {
    expect(text.safeParse(value).success).toBe(false);
  });

  it('refuses control characters', () => {
    // Built from code points so that this source file contains none of its own.
    const withNul = `a${String.fromCharCode(0)}b`;
    const withBell = `a${String.fromCharCode(7)}b`;
    const withC1 = `a${String.fromCharCode(0x85)}b`;

    expect(text.safeParse(withNul).success).toBe(false);
    expect(text.safeParse(withBell).success).toBe(false);
    expect(text.safeParse(withC1).success).toBe(false);
  });

  it.each(['lead.budget-implausible', 'recipient-opted-out', 'a1'])(
    'accepts the machine token %s',
    (token) => {
      expect(machineTokenSchema.safeParse(token).success).toBe(true);
    },
  );

  it.each(['Lead.Budget', 'has spaces', 'trailing-', '.leading', 'under_score'])(
    'refuses the unstable token %s',
    (token) => {
      expect(machineTokenSchema.safeParse(token).success).toBe(false);
    },
  );
});

describe('the recommendation lifecycle states', () => {
  it('is exactly the approved fourteen, in order', () => {
    expect([...RECOMMENDATION_STATES]).toStrictEqual([
      'received',
      'validated',
      'routed',
      'analyzed',
      'recommended',
      'awaiting-approval',
      'approved',
      'rejected',
      'changes-requested',
      'expired',
      'converted-to-execution-intent',
      'executed',
      'result-received',
      'closed',
    ]);
  });

  it('has no auto-approved state: there is no timeout-to-yes anywhere in this system', () => {
    expect(RECOMMENDATION_STATES).not.toContain('auto-approved');
    expect(RECOMMENDATION_STATES).not.toContain('timed-out');
  });
});
