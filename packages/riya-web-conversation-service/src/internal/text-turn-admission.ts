/**
 * The process-local text-turn admission gate (RWC-P9, ADR-0105).
 *
 * ### What it protects, and why it has to be here
 *
 * RWC-P8 gives every admitted text turn a DEDICATED PostgreSQL session, held for the whole turn so
 * the conversation's advisory lock cannot drift onto another connection. That is the right design and
 * it has a consequence: a burst across many DIFFERENT conversations acquires many PoolClients, and it
 * does so BEFORE the model gateway's own concurrency gate is ever reached. The gateway would then be
 * protecting a model that the database had already run out of connections to reach.
 *
 * So one process bounds how many text turns it will admit AT ALL, and it does so before the
 * coordinator, before the store, before the availability read and before the runtime.
 *
 * ### There is no queue, and that is a decision rather than an omission
 *
 * A slot is available or it is not. No waiter list, no timer, no retry-after, no backoff.
 *
 * A local queue would wait behind whatever is currently slow — a hung preflight, a model call the
 * gateway is already queueing — while consuming memory and offering no delivery guarantee whatsoever.
 * The caller learns "not now" either way; the difference is whether it learns it in a microsecond or
 * after an unbounded wait, and whether the process is holding a growing list of turns nobody has
 * promised to serve. Fail fast is the honest version.
 *
 * Capacity comes from adding replicas and from sizing the coordinator pool, not from a local buffer.
 *
 * ### Why a plain counter is safe
 *
 * JavaScript runs one turn of the event loop at a time, so the read-and-increment below cannot
 * interleave with another. No lock, no atomic, no async — and deliberately nothing that could yield
 * between the check and the increment, because a single `await` there would reintroduce the race this
 * whole file exists to avoid.
 *
 * This is NOT idempotency and NOT per-conversation serialization. RWC-P8 owns both, durably and
 * across replicas; this only bounds one process's appetite.
 */

/** The bound on `maxConcurrentTextTurns`. One replica, not a cluster. */
export const MIN_CONCURRENT_TEXT_TURNS = 1;
export const MAX_CONCURRENT_TEXT_TURNS = 1024;

/** A single-use release. Calling it twice is a defect, and it is treated as one. */
export type ReleaseTextTurnSlot = () => void;

export interface TextTurnAdmission {
  /** A release function when a slot was free, or `undefined`. Never waits. */
  tryAcquire(): ReleaseTextTurnSlot | undefined;
  /** How many turns hold a slot right now. For observability only; never a decision input. */
  active(): number;
  /** The configured ceiling. */
  max(): number;
}

/**
 * Is this a legal capacity?
 *
 * Rejects a non-integer, zero, a negative and anything past the ceiling. Zero is rejected rather than
 * read as "closed": a service configured to admit nothing is a deployment mistake that should fail at
 * construction, not a supported mode that looks like a total outage.
 */
export function isValidTextTurnCapacity(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_CONCURRENT_TEXT_TURNS &&
    value <= MAX_CONCURRENT_TEXT_TURNS
  );
}

/** Build the gate for one service instance. */
export function createTextTurnAdmission(maxConcurrent: number): TextTurnAdmission {
  let active = 0;

  return Object.freeze({
    tryAcquire(): ReleaseTextTurnSlot | undefined {
      if (active >= maxConcurrent) {
        return undefined;
      }
      active += 1;
      let released = false;
      return () => {
        if (released) {
          // A second release would hand this process a slot it does not own, and the over-count
          // would be permanent and invisible -- the gate would simply start admitting more turns
          // than it was configured for. Refusing loudly is the only way that surfaces.
          throw new Error('riya-text-turn-slot-released-twice');
        }
        released = true;
        active -= 1;
      };
    },
    active: () => active,
    max: () => maxConcurrent,
  });
}
