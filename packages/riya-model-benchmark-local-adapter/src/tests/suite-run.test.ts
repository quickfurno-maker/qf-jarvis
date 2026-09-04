/**
 * The adapter driven by the real RMB-B scheduler, against a scripted engine.
 *
 * The unit specs prove one request. This proves the thing that actually matters: that RMB-B accepts
 * this target unchanged, that the artifacts it produces are RMB-A evidence rather than something
 * assembled here, and that the parity checks RMB-B performs on a prepared case fire against a REAL
 * disagreement rather than against a fake designed to fail.
 */
import { RiyaHarnessError, runRiyaBenchmarkSuite } from '@qf-jarvis/riya-model-benchmark-harness';
import { verifyRiyaBenchmarkResultSet } from '@qf-jarvis/riya-model-benchmark';
import { describe, expect, it } from 'vitest';

import { createRiyaLocalBenchmarkTarget } from '../service/local-engine-target.js';
import { createRiyaLocalMonotonicClock } from '../service/monotonic-clock.js';
import { buildRiyaLocalBenchmarkRunManifest } from '../service/run-manifest.js';
import {
  FakeEngineTransport,
  FakeTokenizer,
  fakeHealthyStream,
  SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
} from '../testing/fakes.js';
import { FIXTURE_MODEL_ID, fixtureConfig, fixturePlan } from './fixtures.js';

function scriptedTransport(): FakeEngineTransport {
  return new FakeEngineTransport({
    script: [{ chunks: fakeHealthyStream({ model: FIXTURE_MODEL_ID, completionTokens: 5 }) }],
  });
}

