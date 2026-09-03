/**
 * A bounded concurrency gate (AS2, ADR-0143 §24).
 *
 * ### Why a lease rather than a counter
 *
 * `maxConcurrentInvocations` has to hold ACROSS candidates, not within one. A per-candidate limiter
 * bounds nothing useful: five candidates each politely running two calls is ten concurrent calls, and
 * the policy field would describe a guarantee the run does not make.
 *
 * So the gate is a shared object, and a caller holds a lease for the duration of its call. One
 * implementation, injected — two limiters would eventually disagree about what "active" means.
 *
 * ### The re-check loop is the correctness detail
 *
 * Waking a waiter and incrementing on its behalf looks simpler and is wrong: between the release and
 * the woken continuation actually running, another acquirer can take the slot, and the count drifts
 * above the limit under exactly the load the limit exists for. Each waiter re-checks instead.
 */

export interface RiyaSyntheticLease {
  release(): void;
}

export type RiyaSyntheticConcurrencyGate = () => Promise<RiyaSyntheticLease>;

export interface RiyaSyntheticGateHandle {
  readonly acquire: RiyaSyntheticConcurrencyGate;
  /** How many leases are held right now. */
  readonly active: () => number;
  /** The most ever held at once. Reported as run evidence, and what a spec asserts against. */
  readonly peak: () => number;
}

export function createRiyaSyntheticConcurrencyGate(limit: number): RiyaSyntheticGateHandle {
  let active = 0;
  let peak = 0;
  const waiters: (() => void)[] = [];

  const acquire = async (): Promise<RiyaSyntheticLease> => {
    // A LOOP, not an `if`. See the note above.
    while (active >= limit) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    active += 1;
    if (active > peak) peak = active;

    let released = false;
    return {
      release(): void {
        // Idempotent: a `finally` that runs twice must not free a permit twice, or the limit quietly
        // becomes an average.
        if (released) return;
        released = true;
        active -= 1;
        const next = waiters.shift();
        if (next !== undefined) next();
      },
    };
  };

  return { acquire, active: () => active, peak: () => peak };
}
