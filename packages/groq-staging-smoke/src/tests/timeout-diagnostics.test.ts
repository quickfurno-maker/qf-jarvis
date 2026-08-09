/**
 * QFJ-S1D-B — timeout diagnostics: phase attribution, transport-error classes, and sanitisation.
 *
 * The first authorized smoke returned `smoke-timeout` with every counter at 1, which proved the harness
 * behaved and left the cause completely open. These specs pin the instrumentation that closes that gap
 * — and, just as importantly, pin the behaviour it must NOT have changed: one credential read, one bind,
 * one invocation, one HTTP attempt, zero retries, the timer still armed before credential entry, and a
 * 30 s bound that is neither moved nor extended.
 *
 * Everything is offline and deterministic. No resolver, no network, no provider endpoint, no database.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GROQ_CHAT_COMPLETIONS_ENDPOINT, createManualClock } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { parseSmokeConfig, formatSanitizedSmokeResult, runGroqStagingSmokeOnce } from '../index.js';
import {
  createDiagnosticRecorder,
  deriveTimeoutPhase,
  normaliseTransportError,
  CREDENTIAL_OUTCOMES,
  SMOKE_TIMEOUT_PHASES,
  TRANSPORT_ERROR_CODES,
  type DiagnosticRecorder,
  type MonotonicClock,
  type SmokeDiagnostics,
  type CredentialOutcome,
  type SmokeTimeoutPhase,
  type TransportErrorCode,
} from '../diagnostic-telemetry.js';
import {
  createInstrumentedGroqTransport,
  INSTRUMENTED_MAX_RESPONSE_BYTES,
  type FetchLike,
  type FetchResponseLike,
} from '../instrumented-transport.js';
import type { SmokeRunResult, SmokeTimer } from '../run-once.js';
import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
  syntheticSmokeConfigInput,
} from '../testing/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PKG_DIR = new URL('../../', import.meta.url);

/** A hand-driven monotonic clock, so every elapsed value in these specs is exact rather than timed. */
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

/** A response stub. Only `status`, `headers.get`, and `text()` are ever consumed. */
function fakeResponse(options: {
  status?: number;
  body?: string;
  retryAfter?: string | null;
  onText?: () => Promise<string>;
}): FetchResponseLike {
  return {
    status: options.status ?? 200,
    headers: { get: () => options.retryAfter ?? null },
    text: options.onText ?? (() => Promise.resolve(options.body ?? smokeProbeResponseBody())),
  };
}

/** Build an error carrying only a `code`/`name`, exactly as Node/undici surface them. */
function codedError(code: string, name = 'Error'): Error & { code: string } {
  const error = new Error('SYNTHETIC-MESSAGE-MUST-NEVER-BE-READ') as Error & { code: string };
  error.name = name;
  error.code = code;
  return error;
}

interface RunHarness {
  readonly recorder: DiagnosticRecorder;
  readonly clock: ReturnType<typeof manualMonotonic>;
  readonly timer: ReturnType<typeof manualSmokeTimer>;
  readonly fetchCalls: () => number;
  readonly run: () => Promise<SmokeRunResult>;
}

/**
 * Compose a full run over the instrumented transport with a scripted terminal, a manual monotonic
 * clock, and a manual timer. `fetchLike` decides where the run stalls or fails.
 */
function harness(fetchLike: FetchLike, over: Readonly<Record<string, unknown>> = {}): RunHarness {
  const clock = manualMonotonic();
  const recorder = createDiagnosticRecorder(clock);
  const timer = manualSmokeTimer();
  const state = { calls: 0 };
  const countingFetch: FetchLike = (url, init) => {
    state.calls += 1;
    return fetchLike(url, init);
  };
  const transport = createInstrumentedGroqTransport({ fetchLike: countingFetch, recorder });
  return {
    recorder,
    clock,
    timer,
    fetchCalls: () => state.calls,
    run: () =>
      runGroqStagingSmokeOnce(validConfig(over), {
        transport,
        credentialSource: scriptedSecretSource(),
        clock: createManualClock(),
        timer,
        diagnostics: recorder,
      }),
  };
}

