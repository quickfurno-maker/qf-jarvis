/**
 * The validation API.
 *
 * Two functions per contract: one that throws, one that returns a result. Both
 * accept `unknown`, because that is honestly what arrives at a trust boundary —
 * a byte stream somebody else produced, that may be malformed, stale, or hostile.
 *
 * ### Errors name the field. They never echo the value.
 *
 * A `ContractIssue` carries a **path**, a **code**, and a **message**. It does not
 * carry the input, and neither does `ContractValidationError`.
 *
 * This is not fastidiousness. The most likely thing to fail validation in this
 * system is a payload that should not have existed — one carrying an API key in
 * `parameters`, or a phone number where an opaque reference belongs. An error that
 * helpfully quotes the rejected value has just written that secret into an
 * exception message, which becomes a log line, which becomes a breach. **The
 * validator that refuses a secret must not then record it**
 * (docs/governance/security-principles.md §5).
 *
 * So: no input in the error, and **no logging anywhere in this package**. A
 * contract library that logs is a contract library that leaks.
 *
 * ### Failure is closed
 *
 * An unknown event type, an unknown version, a malformed payload, an unexpected
 * field — all of them fail. None of them is coerced, defaulted, upgraded, or
 * guessed at. "An unknown version is rejected, never guessed at"
 * (docs/governance/change-management.md §6).
 */

import type { z } from 'zod';

/** One reason a payload was refused. Path and reason only — never the value. */
export interface ContractIssue {
  /** Dotted path to the offending field, e.g. `payload.recommendation.expiresAt`. */
  readonly path: string;
  /** Stable machine code, e.g. `invalid_type`, `unrecognized_keys`, `custom`. */
  readonly code: string;
  /** Human-readable explanation. Names the field and the rule; never the value. */
  readonly message: string;
}

/**
 * A structured validation failure.
 *
 * Carries the contract that refused the input and every reason it did, so a caller
 * can fix all of them at once rather than one round trip at a time.
 */
export class ContractValidationError extends Error {
  /** The contract that refused the input, e.g. `RecommendationV1`. */
  public readonly contract: string;

  /** Every reason, in order. Never empty. */
  public readonly issues: readonly ContractIssue[];

  public constructor(contract: string, issues: readonly ContractIssue[]) {
    super(
      `${contract} validation failed with ${String(issues.length)} issue(s): ` +
        issues.map((issue) => `${issue.path || '<root>'}: ${issue.message}`).join('; '),
    );
    this.name = 'ContractValidationError';
    this.contract = contract;
    this.issues = issues;
  }
}

/** The result of a safe parse. Explicit success or explicit failure — never a throw. */
export type ContractResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: ContractValidationError };

/**
 * Convert Zod issues into contract issues.
 *
 * Deliberately reads only `path`, `code`, and `message`. Zod's issue objects also
 * carry the offending input on some issue types; that field is dropped here and
 * never surfaces.
 */
export function toContractIssues(error: z.ZodError): readonly ContractIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

/** Turn a Zod safe-parse outcome into a contract result. */
export function toContractResult<T>(
  contract: string,
  result: z.ZodSafeParseResult<T>,
): ContractResult<T> {
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: new ContractValidationError(contract, toContractIssues(result.error)),
  };
}

/** Parse, or throw a `ContractValidationError`. */
export function parseWith<T>(contract: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ContractValidationError(contract, toContractIssues(result.error));
  }
  return result.data;
}

/** Parse, returning an explicit result. */
export function safeParseWith<T>(
  contract: string,
  schema: z.ZodType<T>,
  input: unknown,
): ContractResult<T> {
  return toContractResult(contract, schema.safeParse(input));
}

/** Build a failure without a Zod error behind it — used for registry misses. */
export function contractFailure<T>(
  contract: string,
  issues: readonly ContractIssue[],
): ContractResult<T> {
  return { success: false, error: new ContractValidationError(contract, issues) };
}
