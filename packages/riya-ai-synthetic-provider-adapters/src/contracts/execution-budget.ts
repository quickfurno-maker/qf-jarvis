/**
 * The versioned execution budget (AS3A, ADR-0143 §12).
 *
 * ### There is no "generate everything" command, and the budget is why
 *
 * Every ceiling here is a HARD control, checked before a request leaves rather than reported after it
 * returns. The distinction is the whole point: a budget that is only measured tells you what you
 * spent; a budget that is enforced decides what you spend.
 *
 * ### Tokens and requests, deliberately not dollars
 *
 * A dollar ceiling is the obvious design and the wrong primary one. Prices change, they differ per
 * model and per token direction, and a stored price becomes a lie the moment a provider republishes
 * its rate card — at which point the guard is silently wrong in whichever direction the change went.
 * Requests and tokens are things this repository can COUNT, exactly, at the moment of spending. A
 * money estimate belongs in a report a human reads, not in the control that stops the run.
 *
 * ### Concurrency is here as well as in the generation policy
 *
 * Not duplication. AS2's policy bounds concurrency for correctness of the harness; the budget bounds
 * it for a run that costs money, and a pilot routinely wants to sit far below what the policy would
 * permit. The executor takes the MINIMUM of the two, so neither can widen the other.
 */
import { z } from 'zod';

import { RiyaSyntheticPilotError } from './pilot-errors.js';

export interface RiyaSyntheticExecutionBudgetV1 {
  readonly version: 1;
  readonly budgetRef: string;
  /** How many candidates this run may ATTEMPT, whatever the plan schedules. */
  readonly maxCandidates: number;
  /** Every provider round trip, of every role. The count a bill is proportional to. */
  readonly maxProviderRequests: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  /** Checked alongside the two directional ceilings, never instead of them. */
  readonly maxTotalTokens: number;
  readonly maxWallClockMs: number;
  readonly maxConcurrentCandidates: number;
  readonly maxConcurrentInvocations: number;
  /** An invalid key must not be re-learned once per candidate. */
  readonly stopOnProviderAuthFailure: boolean;
  readonly stopOnBudgetExhaustion: boolean;
}

export type RiyaSyntheticExecutionBudgetInput = Omit<RiyaSyntheticExecutionBudgetV1, 'version'> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const budgetSchema = z
  .object({
    version: z.literal(1).optional(),
    budgetRef: REF,
    // A PILOT ceiling, not a corpus ceiling. AS3C raises this deliberately, in its own reviewed
    // change; a limit nobody had to argue for is how "just this once" becomes ten thousand calls.
    maxCandidates: z.int().min(1).max(2_000),
    maxProviderRequests: z.int().min(1).max(100_000),
    maxInputTokens: z.int().min(1).max(1_000_000_000),
    maxOutputTokens: z.int().min(1).max(1_000_000_000),
    maxTotalTokens: z.int().min(1).max(2_000_000_000),
    // Ten minutes to twelve hours. A run with no wall-clock ceiling is one nobody is watching.
    maxWallClockMs: z.int().min(600_000).max(43_200_000),
    maxConcurrentCandidates: z.int().min(1).max(16),
    maxConcurrentInvocations: z.int().min(1).max(32),
    stopOnProviderAuthFailure: z.boolean(),
    stopOnBudgetExhaustion: z.boolean(),
  })
  .strict();

/**
 * Validate and freeze an execution budget. Throws `invalid-execution-budget`.
 *
 * The two stop flags must both be true. They are recorded FIELDS so a run manifest can show the run
 * was governed by them — not switches a caller may turn off. A pilot that continued through an auth
 * failure would make the same doomed call once per candidate, and one that continued past its
 * ceiling would not have a ceiling.
 */
export function createRiyaSyntheticExecutionBudget(
  input: RiyaSyntheticExecutionBudgetInput,
): RiyaSyntheticExecutionBudgetV1 {
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticPilotError('invalid-execution-budget');
  }
  const data = parsed.data;

  if (!data.stopOnProviderAuthFailure || !data.stopOnBudgetExhaustion) {
    throw new RiyaSyntheticPilotError('invalid-execution-budget');
  }
  // A total below either direction cannot bind: the directional ceiling would always be reached
  // first, and the field would describe a control that never fires.
  if (data.maxTotalTokens < data.maxInputTokens || data.maxTotalTokens < data.maxOutputTokens) {
    throw new RiyaSyntheticPilotError('invalid-execution-budget');
  }
  // One candidate needs several requests — customer turns, teacher turns, a verifier pass and at
  // least two critics. A budget permitting fewer requests than candidates cannot finish even one.
  if (data.maxProviderRequests < data.maxCandidates) {
    throw new RiyaSyntheticPilotError('invalid-execution-budget');
  }

  const { version: _supplied, ...fields } = data;
  return Object.freeze({ version: 1 as const, ...fields });
}