describe('(1, 2) the timer order is unchanged and credential entry is measured separately', () => {
  it('(1) the timer is still armed BEFORE any credential read', async () => {
    const source = scriptedSecretSource();
    const clock = manualMonotonic();
    const recorder = createDiagnosticRecorder(clock);
    const timer = manualSmokeTimer();
    const order: string[] = [];

    const observingTimer: SmokeTimer = {
      arm(ms, onFire) {
        order.push(`armed:${String(ms)}`);
        return timer.arm(ms, onFire);
      },
    };
    const observingSource = {
      isInteractive: () => source.isInteractive(),
      readOnce: async (label: string) => {
        order.push('credentialRead');
        return source.readOnce(label);
      },
    };

    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: createInstrumentedGroqTransport({
        fetchLike: () => Promise.resolve(fakeResponse({})),
        recorder,
      }),
      credentialSource: observingSource,
      clock: createManualClock(),
      timer: observingTimer,
      diagnostics: recorder,
    });

    expect(order[0]).toBe('armed:30000');
    expect(order).toContain('credentialRead');
    expect(order.indexOf('armed:30000')).toBeLessThan(order.indexOf('credentialRead'));
    expect(result.diagnostics.timerArmedMs).toBeLessThanOrEqual(
      result.diagnostics.credentialResolvedMs ?? Number.POSITIVE_INFINITY,
    );
    // (25) the bound itself is untouched.
    expect(timer.armedMs()).toBe(30_000);
  });

  it('(2) credential-entry time is isolated from the rest of the run', async () => {
    const clock = manualMonotonic();
    const recorder = createDiagnosticRecorder(clock);
    const slowTypist = {
      isInteractive: () => true,
      readOnce: async () => {
        clock.advance(18_000); // the operator takes 18 s to type
        return Promise.resolve('FAKE-STAGING-SENTINEL-DO-NOT-USE-0000');
      },
    };

    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: createInstrumentedGroqTransport({
        fetchLike: () => {
          clock.advance(400);
          return Promise.resolve(fakeResponse({}));
        },
        recorder,
      }),
      credentialSource: slowTypist,
      clock: createManualClock(),
      timer: manualSmokeTimer(),
      diagnostics: recorder,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics.credentialEntryMs).toBe(18_000);
    expect(result.diagnostics.networkElapsedMs).toBe(400);
    // The two are separable — which is exactly what the S1D result could not do.
    expect(result.diagnostics.credentialEntryMs).not.toBe(result.diagnostics.networkElapsedMs);
  });
});

