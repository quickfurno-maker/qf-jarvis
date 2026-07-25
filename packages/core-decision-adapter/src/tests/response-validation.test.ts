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
    protocol: { protocol: { name: 'other.core', version: 1, contractDigest: 'c0de0001' } },
    commandId: { commandId: 'other-command-r1' },
    idempotencyKey: { idempotencyKey: 'deadbeefdeadbeef' },
    proposalId: { proposalId: 'other.proposal' },
    proposalVersion: { proposalVersion: 2 },
    conversationId: { conversationId: 'other.conv' },
    boundRevision: { boundRevision: 2 },
  };

  for (const [field, over] of Object.entries(mismatches)) {
    it(`rejects a wrong ${field} as an identity mismatch`, () => {
      const result = validateResponse(response(over), command);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('adapter-identity-mismatch');
    });
  }
});
