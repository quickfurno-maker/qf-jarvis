/**
 * One measured request: first-token semantics, deadlines, cancellation and token accounting.
 *
 * These are the four things a benchmark adapter can get wrong without anybody noticing, because each
 * of them produces a number rather than an error. A first-token callback on the wrong chunk yields a
 * TTFT that is real, plausible and measuring the response header; a `Promise.race` timeout yields a
 * throughput figure computed while the machine was still busy with the last request.
 */
import { describe, expect, it, vi } from 'vitest';

import { RiyaLocalBenchmarkError } from '../contracts/errors.js';
import { createRiyaLocalBenchmarkTarget } from '../service/local-engine-target.js';
import type { RiyaLocalBenchmarkTarget } from '../service/local-engine-target.js';
import {
  FAKE_STREAM_DONE,
  FakeEngineTransport,
  FakeTokenizer,
  fakeHealthyStream,
  fakeStreamChunk,
} from '../testing/fakes.js';
import type { FakeEngineScript } from '../testing/fakes.js';
import { FIXTURE_MODEL_ID, fixtureConfig, fixtureWorkload } from './fixtures.js';
import type { RiyaLocalBenchmarkAdapterConfigInput } from '../contracts/adapter-config.js';

interface Harnessed {
  readonly target: RiyaLocalBenchmarkTarget;
  readonly transport: FakeEngineTransport;
  readonly tokenizer: FakeTokenizer;
}

async function prepared(options: {
  readonly script?: readonly FakeEngineScript[];
  readonly configOverrides?: Partial<RiyaLocalBenchmarkAdapterConfigInput>;
  readonly tokenizer?: FakeTokenizer;
  readonly maximumOutputTokens?: number;
  readonly requestTimeoutMicros?: number;
}): Promise<Harnessed> {
  const transport = new FakeEngineTransport({
    script: options.script ?? [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID }) }],
  });
  const tokenizer = options.tokenizer ?? new FakeTokenizer({ promptTokens: 11 });
  const target = createRiyaLocalBenchmarkTarget({
    config: fixtureConfig(options.configOverrides ?? {}),
    transport,
    tokenizer,
  });
  await target.prepareCase(
    fixtureWorkload({
      ...(options.maximumOutputTokens === undefined
        ? {}
        : { maximumOutputTokens: options.maximumOutputTokens }),
      ...(options.requestTimeoutMicros === undefined
        ? {}
        : { requestTimeoutMicros: options.requestTimeoutMicros }),
    }),
  );
  return { target, transport, tokenizer };
}

function invocation(
  overrides: {
    readonly signal?: AbortSignal;
    readonly onFirstOutput?: () => void;
    readonly requestTimeoutMicros?: number;
  } = {},
): Parameters<RiyaLocalBenchmarkTarget['invoke']>[0] {
  return {
    requestOrdinal: 0,
    requestTimeoutMicros: overrides.requestTimeoutMicros ?? 5_000_000,
    signal: overrides.signal ?? new AbortController().signal,
    onFirstOutput: overrides.onFirstOutput ?? ((): void => undefined),
  };
}

