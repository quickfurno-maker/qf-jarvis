/**
 * Exact model identity, and the refusal of every way to be vague about it.
 *
 * A benchmark that measured one model and stamped another is worse than no benchmark: every number is
 * real, and every number is about the wrong thing. Nothing downstream can detect it, because there is
 * nothing wrong with the numbers.
 */
import { describe, expect, it } from 'vitest';

import {
  createRiyaLocalBenchmarkAdapterConfig,
  isExactServedModelId,
  riyaLocalBenchmarkSamplingDigest,
} from '../contracts/adapter-config.js';
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';
import { createRiyaLocalBenchmarkTarget } from '../service/local-engine-target.js';
import {
  FakeEngineTransport,
  FakeTokenizer,
  fakeHealthyStream,
  fakeStreamChunk,
} from '../testing/fakes.js';
import {
  FIXTURE_MODEL_ID,
  FIXTURE_SAMPLING,
  fixtureConfig,
  fixtureConfigInput,
  fixtureWorkload,
} from './fixtures.js';

function configCode(input: Parameters<typeof createRiyaLocalBenchmarkAdapterConfig>[0]): string {
  try {
    createRiyaLocalBenchmarkAdapterConfig(input);
  } catch (error: unknown) {
    return error instanceof RiyaLocalBenchmarkError ? error.code : 'NOT_A_LOCAL_ERROR';
  }
  return 'ACCEPTED';
}

function withModelId(modelId: string): Parameters<typeof createRiyaLocalBenchmarkAdapterConfig>[0] {
  const base = fixtureConfigInput();
  return {
    ...base,
    subject: { ...base.subject, release: { ...base.subject.release, modelId } },
  };
}

describe('the served model IS the release, and it must be exact', () => {
  it('accepts an exact namespaced catalogue id', () => {
    const config = fixtureConfig();
    expect(config.servedModelId).toBe(FIXTURE_MODEL_ID);
    expect(config.servedModelId).toBe(config.subject.release.modelId);
  });

  it('has no separate served-model field to disagree with the release', () => {
    // The forgery this removes: two plausible strings six lines apart, one measured and one stamped.
    expect(Object.keys(fixtureConfig())).not.toContain('servedModelName');
  });

  it('refuses a wildcard and a latest segment, through the release grammar it reuses', () => {
    expect(configCode(withModelId('vendor.alpha/*'))).toBe('ADAPTER_CONFIG_INVALID');
    expect(configCode(withModelId('vendor.alpha/latest'))).toBe('ADAPTER_CONFIG_INVALID');
    expect(configCode(withModelId('latest'))).toBe('ADAPTER_CONFIG_INVALID');
  });

  it('refuses the LOCAL-serving aliases the release grammar does not know about', () => {
    // Each names whatever the engine happened to load. This is an addition for local serving, not a
    // restatement of the release rule -- and it is the rule that catches `--served-model-name default`.
    for (const alias of ['default', 'auto', 'any', 'current', 'stable', 'model', 'local']) {
      expect(configCode(withModelId(alias)), alias).toBe('MODEL_IDENTITY_NOT_EXACT');
      expect(configCode(withModelId(`vendor.alpha/${alias}`)), alias).toBe(
        'MODEL_IDENTITY_NOT_EXACT',
      );
    }
  });

  it('accepts a name that merely CONTAINS an alias word', () => {
    // Governance, not grammar. `base.alpha-default-tune` is an ordinary name.
    expect(isExactServedModelId('vendor.alpha/base.alpha-default-tune')).toBe(true);
    expect(isExactServedModelId('vendor.alpha/autopilot-7')).toBe(true);
  });

  it('refuses a hosted release, which has no local hardware to be measured on', () => {
    const base = fixtureConfigInput();
    expect(
      configCode({
        ...base,
        subject: {
          ...base.subject,
          release: { ...base.subject.release, executionClass: 'HOSTED' },
        },
      }),
    ).toBe('ADAPTER_CONFIG_INVALID');
  });
});

