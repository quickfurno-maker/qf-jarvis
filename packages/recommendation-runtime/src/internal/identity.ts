/**
 * Identity generation (QFJ-P05.05, ADR-0079).
 *
 * INTERNAL. The default port calls `crypto.randomUUID()` at CALL TIME, never at import and never at
 * construction. A module that generated an identifier while being loaded would give every process
 * that imported it the same value for the life of the process — and an identifier that repeats is
 * one that lets two different recommendations share an approval decision.
 *
 * Whatever a port returns is validated against the contract UUID schema before use, including the
 * default's. An injected port is untrusted input; so, for these purposes, is the platform.
 */
import { randomUUID } from 'node:crypto';

import { actionIdSchema, recommendationIdSchema } from '@qf-jarvis/contracts';

import { RecommendationRuntimeError } from '../contracts/errors.js';
import type { RecommendationRuntimeIdentityPort } from '../contracts/result.js';

/** The default port. Constructing it generates nothing; only calling it does. */
export function defaultIdentityPort(): RecommendationRuntimeIdentityPort {
  return Object.freeze({
    nextRecommendationId: (): string => randomUUID(),
    nextActionId: (): string => randomUUID(),
  });
}

/**
 * Take one identifier from a port and prove it is a contract UUID.
 *
 * A port that throws and a port that returns nonsense are the same failure to a caller — neither
 * produced a usable identity — so both become `identity-failure`. The port's own error is
 * swallowed: it is foreign, unbounded, and could carry anything.
 */
function takeIdentifier(
  next: () => string,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
): string {
  let raw: unknown;
  try {
    raw = next();
  } catch {
    throw new RecommendationRuntimeError('identity-failure');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || typeof parsed.data !== 'string') {
    throw new RecommendationRuntimeError('identity-failure');
  }
  return parsed.data;
}

export function nextRecommendationId(port: RecommendationRuntimeIdentityPort): string {
  return takeIdentifier(() => port.nextRecommendationId(), recommendationIdSchema);
}

export function nextActionId(port: RecommendationRuntimeIdentityPort): string {
  return takeIdentifier(() => port.nextActionId(), actionIdSchema);
}
