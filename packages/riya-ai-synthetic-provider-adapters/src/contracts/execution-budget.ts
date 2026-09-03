/**
 * The versioned execution budget (AS3A, ADR-0143 §12).
 *
 * ### There is no "generate everything" command, and the budget is why
 *
 * A budget that is only measured tells you what you spent; a budget that is enforced decides what
 * you spend. This contract carries both kinds, and the field names say which is which — because the
 * first review of AS3A found the two silently merged, and a threshold described as a ceiling is worse
 * than no ceiling at all: somebody plans against it.
 *
 * ### HARD controls — impossible to exceed by construction
 *
 * `maxCandidates`, `maxProviderRequests`, `maxRequestInputUtf8Bytes`, `maxReservedOutputTokens`,
 * `maxWallClockMs` and the two concurrency limits. Each is checked against a quantity this repository
 * KNOWS before anything is spent: a count it keeps, bytes it just serialized, a reservation it holds,
 * or a deadline it armed. None of them depends on a number a provider will report later.
 *
 * The output ceiling is expressed as a RESERVATION rather than as a total, and that is what makes it
 * hard under concurrency. `maxOutputTokens` on an invocation is a ceiling the provider itself
 * enforces, so reserving it before the call bounds the exposure of every in-flight request at once.
 * Reserving after the fact, or checking a running total, would let N concurrent calls each pass the
 * same check and collectively blow through it.
 *
 * ### OBSERVED thresholds — a stop signal, with bounded overshoot
 *
 * `maxObservedInputTokens`, `maxObservedOutputTokens` and `maxObservedTotalTokens` are compared
 * against what providers REPORTED for calls that already completed. They stop the run; they cannot
 * prevent the call that crosses them, and under concurrency several in-flight calls may report at
 * once. The overshoot is bounded by the hard controls above — at most
 * `maxConcurrentInvocations × maxOutputTokens` of output beyond the line, and the reservation ceiling
 * bounds it again.
 *
 * They are named `maxObserved…` for exactly that reason. Claiming a provider-reported total is
 * impossible to exceed would require pre-tokenizing every request with each provider's own
 * tokenizer, which is a second implementation of somebody else's counting rules — wrong the day
 * either changes, and wrong silently.
 *
 * ### Bytes and requests, deliberately not dollars
 *
 * Prices change, differ per model and per direction, and a stored price becomes a lie the moment a
 * provider republishes its rate card. Requests, bytes and reservations are things this repository can
 * count exactly at the moment of spending. A money estimate belongs in a report a human reads.
 *
 * ### Concurrency is here as well as in the generation policy
 *
 * AS2's policy bounds concurrency for correctness of the harness; the budget bounds it for a run that
 * costs money. The executor takes the MINIMUM of the two, so neither can widen the other.
 */
import { z } from 'zod';

import { RiyaSyntheticPilotError } from './pilot-errors.js';

export interface RiyaSyntheticExecutionBudgetV1 {
  readonly version: 1;
  readonly budgetRef: string;

  // ---- HARD controls -------------------------------------------------------------------------
  /** How many candidates this run may ATTEMPT. Enforced by truncating the schedule in preflight. */
  readonly maxCandidates: number;
  /** Every provider round trip, of every role. Reserved before the call, never counted after. */
  readonly maxProviderRequests: number;
  /**
   * The serialized provider request body ceiling, in UTF-8 bytes.
   *
   * Measured on the bytes that are about to be sent — instructions, projected input and the bound
   * output schema — and refused before transport. Bytes rather than tokens because bytes are a fact
   * this repository owns; tokens are a provider's opinion about the same string.
   */
  readonly maxRequestInputUtf8Bytes: number;
  /**
   * The aggregate OUTPUT exposure a run may hold at once, in tokens.
   *
   * Every in-flight invocation reserves its own `maxOutputTokens` against this before it is allowed
   * to reach a transport, and releases the unused part when it settles. A call that cannot fit waits;
   * a call larger than the whole ceiling is refused, because it could never fit.
   */
  readonly maxReservedOutputTokens: number;
  readonly maxWallClockMs: number;
  readonly maxConcurrentCandidates: number;
  readonly maxConcurrentInvocations: number;

  // ---- OBSERVED stop thresholds -------------------------------------------------------------
  /** Provider-reported input tokens. A stop threshold, with bounded overshoot. */
  readonly maxObservedInputTokens: number;
  readonly maxObservedOutputTokens: number;
  /** Checked alongside the two directional thresholds, never instead of them. */
  readonly maxObservedTotalTokens: number;

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
    // 4 KiB to 4 MiB. A role input is a projected scenario and a short transcript; anything near the
    // top of this range is a bug somebody should see before paying for it.
    maxRequestInputUtf8Bytes: z.int().min(4_096).max(4_194_304),
    maxReservedOutputTokens: z.int().min(1).max(1_000_000_000),
    // Ten minutes to twelve hours. A run with no wall-clock ceiling is one nobody is watching.
    maxWallClockMs: z.int().min(600_000).max(43_200_000),
    maxConcurrentCandidates: z.int().min(1).max(16),
    maxConcurrentInvocations: z.int().min(1).max(32),
    maxObservedInputTokens: z.int().min(1).max(1_000_000_000),
    maxObservedOutputTokens: z.int().min(1).max(1_000_000_000),
    maxObservedTotalTokens: z.int().min(1).max(2_000_000_000),
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
 * thresholds would not have any.
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
  // A total below either direction cannot bind: the directional threshold would always be reached
  // first, and the field would describe a control that never fires.
  if (
    data.maxObservedTotalTokens < data.maxObservedInputTokens ||
    data.maxObservedTotalTokens < data.maxObservedOutputTokens
  ) {
    throw new RiyaSyntheticPilotError('invalid-execution-budget');
  }
  // One candidate needs several requests — customer turns, teacher turns, a verifier pass and at
  // least two critics. A budget permitting fewer requests than candidates cannot finish even one.
  if (data.maxProviderRequests < data.maxCandidates) {
    throw new RiyaSyntheticPilotError('invalid-execution-budget');
  }
  // A reservation ceiling below the observed output threshold would make the HARD control the only
  // one that ever fires, and the observed threshold decorative. Stated as a rule rather than left to
  // chance, because a decorative field is one a reader will plan against.
  if (data.maxReservedOutputTokens > data.maxObservedOutputTokens) {
    throw new RiyaSyntheticPilotError('invalid-execution-budget');
  }

  const { version: _supplied, ...fields } = data;
  return Object.freeze({ version: 1 as const, ...fields });
}
