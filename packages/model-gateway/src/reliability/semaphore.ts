/**
 * A bounded, fair concurrency semaphore (QFJ-P04.01A, ADR-0045).
 *
 * At most `maxConcurrent` permits are held at once; up to `maxQueue` callers may wait FIFO for a permit.
 * A caller that arrives with no permit and no queue room is REFUSED (never blocked forever, never a busy
 * spin, no background timer). There is no wall-clock wait — a waiter resolves only when a permit is
 * released. This is the gateway's concurrency/queue bound.
 */

/** The reason a bounded acquire refused. */
export type SemaphoreRefusal = 'concurrency-limit' | 'queue-full';

export class BoundedSemaphore {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private inFlight = 0;
  private readonly waiters: (() => void)[] = [];

  public constructor(maxConcurrent: number, maxQueue: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrent must be a positive integer');
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new Error('maxQueue must be a non-negative integer');
    }
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
  }

  /**
   * Acquire a permit, or refuse. Resolves `{ acquired: true }` immediately when a permit is free, waits
   * FIFO (up to `maxQueue`) when all permits are held, and resolves `{ acquired: false, refusal }` when
   * neither a permit nor a queue slot is available.
   */
  public acquire(): Promise<
    { readonly acquired: true } | { readonly acquired: false; readonly refusal: SemaphoreRefusal }
  > {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight += 1;
      return Promise.resolve({ acquired: true });
    }
    if (this.waiters.length >= this.maxQueue) {
      const refusal: SemaphoreRefusal = this.maxQueue === 0 ? 'concurrency-limit' : 'queue-full';
      return Promise.resolve({ acquired: false, refusal });
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.inFlight += 1;
        resolve({ acquired: true });
      });
    });
  }

  /** Release a held permit, handing it to the next FIFO waiter if any. */
  public release(): void {
    if (this.inFlight <= 0) {
      return;
    }
    this.inFlight -= 1;
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
    }
  }
}
