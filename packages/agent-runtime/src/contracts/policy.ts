/**
 * The immutable runtime routing policy (QFJ-M1, ADR-0054 §J).
 *
 * A small, versioned policy the deterministic router consults: where an UNKNOWN party is triaged
 * (Jarvis or Human) and the exact policy revision bound into decisions. It carries no rule engine and
 * no model — assignment is a pure function of party type, takeover/pause state, and this policy.
 */
import { z } from 'zod';

import { AgentRuntimeError } from './errors.js';

/** Where an UNKNOWN party is routed for triage. */
export type UnknownRouting = 'JARVIS' | 'HUMAN';

/** One immutable runtime routing policy. */
export interface RuntimePolicy {
  readonly policyRevision: string;
  readonly unknownRouting: UnknownRouting;
}

export interface RuntimePolicyInput {
  readonly policyRevision: string;
  readonly unknownRouting?: UnknownRouting;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const policySchema = z
  .object({
    policyRevision: IDENTIFIER,
    unknownRouting: z.enum(['JARVIS', 'HUMAN']).default('JARVIS'),
  })
  .strict();

/** Validate and freeze a routing policy. Throws `AgentRuntimeError('invalid-context')` on violation. */
export function createRuntimePolicy(input: RuntimePolicyInput): RuntimePolicy {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-context');
  }
  return Object.freeze({
    policyRevision: parsed.data.policyRevision,
    unknownRouting: parsed.data.unknownRouting,
  });
}
