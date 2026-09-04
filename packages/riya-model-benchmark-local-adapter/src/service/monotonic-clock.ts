/**
 * The monotonic clock RMB-B refuses to own (AS4-PREP-A).
 *
 * ### Why the harness would not read a clock itself
 *
 * RMB-B's containment forbids `Date.now`, `performance.now` and `process.hrtime` in its own source, so
 * every instant it uses arrives through a port and every one of its specs runs on a manual clock with
 * no real elapsed time in it. That is what makes its latency arithmetic assertable to the microsecond.
 *
 * Somebody still has to read a real clock when a real engine is being measured. This is that somebody,
 * and it is four lines for a reason: the less that sits between the hardware counter and the number,
 * the less there is to be wrong about.
 *
 * ### `hrtime.bigint`, not `Date.now`
 *
 * A wall clock steps when the system time is adjusted -- an NTP correction mid-suite would produce a
 * negative latency, which reads as an impossibly fast request rather than as a clock event. The
 * high-resolution monotonic counter cannot step backwards, and RMB-B aborts the suite if one ever
 * appears to.
 *
 * The origin is arbitrary and the value means elapsed time only. It never becomes a `createdAt`.
 */
import { hrtime } from 'node:process';

import type { RiyaBenchmarkMonotonicClockPort } from '@qf-jarvis/riya-model-benchmark-harness';

/**
 * A microsecond monotonic clock.
 *
 * Nanoseconds are divided down in BigInt before the conversion to `number`, so the safe-integer range
 * is never left along the way -- a machine up for a few months has a nanosecond counter well past
 * 2^53, and doing the division in floating point would quietly lose the low digits that latency is
 * made of.
 */
export function createRiyaLocalMonotonicClock(): RiyaBenchmarkMonotonicClockPort {
  return Object.freeze({
    nowMicros: (): number => Number(hrtime.bigint() / 1_000n),
  });
}
