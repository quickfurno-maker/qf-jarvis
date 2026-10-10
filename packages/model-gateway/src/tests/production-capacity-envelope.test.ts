import { describe, expect, it } from 'vitest';

import { BoundedSemaphore } from '../reliability/semaphore.js';

describe('production model-gateway capacity envelope', () => {
  it('admits 50 active requests, queues 150, and refuses request 201+ without unbounded waiting', async () => {
    const semaphore = new BoundedSemaphore(50, 150);
    const outcomes: (
      | { readonly acquired: true }
      | { readonly acquired: false; readonly refusal: 'concurrency-limit' | 'queue-full' }
      | undefined
    )[] = Array.from({ length: 250 });

    const acquisitions = Array.from({ length: 250 }, (_, index) =>
      semaphore.acquire().then((outcome) => {
        outcomes[index] = outcome;
        return outcome;
      }),
    );

    await Promise.resolve();
    expect(outcomes.slice(0, 50).every((outcome) => outcome?.acquired === true)).toBe(true);
    expect(outcomes.slice(50, 200).every((outcome) => outcome === undefined)).toBe(true);
    expect(
      outcomes
        .slice(200)
        .every((outcome) => outcome?.acquired === false && outcome.refusal === 'queue-full'),
    ).toBe(true);

    // Hand the 50 permits through the 150 FIFO waiters in three bounded waves.
    for (let index = 0; index < 150; index += 1) semaphore.release();
    await Promise.all(acquisitions.slice(0, 200));

    expect(outcomes.slice(0, 200).every((outcome) => outcome?.acquired === true)).toBe(true);
    expect(
      outcomes
        .slice(200)
        .every((outcome) => outcome?.acquired === false && outcome.refusal === 'queue-full'),
    ).toBe(true);
    const acquired = outcomes.filter((outcome) => outcome?.acquired === true);
    const refused = outcomes.filter((outcome) => outcome?.acquired === false);
    expect(acquired).toHaveLength(200);
    expect(refused).toHaveLength(50);

    // Drain the final 50 holders. Extra releases remain harmless and never create capacity.
    for (let index = 0; index < 60; index += 1) semaphore.release();
  });
});
