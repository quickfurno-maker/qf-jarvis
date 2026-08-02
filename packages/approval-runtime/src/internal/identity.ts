/**
 * Approval-request identity (QFJ-P08, ADR-0080).
 *
 * INTERNAL. The default port calls `crypto.randomUUID()` at CALL TIME, never at import and never at
 * factory construction. A module that generated an identifier while loading would hand every
 * importing process the same one for its lifetime — and two asks sharing an identifier is how one
 * Core decision silently answers a question nobody asked.
 *
 * Whatever a port returns is validated, including the default's. An injected port is untrusted
 * input; so, for these purposes, is the platform.
 */
import { randomUUID } from 'node:crypto';

import { approvalRequestIdSchema } from '@qf-jarvis/contracts';

import { ApprovalRuntimeError } from '../contracts/errors.js';
import type { ApprovalRuntimeIdentityPort } from '../contracts/result.js';

/** The default port. Constructing it generates nothing; only calling it does. */
export function defaultIdentityPort(): ApprovalRuntimeIdentityPort {
  return Object.freeze({
    nextApprovalRequestId: (): string => randomUUID(),
  });
}

/**
 * Take one approval-request identifier from a port and prove it is a contract UUID.
 *
 * A port that throws and a port that returns nonsense are the same failure to a caller — neither
 * produced a usable identity — so both become `identity-failure`. The port's own error is swallowed:
 * it is foreign, unbounded, and could carry anything.
 */
export function nextApprovalRequestId(port: ApprovalRuntimeIdentityPort): string {
  let raw: unknown;
  try {
    raw = port.nextApprovalRequestId();
  } catch {
    throw new ApprovalRuntimeError('identity-failure');
  }
  const parsed = approvalRequestIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApprovalRuntimeError('identity-failure');
  }
  return parsed.data;
}
