/**
 * Communication-request identity (QFJ-P08, ADR-0133).
 *
 * INTERNAL. The default port calls `crypto.randomUUID()` at CALL TIME, never at import and never at
 * factory construction. A module that generated an identifier while loading would hand every
 * importing process the same one for its lifetime — and two asks sharing a `communicationId` is how
 * one Core authorization silently answers a question nobody asked, about a communication nobody
 * opened.
 *
 * Whatever a port returns is validated, including the default's. An injected port is untrusted
 * input; so, for these purposes, is the platform.
 */
import { randomUUID } from 'node:crypto';

import { communicationIdSchema, communicationRequestIdSchema } from '@qf-jarvis/contracts';
import type { ZodType } from 'zod';

import { CommunicationRequestRuntimeError } from '../contracts/errors.js';
import type { CommunicationRequestRuntimeIdentityPort } from '../contracts/result.js';

/** The default port. Constructing it generates nothing; only calling it does. */
export function defaultIdentityPort(): CommunicationRequestRuntimeIdentityPort {
  return Object.freeze({
    nextCommunicationRequestId: (): string => randomUUID(),
    nextCommunicationId: (): string => randomUUID(),
  });
}

/**
 * Take one identifier from a port and prove it is a contract UUID.
 *
 * A port that throws and a port that returns nonsense are the same failure to a caller — neither
 * produced a usable identity — so both become `identity-failure`. The port's own error is swallowed:
 * it is foreign, unbounded, and could carry anything, including the very content this package
 * refuses to echo.
 */
function take(take: () => string, schema: ZodType<string>): string {
  let raw: unknown;
  try {
    raw = take();
  } catch {
    throw new CommunicationRequestRuntimeError('identity-failure');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CommunicationRequestRuntimeError('identity-failure');
  }
  return parsed.data;
}

/** The identity of the ASK. */
export function nextCommunicationRequestId(port: CommunicationRequestRuntimeIdentityPort): string {
  return take(() => port.nextCommunicationRequestId(), communicationRequestIdSchema);
}

/** The identity of the governed COMMUNICATION the ask would open. A different thing. */
export function nextCommunicationId(port: CommunicationRequestRuntimeIdentityPort): string {
  return take(() => port.nextCommunicationId(), communicationIdSchema);
}
