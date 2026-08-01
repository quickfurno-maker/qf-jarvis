/**
 * The shared identifier and instant grammars (QFJ-P08-A, ADR-0074).
 *
 * INTERNAL. Not exported from the package root: a caller who could reach the validators could also
 * pre-validate and then hand in something else, and the only guarantee worth having here is that
 * EVERY value went through the same constructor. Both the command and the snapshot need the
 * conversation-id grammar, so it lives in one place rather than being written twice and drifting.
 */
import { z } from 'zod';

/**
 * An exact identifier: 1–128 chars, no wildcard, not `latest`.
 *
 * Matched to the grammar the rest of the repository already uses for exact references (the prompt
 * registry, the gateway staging binding, the M2 plan). `*` and `latest` are rejected as whole tokens
 * because they are the two well-formed strings that mean "whichever one you like" — an operator
 * command that could name every conversation at once is not a command, it is an incident.
 */
export const EXACT_IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .refine((value) => !value.includes('*'))
  .refine((value) => value.toLowerCase() !== 'latest');

/**
 * A revision: a non-negative safe integer.
 *
 * Zero is valid — a conversation that has never been controlled starts somewhere, and refusing its
 * first command because the counter has not moved yet would be a strange way to fail closed.
 */
export const REVISION = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The exact canonical UTC millisecond shape. No offsets, no local time, no second-precision form. */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * True only for an exact canonical UTC millisecond instant that round-trips.
 *
 * The shape test alone would accept `2026-02-30T00:00:00.000Z`, which parses (JavaScript rolls it
 * forward to March 2) and would then be recorded in audit evidence as a date the operator never
 * wrote. Re-serializing and comparing is what makes the recorded instant the supplied one.
 *
 * This package reads NO clock. The instant is the caller's, validated but never generated, never
 * normalized and never defaulted — a control record whose time this package invented would be
 * evidence about this package rather than about the operator.
 */
export function isCanonicalInstant(value: string): boolean {
  if (!CANONICAL_INSTANT.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return new Date(parsed).toISOString() === value;
}

/** A caller-supplied canonical instant. */
export const CANONICAL_INSTANT_SCHEMA = z.string().refine(isCanonicalInstant);

/**
 * True for a plain, non-array object with no inherited enumerable payload.
 *
 * Zod's `.strict()` rejects unknown OWN keys; it does not notice a prototype that supplies extra
 * enumerable properties. A control command arriving with an inherited `action` is not a shape this
 * package should quietly accept.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return false;
  }
  const own = new Set(Object.keys(value));
  for (const key in value) {
    if (!own.has(key)) {
      return false;
    }
  }
  return true;
}
