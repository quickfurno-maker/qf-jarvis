/**
 * The JF-5B-ONLY Groq pacer (JF-5B-R6). Pure arithmetic and injected seams — nothing here ever sleeps.
 *
 * ### Why it exists
 *
 * Run-8 issued 45 Groq model-required rows as fast as the suite could. Eight completed; 37 came back
 * transient. The owner then read the staging project's inherited organisation limits for
 * `openai/gpt-oss-20b`: 30 RPM, 1,000 RPD, **8,000 TPM**, 200,000 TPD. A structured three-agent turn
 * costs on the order of a thousand prompt tokens plus its completion, so a handful of back-to-back calls
 * is the entire per-minute token lane.
 *
 * ### What these specs protect
 *
 * That the delay is derived from MEASURED token spend against a target below the observed ceiling; that
 * a rate limit earns more than one window of cool-down; that the failed case is never retried; and that
 * none of this is or becomes a production rate policy.
 */
import { describe, expect, it } from 'vitest';

import {
  GROQ_OBSERVED_RPD,
  GROQ_OBSERVED_RPM,
  GROQ_OBSERVED_TPD,
  GROQ_OBSERVED_TPM,
  MIN_MODEL_CALL_INTERVAL_MS,
  PACING_TARGET_TPM,
  RATE_LIMIT_COOLDOWN_MS,
  createGroqLivePacer,
  pacingDelayMsFor,
} from '../contracts/groq-live-pacing.js';

describe('JF-5B-R6 the observed limits are recorded as observations', () => {
  it('pins exactly what the owner read in the provider console on 2026-09-12', () => {
    expect([GROQ_OBSERVED_RPM, GROQ_OBSERVED_RPD, GROQ_OBSERVED_TPM, GROQ_OBSERVED_TPD]).toEqual([
      30, 1_000, 8_000, 200_000,
    ]);
  });

  it('aims 25% under the observed token ceiling', () => {
    expect(PACING_TARGET_TPM).toBe(6_000);
    // The gap is the point: the ceiling is enforced by the provider, the target is what we aim at, and
    // our token figure is always the PREVIOUS call's.
    expect(PACING_TARGET_TPM).toBe(GROQ_OBSERVED_TPM * 0.75);
  });

  it('floors the interval well under the observed request ceiling', () => {
    expect(MIN_MODEL_CALL_INTERVAL_MS).toBe(15_000);
    // 4 calls per minute against an observed 30 RPM. The floor is about tokens, not requests.
    expect(60_000 / MIN_MODEL_CALL_INTERVAL_MS).toBeLessThan(GROQ_OBSERVED_RPM);
  });

  it('cools down for MORE than one full limiter window after a rate limit', () => {
    expect(RATE_LIMIT_COOLDOWN_MS).toBe(65_000);
    // We do not know where in the minute we landed, so only something over a full window is certain.
    expect(RATE_LIMIT_COOLDOWN_MS).toBeGreaterThan(60_000);
  });
});

describe('JF-5B-R6 the delay is derived from measured token spend', () => {
  it('charges nothing before the first call', () => {
    expect(pacingDelayMsFor(undefined)).toBe(0);
  });

  it('a 1000-token turn earns the floor', () => {
    // 1000 / 6000 * 60_000 = 10_000, under the floor.
    expect(pacingDelayMsFor({ totalTokens: 1_000, errorCode: undefined })).toBe(
      MIN_MODEL_CALL_INTERVAL_MS,
    );
    expect(pacingDelayMsFor({ totalTokens: 1_000, errorCode: undefined })).toBeGreaterThanOrEqual(
      15_000,
    );
  });

  it('a 2000-token turn earns 20s', () => {
    expect(pacingDelayMsFor({ totalTokens: 2_000, errorCode: undefined })).toBe(20_000);
  });

  it('a 4000-token turn earns 40s', () => {
    expect(pacingDelayMsFor({ totalTokens: 4_000, errorCode: undefined })).toBe(40_000);
  });

  it('an 8000-token turn earns a full minute and a half of the target lane', () => {
    expect(pacingDelayMsFor({ totalTokens: 8_000, errorCode: undefined })).toBe(80_000);
  });

  it('an unknown token count still earns the floor, never zero', () => {
    expect(pacingDelayMsFor({ totalTokens: undefined, errorCode: undefined })).toBe(
      MIN_MODEL_CALL_INTERVAL_MS,
    );
  });

  it('a rate limit OUTRANKS the token estimate', () => {
    // Being told to slow down beats our own guess about how fast we were going.
    expect(pacingDelayMsFor({ totalTokens: 10, errorCode: 'rate-limited' })).toBe(
      RATE_LIMIT_COOLDOWN_MS,
    );
    expect(pacingDelayMsFor({ totalTokens: 8_000, errorCode: 'rate-limited' })).toBe(
      RATE_LIMIT_COOLDOWN_MS,
    );
  });

  it('any OTHER failure earns ordinary pacing, not a cool-down', () => {
    for (const code of [
      'timeout',
      'provider-failed',
      'structured-output-invalid',
      'circuit-open',
    ]) {
      expect([code, pacingDelayMsFor({ totalTokens: 1_200, errorCode: code })]).toEqual([
        code,
        MIN_MODEL_CALL_INTERVAL_MS,
      ]);
    }
  });
});

