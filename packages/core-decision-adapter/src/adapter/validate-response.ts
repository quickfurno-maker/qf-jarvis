/**
 * Strict Core-response validation (QFJ-M3, ADR-0056 §H).
 *
 * Parses the serialized response and checks its identity against the command. Any parse/schema failure
 * → `adapter-response-invalid`; any protocol/command/idempotency/proposal/conversation/revision or
 * proposal-DIGEST mismatch → `adapter-identity-mismatch`. An `ACCEPTED` therefore requires the exact
 * identity AND the exact proposal content (RWC-P2D, ADR-0096). Fails closed and returns no raw error.
 */
import type { CoreCommand } from '../contracts/command.js';
import { coreCommandResponseSchema } from '../contracts/response.js';
import type { CoreCommandResponse } from '../contracts/response.js';

export type ResponseValidation =
  | { readonly ok: true; readonly response: CoreCommandResponse }
  | {
      readonly ok: false;
      readonly reason: 'adapter-response-invalid' | 'adapter-identity-mismatch';
    };

/** Validate a serialized response against the command. Returns the frozen response or a fail reason. */
export function validateResponse(serialized: string, command: CoreCommand): ResponseValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: 'adapter-response-invalid' };
  }
  const result = coreCommandResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: 'adapter-response-invalid' };
  }
  const r = result.data;
  const identityMatches =
    r.protocol.name === command.protocol.name &&
    r.protocol.version === command.protocol.version &&
    r.protocol.contractDigest === command.protocol.contractDigest &&
    r.commandId === command.commandId &&
    r.idempotencyKey === command.idempotencyKey &&
    r.proposalId === command.proposalId &&
    r.proposalVersion === command.proposalVersion &&
    r.conversationId === command.conversationId &&
    r.boundRevision === command.expectedRevision &&
    // RWC-P2D (ADR-0096): the decision must be about this proposal's exact CONTENT, not merely its
    // identity. Identity excludes model output, so without this comparison a stale or cached
    // `ACCEPTED` issued for an earlier body would validate against a command carrying a different
    // one -- and RWC-P2D would then present that different body as Core-authorized.
    r.proposalDigest === command.proposalDigest;
  if (!identityMatches) {
    return { ok: false, reason: 'adapter-identity-mismatch' };
  }
  return {
    ok: true,
    response: Object.freeze({
      protocol: Object.freeze({ ...r.protocol }),
      commandId: r.commandId,
      idempotencyKey: r.idempotencyKey,
      proposalId: r.proposalId,
      proposalVersion: r.proposalVersion,
      conversationId: r.conversationId,
      boundRevision: r.boundRevision,
      proposalDigest: r.proposalDigest,
      outcome: r.outcome,
      reason: r.reason,
      decidedAt: r.decidedAt,
    }),
  };
}