describe('time to first token marks the FIRST REAL output token, once', () => {
  it('marks exactly once on a stream that opens with a role and an empty delta', async () => {
    const onFirstOutput = vi.fn();
    const { target } = await prepared({});
    const result = await target.invoke(invocation({ onFirstOutput }));
    expect(onFirstOutput).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ outcome: 'SUCCESS', inputTokens: 11, outputTokens: 2 });
  });

  it('does NOT mark on the role-only opener', async () => {
    const onFirstOutput = vi.fn();
    const { target } = await prepared({
      script: [
        {
          chunks: [
            fakeStreamChunk({
              model: FIXTURE_MODEL_ID,
              choices: [{ delta: { role: 'assistant' } }],
            }),
          ],
        },
      ],
    });
    await expect(target.invoke(invocation({ onFirstOutput }))).rejects.toMatchObject({
      code: 'ENGINE_PROTOCOL_INVALID',
    });
    expect(onFirstOutput).not.toHaveBeenCalled();
  });

  it('does NOT mark on an empty or null content delta', async () => {
    const onFirstOutput = vi.fn();
    const { target } = await prepared({
      script: [
        {
          chunks: [
            fakeStreamChunk({ model: FIXTURE_MODEL_ID, choices: [{ delta: { content: '' } }] }),
            fakeStreamChunk({ model: FIXTURE_MODEL_ID, choices: [{ delta: { content: null } }] }),
          ],
        },
      ],
    });
    await expect(target.invoke(invocation({ onFirstOutput }))).rejects.toMatchObject({
      code: 'ENGINE_PROTOCOL_INVALID',
    });
    expect(onFirstOutput).not.toHaveBeenCalled();
  });

  it('does NOT mark on a usage-only or finish-only chunk', async () => {
    const onFirstOutput = vi.fn();
    const { target } = await prepared({
      script: [
        {
          chunks: [
            fakeStreamChunk({
              model: FIXTURE_MODEL_ID,
              choices: [{ delta: {}, finish_reason: 'stop' }],
            }),
            fakeStreamChunk({
              model: FIXTURE_MODEL_ID,
              choices: [],
              usage: { prompt_tokens: 11, completion_tokens: 3 },
            }),
            FAKE_STREAM_DONE,
          ],
        },
      ],
    });
    await expect(target.invoke(invocation({ onFirstOutput }))).rejects.toMatchObject({
      code: 'ENGINE_PROTOCOL_INVALID',
    });
    expect(onFirstOutput).not.toHaveBeenCalled();
  });

  it('does not mark a SECOND time on the second content token', async () => {
    // Two callbacks make RMB-B's time-to-first-token sample ambiguous, and RMB-B fails the suite for
    // it. This is the adapter side of that contract.
    const onFirstOutput = vi.fn();
    const { target } = await prepared({});
    await target.invoke(invocation({ onFirstOutput }));
    expect(onFirstOutput).toHaveBeenCalledTimes(1);
  });

  it('marks correctly when a single event arrives split across chunk boundaries', async () => {
    // The bug that survives every naive test: a JSON object cut in half by the socket. A per-chunk
    // parser MISSES the first token here, which is a TTFT that is silently wrong rather than a crash.
    const whole = fakeStreamChunk({
      model: FIXTURE_MODEL_ID,
      choices: [{ delta: { content: 'alpha' } }],
    });
    const cut = Math.floor(whole.length / 2);
    const onFirstOutput = vi.fn();
    const { target } = await prepared({
      script: [
        {
          chunks: [
            whole.slice(0, cut),
            whole.slice(cut),
            fakeStreamChunk({
              model: FIXTURE_MODEL_ID,
              choices: [],
              usage: { prompt_tokens: 11, completion_tokens: 1 },
            }),
            FAKE_STREAM_DONE,
          ],
        },
      ],
    });
    const result = await target.invoke(invocation({ onFirstOutput }));
    expect(onFirstOutput).toHaveBeenCalledTimes(1);
    expect(result).toStrictEqual({ outcome: 'SUCCESS', inputTokens: 11, outputTokens: 1 });
  });
});

