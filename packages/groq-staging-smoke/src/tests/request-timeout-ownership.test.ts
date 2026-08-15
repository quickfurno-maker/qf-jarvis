/**
 * MVP-P2A.2 HF4-R3 — the request timeout bounds the REQUEST, not the operator.
 *
 * ### The run that made this necessary
 *
 * RUN S4 was the owner's single authorized live process after HF4-R2 shipped timeout-phase
 * observability. It printed, content-free and in full:
 *
 *     timeoutPhase=credential-resolution transportErrorCode=NONE credentialOutcome=resolved
 *     credentialEntryMs=43802 abortSignalledMs=30004 credentialResolvedMs=43802
 *     requestConstructedMs=43803 invokeStartedMs=43803 fetchStartedMs=ABSENT networkElapsedMs=ABSENT
 *     phase=smoke status=FAILED reason=smoke-timeout requests=1
 *
 * Read those in order. The abort fired at 30004 ms. The credential resolved 13.8 s LATER, at 43802 ms —
 * successfully, `credentialOutcome=resolved`, on the first attempt. The request was constructed at
 * 43803 ms, after the abort. `fetchStarted` was never stamped, so no socket was opened, no bytes left
 * the machine, and Groq was never contacted. `transportErrorCode=NONE` because there was no transport
 * to fail.
 *
 * The harness reported `smoke-timeout`. What it had actually measured was a person typing a key into a
 * masked prompt. RUN S4 was consumed, the 20B model-quality verdict stayed unresolved for a third
 * consecutive run, and not one byte of the evidence was about the model.
 *
 * ### What these specs pin
 *
 * That the arm point moved, and that NOTHING else did. `config.timeoutMs` is still 30 s; the phase
 * vocabulary still contains `credential-resolution` so S3's and S4's reports remain readable; credential
 * entry is still measured to the millisecond; and there is still exactly one bind, one credential read,
 * one timer, one AbortController and one provider invocation, with zero retries and zero fallbacks.
 *
 * Everything is offline and deterministic: a scripted terminal, a manual monotonic clock, a manual
 * timer, and an injected fetch. No resolver, no network, no provider endpoint, no database, no Docker,
 * and no real credential anywhere in this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createManualClock } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { parseSmokeConfig, runGroqStagingSmokeOnce } from '../index.js';
import {
  createDiagnosticRecorder,
  deriveTimeoutPhase,
  SMOKE_TIMEOUT_PHASES,
  type DiagnosticRecorder,
  type MonotonicClock,
} from '../diagnostic-telemetry.js';
import {
  createInstrumentedGroqTransport,
  type FetchLike,
  type FetchResponseLike,
} from '../instrumented-transport.js';
import type { SmokeRunResult, SmokeTimer } from '../run-once.js';
import {
  manualSmokeTimer,
  smokeProbeResponseBody,
  syntheticSmokeConfigInput,
} from '../testing/index.js';

const PKG_DIR = new URL('../../', import.meta.url);

/** The exact S4 measurements, so the numbers in these specs are the owner's, not invented. */
const S4 = {
  credentialEntryMs: 43_802,
  abortSignalledMs: 30_004,
  timeoutMs: 30_000,
} as const;

/** A non-secret sentinel. Shaped like a key, is not one, and never leaves this file. */
const SENTINEL = 'FAKE-STAGING-SENTINEL-DO-NOT-USE-0000';

function manualMonotonic(): MonotonicClock & { advance: (ms: number) => void } {
  const state = { now: 0 };
  return {
    nowMs: () => state.now,
    advance: (ms: number) => {
      state.now += ms;
    },
  };
}

function validConfig(over: Readonly<Record<string, unknown>> = {}) {
  const parsed = parseSmokeConfig(syntheticSmokeConfigInput(over));
  if (!parsed.ok) {
    throw new Error('the synthetic smoke fixture must be valid');
  }
  return parsed.config;
}

function fakeResponse(options: {
  status?: number;
  body?: string;
  onText?: () => Promise<string>;
}): FetchResponseLike {
  return {
    status: options.status ?? 200,
    headers: { get: () => null },
    text: options.onText ?? (() => Promise.resolve(options.body ?? smokeProbeResponseBody())),
  };
}

