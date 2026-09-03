/**
 * The versioned generation policy (AS2, ADR-0143).
 *
 * ### Repair is capped at one, and only for transport
 *
 * `maxStructuralRepairAttempts` is bounded to 0 or 1 by the schema, not by convention. The reason is
 * the failure it prevents rather than the cost it saves: a harness that may retry until something
 * passes will, given enough attempts, produce a corpus selected for whatever the gate happens to
 * miss. One repair fixes a model that emitted malformed JSON. It cannot fix a model that wrote a
 * mediocre conversation, and it must not be allowed to try.
 *
 * ### Transport retry and quality rejection are different axes
 *
 * `maxTransientRetries` applies to `TRANSIENT` failures only. A critic rejection, a diversity
 * failure, a privacy finding or a leakage quarantine is an OUTCOME, and re-rolling it here would be
 * the same gate-gaming by another route. A fresh attempt is a new candidate under a new
 * `generationRef`, which AS3 decides to spend — not a silent loop inside one candidate.
 *
 * ### Cross-family critique is a policy switch, not a hard-coded family list
 *
 * `requireCrossFamilyCritique` makes ADR-0143 §9 enforceable without naming a provider anywhere in
 * source. The families come from the config inventory, so the rule survives GPT and Claude being
 * replaced by whatever comes next.
 */
import { z } from 'zod';

import { RiyaSyntheticGenerationError } from './errors.js';

export interface RiyaSyntheticGenerationPolicyV1 {
  readonly version: 1;
  readonly policyRef: string;
  readonly policyVersion: number;
  /** 0 or 1. Structural only — never a second opinion on quality. */
  readonly maxStructuralRepairAttempts: number;
  /** Transport-transient failures only. */
  readonly maxTransientRetries: number;
  readonly perInvocationTimeoutMs: number;
  /** The whole candidate's budget, so a slow conversation cannot run forever turn by turn. */
  readonly candidateTimeoutMs: number;
  readonly maxConcurrentInvocations: number;
  readonly maxConcurrentCandidates: number;
  /** When true, at least one critic must come from a different model family than the teacher. */
  readonly requireCrossFamilyCritique: boolean;
  readonly minCriticsPerCandidate: number;
}

export type RiyaSyntheticGenerationPolicyInput = Omit<
  RiyaSyntheticGenerationPolicyV1,
  'version'
> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const policySchema = z
  .object({
    version: z.literal(1).optional(),
    policyRef: REF,
    policyVersion: z.int().min(1).max(1_000_000),
    // Bounded in the CONTRACT. A policy field somebody could set to 20 is a retry loop waiting for a
    // deadline to justify it.
    maxStructuralRepairAttempts: z.int().min(0).max(1),
    maxTransientRetries: z.int().min(0).max(3),
    // Offline generation is patient, but a hung call is still a hung call.
    perInvocationTimeoutMs: z.int().min(1_000).max(600_000),
    candidateTimeoutMs: z.int().min(1_000).max(3_600_000),
    // Conservative ceilings. This is dataset generation, not live conversation throughput.
    maxConcurrentInvocations: z.int().min(1).max(32),
    maxConcurrentCandidates: z.int().min(1).max(16),
    requireCrossFamilyCritique: z.boolean(),
    minCriticsPerCandidate: z.int().min(1).max(8),
  })
  .strict();

/** Validate and freeze a generation policy. Throws `invalid-generation-policy`. */
export function createRiyaSyntheticGenerationPolicy(
  input: RiyaSyntheticGenerationPolicyInput,
): RiyaSyntheticGenerationPolicyV1 {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('invalid-generation-policy');
  }
  const data = parsed.data;
  // A candidate budget smaller than a single call's budget can never be satisfied; the first
  // invocation would exhaust it and every candidate would time out for a reason nobody could see.
  if (data.candidateTimeoutMs < data.perInvocationTimeoutMs) {
    throw new RiyaSyntheticGenerationError('invalid-generation-policy');
  }
  // Cross-family critique needs at least two critics to be meaningful: with one, "a different family
  // than the teacher" is satisfiable but there is no second opinion to disagree with it.
  if (data.requireCrossFamilyCritique && data.minCriticsPerCandidate < 2) {
    throw new RiyaSyntheticGenerationError('invalid-generation-policy');
  }
  const { version: _supplied, ...fields } = data;
  return Object.freeze({ version: 1 as const, ...fields });
}
