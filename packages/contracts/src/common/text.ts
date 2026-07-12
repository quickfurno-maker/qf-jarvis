/**
 * Bounded text and machine-readable codes.
 *
 * Every string in every contract is bounded. An unbounded string is a denial-of-
 * service vector and an invitation to smuggle a payload — a raw provider
 * response, a model transcript, a whole source record — through a field that was
 * meant to hold a sentence.
 */

import { z } from 'zod';

/**
 * A stable, machine-readable token: lowercase alphanumerics separated by single
 * hyphens or dots. `recipient-opted-out`, `lead.budget-implausible`.
 *
 * Machine codes are for machines. They are matched, counted, and switched on, so
 * they must be stable across releases — which is why they are constrained here
 * and never derived from human-facing text.
 */
export const MACHINE_TOKEN_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

export const MAX_MACHINE_TOKEN_LENGTH = 64;

export const machineTokenSchema = z
  .string()
  .min(1)
  .max(MAX_MACHINE_TOKEN_LENGTH)
  .regex(MACHINE_TOKEN_PATTERN, 'Must be a lowercase machine token, e.g. "recipient-opted-out"');

export type MachineToken = z.infer<typeof machineTokenSchema>;

/**
 * A stable reason code. Structurally a machine token; semantically a commitment.
 *
 * Reason codes are what let an auditor ask "how often did Core refuse for
 * consent withdrawal?" and get an answer. A free-text reason cannot be counted,
 * so it cannot be governed.
 */
export const reasonCodeSchema = machineTokenSchema;
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

/**
 * C0 and C1 control characters have no place in a contract string.
 *
 * Implemented as a code-point scan rather than a regular expression so that this
 * source file contains no control characters of its own — a file that must embed
 * the bytes it rejects is a file that tooling, diffs, and reviewers all mishandle.
 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** Non-blank, and not padded with leading or trailing whitespace. */
const TRIMMED_NON_BLANK = /^\S(?:[\s\S]*\S)?$/;

/**
 * Human-readable text, bounded and free of control characters.
 *
 * Must be non-blank and must not carry leading or trailing whitespace — a value
 * that differs from its own trimmed form is almost always an upstream bug, and
 * accepting it means two contracts that mean the same thing do not compare equal.
 *
 * The return type is inferred rather than annotated: an explicit annotation would
 * require a type assertion, and this package does not use them.
 */
export function boundedText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .regex(TRIMMED_NON_BLANK, 'Must not be blank or padded with whitespace')
    .refine((value) => !hasControlCharacters(value), {
      message: 'Must not contain control characters',
    });
}

/** Field bounds, stated once so that documentation and code cannot drift apart. */
export const TEXT_LIMITS = {
  /** A headline a human can scan in a prioritized list. */
  summary: 280,
  /** The stated reasoning from evidence to conclusion, written to be challenged. */
  rationale: 2000,
  /** Why a state was recorded, beyond its reason code. */
  explanation: 1000,
  /** A single evidence item or action, described. */
  description: 500,
} as const;