function codedError(code: string, name = 'Error'): Error & { code: string } {
  const error = new Error('SYNTHETIC-MESSAGE-MUST-NEVER-BE-READ') as Error & { code: string };
  error.name = name;
  error.code = code;
  return error;
}

interface Scenario {
  readonly clock: ReturnType<typeof manualMonotonic>;
  readonly recorder: DiagnosticRecorder;
  readonly timer: ReturnType<typeof manualSmokeTimer>;
  readonly order: readonly string[];
  readonly fetchCalls: () => number;
  readonly run: () => Promise<SmokeRunResult>;
}

/**
 * Compose a run whose credential entry takes a chosen number of milliseconds on the monotonic clock.
 *
 * `entryMs` is charged inside `readOnce`, which is exactly where a human's typing lands in production.
 * The event `order` is recorded so arm-versus-read can be asserted as a sequence rather than inferred
 * from timestamps that a manual clock could make coincide.
 */
function scenario(options: {
  readonly entryMs: number;
  readonly fetchLike: FetchLike;
  readonly interactive?: boolean;
  readonly rejectRead?: Error;
  readonly value?: string;
}): Scenario {
  const clock = manualMonotonic();
  const recorder = createDiagnosticRecorder(clock);
  const timer = manualSmokeTimer();
  const order: string[] = [];
  const state = { calls: 0 };

  const countingFetch: FetchLike = (url, init) => {
    state.calls += 1;
    order.push('fetch');
    return options.fetchLike(url, init);
  };

  const observingTimer: SmokeTimer = {
    arm(ms, onFire) {
      order.push(`armed:${String(ms)}`);
      return timer.arm(ms, onFire);
    },
  };

  const source = {
    isInteractive: () => options.interactive ?? true,
    readOnce: (): Promise<string> => {
      order.push('readStarted');
      // The operator's typing time, charged on the monotonic clock exactly where production charges it.
      clock.advance(options.entryMs);
      order.push('readSettled');
      return options.rejectRead === undefined
        ? Promise.resolve(options.value ?? SENTINEL)
        : Promise.reject(options.rejectRead);
    },
  };

  return {
    clock,
    recorder,
    timer,
    order,
    fetchCalls: () => state.calls,
    run: () =>
      runGroqStagingSmokeOnce(validConfig(), {
        transport: createInstrumentedGroqTransport({ fetchLike: countingFetch, recorder }),
        credentialSource: source,
        clock: createManualClock(),
        timer: observingTimer,
        diagnostics: recorder,
      }),
  };
}

