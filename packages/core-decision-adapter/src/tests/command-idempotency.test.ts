/**
 * QFJ-M3 — versioned command + deterministic idempotency (ADR-0056 §C, §D, §G).
 *
 * Matrix: a valid command is frozen, protocol-versioned, and identity-bound; the idempotency key is
 * deterministic and changes when the revision, protocol, or proposal version changes; a wildcard/
 * "latest"/invalid-instant/invalid-correlation input is rejected; a reply body is present only for a
 * REPLY; the serialized command carries no chain-of-thought, secret, or raw provider object.
 */
import { describe, expect, it } from 'vitest';

import type { CoreDecisionProtocol } from '../contracts/protocol.js';
import { DEFAULT_CORE_DECISION_PROTOCOL } from '../contracts/protocol.js';
import { buildCoreCommand, idempotencyKeyFor } from '../contracts/command.js';
import { CoreAdapterError } from '../contracts/errors.js';
import { serializeCommand } from '../transport/core-decision-transport.js';
import { coreCommandResponseSchema } from '../contracts/response.js';
import { coreRequest } from '../testing/index.js';

const protocol = DEFAULT_CORE_DECISION_PROTOCOL;
const createdAt = '2026-07-25T00:00:00Z';

function build(overrides: Parameters<typeof coreRequest>[0] = {}) {
  return buildCoreCommand({
    request: coreRequest(overrides),
    protocol,
    correlationId: 'run.1',
    createdAt,
  });
}