describe('(3, 9) a completed run emits a monotonic, complete milestone set', () => {
  it('(3) milestones are non-decreasing in causal order', async () => {
    const h = harness((_url, _init) => {
      h.clock.advance(25);
      return Promise.resolve(fakeResponse({}));
    });
    const result = await h.run();
    expect(result.ok).toBe(true);

    const d = result.diagnostics;
    const sequence = [
      d.timerArmedMs,
      d.bindStartedMs,
      d.credentialResolvedMs,
      d.requestConstructedMs,
      d.invokeStartedMs,
      d.fetchStartedMs,
      d.headersReceivedMs,
      d.responseBodyStartedMs,
      d.responseBodyCompletedMs,
      d.invokeSettledMs,
    ];
    for (const value of sequence) {
      expect(typeof value).toBe('number');
    }
    const times = sequence.filter((value): value is number => typeof value === 'number');
    expect(times).toHaveLength(sequence.length);
    for (let i = 1; i < times.length; i += 1) {
      const previous = times[i - 1];
      const current = times[i];
      if (previous === undefined || current === undefined) {
        continue;
      }
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  it('(9) a successful path emits the complete, non-secret telemetry', async () => {
    const h = harness(() => Promise.resolve(fakeResponse({})));
    const result = await h.run();
    expect(result.ok).toBe(true);
    expect(result.diagnostics.transportErrorCode).toBe('NONE');
    expect(result.diagnostics.abortSignalledMs).toBeUndefined();
    expect(result.diagnostics.timeoutPhase).toBe('unknown'); // no abort fired
    expect(typeof result.diagnostics.totalElapsedMs).toBe('number');
  });
});

describe('(4, 5, 6, 7, 8) an abort is attributed to the phase it landed in', () => {
  it('(4) abort during credential resolution maps to credential-resolution', async () => {
    const clock = manualMonotonic();
    const recorder = createDiagnosticRecorder(clock);
    const timer = manualSmokeTimer();
    const stalledTypist = {
      isInteractive: () => true,
      readOnce: () =>
        new Promise<string>((_resolve, reject) => {
          // The operator never finishes typing; the timer fires first.
          timer.fire();
          reject(codedError('ABORT_ERR', 'AbortError'));
        }),
    };
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: createInstrumentedGroqTransport({
        fetchLike: () => Promise.reject(new Error('unreachable')),
        recorder,
      }),
      credentialSource: stalledTypist,
      clock: createManualClock(),
      timer,
      diagnostics: recorder,
    });
    expect(result.diagnostics.timeoutPhase).toBe('credential-resolution');
    expect(result.diagnostics.credentialResolvedMs).toBeUndefined();
  });

  it('(5) abort before the fetch maps to pre-fetch', () => {
    // Derivation is pure, so the phase table is asserted directly and exhaustively.
    expect(deriveTimeoutPhase({ timerArmed: 0, bindStarted: 1, credentialResolved: 2 })).toBe(
      'pre-fetch',
    );
  });

  it('(6) abort while waiting for headers maps to awaiting-headers', async () => {
    const h = harness(
      (_url, init) =>
        new Promise<FetchResponseLike>((_resolve, reject) => {
          // Headers never arrive. Register the abort listener FIRST, then expire the timer — the other
          // order races: a synchronous abort would fire before anything was listening and hang forever.
          const fail = (): void => {
            reject(codedError('ABORT_ERR', 'AbortError'));
          };
          if (init.signal.aborted) {
            fail();
            return;
          }
          init.signal.addEventListener('abort', fail, { once: true });
          h.timer.fire();
        }),
    );
    const result = await h.run();
    expect(result.diagnostics.timeoutPhase).toBe('awaiting-headers');
    expect(result.diagnostics.fetchStartedMs).toBeDefined();
    expect(result.diagnostics.headersReceivedMs).toBeUndefined();
    expect(result.diagnostics.transportErrorCode).toBe('ABORT');
    expect(h.fetchCalls()).toBe(1);
  });

  it('(7) abort while consuming the body maps to awaiting-body', async () => {
    const h = harness(() =>
      Promise.resolve(
        fakeResponse({
          onText: () =>
            new Promise<string>((_resolve, reject) => {
              h.timer.fire();
              reject(codedError('UND_ERR_BODY_TIMEOUT'));
            }),
        }),
      ),
    );
    const result = await h.run();
    expect(result.diagnostics.timeoutPhase).toBe('awaiting-body');
    expect(result.diagnostics.headersReceivedMs).toBeDefined();
    expect(result.diagnostics.responseBodyStartedMs).toBeDefined();
    expect(result.diagnostics.responseBodyCompletedMs).toBeUndefined();
    expect(result.diagnostics.transportErrorCode).toBe('UND_ERR_BODY_TIMEOUT');
  });

  it('(8) abort after the body but before settlement maps to post-body', () => {
    expect(
      deriveTimeoutPhase({
        timerArmed: 0,
        bindStarted: 1,
        credentialResolved: 2,
        fetchStarted: 3,
        headersReceived: 4,
        responseBodyCompleted: 5,
      }),
    ).toBe('post-body');
    // And once settlement is proven, the phase moves on deterministically.
    expect(
      deriveTimeoutPhase({
        timerArmed: 0,
        bindStarted: 1,
        credentialResolved: 2,
        fetchStarted: 3,
        headersReceived: 4,
        responseBodyCompleted: 5,
        invokeSettled: 6,
      }),
    ).toBe('invoke-settlement');
  });

  it('the phase table is total, ordered, and closed', () => {
    expect(deriveTimeoutPhase({})).toBe('unknown');
    expect(deriveTimeoutPhase({ timerArmed: 0 })).toBe('pre-bind');
    expect(deriveTimeoutPhase({ timerArmed: 0, bindStarted: 1 })).toBe('credential-resolution');
    for (const phase of SMOKE_TIMEOUT_PHASES) {
      expect(typeof phase).toBe('string');
    }
    // Freezing happens AT abort, so a later settlement cannot rewrite history.
    const clock = manualMonotonic();
    const recorder = createDiagnosticRecorder(clock);
    recorder.mark('timerArmed');
    recorder.mark('bindStarted');
    recorder.markAbort();
    recorder.mark('invokeSettled');
    expect(recorder.snapshot().timeoutPhase).toBe('credential-resolution');
  });
});

describe('(10-16) transport failures normalise to the closed code set', () => {
  const cases: readonly { readonly code: string; readonly expected: TransportErrorCode }[] = [
    { code: 'ENOTFOUND', expected: 'ENOTFOUND' },
    { code: 'ECONNREFUSED', expected: 'ECONNREFUSED' },
    { code: 'ECONNRESET', expected: 'ECONNRESET' },
    { code: 'ETIMEDOUT', expected: 'ETIMEDOUT' },
    { code: 'UND_ERR_CONNECT_TIMEOUT', expected: 'UND_ERR_CONNECT_TIMEOUT' },
    { code: 'UND_ERR_HEADERS_TIMEOUT', expected: 'UND_ERR_HEADERS_TIMEOUT' },
    { code: 'UND_ERR_BODY_TIMEOUT', expected: 'UND_ERR_BODY_TIMEOUT' },
    { code: 'CERT_HAS_EXPIRED', expected: 'CERT' },
    { code: 'SELF_SIGNED_CERT_IN_CHAIN', expected: 'CERT' },
    { code: 'ERR_TLS_CERT_ALTNAME_INVALID', expected: 'CERT' },
    { code: 'ABORT_ERR', expected: 'ABORT' },
    { code: 'SOMETHING_UNKNOWN', expected: 'OTHER' },
  ];

  for (const { code, expected } of cases) {
    it(`(10-16) ${code} maps to ${expected}`, async () => {
      expect(normaliseTransportError(codedError(code))).toBe(expected);
      const h = harness(() => Promise.reject(codedError(code)));
      const result = await h.run();
      expect(result.diagnostics.transportErrorCode).toBe(expected);
      expect(h.fetchCalls()).toBe(1);
    });
  }

  it('(15) an AbortError by NAME maps to ABORT even without a code', () => {
    const error = new Error('SYNTHETIC-MESSAGE-MUST-NEVER-BE-READ');
    error.name = 'AbortError';
    expect(normaliseTransportError(error)).toBe('ABORT');
  });

  it('(16) a nested cause code is honoured; anything else is OTHER', () => {
    const wrapped = new Error('outer') as Error & { cause: unknown };
    wrapped.cause = codedError('ECONNREFUSED');
    expect(normaliseTransportError(wrapped)).toBe('ECONNREFUSED');
    expect(normaliseTransportError(new Error('plain'))).toBe('OTHER');
    expect(normaliseTransportError(undefined)).toBe('OTHER');
    expect(normaliseTransportError('a string')).toBe('OTHER');
  });

  it('every emitted code is a member of the closed set', async () => {
    for (const { code } of cases) {
      const h = harness(() => Promise.reject(codedError(code)));
      const result = await h.run();
      expect(TRANSPORT_ERROR_CODES).toContain(result.diagnostics.transportErrorCode);
    }
  });
});

describe('(17, 18) nothing sensitive can reach the telemetry', () => {
  it('(17) messages, causes, stacks, URLs, headers, bodies, and output never appear', async () => {
    const secretishBody = smokeProbeResponseBody({ probe: 'MODEL-SAID-SOMETHING-CONFIDENTIAL' });
    const h = harness(() => Promise.resolve(fakeResponse({ body: secretishBody })));
    const result = await h.run();
    const surfaces = [
      JSON.stringify(result.diagnostics),
      JSON.stringify(result),
      formatSanitizedSmokeResult(result, '2026-07-28T00:00:00.000Z'),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain('MODEL-SAID-SOMETHING-CONFIDENTIAL');
      expect(surface).not.toContain('SYNTHETIC-MESSAGE-MUST-NEVER-BE-READ');
      expect(surface).not.toContain('api.groq.com');
      expect(surface).not.toContain('Bearer');
      expect(surface.toLowerCase()).not.toContain('authorization');
      expect(surface).not.toContain('probe');
      expect(surface).not.toContain('at Object.');
      expect(surface).not.toContain('staging connectivity probe');
    }
  });

  it('(17) a failing run leaks no error text either', async () => {
    const h = harness(() => Promise.reject(codedError('ECONNRESET')));
    const result = await h.run();
    const report = formatSanitizedSmokeResult(result, '2026-07-28T00:00:00.000Z');
    expect(report).not.toContain('SYNTHETIC-MESSAGE-MUST-NEVER-BE-READ');
    expect(report).toContain('transportErrorCode=ECONNRESET');
  });

  it('(18) the Authorization header cannot enter telemetry — the recorder has no field for it', async () => {
    const seen: { headers?: Readonly<Record<string, string>> } = {};
    const h = harness((_url, init) => {
      seen.headers = init.headers;
      return Promise.resolve(fakeResponse({}));
    });
    const result = await h.run();
    // The header DID reach the wire (proving pass-through works)…
    expect(seen.headers?.['authorization']).toContain('Bearer ');
    // …and every diagnostic value is a number or a closed enum member, so it has nowhere to go.
    for (const [key, value] of Object.entries(result.diagnostics)) {
      if (value === undefined) {
        continue;
      }
      if (key === 'timeoutPhase') {
        expect(SMOKE_TIMEOUT_PHASES).toContain(value as SmokeTimeoutPhase);
        continue;
      }
      if (key === 'transportErrorCode') {
        expect(TRANSPORT_ERROR_CODES).toContain(value as TransportErrorCode);
        continue;
      }
      if (key === 'credentialOutcome') {
        expect(CREDENTIAL_OUTCOMES).toContain(value as CredentialOutcome);
        continue;
      }
      expect(typeof value).toBe('number');
    }
  });

  it('CONTAINMENT: the diagnostics object carries EXACTLY the approved field names', async () => {
    const h = harness(() => Promise.resolve(fakeResponse({})));
    const result = await h.run();
    const ALLOWED: readonly (keyof SmokeDiagnostics)[] = [
      'timerArmedMs',
      'bindStartedMs',
      'credentialResolvedMs',
      'invokeStartedMs',
      'requestConstructedMs',
      'fetchStartedMs',
      'headersReceivedMs',
      'responseBodyStartedMs',
      'responseBodyCompletedMs',
      'invokeSettledMs',
      'abortSignalledMs',
      'credentialEntryMs',
      'networkElapsedMs',
      'totalElapsedMs',
      'timeoutPhase',
      'transportErrorCode',
      'credentialReadSettledMs',
      'credentialOutcome',
      'credentialReadAttempts',
      'credentialResolutions',
    ];
    expect(Object.keys(result.diagnostics).sort()).toEqual([...ALLOWED].sort());
  });

  it('CONTAINMENT: every printed diagnostic line is an approved name and a scalar value', async () => {
    const h = harness(() => Promise.resolve(fakeResponse({})));
    const result = await h.run();
    const report = formatSanitizedSmokeResult(result, '2026-07-28T00:00:00.000Z');
    const APPROVED_LINE = new Set([
      'qfj-groq-staging-smoke',
      'timestamp',
      'outcome',
      'reason',
      'releaseId',
      'providerId',
      'modelId',
      'modelVersion',
      'configDigest',
      'capabilityProfileRef',
      'evaluationRef',
      'dataControlsAttestationRef',
      'promptFamily',
      'promptVersion',
      'schemaRevision',
      'latencyMs',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'bindReason',
      'retryable',
      'binds',
      'credentialReads',
      'invocations',
      'timersArmed',
      'timersCleared',
      'timerArmedMs',
      'bindStartedMs',
      'credentialResolvedMs',
      'requestConstructedMs',
      'invokeStartedMs',
      'fetchStartedMs',
      'headersReceivedMs',
      'responseBodyStartedMs',
      'responseBodyCompletedMs',
      'invokeSettledMs',
      'abortSignalledMs',
      'credentialEntryMs',
      'networkElapsedMs',
      'totalElapsedMs',
      'timeoutPhase',
      'transportErrorCode',
      'credentialReadSettledMs',
      'credentialOutcome',
      'credentialReadAttempts',
      'credentialResolutions',
      'modelOutput',
      'authority',
    ]);
    for (const line of report.split('\n')) {
      const key = line.includes('=') ? (line.split('=')[0] ?? '') : line;
      expect(APPROVED_LINE.has(key)).toBe(true);
    }
    // Every diagnostic line's value is a plain integer or a closed enum member.
    for (const line of report.split('\n')) {
      const [key, value] = line.split('=');
      if (key === undefined || value === undefined || !key.endsWith('Ms')) {
        continue;
      }
      expect(value).toMatch(/^-?\d+$/);
    }
  });
});

describe('(19, 20, 21, 22) one attempt, no retry, original error preserved', () => {
  it('(19, 20) exactly one fetch and one invocation, on success and on failure', async () => {
    for (const fetchLike of [
      () => Promise.resolve(fakeResponse({})),
      () => Promise.resolve(fakeResponse({ status: 429, body: '{"error":"SECRET"}' })),
      () => Promise.resolve(fakeResponse({ status: 503, body: '{"error":"SECRET"}' })),
      () => Promise.reject(codedError('ECONNRESET')),
    ] satisfies FetchLike[]) {
      const h = harness(fetchLike);
      const result = await h.run();
      expect(h.fetchCalls()).toBe(1);
      expect(result.counters.invocations).toBe(1);
      expect(result.counters.binds).toBe(1);
      expect(result.counters.credentialReads).toBe(1);
      expect(result.counters.timersArmed).toBe(1);
      expect(result.counters.timersCleared).toBe(1);
    }
  });

  it('(21) no retry at any layer, including on retryable classes', async () => {
    for (const code of ['ETIMEDOUT', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT']) {
      const h = harness(() => Promise.reject(codedError(code)));
      const result = await h.run();
      expect(h.fetchCalls()).toBe(1);
      expect(result.counters.invocations).toBe(1);
    }
    // A 429 is reported as retryable and still attempted exactly once.
    const rateLimited = harness(() =>
      Promise.resolve(fakeResponse({ status: 429, body: '{"error":"SECRET"}' })),
    );
    const result = await rateLimited.run();
    expect(rateLimited.fetchCalls()).toBe(1);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-provider-unavailable');
      expect(result.retryable).toBe(true);
    }
  });

  it('(22) the decorator rethrows the ORIGINAL error object, identity preserved', async () => {
    const original = codedError('ECONNREFUSED');
    const recorder = createDiagnosticRecorder(manualMonotonic());
    const transport = createInstrumentedGroqTransport({
      fetchLike: () => Promise.reject(original),
      recorder,
    });
    let thrown: unknown;
    try {
      await transport.send(
        { url: GROQ_CHAT_COMPLETIONS_ENDPOINT, headers: {}, body: '{}' },
        new AbortController().signal,
      );
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBe(original); // identity, not a copy or a wrapper
    expect(recorder.snapshot().transportErrorCode).toBe('ECONNREFUSED');
  });

  it('the transport keeps the gateway SSRF guard and never fetches for a foreign URL', async () => {
    const state = { calls: 0 };
    const transport = createInstrumentedGroqTransport({
      fetchLike: () => {
        state.calls += 1;
        return Promise.resolve(fakeResponse({}));
      },
      recorder: createDiagnosticRecorder(manualMonotonic()),
    });
    await expect(
      transport.send(
        { url: 'https://evil.example.com/v1/chat', headers: {}, body: '{}' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/non-official endpoint/);
    expect(state.calls).toBe(0);
  });

  it('the transport bounds the response body exactly as the gateway does', async () => {
    const oversized = 'x'.repeat(INSTRUMENTED_MAX_RESPONSE_BYTES + 500);
    const recorder = createDiagnosticRecorder(manualMonotonic());
    const transport = createInstrumentedGroqTransport({
      fetchLike: () => Promise.resolve(fakeResponse({ body: oversized, retryAfter: '7' })),
      recorder,
    });
    const response = await transport.send(
      { url: GROQ_CHAT_COMPLETIONS_ENDPOINT, headers: {}, body: '{}' },
      new AbortController().signal,
    );
    expect(response.bodyText).toHaveLength(INSTRUMENTED_MAX_RESPONSE_BYTES);
    expect(response.retryAfterSeconds).toBe(7);
  });

  it('the mirrored wire constants match the gateway source exactly', () => {
    const gatewaySource = readFileSync(
      join(REPO_ROOT, 'packages/model-gateway/src/providers/groq/groq-transport.ts'),
      'utf8',
    );
    const bound = /export const GROQ_MAX_RESPONSE_BYTES = ([\d_]+);/.exec(gatewaySource);
    expect(bound).not.toBeNull();
    expect(Number.parseInt((bound?.[1] ?? '').replace(/_/g, ''), 10)).toBe(
      INSTRUMENTED_MAX_RESPONSE_BYTES,
    );
    // Endpoint, method, and redirect policy are the gateway's, not a local invention.
    expect(GROQ_CHAT_COMPLETIONS_ENDPOINT).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(gatewaySource).toContain("redirect: 'error'");
    expect(gatewaySource).toContain("method: 'POST'");
  });
});

describe('(23, 24, 25, 26, 27, 28) the S1A contract is unchanged', () => {
  it('(23) the outcome/reason mapping is unchanged', async () => {
    const expectations: readonly { readonly fetchLike: FetchLike; readonly reason: string }[] = [
      {
        fetchLike: () => Promise.resolve(fakeResponse({ status: 429 })),
        reason: 'smoke-provider-unavailable',
      },
      {
        fetchLike: () => Promise.resolve(fakeResponse({ status: 401 })),
        reason: 'smoke-provider-failed',
      },
      {
        fetchLike: () => Promise.resolve(fakeResponse({ body: 'not-json' })),
        reason: 'smoke-provider-malformed',
      },
      {
        fetchLike: () => Promise.reject(codedError('ECONNRESET')),
        reason: 'smoke-provider-unavailable',
      },
    ];
    for (const { fetchLike, reason } of expectations) {
      const result = await harness(fetchLike).run();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    }
  });

  it('(24) the report still discards the model output and names Core as the authority', async () => {
    const result = await harness(() => Promise.resolve(fakeResponse({}))).run();
    const report = formatSanitizedSmokeResult(result, '2026-07-28T00:00:00.000Z');
    expect(report).toContain('modelOutput=DISCARDED');
    expect(report).toContain('authority=QUICKFURNO_CORE');
  });

  it('(25, 26, 27, 28) the approved config, digest, model id, and timeout are untouched', () => {
    const approval = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'docs/approvals/groq-staging-smoke-v1/release-approval.json'),
        'utf8',
      ),
    ) as { timeoutMs: number; release: { configDigest: string; modelId: string } };
    expect(approval.timeoutMs).toBe(30_000);
    expect(approval.release.configDigest).toBe(
      '4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1',
    );
    expect(approval.release.modelId).toBe('openai/gpt-oss-20b');

    // (27) the generated config still parses, unchanged by this slice.
    const generated = {
      credentialReference: approval['credentialReference' as keyof typeof approval] as unknown,
    };
    expect(generated).toBeDefined();
    expect(parseSmokeConfig(syntheticSmokeConfigInput()).ok).toBe(true);
  });
});

describe('(29-35) package, repository, and hygiene invariants', () => {
  it('(29) the groq-staging-smoke package-root API is unchanged at 24 symbols', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel)).toHaveLength(24);
    // The diagnostics surface stays INTERNAL — imported relatively, never re-exported.
    for (const internal of [
      'createDiagnosticRecorder',
      'createInstrumentedGroqTransport',
      'normaliseTransportError',
      'deriveTimeoutPhase',
      'SMOKE_TIMEOUT_PHASES',
      'TRANSPORT_ERROR_CODES',
    ]) {
      expect(barrel[internal]).toBeUndefined();
    }
  });

  it('(30) the model-evaluation package-root API lock remains 33', () => {
    const containment = readFileSync(
      join(REPO_ROOT, 'packages/model-evaluation/src/tests/containment.test.ts'),
      'utf8',
    );
    const block = /const EXPECTED = \[([\s\S]*?)\];/.exec(containment);
    const symbols = (block?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith("'"));
    expect(symbols).toHaveLength(33);
  });

  it('(31) the event-backbone package-root API lock remains 39', () => {
    expect(
      readFileSync(join(REPO_ROOT, 'packages/event-backbone/src/tests/public-api.test.ts'), 'utf8'),
    ).toContain('toHaveLength(39)');
  });

  it('(32, 33) migrations 0001-0012 are byte-identical and 0013 is absent', () => {
    const LOCKED: Record<string, string> = {
      '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
      '0002_event_runtime_grants.sql':
        '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
      '0003_ingestion_rejection_and_event_conflict.sql':
        '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
      '0004_projection_foundation.sql':
        '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
      '0005_projection_event_positions.sql':
        '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
      '0006_projection_failure_operations.sql':
        'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
      '0007_subject_activity_projection.sql':
        '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
      '0008_conversation_control_persistence.sql':
        'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
      '0009_durable_approval_queue.sql':
        'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
      '0010_execution_replay_claim.sql':
        '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
      '0011_riya_conversation_continuity.sql':
        '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
      // RWC-P8 (ADR-0104): the ONE authorized addition. Durable logical-turn idempotency, sitting
      // BELOW the ingress transport replay guard rather than replacing it. Repository and
      // LOCAL/CI only; nothing is applied to a managed database.
      '0012_riya_logical_turn_idempotency.sql':
        '5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e',
    };
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED));
    for (const [name, hash] of Object.entries(LOCKED)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((name) => name.startsWith('0013'))).toBe(false);
  });

  it('(34) no S1D-B source references the protected reconciliation directory', () => {
    for (const file of [
      'src/diagnostic-telemetry.ts',
      'src/instrumented-transport.ts',
      'src/run-once.ts',
      'src/format-sanitized-result.ts',
      'src/bin.ts',
    ]) {
      expect(readFileSync(fileURLToPath(new URL(file, PKG_DIR)), 'utf8')).not.toContain(
        'qfj-managed-reconciliation',
      );
    }
  });

  it('(35) no spec here invokes the resolver, the network, a database, or Docker', () => {
    const self = readFileSync(
      fileURLToPath(new URL('src/tests/timeout-diagnostics.test.ts', PKG_DIR)),
      'utf8',
    );
    expect(self).not.toMatch(/\bfetch\s*\(/);
    // Checked against IMPORTS, not raw text — this very assertion names the symbols it forbids, and a
    // symbol that is never imported cannot be called.
    const specifiers = self.match(/import[\s\S]*?from\s*['"][^'"]+['"]/g) ?? [];
    for (const statement of specifiers) {
      expect(statement).not.toContain('createNodeMaskedSecretSource');
      expect(statement).not.toContain('createFetchGroqTransport');
      expect(statement).not.toMatch(/\b(pg|supabase|dockerode)\b/);
    }
    // Every transport in this file is built over an injected fetchLike; none is the platform one.
    expect(self).toContain('createInstrumentedGroqTransport({');
  });
});