describe('(R3-1) the S4 regression: slow credential entry is no longer a request timeout', () => {
  it('resolves at 43802ms against a 30000ms bound and still reaches the provider exactly once', async () => {
    const s = scenario({
      entryMs: S4.credentialEntryMs,
      fetchLike: () => Promise.resolve(fakeResponse({})),
    });
    const result = await s.run();

    // The premise: entry alone outlasts the entire request budget. Pre-R3 this alone was fatal.
    expect(S4.credentialEntryMs).toBeGreaterThan(S4.timeoutMs);
    expect(result.diagnostics.credentialEntryMs).toBe(S4.credentialEntryMs);
    expect(result.diagnostics.credentialEntryMs ?? 0).toBeGreaterThan(S4.timeoutMs);

    // The credential was read once and resolved once — the operator did nothing wrong.
    expect(result.diagnostics.credentialOutcome).toBe('resolved');
    expect(result.diagnostics.credentialReadAttempts).toBe(1);
    expect(result.diagnostics.credentialResolutions).toBe(1);
    expect(result.counters.credentialReads).toBe(1);

    // The correction, stated as an order: read, THEN arm, THEN fetch.
    expect(s.order).toEqual([
      'readStarted',
      'readSettled',
      `armed:${String(S4.timeoutMs)}`,
      'fetch',
    ]);

    // The request happened. This is the line S4 could never reach.
    expect(s.fetchCalls()).toBe(1);
    expect(result.diagnostics.fetchStartedMs).toBeDefined();
    expect(result.counters.invocations).toBe(1);

    // No abort, because the request itself was never slow.
    expect(result.diagnostics.abortSignalledMs).toBeUndefined();
    expect(result.diagnostics.timeoutPhase).toBe('unknown');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect(result.reason).not.toBe('smoke-timeout');
    }
  });

  it('the outcome follows the provider, not the typing speed', async () => {
    // Same 43.8 s entry; the provider decides the result. A failure here is a REAL provider failure.
    const s = scenario({
      entryMs: S4.credentialEntryMs,
      fetchLike: () => Promise.resolve(fakeResponse({ status: 503, body: '{"error":"SECRET"}' })),
    });
    const result = await s.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-provider-unavailable');
    }
    expect(s.fetchCalls()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('(load-bearing) timerArmedMs >= credentialResolvedMs, by a real margin', async () => {
    const s = scenario({
      entryMs: S4.credentialEntryMs,
      fetchLike: () => Promise.resolve(fakeResponse({})),
    });
    const d = (await s.run()).diagnostics;
    const armed = d.timerArmedMs;
    const resolved = d.credentialResolvedMs;
    expect(typeof armed).toBe('number');
    expect(typeof resolved).toBe('number');
    expect(armed ?? -1).toBeGreaterThanOrEqual(resolved ?? Number.POSITIVE_INFINITY);
    // And the margin is the operator's time, which now sits entirely OUTSIDE the request bound.
    expect(resolved ?? 0).toBeGreaterThanOrEqual(S4.credentialEntryMs);
  });
});

describe('(R3-2) counter semantics: nothing is armed before there is a request to bound', () => {
  it('a TTY refusal arms nothing and reads nothing', async () => {
    const s = scenario({
      entryMs: 0,
      interactive: false,
      fetchLike: () => Promise.resolve(fakeResponse({})),
    });
    const result = await s.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-tty-required');
    }
    expect(result.counters.timersArmed).toBe(0);
    expect(result.counters.timersCleared).toBe(0);
    expect(result.counters.invocations).toBe(0);
    expect(result.counters.credentialReads).toBe(0);
    expect(s.timer.armed()).toBe(0);
    expect(s.fetchCalls()).toBe(0);
    expect(result.diagnostics.credentialOutcome).toBe('tty-required');
    expect(result.diagnostics.credentialReadAttempts).toBe(0);
  });

  it('a credential refusal arms nothing, invokes nothing, and touches no transport', async () => {
    for (const rejection of [
      codedError('ABORT_ERR', 'AbortError'),
      new Error('SYNTHETIC-SOURCE-FAILURE'),
    ]) {
      const s = scenario({
        entryMs: 1_000,
        rejectRead: rejection,
        fetchLike: () => Promise.resolve(fakeResponse({})),
      });
      const result = await s.run();
      expect(result.ok).toBe(false);
      expect(result.counters.binds).toBe(1);
      expect(result.counters.timersArmed).toBe(0);
      expect(result.counters.timersCleared).toBe(0);
      expect(result.counters.invocations).toBe(0);
      expect(s.timer.armed()).toBe(0);
      expect(s.timer.cancelled()).toBe(0);
      expect(s.fetchCalls()).toBe(0);
      expect(s.order).not.toContain(`armed:${String(S4.timeoutMs)}`);
      // A refused bind is not a timeout, and must never be dressed as one.
      if (!result.ok) {
        expect(result.reason).not.toBe('smoke-timeout');
      }
      expect(result.diagnostics.abortSignalledMs).toBeUndefined();
      expect(result.diagnostics.timeoutPhase).toBe('unknown');
      expect(result.diagnostics.transportErrorCode).toBe('NONE');
    }
  });

  it('a locally rejected value arms nothing either', async () => {
    for (const value of ['', 'short']) {
      const s = scenario({
        entryMs: 10,
        value,
        fetchLike: () => Promise.resolve(fakeResponse({})),
      });
      const result = await s.run();
      expect(result.ok).toBe(false);
      expect(result.counters.timersArmed).toBe(0);
      expect(result.counters.timersCleared).toBe(0);
      expect(result.counters.invocations).toBe(0);
      expect(s.fetchCalls()).toBe(0);
    }
  });

  it('a successful bind arms exactly one timer and clears it exactly once', async () => {
    const s = scenario({ entryMs: 5, fetchLike: () => Promise.resolve(fakeResponse({})) });
    const result = await s.run();
    expect(result.ok).toBe(true);
    expect(result.counters.timersArmed).toBe(1);
    expect(result.counters.timersCleared).toBe(1);
    expect(s.timer.armed()).toBe(1);
    expect(s.timer.cancelled()).toBe(1);
    expect(s.timer.armedMs()).toBe(S4.timeoutMs);
  });

  it('the timer is cleared exactly once on failure, on malformed output, and on a throw', async () => {
    const fetches: readonly FetchLike[] = [
      () => Promise.resolve(fakeResponse({ status: 500, body: '{"error":"SECRET"}' })),
      () => Promise.resolve(fakeResponse({ body: '{"not":"the schema"}' })),
      () => Promise.reject(codedError('ECONNRESET')),
    ];
    for (const fetchLike of fetches) {
      const s = scenario({ entryMs: 5, fetchLike });
      const result = await s.run();
      expect(result.ok).toBe(false);
      expect(result.counters.timersArmed).toBe(1);
      expect(result.counters.timersCleared).toBe(1);
      expect(s.timer.armed()).toBe(1);
      expect(s.timer.cancelled()).toBe(1);
    }
  });
});

