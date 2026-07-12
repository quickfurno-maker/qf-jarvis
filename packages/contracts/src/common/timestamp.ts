/**
 * UTC timestamps, as RFC 3339 strings.
 *
 * Contracts carry timestamps as strings, never as JavaScript `Date`. A `Date` is
 * not JSON-serializable, carries a local-time interpretation nobody agreed to,
 * and silently rolls invalid calendar dates forward. A string that must end in
 * `Z` has exactly one meaning, everywhere, forever.
 */

import { z } from 'zod';

/**
 * RFC 3339, UTC only. `2026-07-11T09:15:00Z`, optionally with fractional seconds.
 *
 * A local offset such as `+05:30` is rejected on purpose. Two systems reasoning
 * about "when did this happen" across a trust boundary must not have to agree on
 * a timezone database first.
 */
export const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/**
 * A real instant on the calendar.
 *
 * The pattern above admits `2026-02-30T00:00:00Z`, which is well-formed and does
 * not exist.
 *
 * `Date.parse` alone is **not** sufficient to catch it, which is worth stating
 * because it is the obvious thing to reach for and it is wrong: V8 does not reject
 * 30 February, it silently **rolls it forward** to 2 March. A validator built on
 * `Date.parse` would therefore accept an impossible date and hand back a different
 * day than the one it was given — which, on an `occurredAt`, is a fact quietly
 * changed in transit.
 *
 * So the calendar fields are read back and compared with what was written. If the
 * instant that came out is not the instant that went in, the input was not a real
 * date. Pure and deterministic: it reads no clock.
 */
function isRealCalendarInstant(value: string): boolean {
  const epochMillis = Date.parse(value);
  if (Number.isNaN(epochMillis)) {
    return false;
  }

  const parsed = new Date(epochMillis);

  return (
    parsed.getUTCFullYear() === Number(value.slice(0, 4)) &&
    parsed.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    parsed.getUTCDate() === Number(value.slice(8, 10)) &&
    parsed.getUTCHours() === Number(value.slice(11, 13)) &&
    parsed.getUTCMinutes() === Number(value.slice(14, 16)) &&
    parsed.getUTCSeconds() === Number(value.slice(17, 19))
  );
}

export const utcTimestampSchema = z
  .string()
  .regex(RFC3339_UTC_PATTERN, 'Must be an RFC 3339 UTC timestamp ending in "Z"')
  .refine(isRealCalendarInstant, { message: 'Must be a real calendar instant' });

export type UtcTimestamp = z.infer<typeof utcTimestampSchema>;

/**
 * Milliseconds since the epoch, for ordering comparisons only.
 *
 * Deterministic: it parses the string it is given and reads no clock. Contract
 * validation must never depend on the current time — an event that was valid
 * when it was emitted does not become invalid because it was replayed tomorrow.
 */
export function toEpochMillis(timestamp: UtcTimestamp): number {
  return Date.parse(timestamp);
}

/** `a` is strictly before `b`. */
export function isStrictlyBefore(a: UtcTimestamp, b: UtcTimestamp): boolean {
  return toEpochMillis(a) < toEpochMillis(b);
}

/** `a` is at or before `b`. */
export function isAtOrBefore(a: UtcTimestamp, b: UtcTimestamp): boolean {
  return toEpochMillis(a) <= toEpochMillis(b);
}
