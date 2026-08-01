/**
 * QFJ-P08-A — the operations snapshot constructor (ADR-0075).
 *
 * ADR-0054 §L documented the projection fields as a shape with no constructor and no producer.
 * ADR-0075 adds the constructor, because the Jarvis composition root now has a query method that must
 * produce a VALIDATED snapshot rather than an object literal a caller assembled by hand.
 *
 * Two things are under test. First, that the contract stayed content-free while gaining `revision` —
 * the status and audit fields are TOKENS, and free text is the one shape through which a message body
 * or a customer detail would enter a projection that promises it carries neither. Second, that the
 * constructor DERIVES NOTHING: it does not compute `assignedActor`, because `assignAgent` is M1's
 * sole assignment authority and a second place that could decide an actor would be a second router.
 */
import { describe, expect, it } from 'vitest';

import { AgentRuntimeError } from '../contracts/errors.js';
import {
  CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS,
  createConversationOperationsSnapshot,
} from '../contracts/operations-center.js';
import type { ConversationOperationsSnapshotInput } from '../contracts/operations-center.js';

const AT = '2026-08-01T00:00:00.000Z';

function input(
  over: Partial<ConversationOperationsSnapshotInput> = {},
): ConversationOperationsSnapshotInput {
  return {
    conversationId: 'conv.1',
    revision: 3,
    assignedActor: 'RIYA',
    partyType: 'CLIENT',
    conversationState: 'ACTIVE_AI',
    lastActivityAt: AT,
    aiPaused: false,
    humanTakeover: false,
    escalationStatus: 'none',
    followUpStatus: 'none',
    deliveryStatePlaceholder: 'not-implemented',
    auditRef: 'audit.1',
    ...over,
  };
}

describe('the operations snapshot constructor', () => {
  it('accepts the exact twelve fields and returns them unchanged', () => {
    const snapshot = createConversationOperationsSnapshot(input());
    expect(Object.keys(snapshot).sort()).toEqual(
      [...CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS].sort(),
    );
    expect(snapshot.revision).toBe(3);
    expect(snapshot.assignedActor).toBe('RIYA');
    expect(snapshot.lastActivityAt).toBe(AT);
  });

  it('accepts revision zero and the safe-integer ceiling', () => {
    expect(createConversationOperationsSnapshot(input({ revision: 0 })).revision).toBe(0);
    expect(
      createConversationOperationsSnapshot(input({ revision: Number.MAX_SAFE_INTEGER })).revision,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects a negative, fractional or unsafe revision', () => {
    for (const revision of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => createConversationOperationsSnapshot(input({ revision }))).toThrow(
        AgentRuntimeError,
      );
    }
  });

  it('rejects a missing revision', () => {
    const partial = { ...input() } as Record<string, unknown>;
    delete partial['revision'];
    expect(() =>
      createConversationOperationsSnapshot(
        partial as unknown as ConversationOperationsSnapshotInput,
      ),
    ).toThrow(AgentRuntimeError);
  });

  it('enforces the closed actor, party and conversation-state vocabularies', () => {
    expect(() =>
      createConversationOperationsSnapshot(
        input({ assignedActor: 'KABIR' as ConversationOperationsSnapshotInput['assignedActor'] }),
      ),
    ).toThrow(AgentRuntimeError);
    expect(() =>
      createConversationOperationsSnapshot(
        input({ partyType: 'SUPPLIER' as ConversationOperationsSnapshotInput['partyType'] }),
      ),
    ).toThrow(AgentRuntimeError);
    expect(() =>
      createConversationOperationsSnapshot(
        input({
          conversationState: 'PENDING' as ConversationOperationsSnapshotInput['conversationState'],
        }),
      ),
    ).toThrow(AgentRuntimeError);
  });

  it('requires a canonical instant, reusing the existing M1 grammar', () => {
    expect(() => createConversationOperationsSnapshot(input({ lastActivityAt: AT }))).not.toThrow();
    // The M1 contract accepts both second and millisecond precision; ADR-0075 does not change it.
    expect(() =>
      createConversationOperationsSnapshot(input({ lastActivityAt: '2026-08-01T00:00:00Z' })),
    ).not.toThrow();
    for (const value of ['yesterday', '2026-08-01', '2026-08-01T00:00:00+05:30', '']) {
      expect(() => createConversationOperationsSnapshot(input({ lastActivityAt: value }))).toThrow(
        AgentRuntimeError,
      );
    }
  });

  it('rejects free text in every status and audit field', () => {
    const tokens = [
      'escalationStatus',
      'followUpStatus',
      'deliveryStatePlaceholder',
      'auditRef',
      'conversationId',
    ] as const;
    // A value with a space is prose, and prose is how a message body enters a content-free contract.
    for (const field of tokens) {
      for (const value of ['', 'the client sounded upset', 'a'.repeat(129), 'has/slash']) {
        expect(() => createConversationOperationsSnapshot(input({ [field]: value }))).toThrow(
          AgentRuntimeError,
        );
      }
      expect(() =>
        createConversationOperationsSnapshot(input({ [field]: 'a'.repeat(128) })),
      ).not.toThrow();
    }
  });

  it('rejects an unknown key, including one that would smuggle content', () => {
    for (const key of ['messageBody', 'tenantId', 'operatorRef', 'subjectRef', 'dataClass']) {
      expect(() =>
        createConversationOperationsSnapshot({
          ...input(),
          [key]: 'x',
        }),
      ).toThrow(AgentRuntimeError);
    }
  });

  it('rejects a primitive, null, array or prototype-carrying object', () => {
    for (const value of ['x', 7, true, null, undefined, [input()], new Date()]) {
      expect(() =>
        createConversationOperationsSnapshot(
          value as unknown as ConversationOperationsSnapshotInput,
        ),
      ).toThrow(AgentRuntimeError);
    }
    const inherited = Object.create({ revision: 3 }) as Record<string, unknown>;
    Object.assign(inherited, input());
    expect(() =>
      createConversationOperationsSnapshot(
        inherited as unknown as ConversationOperationsSnapshotInput,
      ),
    ).toThrow(AgentRuntimeError);
  });

  it('derives nothing — an inconsistent actor is accepted as supplied, not corrected', () => {
    // `assignAgent` is the sole assignment authority. A constructor that "fixed" the actor here would
    // be a second router, and the two would disagree the first time either changed.
    const snapshot = createConversationOperationsSnapshot(
      input({ assignedActor: 'ANISHA', partyType: 'CLIENT' }),
    );
    expect(snapshot.assignedActor).toBe('ANISHA');
  });

  it('freezes the output and leaves the caller input untouched', () => {
    const supplied = input();
    const snapshot = createConversationOperationsSnapshot(supplied);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(supplied)).toBe(false);
    expect(supplied).toEqual(input());
  });

  it('produces a content-free record', () => {
    const serialized = JSON.stringify(createConversationOperationsSnapshot(input())).toLowerCase();
    for (const forbidden of ['message', 'body', 'prompt', 'reply', 'tenant', 'subject', 'email']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