describe('(R3-3) a REAL request timeout still works, and lands in the right phase', () => {
  it('a stall awaiting headers times out, after the operator has already finished typing', async () => {
    const s = scenario({
      // The operator is slower than the whole request budget — and it is still the REQUEST that fails.
      entryMs: S4.credentialEntryMs,
      fetchLike: (_url, init) =>
        new Promise<FetchResponseLike>((_resolve, reject) => {
          const fail = (): void => {
            reject(codedError('ABORT_ERR', 'AbortError'));
          };
          if (init.signal.aborted) {
            fail();
            return;
          }
          init.signal.addEventListener('abort', fail, { once: true });
          s.timer.fire();
        }),
    });
    const result = await s.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-timeout');
    }
    expect(result.diagnostics.timeoutPhase).toBe('awaiting-headers');
    expect(result.diagnostics.fetchStartedMs).toBeDefined();
    expect(result.diagnostics.headersReceivedMs).toBeUndefined();
    expect(result.diagnostics.transportErrorCode).toBe('ABORT');
    expect(s.fetchCalls()).toBe(1);
    // The abort is attributed to the request, and it fired after the arm — never before it.
    expect(result.diagnostics.abortSignalledMs ?? -1).toBeGreaterThanOrEqual(
      result.diagnostics.timerArmedMs ?? Number.POSITIVE_INFINITY,
    );
  });

  it('a stall consuming the body maps to awaiting-body', async () => {
    const s = scenario({
      entryMs: S4.credentialEntryMs,
      fetchLike: () =>
        Promise.resolve(
          fakeResponse({
            onText: () =>
              new Promise<string>((_resolve, reject) => {
                s.timer.fire();
                reject(codedError('UND_ERR_BODY_TIMEOUT'));
              }),
          }),
        ),
    });
    const result = await s.run();
    expect(result.diagnostics.timeoutPhase).toBe('awaiting-body');
    expect(result.diagnostics.headersReceivedMs).toBeDefined();
    expect(result.diagnostics.responseBodyCompletedMs).toBeUndefined();
    expect(result.diagnostics.transportErrorCode).toBe('UND_ERR_BODY_TIMEOUT');
  });

  it('an abort landing between the arm and the fetch maps to pre-fetch, not credential-resolution', async () => {
    // The timer expires the instant it is armed. Because arming now happens AFTER the credential is
    // resolved, `credentialResolved` is already proven — so the phase is pre-fetch. Pre-R3 the very same
    // abort would have been attributed to credential-resolution.
    const clock = manualMonotonic();
    const recorder = createDiagnosticRecorder(clock);
    const immediate: SmokeTimer = {
      arm(_ms, onFire) {
        onFire();
        return () => {
          /* nothing to cancel */
        };
      },
    };
    const state = { calls: 0 };
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: createInstrumentedGroqTransport({
        fetchLike: () => {
          state.calls += 1;
          return Promise.resolve(fakeResponse({}));
        },
        recorder,
      }),
      credentialSource: {
        isInteractive: () => true,
        readOnce: () => {
          clock.advance(S4.credentialEntryMs);
          return Promise.resolve(SENTINEL);
        },
      },
      clock: createManualClock(),
      timer: immediate,
      diagnostics: recorder,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-timeout');
    }
    expect(result.diagnostics.timeoutPhase).toBe('pre-fetch');
    expect(result.diagnostics.credentialResolvedMs).toBeDefined();
    expect(result.diagnostics.fetchStartedMs).toBeUndefined();
    expect(state.calls).toBe(0);
    expect(result.counters.invocations).toBe(1);
  });
});