describe('the engine is held to the configured model at run time', () => {
  const modelsBody = (ids: readonly string[]): string =>
    JSON.stringify({ data: ids.map((id) => ({ id })) });

  it('confirms an exact match through pre-benchmark control traffic', async () => {
    const transport = new FakeEngineTransport({
      modelsBody: modelsBody(['some.other/model-a', FIXTURE_MODEL_ID]),
    });
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport,
      tokenizer: new FakeTokenizer(),
    });
    await expect(target.verifyServedModel()).resolves.toBeUndefined();
    expect(transport.requests.map((one) => one.path)).toStrictEqual(['/models']);
  });

  it('refuses a listing that serves something else, even when it serves exactly one thing', async () => {
    // "It is the only model loaded, so it must be the one" is precisely how a benchmark ends up
    // attributed to the wrong release.
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: new FakeEngineTransport({ modelsBody: modelsBody(['vendor.alpha/base.alpha-7']) }),
      tokenizer: new FakeTokenizer(),
    });
    await expect(target.verifyServedModel()).rejects.toMatchObject({
      code: 'ENGINE_MODEL_MISMATCH',
    });
  });

  it('refuses a prefix match', async () => {
    const target = createRiyaLocalBenchmarkTarget({
      config: fixtureConfig(),
      transport: new FakeEngineTransport({
        modelsBody: modelsBody([`${FIXTURE_MODEL_ID}-instruct`]),
      }),
      tokenizer: new FakeTokenizer(),
    });
    await expect(target.verifyServedModel()).rejects.toMatchObject({
      code: 'ENGINE_MODEL_MISMATCH',
    });
  });

  it('refuses a STREAM whose chunks name a different model', async () => {
    // The substitution that control traffic cannot catch: the listing was right and the engine
    // answered with something else. Every chunk is checked, not just the first.
    const config = fixtureConfig();
    const transport = new FakeEngineTransport({
      script: [{ chunks: fakeHealthyStream({ model: 'vendor.alpha/base.alpha-7' }) }],
    });
    const target = createRiyaLocalBenchmarkTarget({
      config,
      transport,
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await target.prepareCase(fixtureWorkload());
    await expect(
      target.invoke({
        requestOrdinal: 0,
        requestTimeoutMicros: 5_000_000,
        signal: new AbortController().signal,
        onFirstOutput: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ENGINE_MODEL_MISMATCH' });
  });

  it('refuses a substitution that appears only after the first token', async () => {
    const config = fixtureConfig();
    const transport = new FakeEngineTransport({
      script: [
        {
          chunks: [
            fakeStreamChunk({
              model: FIXTURE_MODEL_ID,
              choices: [{ delta: { content: 'alpha' } }],
            }),
            fakeStreamChunk({
              model: 'vendor.alpha/base.alpha-7',
              choices: [{ delta: { content: 'beta' } }],
            }),
          ],
        },
      ],
    });
    const target = createRiyaLocalBenchmarkTarget({
      config,
      transport,
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await target.prepareCase(fixtureWorkload());
    await expect(
      target.invoke({
        requestOrdinal: 0,
        requestTimeoutMicros: 5_000_000,
        signal: new AbortController().signal,
        onFirstOutput: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ENGINE_MODEL_MISMATCH' });
  });

  it('sends the exact configured model, and no credential', async () => {
    const config = fixtureConfig();
    const transport = new FakeEngineTransport({
      script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID }) }],
    });
    const target = createRiyaLocalBenchmarkTarget({
      config,
      transport,
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });
    await target.prepareCase(fixtureWorkload());
    await target.invoke({
      requestOrdinal: 0,
      requestTimeoutMicros: 5_000_000,
      signal: new AbortController().signal,
      onFirstOutput: () => undefined,
    });
    const body = transport.sentBodies[0] ?? '';
    expect(JSON.parse(body)).toMatchObject({
      model: FIXTURE_MODEL_ID,
      max_tokens: 32,
      stream: true,
      temperature: FIXTURE_SAMPLING.temperature,
      top_p: FIXTURE_SAMPLING.topP,
      seed: FIXTURE_SAMPLING.seed,
    });
    // `token` is deliberately absent from this list: `max_tokens` is a legitimate field, and a check
    // that has to be weakened the first time it fires is a check nobody keeps.
    for (const forbidden of [
      'authorization',
      'api_key',
      'apiKey',
      'bearer',
      'x-api-key',
      'secret',
    ]) {
      expect(body.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // The request object itself carries no header field at all -- there is nowhere for one to sit.
    expect(Object.keys(transport.requests[0] ?? {}).sort()).toStrictEqual([
      'body',
      'method',
      'path',
      'signal',
    ]);
  });
});

describe('the sampling identity is derived, never transcribed', () => {
  it('is stable and depends on every knob', () => {
    const base = riyaLocalBenchmarkSamplingDigest(FIXTURE_SAMPLING);
    expect(riyaLocalBenchmarkSamplingDigest({ ...FIXTURE_SAMPLING })).toBe(base);
    expect(riyaLocalBenchmarkSamplingDigest({ ...FIXTURE_SAMPLING, seed: 8 })).not.toBe(base);
    expect(riyaLocalBenchmarkSamplingDigest({ ...FIXTURE_SAMPLING, temperature: 0.7 })).not.toBe(
      base,
    );
    expect(riyaLocalBenchmarkSamplingDigest({ ...FIXTURE_SAMPLING, topP: 0.9 })).not.toBe(base);
  });
});

describe('the runtime config digest records what was measured, and no machine identity', () => {
  it('moves when the token accounting changes', () => {
    // The failure an authored digest invites: two incomparable runs comparing as equal because
    // somebody changed a setting and forgot to bump a hash by hand.
    const server = fixtureConfig({ outputTokenAccounting: 'SERVER_REPORTED_USAGE' });
    const local = createRiyaLocalBenchmarkAdapterConfig({
      ...fixtureConfigInput({ outputTokenAccounting: 'LOCAL_TOKENIZER_COUNT' }),
    });
    expect(local.runtimeConfigDigest).not.toBe(server.runtimeConfigDigest);
  });

  it('moves when the engine version changes', () => {
    const base = fixtureConfig();
    const bumped = fixtureConfig({
      environment: { ...fixtureConfigInput().environment, runtimeEngineVersion: 'v1.2.4' },
    });
    expect(bumped.runtimeConfigDigest).not.toBe(base.runtimeConfigDigest);
  });

  it('does NOT depend on the endpoint, because the endpoint is machine identity', () => {
    // There is no code path from an endpoint into this digest, and the configuration has no endpoint
    // field at all -- the CLI takes it separately and never persists it.
    expect(Object.keys(fixtureConfig())).not.toContain('endpoint');
  });
});
