/**
 * QFJ-M1 — contracts, routing, and proposals (ADR-0054 §B–§D, §G, §J).
 *
 * Matrix items 1–6, 15–20, 26: envelope validation/freeze; strict CLIENT→RIYA / VENDOR→ANISHA /
 * UNKNOWN→JARVIS|HUMAN routing; Riya/Anisha cross-scope refusal; deterministic assignment; invalid
 * transitions fail closed; proposals are PENDING_CORE_VALIDATION with no execute/send method; the
 * operations-center projection fields are defined without content.
 */
import { describe, expect, it } from 'vitest';

import { AgentRuntimeError } from '../contracts/errors.js';
import { createInboundEnvelope } from '../contracts/inbound-envelope.js';
import { createProposal } from '../contracts/proposals.js';
import { isValidConversationTransition } from '../contracts/conversation-state.js';
import { CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS } from '../contracts/operations-center.js';
import { PROPOSAL_AUTHORITY_STATUS } from '../contracts/vocabularies.js';
import { assignAgent } from '../router/assign-agent.js';
import { envelopeInput, syntheticPolicy } from '../testing/fixtures.js';

function expectError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected AgentRuntimeError');
  } catch (error) {
    expect(error).toBeInstanceOf(AgentRuntimeError);
    expect((error as AgentRuntimeError).code).toBe(code);
  }
}

describe('inbound envelope', () => {
  it('(1) freezes a valid envelope and rejects invalid id/instant/data class', () => {
    const env = createInboundEnvelope(envelopeInput());
    expect(Object.isFrozen(env)).toBe(true);
    expectError(
      () => createInboundEnvelope(envelopeInput({ conversationId: 'has space' })),
      'invalid-envelope',
    );
    expectError(
      () => createInboundEnvelope(envelopeInput({ receivedAt: '2026-07-25' })),
      'invalid-envelope',
    );
    expectError(
      () => createInboundEnvelope(envelopeInput({ dataClass: 'PUBLIC' as never })),
      'invalid-envelope',
    );
    expectError(
      () => createInboundEnvelope({ ...envelopeInput(), webhookSecret: 'x' } as never),
      'invalid-envelope',
    );
  });
});

describe('deterministic assignment', () => {
  const policy = syntheticPolicy();

  it('(2,3) CLIENT assigns RIYA and VENDOR assigns ANISHA', () => {
    expect(assignAgent('CLIENT', false, policy)).toBe('RIYA');
    expect(assignAgent('VENDOR', false, policy)).toBe('ANISHA');
  });

  it('(4) UNKNOWN routes to JARVIS by default and HUMAN per policy', () => {
    expect(assignAgent('UNKNOWN', false, syntheticPolicy('JARVIS'))).toBe('JARVIS');
    expect(assignAgent('UNKNOWN', false, syntheticPolicy('HUMAN'))).toBe('HUMAN');
  });

  it('a human takeover overrides assignment to HUMAN', () => {
    expect(assignAgent('CLIENT', true, policy)).toBe('HUMAN');
    expect(assignAgent('VENDOR', true, policy)).toBe('HUMAN');
  });

  it('(15,16) assignment is deterministic and never model-based', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(assignAgent('CLIENT', false, policy)).toBe('RIYA');
    }
  });
});

describe('proposals and scope', () => {
  it('(5,6) Riya cannot act on a vendor party and Anisha cannot act on a client party', () => {
    expectError(
      () =>
        createProposal({
          proposalId: 'p1',
          proposalVersion: 1,
          kind: 'REPLY',
          actor: 'RIYA',
          partyType: 'VENDOR',
          conversationId: 'c1',
        }),
      'scope-violation',
    );
    expectError(
      () =>
        createProposal({
          proposalId: 'p2',
          proposalVersion: 1,
          kind: 'REPLY',
          actor: 'ANISHA',
          partyType: 'CLIENT',
          conversationId: 'c1',
        }),
      'scope-violation',
    );
  });

  it('(18,19,20) every proposal is PENDING_CORE_VALIDATION with no execute/send/authorize method', () => {
    for (const kind of [
      'AGENT_ASSIGNMENT',
      'REPLY',
      'FOLLOW_UP',
      'ESCALATION',
      'TOOL_INTENT',
    ] as const) {
      const proposal = createProposal({
        proposalId: `p-${kind}`,
        proposalVersion: 1,
        kind,
        actor: 'JARVIS',
        partyType: 'UNKNOWN',
        conversationId: 'c1',
      });
      expect(proposal.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
      expect(Object.isFrozen(proposal)).toBe(true);
      const asRecord = proposal as unknown as Record<string, unknown>;
      for (const method of ['execute', 'send', 'authorize', 'callN8n', 'commit']) {
        expect(asRecord[method]).toBeUndefined();
      }
    }
  });
});

describe('conversation-state machine', () => {
  it('(17) fails closed on an invalid transition', () => {
    expect(isValidConversationTransition('CLOSED', 'ACTIVE_AI')).toBe(false);
    expect(isValidConversationTransition('NEW', 'WAITING_EXTERNAL')).toBe(false);
    expect(isValidConversationTransition('ACTIVE_AI', 'WAITING_EXTERNAL')).toBe(true);
  });
});

describe('operations-center contract', () => {
  it('(26) defines projection fields without any content field', () => {
    const fields = CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS.join(' ').toLowerCase();
    for (const forbidden of ['content', 'text', 'message', 'subject', 'body', 'prompt']) {
      expect(fields).not.toContain(forbidden);
    }
    expect(CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS).toContain('assignedActor');
    expect(CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS).toContain('humanTakeover');
  });

  it('(26, ADR-0075) carries the authoritative revision, in exact order', () => {
    // The revision is the concurrency token an operator command's `expectedRevision` must present.
    // Without it, a surface that showed a conversation could not build a bound command for it.
    expect([...CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS]).toEqual([
      'conversationId',
      'revision',
      'assignedActor',
      'partyType',
      'conversationState',
      'lastActivityAt',
      'aiPaused',
      'humanTakeover',
      'escalationStatus',
      'followUpStatus',
      'deliveryStatePlaceholder',
      'auditRef',
    ]);
    expect(CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS).toHaveLength(12);
  });

  it('(26, ADR-0075) still names no tenant, subject, operator or business field', () => {
    const fields = CONVERSATION_OPERATIONS_SNAPSHOT_FIELDS.join(' ').toLowerCase();
    for (const forbidden of [
      'tenant',
      'dataclass',
      'cancelled',
      'subjectref',
      'operator',
      'reason',
      'recipient',
      'email',
      'phone',
      'payment',
      'price',
      'approval',
      'consent',
    ]) {
      expect(fields).not.toContain(forbidden);
    }
  });
});
