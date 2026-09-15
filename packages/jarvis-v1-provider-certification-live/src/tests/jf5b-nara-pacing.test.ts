/** JF-5B-R18: Nara evaluation pacing after Run-29 capacity interference. */
import { describe, expect, it } from 'vitest';

import {
  NARA_MIN_MODEL_CALL_INTERVAL_MS,
  NARA_PUBLISHED_FREE_RPM,
  NARA_RATE_LIMIT_COOLDOWN_MS,
  createNaraLivePacer,
  naraPacingDelayMsFor,
} from '../contracts/nara-live-pacing.js';

describe('JF-5B-R18 Nara pacing constants', () => {
  it('pins the public Free-plan RPM observation and a conservative lane', () => {
    expect(NARA_PUBLISHED_FREE_RPM).toBe(15);
    expect(NARA_MIN_MODEL_CALL_INTERVAL_MS).toBe(15_000);
    expect(60_000 / NARA_MIN_MODEL_CALL_INTERVAL_MS).toBeLessThan(NARA_PUBLISHED_FREE_RPM);
  });

  it('uses more than one minute after a 429 and never retries the failed case', () => {
    expect(NARA_RATE_LIMIT_COOLDOWN_MS).toBe(65_000);
    expect(NARA_RATE_LIMIT_COOLDOWN_MS).toBeGreaterThan(60_000);
  });
});

describe('JF-5B-R18 Nara pacing arithmetic', () => {
  it('does not delay the first model call', () => {
    expect(naraPacingDelayMsFor(undefined)).toBe(0);
  });
  it('uses the fixed request interval after an ordinary call', () => {
    expect(naraPacingDelayMsFor({ totalTokens: 1234, errorCode: undefined })).toBe(
      NARA_MIN_MODEL_CALL_INTERVAL_MS,
    );
  });

  it('lets an exact rate limit override the ordinary interval', () => {
    expect(naraPacingDelayMsFor({ totalTokens: undefined, errorCode: 'rate-limited' })).toBe(
      NARA_RATE_LIMIT_COOLDOWN_MS,
    );
  });
});

describe('JF-5B-R18 Nara pacer', () => {
  function fakes() {
    const state = { now: 0, slept: [] as number[] };
    return {
      state,
      clock: { now: () => state.now },
      sleeper: {
        sleep: (ms: number): Promise<void> => {
          state.slept.push(ms);
          state.now += ms;
          return Promise.resolve();
        },
      },
    };
  }
  it('subtracts call elapsed time from the next interval', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createNaraLivePacer(clock, sleeper);
    pacer.observe({ totalTokens: 10, errorCode: undefined });
    state.now += 5_000;
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([10_000]);
    expect(pacer.totalWaitedMs()).toBe(10_000);
  });

  it('waits the remaining cooldown after a 429', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createNaraLivePacer(clock, sleeper);
    pacer.observe({ totalTokens: undefined, errorCode: 'rate-limited' });
    state.now += 1_000;
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([64_000]);
  });

  it('never sleeps before the first call', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createNaraLivePacer(clock, sleeper);
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([]);
  });
});