describe('a whole suite runs through RMB-B against this adapter', () => {
  it('produces a verifiable RMB-A result set with no memory and no approval', async () => {
    const config = fixtureConfig();
    const transport = scriptedTransport();
    const target = createRiyaLocalBenchmarkTarget({
      config,
      transport,
      tokenizer: new FakeTokenizer({ promptTokens: 11 }),
    });

    const plan = fixturePlan({ warmupRequestCount: 1, measuredRequestCount: 4, concurrency: 2 });
    const resultSet = await runRiyaBenchmarkSuite({
      plan,
      target,
      clock: createRiyaLocalMonotonicClock(),
      createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
    });

    // RMB-A's own verifier, on the artifact as produced. Nothing here rebuilt a digest by hand.
    expect(verifyRiyaBenchmarkResultSet(JSON.parse(JSON.stringify(resultSet)))).toBeDefined();
    expect(resultSet.caseIds).toStrictEqual(['case.short.c1']);

    const evidence = resultSet.results[0];
    expect(evidence?.observation.attemptedRequests).toBe(4);
    expect(evidence?.observation.successfulRequests).toBe(4);
    expect(evidence?.observation.outputTokensTotal).toBe(20);
    expect(evidence?.observation.inputTokensTotal).toBe(44);
    expect(evidence?.syntheticWorkload).toBe(true);
    expect(evidence?.productionApproval).toBe(false);
    // Not measured, so not present. A fabricated zero would sit in a comparison table beside real
    // readings from a machine that could measure.
    expect(evidence?.observation.peakAcceleratorMemoryBytes).toBeUndefined();
    expect(evidence?.observation.peakHostMemoryBytes).toBeUndefined();

    // Warmup was excluded from the numbers but did reach the engine.
    expect(transport.sentBodies).toHaveLength(5);
    expect(transport.openStreams).toBe(0);
  });

  it('stamps the exact release and the LOCAL environment the config bound', async () => {
    const config = fixtureConfig();
    const resultSet = await runRiyaBenchmarkSuite({
      plan: fixturePlan(),
      target: createRiyaLocalBenchmarkTarget({
        config,
        transport: scriptedTransport(),
        tokenizer: new FakeTokenizer({ promptTokens: 11 }),
      }),
      clock: createRiyaLocalMonotonicClock(),
      createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
    });
    const evidence = resultSet.results[0];
    expect(evidence?.subject.release.modelId).toBe(FIXTURE_MODEL_ID);
    expect(evidence?.environment.kind).toBe('LOCAL_EXPLICIT');
    expect(evidence?.environment.runtimeConfigDigest).toBe(config.runtimeConfigDigest);
  });

  it('carries no prompt, no completion and no machine identity anywhere in the artifact', async () => {
    const resultSet = await runRiyaBenchmarkSuite({
      plan: fixturePlan(),
      target: createRiyaLocalBenchmarkTarget({
        config: fixtureConfig(),
        transport: scriptedTransport(),
        tokenizer: new FakeTokenizer({ promptTokens: 11 }),
      }),
      clock: createRiyaLocalMonotonicClock(),
      createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
    });
    const serialized = JSON.stringify(resultSet).toLowerCase();
    for (const forbidden of [
      'you are a synthetic',
      'alpha beta',
      '127.0.0.1',
      'localhost',
      'http://',
      'authorization',
      'users\\',
      '/home/',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('lets RMB-B refuse a token-count disagreement BEFORE any request is sent', async () => {
    // The parity mechanism, end to end and non-vacuous: the plan declares 11, the engine's tokenizer
    // says 480, `prepareCase` reports 480, and RMB-B refuses the case rather than measuring it.
    const transport = scriptedTransport();
    await expect(
      runRiyaBenchmarkSuite({
        plan: fixturePlan({ inputTokenCount: 11 }),
        target: createRiyaLocalBenchmarkTarget({
          config: fixtureConfig(),
          transport,
          tokenizer: new FakeTokenizer({ promptTokens: 480 }),
        }),
        clock: createRiyaLocalMonotonicClock(),
        createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
      }),
    ).rejects.toMatchObject({ code: 'TARGET_CASE_MISMATCH' });
    expect(transport.sentBodies).toHaveLength(0);
  });

  it('produces NO partial result set when the engine breaks the protocol', async () => {
    const transport = new FakeEngineTransport({ script: [{ chunks: ['data: {"nope":1}\n\n'] }] });
    await expect(
      runRiyaBenchmarkSuite({
        plan: fixturePlan(),
        target: createRiyaLocalBenchmarkTarget({
          config: fixtureConfig(),
          transport,
          tokenizer: new FakeTokenizer({ promptTokens: 11 }),
        }),
        clock: createRiyaLocalMonotonicClock(),
        createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
      }),
    ).rejects.toBeInstanceOf(RiyaHarnessError);
    expect(transport.openStreams).toBe(0);
  });

  it('drains every in-flight request when the suite is cancelled', async () => {
    const controller = new AbortController();
    const transport = new FakeEngineTransport({ script: [{ hangUntilAborted: true }] });
    const pending = runRiyaBenchmarkSuite({
      plan: fixturePlan({ measuredRequestCount: 4, concurrency: 4 }),
      target: createRiyaLocalBenchmarkTarget({
        config: fixtureConfig(),
        transport,
        tokenizer: new FakeTokenizer({ promptTokens: 11 }),
      }),
      clock: createRiyaLocalMonotonicClock(),
      createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
      signal: controller.signal,
    });
    // Let the requests reach the engine before cancelling, so the drain has something to drain.
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RiyaHarnessError);
    // The load stopped when the harness returned. This is the property that would be false under a
    // `Promise.race` timeout, and it would be false silently.
    expect(transport.openStreams).toBe(0);
  });

  it('yields a manifest that joins to the evidence and names no address', async () => {
    const config = fixtureConfig();
    const plan = fixturePlan();
    const resultSet = await runRiyaBenchmarkSuite({
      plan,
      target: createRiyaLocalBenchmarkTarget({
        config,
        transport: scriptedTransport(),
        tokenizer: new FakeTokenizer({ promptTokens: 11 }),
      }),
      clock: createRiyaLocalMonotonicClock(),
      createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
    });
    const manifest = buildRiyaLocalBenchmarkRunManifest({
      config,
      resultSet,
      benchmarkSuiteId: plan.benchmarkSuiteId,
      benchmarkSuiteVersion: plan.benchmarkSuiteVersion,
      endpointHostForm: 'IPV4_LOOPBACK',
      createdAt: SYNTHETIC_LOCAL_BENCHMARK_INSTANT,
    });
    expect(manifest.resultSetDigest).toBe(resultSet.resultSetDigest);
    expect(manifest.caseIds).toStrictEqual([...resultSet.caseIds]);
    expect(manifest.acceleratorMemoryMeasured).toBe(false);
    expect(manifest.productionApproval).toBe(false);
    expect(manifest.syntheticWorkload).toBe(true);
    const serialized = JSON.stringify(manifest);
    for (const forbidden of ['127.0.0.1', 'http://', ':8000', 'localhost']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