describe('command construction', () => {
  it('builds a frozen, protocol-versioned, identity-bound command', () => {
    const command = build();
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.protocol)).toBe(true);
    expect(command.protocol).toEqual({
      name: 'qfj.core.decision',
      version: 1,
      contractDigest: 'c0de0001',
    });
    expect(command.commandId).toBe('conv.1-conv.1-msg.1-reply-r1');
    expect(command.expectedRevision).toBe(1);
    expect(command.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('includes a reply body only for the kinds that carry client-facing text', () => {
    // QFJ-S3-C-B (ADR-0068): FOLLOW_UP joins REPLY, because a sales follow-up proposal genuinely
    // carries a drafted acknowledgement Core must validate. The other three propose no text at all,
    // so a body arriving with one of them is dropped rather than forwarded.
    expect(build({ proposalKind: 'REPLY' }).proposedReplyBody).toBe('synthetic reply body');
    expect(build({ proposalKind: 'FOLLOW_UP' }).proposedReplyBody).toBe('synthetic reply body');
    expect(build({ proposalKind: 'ESCALATE_TO_HUMAN' }).proposedReplyBody).toBeUndefined();
    expect(build({ proposalKind: 'REQUEST_CLARIFICATION' }).proposedReplyBody).toBeUndefined();
    expect(build({ proposalKind: 'NO_ACTION' }).proposedReplyBody).toBeUndefined();
  });

  it('rejects an invalid protocol, instant, or correlation id', () => {
    const bad = { name: '*', version: 1, contractDigest: 'c0de0001' } as CoreDecisionProtocol;
    expect(() =>
      buildCoreCommand({
        request: coreRequest(),
        protocol: bad,
        correlationId: 'run.1',
        createdAt,
      }),
    ).toThrow(CoreAdapterError);
    expect(() =>
      buildCoreCommand({
        request: coreRequest(),
        protocol,
        correlationId: 'run.1',
        createdAt: 'not-an-instant',
      }),
    ).toThrow(CoreAdapterError);
    expect(() =>
      buildCoreCommand({ request: coreRequest(), protocol, correlationId: 'bad id!', createdAt }),
    ).toThrow(CoreAdapterError);
  });
});

describe('idempotency key determinism', () => {
  const base = {
    protocol,
    proposalId: 'p.1',
    proposalVersion: 1,
    conversationId: 'c.1',
    expectedRevision: 1,
  };

  it('is deterministic for the same identity', () => {
    expect(idempotencyKeyFor(base)).toBe(idempotencyKeyFor({ ...base }));
  });

  it('changes when the revision changes', () => {
    expect(idempotencyKeyFor(base)).not.toBe(idempotencyKeyFor({ ...base, expectedRevision: 2 }));
  });

  it('changes when the proposal version changes', () => {
    expect(idempotencyKeyFor(base)).not.toBe(idempotencyKeyFor({ ...base, proposalVersion: 2 }));
  });

  it('changes when the protocol version changes', () => {
    const other: CoreDecisionProtocol = { ...protocol, version: 2 };
    expect(idempotencyKeyFor(base)).not.toBe(idempotencyKeyFor({ ...base, protocol: other }));
  });

  it('matches the key the command embeds', () => {
    expect(build().idempotencyKey).toBe(
      idempotencyKeyFor({
        protocol,
        proposalId: 'conv.1-msg.1-reply',
        proposalVersion: 1,
        conversationId: 'conv.1',
        expectedRevision: 1,
      }),
    );
  });
});

describe('serialized command privacy', () => {
  it('carries no chain-of-thought, secret, or raw provider object', () => {
    const command = build();
    const wire = serializeCommand(command);
    for (const forbidden of [
      'reasoning',
      'chainOfThought',
      'sk-',
      'apiKey',
      '__proto__',
      'rawResponse',
    ]) {
      expect(wire).not.toContain(forbidden);
    }
    // Round-trips to a plain object with only the safe, content-free fields.
    const parsed = JSON.parse(wire) as Record<string, unknown>;
    expect(parsed['idempotencyKey']).toBe(command.idempotencyKey);
    expect(parsed['expectedRevision']).toBe(1);
  });
});

describe('maximum-length command identity (ADR-0069)', () => {
  const MAX_CONVERSATION = 'c'.repeat(128);
  // A derived proposal id: `proposal.` + 32 hex characters = 41 characters, fixed width.
  const DERIVED_PROPOSAL = `proposal.${'a1b2c3d4'.repeat(4)}`;

  it('a 128-char conversation id plus a derived proposal id stays inside the 256-char commandId bound', () => {
    const command = build({
      conversationId: MAX_CONVERSATION,
      proposalId: DERIVED_PROPOSAL,
      expectedRevision: 1_000_000,
    });
    expect(DERIVED_PROPOSAL).toHaveLength(41);
    expect(command.commandId.length).toBeLessThanOrEqual(256);
    expect(command.commandId).toBe(`${MAX_CONVERSATION}-${DERIVED_PROPOSAL}-r1000000`);
    expect(command.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);

    // The response schema accepts a matching response at that same maximum length.
    const parsed = coreCommandResponseSchema.safeParse({
      protocol: { name: 'qfj.core.decision', version: 1, contractDigest: 'c0de0001' },
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      proposalId: DERIVED_PROPOSAL,
      proposalVersion: 1,
      conversationId: MAX_CONVERSATION,
      boundRevision: 1_000_000,
      outcome: 'ACCEPTED',
      reason: 'core.accepted',
      decidedAt: '2026-07-25T00:00:00Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('identical maximum-length identity is idempotent; a changed field is not', () => {
    const a = build({
      conversationId: MAX_CONVERSATION,
      proposalId: DERIVED_PROPOSAL,
      expectedRevision: 1_000_000,
    });
    const b = build({
      conversationId: MAX_CONVERSATION,
      proposalId: DERIVED_PROPOSAL,
      expectedRevision: 1_000_000,
    });
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
    expect(b.commandId).toBe(a.commandId);

    const c = build({
      conversationId: MAX_CONVERSATION,
      proposalId: DERIVED_PROPOSAL,
      expectedRevision: 999_999,
    });
    expect(c.idempotencyKey).not.toBe(a.idempotencyKey);
  });
});
