/**
 * QFJ-M3 — strict response-identity validation (ADR-0056 §E, §H).
 *
 * Matrix: a well-formed, exactly-matching response validates; a non-JSON body, a schema violation, and
 * an unknown outcome fail as `adapter-response-invalid`; a wrong protocol, command id, idempotency key,
 * proposal id/version, conversation id, or bound revision fails as `adapter-identity-mismatch`. An
 * `ACCEPTED` therefore requires the exact identity.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_CORE_DECISION_PROTOCOL } from '../contracts/protocol.js';
import { buildCoreCommand } from '../contracts/command.js';
import type { CoreCommand } from '../contracts/command.js';
import { canonicalJson } from '../contracts/digest.js';
import { validateResponse } from '../adapter/validate-response.js';
import { coreRequest } from '../testing/index.js';

const command = buildCoreCommand({
  request: coreRequest(),
  protocol: DEFAULT_CORE_DECISION_PROTOCOL,
  correlationId: 'run.1',
  createdAt: '2026-07-25T00:00:00Z',
});

function response(over: Record<string, unknown> = {}): string {
  return canonicalJson({
    protocol: command.protocol,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    proposalId: command.proposalId,
    proposalVersion: command.proposalVersion,
    conversationId: command.conversationId,
    boundRevision: command.expectedRevision,
    // RWC-P2D (ADR-0096): a conforming responder echoes the digest it was sent.
    proposalDigest: command.proposalDigest,
    outcome: 'ACCEPTED',
    reason: 'core-decided',
    decidedAt: '2026-07-25T00:00:05Z',
    ...over,
  });
}

describe('response validation — accepts an exact match', () => {
  it('validates a well-formed, identity-matching response', () => {
    const result = validateResponse(response(), command);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.outcome).toBe('ACCEPTED');
      expect(Object.isFrozen(result.response)).toBe(true);
    }
  });
});

describe('response validation — malformed input fails closed', () => {
  it('rejects non-JSON', () => {
    const result = validateResponse('}{not json', command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('adapter-response-invalid');
  });

  it('rejects a schema violation (missing field)', () => {
    const result = validateResponse(canonicalJson({ outcome: 'ACCEPTED' }), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('adapter-response-invalid');
  });

  it('rejects an unknown outcome', () => {
    const result = validateResponse(response({ outcome: 'SHIPPED' }), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('adapter-response-invalid');
  });
});

describe('response validation — identity mismatch fails closed', () => {
  const mismatches: Record<string, Record<string, unknown>> = {
    protocol: { protocol: { name: 'other.core', version: 2, contractDigest: 'c0de0002' } },
    commandId: { commandId: 'other-command-r1' },
    idempotencyKey: { idempotencyKey: 'deadbeefdeadbeef' },
    proposalId: { proposalId: 'other.proposal' },
    proposalVersion: { proposalVersion: 2 },
    conversationId: { conversationId: 'other.conv' },
    boundRevision: { boundRevision: 2 },
    // RWC-P2D (ADR-0096). Every OTHER field here is unchanged, so this row isolates exactly the new
    // property: a response about different proposal CONTENT, under a perfect identity match.
    proposalDigest: { proposalDigest: 'deadbeefdeadbeefdeadbeefdeadbeef' },
  };

  for (const [field, over] of Object.entries(mismatches)) {
    it(`rejects a wrong ${field} as an identity mismatch`, () => {
      const result = validateResponse(response(over), command);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('adapter-identity-mismatch');
    });
  }
});

// ---------------------------------------------------------------------------
// The conversation revision domain (QFJ-P08-B3 final review, ADR-0078).
// ---------------------------------------------------------------------------
//
// `boundRevision` is the CONVERSATION REVISION the Core response echoes back, not an authored
// version — and its domain belongs to the durable schema that owns conversation state: migration
// 0008 requires a new state row to start at 0 and permits values through `Number.MAX_SAFE_INTEGER`.
//
// It was validated as an authored `VERSION` (1..1,000,000). That failed LATE and misleadingly: a
// revision-0 conversation passed every gate, drafted, reached Core, received a legitimate `ACCEPTED`
// echoing `boundRevision: 0`, and was then discarded as `CORE_UNAVAILABLE` — a bounds bug wearing
// the costume of a Core outage.

describe('response validation — the conversation revision domain', () => {
  /** A command bound to an arbitrary conversation revision, and its exactly-matching response. */
  function exchange(expectedRevision: number): { command: CoreCommand; body: string } {
    const bound = buildCoreCommand({
      request: coreRequest({ expectedRevision }),
      protocol: DEFAULT_CORE_DECISION_PROTOCOL,
      correlationId: 'run.1',
      createdAt: '2026-07-25T00:00:00Z',
    });
    return {
      command: bound,
      body: canonicalJson({
        protocol: bound.protocol,
        commandId: bound.commandId,
        idempotencyKey: bound.idempotencyKey,
        proposalId: bound.proposalId,
        proposalVersion: bound.proposalVersion,
        conversationId: bound.conversationId,
        boundRevision: bound.expectedRevision,
        proposalDigest: bound.proposalDigest,
        outcome: 'ACCEPTED',
        reason: 'core-decided',
        decidedAt: '2026-07-25T00:00:05Z',
      }),
    };
  }

  it('accepts every revision the durable schema can hold, including 0 and MAX_SAFE_INTEGER', () => {
    for (const revision of [0, 1, 1_000_000, 1_000_001, Number.MAX_SAFE_INTEGER]) {
      const { command: bound, body } = exchange(revision);
      const result = validateResponse(body, bound);
      expect(result.ok, String(revision)).toBe(true);
      if (result.ok) {
        expect(result.response.boundRevision, String(revision)).toBe(revision);
        expect(result.response.outcome).toBe('ACCEPTED');
      }
    }
  });

  it('still refuses a boundRevision no durable row could hold', () => {
    // These arrive structurally in the serialized body, so the SCHEMA is what refuses them --
    // `adapter-response-invalid`, not an identity mismatch.
    for (const boundRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 2]) {
      const result = validateResponse(response({ boundRevision }), command);
      expect(result.ok, String(boundRevision)).toBe(false);
      if (!result.ok) {
        expect(result.reason, String(boundRevision)).toBe('adapter-response-invalid');
      }
    }
    // `NaN` and `Infinity` are not representable in JSON and arrive as `null`; still refused.
    for (const boundRevision of [null, 'one', true]) {
      const result = validateResponse(response({ boundRevision }), command);
      expect(result.ok, String(boundRevision)).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('adapter-response-invalid');
      }
    }
  });

  it('still rejects a response whose boundRevision disagrees with the command', () => {
    // Widening the DOMAIN must not weaken the IDENTITY check: 0 is now a legal revision, so a
    // response claiming 0 against a command bound to 1 must fail as a mismatch rather than pass.
    const result = validateResponse(response({ boundRevision: 0 }), command);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('adapter-identity-mismatch');
    }
  });

  it('leaves the AUTHORED proposalVersion bound exactly where it was', () => {
    // The reason `VERSION` was not simply widened: it also governs `proposalVersion`, which has no
    // version 0 and no version in the millions.
    for (const proposalVersion of [0, 1_000_001, -1, 0.5]) {
      const result = validateResponse(response({ proposalVersion }), command);
      expect(result.ok, String(proposalVersion)).toBe(false);
      if (!result.ok) {
        expect(result.reason, String(proposalVersion)).toBe('adapter-response-invalid');
      }
    }
    // 1 is the command's own version and validates; 1_000_000 is in-domain and fails only on
    // identity, which proves the schema admitted it.
    expect(validateResponse(response({ proposalVersion: 1 }), command).ok).toBe(true);
    const atCeiling = validateResponse(response({ proposalVersion: 1_000_000 }), command);
    expect(atCeiling.ok).toBe(false);
    if (!atCeiling.ok) {
      expect(atCeiling.reason).toBe('adapter-identity-mismatch');
    }
  });
});
