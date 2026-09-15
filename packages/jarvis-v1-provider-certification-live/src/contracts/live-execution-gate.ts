/**
 * The double-opt-in live execution gate, the call/cost budget, and the outside-the-repository rule.
 *
 * ### Why two gates and not one
 *
 * A single flag is one typo away from a live spend, and one CI configuration change away from a
 * provider call on every push. So a live run needs BOTH an explicit `--execute-live` argument AND a
 * fixed phrase typed at a terminal after the preflight summary has been read.
 *
 * The phrase is deliberately not accepted via argv. If it were, the two gates would be one gate with
 * two names, and a script could satisfy both without a person ever seeing what was about to happen.
 *
 * ### What the preflight may print
 *
 * Non-secret facts only, and all of them, because the second confirmation is worthless if the person
 * typing it has not been told the head, the providers, the ceilings and the output path.
 */
import { z } from 'zod';

/** The fixed second-gate phrase. Typed at a TTY, never accepted from argv. */
export const LIVE_CONFIRMATION_PHRASE = 'EXECUTE_JF5B_LIVE';

/** The explicit first-gate flag. */
export const EXECUTE_LIVE_FLAG = '--execute-live';

export const GATE_REFUSALS = [
  'execute-live-flag-absent',
  'confirmation-phrase-in-argv',
  'not-a-tty',
  'confirmation-phrase-mismatch',
  'output-path-not-absolute',
  'output-path-inside-repository',
  'budget-exhausted',
] as const;
export type GateRefusal = (typeof GATE_REFUSALS)[number];

/**
 * Is the first gate open, and was the second gate NOT smuggled through argv?
 *
 * Returns the refusal rather than a boolean so a caller reports which gate closed, and so "no flag" can
 * never be confused with "phrase supplied unsafely".
 */
export function checkArgvGate(argv: readonly string[]): GateRefusal | undefined {
  // The phrase anywhere in argv is a refusal even when the flag is also present: a caller that put it
  // there was trying to make the interactive gate unnecessary.
  if (argv.some((arg) => arg.includes(LIVE_CONFIRMATION_PHRASE))) {
    return 'confirmation-phrase-in-argv';
  }
  if (!argv.includes(EXECUTE_LIVE_FLAG)) {
    return 'execute-live-flag-absent';
  }
  return undefined;
}

/** Is the typed second gate exactly the phrase? Whitespace is trimmed; nothing else is forgiven. */
export function checkTypedConfirmation(typed: string, isTty: boolean): GateRefusal | undefined {
  if (!isTty) {
    return 'not-a-tty';
  }
  return typed.trim() === LIVE_CONFIRMATION_PHRASE ? undefined : 'confirmation-phrase-mismatch';
}

/**
 * Refuse an output path that is not absolute, or that resolves anywhere inside the repository.
 *
 * Raw live artifacts carry model output. Inside the repository they are one `git add -A` from being
 * committed, and one review from being read by someone who should not. The check is on the RESOLVED
 * path so a symlink, a junction or a `..` walk cannot land inside by a route the string did not show.
 *
 * `repositoryRoot` and `resolvedOutput` are both supplied already resolved: this module performs no
 * filesystem access, so it can be tested exhaustively without one.
 */
/** The Windows path separator, by code point. A literal backslash here is the one character that a
 * copy, a heredoc or a codegen step reliably corrupts, and a corrupted separator would silently turn
 * the repository-containment check below into a check that always passes.
 */
const BACKSLASH = String.fromCharCode(92);

/**
 * One path, with Windows separators folded to `/` and any trailing separator dropped.
 *
 * Extracted so the containment rule below reads as one comparison rather than as two lines of escaping.
 */
function normalizeSeparators(path: string): string {
  return path.split(BACKSLASH).join('/').replace(/[/]+$/u, '');
}

export function checkOutputPath(
  resolvedOutput: string,
  repositoryRoot: string,
): GateRefusal | undefined {
  const normalized = normalizeSeparators(resolvedOutput);
  const root = normalizeSeparators(repositoryRoot);
  if (normalized.length === 0 || !/^([A-Za-z]:\/|\/)/u.test(normalized)) {
    return 'output-path-not-absolute';
  }
  const lowerOut = normalized.toLowerCase();
  const lowerRoot = root.toLowerCase();
  if (lowerOut === lowerRoot || lowerOut.startsWith(`${lowerRoot}/`)) {
    return 'output-path-inside-repository';
  }
  return undefined;
}

/** The hard ceilings for one run. Exceeding one refuses the NEXT reservation; nothing is retried. */
export interface LiveBudget {
  readonly maxGroqCalls: number;
  readonly maxNaraCalls: number;
  readonly maxTotalCalls: number;
  readonly maxEstimatedSpendUsd: number;
}

/**
 * The JF-5B ceilings.
 *
 * Derived from the plan rather than chosen: Groq connectivity (1) + three agents of model-required
 * certification + AUTO routing; Nara discovery (1) + up to five shortlist probes x three agents +
 * three agents of certification + AUTO fallback. The totals are generous enough for one honest run and
 * small enough that a runaway loop stops long before it matters.
 */
export const JF5B_BUDGET: LiveBudget = Object.freeze({
  maxGroqCalls: 120,
  maxNaraCalls: 120,
  maxTotalCalls: 200,
  maxEstimatedSpendUsd: 10,
});

const budgetSchema = z
  .object({
    maxGroqCalls: z.int().min(0).max(1000),
    maxNaraCalls: z.int().min(0).max(1000),
    maxTotalCalls: z.int().min(0).max(2000),
    maxEstimatedSpendUsd: z.number().min(0).max(10),
  })
  .strict();

/** Validate a budget. The spend ceiling is capped at 10 USD by the schema, not by convention. */
export function createLiveBudget(input: LiveBudget): LiveBudget {
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('invalid-live-budget');
  }
  return Object.freeze({ ...parsed.data });
}

/** A call ledger that refuses the next reservation once a ceiling is reached. It never retries. */
export interface CallLedger {
  reserve(provider: 'groq' | 'nara', estimatedSpendUsd: number): GateRefusal | undefined;
  readonly groqCalls: () => number;
  readonly naraCalls: () => number;
  readonly totalCalls: () => number;
  readonly spendUsd: () => number;
}

export function createCallLedger(budget: LiveBudget): CallLedger {
  const state = { groq: 0, nara: 0, spend: 0 };
  return Object.freeze({
    reserve(provider: 'groq' | 'nara', estimatedSpendUsd: number): GateRefusal | undefined {
      const groq = state.groq + (provider === 'groq' ? 1 : 0);
      const nara = state.nara + (provider === 'nara' ? 1 : 0);
      const spend = state.spend + estimatedSpendUsd;
      if (
        groq > budget.maxGroqCalls ||
        nara > budget.maxNaraCalls ||
        groq + nara > budget.maxTotalCalls ||
        spend > budget.maxEstimatedSpendUsd
      ) {
        return 'budget-exhausted';
      }
      state.groq = groq;
      state.nara = nara;
      state.spend = spend;
      return undefined;
    },
    groqCalls: () => state.groq,
    naraCalls: () => state.nara,
    totalCalls: () => state.groq + state.nara,
    spendUsd: () => state.spend,
  });
}
