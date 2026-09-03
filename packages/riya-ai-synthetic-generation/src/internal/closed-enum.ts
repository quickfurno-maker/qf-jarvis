/**
 * A zod schema over a closed vocabulary that KEEPS the vocabulary's type (AS2).
 *
 * ### Why this exists
 *
 * `z.enum` needs a tuple literal, and the canonical Riya vocabularies are `readonly T[]`. The usual
 * workaround is `z.enum(values as readonly [string, ...string[]])`, which validates against the right
 * list and then infers plain `string`. Every call site is then one type short, and the shortfall is
 * paid with an unsafe cast — at exactly the boundary whose whole job is turning untrusted model
 * output into something typed.
 *
 * Worse, the cast hides a second failure. A schema typed `string[]` will happily accept a plan whose
 * `languageModes` contain `"NOT_A_LANGUAGE"`, hand back an object whose TypeScript type claims
 * otherwise, and let the mistake surface much later somewhere that cannot explain it.
 *
 * This validates against the same closed set and returns the same type, so neither the cast nor the
 * false contract is needed.
 */
import { z } from 'zod';

export function closedEnum<T extends string>(values: readonly T[]): z.ZodType<T> {
  const allowed: ReadonlySet<string> = new Set<string>(values);
  return z.custom<T>((value) => typeof value === 'string' && allowed.has(value));
}