describe('JF-5B-R6 the pacer waits against a clock, and never in a test', () => {
  function fakes(start = 0) {
    const state = { now: start, slept: [] as number[] };
    return {
      state,
      clock: { now: () => state.now },
      sleeper: {
        sleep: (ms: number): Promise<void> => {
          state.slept.push(ms);
          // The fake ADVANCES the clock instead of waiting. That is what keeps CI fast, and it is why
          // both seams must be injected together.
          state.now += ms;
          return Promise.resolve();
        },
      },
    };
  }

  it('does not wait before the first call', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createGroqLivePacer(clock, sleeper);
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([]);
    expect(pacer.totalWaitedMs()).toBe(0);
  });

  it('waits the token delay, MINUS the time the call itself took', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createGroqLivePacer(clock, sleeper);
    pacer.observe({ totalTokens: 4_000, errorCode: undefined });
    // The call took 7 seconds of the 40 it earned.
    state.now += 7_000;
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([33_000]);
    expect(pacer.totalWaitedMs()).toBe(33_000);
  });

  it('does not wait at all when the call already took longer than the delay', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createGroqLivePacer(clock, sleeper);
    pacer.observe({ totalTokens: 1_000, errorCode: undefined });
    // A 26-second turn, which run-8 actually saw. The lane has already drained.
    state.now += 26_000;
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([]);
  });

  it('waits at least a full cool-down after a rate limit, before the NEXT case', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createGroqLivePacer(clock, sleeper);
    pacer.observe({ totalTokens: undefined, errorCode: 'rate-limited' });
    state.now += 1_000;
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([64_000]);
    // 1s elapsed plus 64s waited is the full 65s cool-down.
    expect((state.slept[0] ?? 0) + 1_000).toBe(RATE_LIMIT_COOLDOWN_MS);
  });

  it('paces each successive call from its own observation', async () => {
    const { state, clock, sleeper } = fakes();
    const pacer = createGroqLivePacer(clock, sleeper);
    pacer.observe({ totalTokens: 2_000, errorCode: undefined });
    await pacer.waitBeforeNextCall();
    pacer.observe({ totalTokens: 6_000, errorCode: undefined });
    await pacer.waitBeforeNextCall();
    expect(state.slept).toEqual([20_000, 60_000]);
  });

  it('charges the SUITE no wall-clock at all, however much it paces', async () => {
    // The guard against a well-meant edit that swaps the fake sleeper for `setTimeout`: this sequence
    // paces 80 seconds of virtual time, and a real sleeper would make CI wait every one of them.
    const started = Date.now();
    const { clock, sleeper } = fakes();
    const pacer = createGroqLivePacer(clock, sleeper);
    for (const totalTokens of [2_000, 4_000, 2_000]) {
      pacer.observe({ totalTokens, errorCode: undefined });
      await pacer.waitBeforeNextCall();
    }
    expect(pacer.totalWaitedMs()).toBe(80_000);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('JF-5B-R6 this is not, and cannot become, a production rate policy', () => {
  it('is imported by no serving path', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const roots = [
      url.fileURLToPath(new URL('../../../../packages', import.meta.url)),
      url.fileURLToPath(new URL('../../../../apps', import.meta.url)),
    ];
    const walk = (dir: string): string[] =>
      [...fs.readdirSync(dir)].flatMap((entry) => {
        if (['node_modules', 'dist', '.turbo', 'coverage', '.git'].includes(entry)) {
          return [];
        }
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
      });
    const importers: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const normalised = file.replace(/\\/gu, '/');
        if (normalised.includes('/groq-live-pacing.ts')) {
          continue;
        }
        const text = fs.readFileSync(file, 'utf8');
        if (
          text.includes('groq-live-pacing') ||
          text.includes('createGroqLivePacer') ||
          text.includes('pacingClock')
        ) {
          importers.push(normalised.split('/src/')[1] ?? normalised);
        }
      }
    }
    // The harness barrel, the certification runner, the one-shot composition, and the specs that drive
    // and lock them. Nothing in `model-gateway`, no provider, no runtime, no ingress, no worker.
    //
    // `jf5b-phase3-diagnostics.test.ts` is here because it LOCKS the runner's wiring by name — it asserts
    // the seams are injected in pairs and that the pacer reaches the Groq column only. A spec that reads
    // a name is not a serving path that depends on it, and this list is an exact set precisely so that
    // distinction has to be argued in a diff rather than assumed.
    expect(importers.sort()).toEqual([
      'cli/preflight.ts',
      'composition/jf5b-certification-runner-impl.ts',
      'composition/jf5b-live-composition.ts',
      'index.ts',
      'tests/jf5b-groq-pacing.test.ts',
      'tests/jf5b-phase3-diagnostics.test.ts',
    ]);
  });

  it('the Groq provider and the gateway know nothing about pacing', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const groq = fs.readFileSync(
      url.fileURLToPath(
        new URL(
          '../../../../packages/model-gateway/src/providers/groq/groq-model-provider.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    // CODE, not documentation: the provider's own header says it "never sleeps", and a raw scan would
    // read that promise as the breach.
    const NEWLINE = String.fromCharCode(10);
    const code = groq
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split(NEWLINE)
      .filter((line) => !/^\s*\/\//u.test(line))
      .join(NEWLINE);
    for (const forbidden of ['pacing', 'sleep', 'setTimeout', 'TPM', 'cooldown']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});