describe('(R3-4) what HF4-R3 did NOT change', () => {
  it('the bound is still 30 s and is read from config, never hard-coded upward', async () => {
    const s = scenario({ entryMs: 5, fetchLike: () => Promise.resolve(fakeResponse({})) });
    await s.run();
    expect(s.timer.armedMs()).toBe(30_000);
    expect(validConfig().timeoutMs).toBe(30_000);
  });

  it('credential-entry timing is still measured to the millisecond', async () => {
    for (const entryMs of [0, 1, 18_000, S4.credentialEntryMs]) {
      const s = scenario({ entryMs, fetchLike: () => Promise.resolve(fakeResponse({})) });
      const result = await s.run();
      expect(result.diagnostics.credentialEntryMs).toBe(entryMs);
    }
  });

  it('the phase vocabulary is closed, complete, and still contains credential-resolution', () => {
    expect(SMOKE_TIMEOUT_PHASES).toContain('credential-resolution');
    expect(SMOKE_TIMEOUT_PHASES).toContain('pre-bind');
    expect(SMOKE_TIMEOUT_PHASES).toHaveLength(8);
    // The derivation is untouched, so S3's and S4's archived reports still read the same way.
    expect(deriveTimeoutPhase({ timerArmed: 0, bindStarted: 1 })).toBe('credential-resolution');
    expect(deriveTimeoutPhase({ timerArmed: 0 })).toBe('pre-bind');
  });

  it('still exactly one AbortController, one arm site, and one invoke site in the source', () => {
    const source = readRunOnceSource();
    expect(source.match(/new AbortController\(\)/g)?.length).toBe(1);
    expect(source.match(/deps\.timer\.arm\(/g)?.length).toBe(1);
    expect(source.match(/\.invoke\(input\)/g)?.length).toBe(1);
    expect(source).toContain('cancelTimer();');
    expect(source).toContain('} finally {');
    // Exactly one real `setTimeout` — the shipped system timer — and no second bound smuggled in
    // alongside the moved one. HF4-R3 moves ownership; it does not add a credential-entry deadline.
    expect(source.match(/setTimeout\s*\(/g)?.length).toBe(1);
    expect(source.match(/clearTimeout\s*\(/g)?.length).toBe(1);
    expect(source).not.toMatch(/credentialTimeout|entryTimeout|typingTimeout|readTimeout/i);
  });

  it('no loop, and exactly one bind call site, so there is nowhere for a retry to live', () => {
    const source = readRunOnceSource();
    expect(source).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/);
    expect(source.match(/bindGroqStagingProvider\(\{/g)?.length).toBe(1);
  });

  it('carries no secret, no prompt, and no raw error anywhere in the outcome', async () => {
    const s = scenario({
      entryMs: S4.credentialEntryMs,
      fetchLike: () => Promise.resolve(fakeResponse({ status: 401, body: '{"error":"SECRET"}' })),
    });
    const result = await s.run();
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(SENTINEL);
    expect(serialised).not.toContain('SECRET');
    expect(serialised).not.toContain('SYNTHETIC-MESSAGE-MUST-NEVER-BE-READ');
  });
});

/** Read the production module as text, for the structural locks above. No import, no execution. */
function readRunOnceSource(): string {
  return readFileSync(fileURLToPath(new URL('src/run-once.ts', PKG_DIR)), 'utf8');
}