describe('deadlines and cancellation reach the underlying request', () => {
  it('abandons a request that never finishes, as measurement DATA', async () => {
    const { target, transport } = await prepared({
      script: [{ hangUntilAborted: true }],
      requestTimeoutMicros: 20_000,
    });
    const result = await target.invoke(invocation({ requestTimeoutMicros: 20_000 }));
    expect(result).toStrictEqual({ outcome: 'FAILURE' });
    // The stream was closed, not abandoned. A benchmark that returned while the engine kept generating
    // would free a concurrency slot against a machine still busy with the last request.
    expect(transport.openStreams).toBe(0);
    expect(transport.closedStreams).toBeGreaterThan(0);
  });

  it('aborts the transport signal rather than merely giving up on a promise', async () => {
    const { target, transport } = await prepared({
      script: [{ hangUntilAborted: true }],
      requestTimeoutMicros: 20_000,
    });
    await target.invoke(invocation({ requestTimeoutMicros: 20_000 }));
    const sent = transport.requests.find((one) => one.path === '/chat/completions');
    expect(sent?.signal.aborted).toBe(true);
  });

  it('treats a SUITE cancellation as cancellation, never as a failed request', async () => {
    // A cancelled request has no latency to report. Recording it as a failure would put the operator
    // who pressed Ctrl-C into the success rate.
    const controller = new AbortController();
    const { target, transport } = await prepared({ script: [{ hangUntilAborted: true }] });
    const pending = target.invoke(invocation({ signal: controller.signal }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(transport.openStreams).toBe(0);
  });

  it('refuses to start when the suite is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { target, transport } = await prepared({});
    await expect(target.invoke(invocation({ signal: controller.signal }))).rejects.toMatchObject({
      code: 'REQUEST_CANCELLED',
    });
    expect(transport.requests.filter((one) => one.path === '/chat/completions')).toHaveLength(0);
  });

  it('leaves nothing in flight once it has settled', async () => {
    const { target, transport } = await prepared({});
    await target.invoke(invocation());
    expect(transport.openStreams).toBe(0);
  });
});

describe('token accounting is exact or refused', () => {
  it('reports the prepared input count and the engine completion count', async () => {
    const { target } = await prepared({
      script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID, completionTokens: 9 }) }],
    });
    expect(await target.invoke(invocation())).toStrictEqual({
      outcome: 'SUCCESS',
      inputTokens: 11,
      outputTokens: 9,
    });
  });

  it('refuses a stream that reports no usable completion count', async () => {
    // No invented number. "Approximately N tokens" divided into a throughput figure is a number nobody
    // can defend.
    const { target } = await prepared({
      script: [
        {
          chunks: [
            fakeStreamChunk({
              model: FIXTURE_MODEL_ID,
              choices: [{ delta: { content: 'alpha' } }],
            }),
            FAKE_STREAM_DONE,
          ],
        },
      ],
    });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_USAGE_INVALID',
    });
  });

  it('refuses a completion count of zero on a stream that produced output', async () => {
    const { target } = await prepared({
      script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID, completionTokens: 0 }) }],
    });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_USAGE_INVALID',
    });
  });

  it('refuses an output count above the cap the request asked for', async () => {
    const { target } = await prepared({
      script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID, completionTokens: 33 }) }],
      maximumOutputTokens: 32,
    });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_USAGE_INVALID',
    });
  });

  it('refuses a prompt count that disagrees with what was priced', async () => {
    // Never averaged, never replaced with the planned number. A drift here means the prompt or the
    // template changed, which is exactly what a benchmark must not smooth over.
    const { target } = await prepared({
      script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID, promptTokens: 12 }) }],
    });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_USAGE_INVALID',
    });
  });

  it('refuses a 200 that produced no output token at all', async () => {
    const { target } = await prepared({ script: [{ chunks: [FAKE_STREAM_DONE] }] });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_PROTOCOL_INVALID',
    });
  });

  it('counts locally when configured to, and refuses that configuration without a counter', async () => {
    const local = await prepared({
      configOverrides: { outputTokenAccounting: 'LOCAL_TOKENIZER_COUNT' },
      tokenizer: new FakeTokenizer({ promptTokens: 11, outputTokens: 4, withOutputCounting: true }),
      script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID, completionTokens: 99 }) }],
      maximumOutputTokens: 32,
    });
    // The engine claimed 99. The configuration said count locally, so 4 is what is recorded -- and 99
    // is not quietly substituted because it happened to be there.
    expect(await local.target.invoke(invocation())).toStrictEqual({
      outcome: 'SUCCESS',
      inputTokens: 11,
      outputTokens: 4,
    });
    expect(local.tokenizer.outputCalls).toBe(1);

    expect(() =>
      createRiyaLocalBenchmarkTarget({
        config: fixtureConfig({ outputTokenAccounting: 'LOCAL_TOKENIZER_COUNT' }),
        transport: new FakeEngineTransport(),
        tokenizer: new FakeTokenizer({ promptTokens: 11 }),
      }),
    ).toThrow(RiyaLocalBenchmarkError);
  });
});

describe('engine failures are classified, never leaked', () => {
  it('records an engine error status as a failed request', async () => {
    const { target } = await prepared({ script: [{ status: 500, chunks: ['boom'] }] });
    expect(await target.invoke(invocation())).toStrictEqual({ outcome: 'FAILURE' });
  });

  it('REFUSES a redirect rather than following it or recording it as a failure', async () => {
    const { target } = await prepared({ script: [{ status: 307, chunks: [] }] });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_REDIRECT_REFUSED',
    });
  });

  it('refuses a body that is not an event stream at all', async () => {
    const { target } = await prepared({
      script: [{ chunks: ['data: <html>redirecting</html>\n\n'] }],
    });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_PROTOCOL_INVALID',
    });
  });

  it('replaces a raw transport exception with a content-free code', async () => {
    // A transport error message can carry a URL, a port, a filesystem path or a proxy banner. None of
    // those may reach a benchmark log.
    const { target } = await prepared({
      script: [{ throwOnRequest: new Error('connect ECONNREFUSED 10.1.2.3:9999') }],
    });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'ENGINE_PROTOCOL_INVALID',
    });
    const thrown: unknown = await target.invoke(invocation()).catch((error: unknown) => error);
    expect((thrown as Error).message).toBe('ENGINE_PROTOCOL_INVALID');
    expect((thrown as Error).cause).toBeUndefined();
  });

  it('refuses an invocation for a case that was never prepared', async () => {
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: new FakeEngineTransport(),
      tokenizer: new FakeTokenizer(),
    });
    await expect(target.invoke(invocation())).rejects.toMatchObject({
      code: 'CASE_NOT_PREPARED',
    });
  });
});

describe('no generated text crosses the boundary', () => {
  it('returns counts and nothing else', async () => {
    const { target } = await prepared({});
    const result = await target.invoke(invocation());
    expect(Object.keys(result).sort()).toStrictEqual(['inputTokens', 'outcome', 'outputTokens']);
    expect(JSON.stringify(result)).not.toContain('alpha');
  });
});
