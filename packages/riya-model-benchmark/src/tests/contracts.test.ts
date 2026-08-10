/**
 * RMB-A — subject, environment, workload and observation contracts.
 *
 * The observation specs are the ones that matter most. A benchmark harness that breaks does not
 * usually produce obviously wrong numbers; it produces plausible ones over a population nobody can
 * name, and the worst case — a run where everything failed — produces the FASTEST numbers anybody has
 * seen. Those are the failures these specs are built around.
 */
import { describe, expect, it } from 'vitest';

import { createRiyaBenchmarkEnvironment } from '../contracts/environment.js';
import { RiyaBenchmarkError } from '../contracts/errors.js';
import { createRiyaBenchmarkObservation } from '../contracts/observation.js';
import { createRiyaBenchmarkSubject } from '../contracts/subject.js';
import { createRiyaBenchmarkWorkload, workloadParityKey } from '../contracts/workload.js';
import {
  syntheticDigest,
  syntheticHostedEnvironment,
  syntheticLocalEnvironment,
  syntheticObservation,
  syntheticSubject,
  syntheticWorkload,
} from '../testing/fixtures.js';

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaBenchmarkError ? error.code : 'not-a-benchmark-error';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// 1–5. Subject.
// ---------------------------------------------------------------------------

describe('the subject names a release, and reuses the repo grammar to do it', () => {
  it('accepts a well-formed subject and freezes it', () => {
    const subject = syntheticSubject();
    expect(subject.version).toBe(1);
    expect(subject.release.modelId).toBe('model.alpha');
    expect(Object.isFrozen(subject)).toBe(true);
    expect(Object.isFrozen(subject.release)).toBe(true);
  });

  it('re-proves the release through the EVALUATION package, not a local copy', () => {
    // A namespaced catalogue id is legal because the evaluation grammar says so. If this package had
    // its own schema, this is exactly where the two would drift.
    const namespaced = syntheticSubject({ modelId: 'vendor.alpha/model-alpha-7b' });
    expect(namespaced.release.modelId).toBe('vendor.alpha/model-alpha-7b');

    // And the wildcard rule comes across with it, exactly as the evaluation package defines it.
    for (const modelId of ['latest', 'LATEST', 'model.*']) {
      expect(
        codeOf(() => syntheticSubject({ modelId })),
        modelId,
      ).toBe('SUBJECT_INVALID');
    }
    expect(codeOf(() => syntheticSubject({ releaseId: 'latest' }))).toBe('SUBJECT_INVALID');
  });

  it('INHERITED GAP: a SEGMENT-level `latest` is not refused, and that is deliberate here', () => {
    // `@qf-jarvis/model-evaluation` rejects a token that IS `latest`, not one that ends in
    // `/latest`, so `vendor.alpha/latest` reaches an evaluation binding today. This package inherits
    // that behaviour rather than tightening it.
    //
    // Diverging would be worse than the gap: the same release would be acceptable to safety evidence
    // and refused by benchmark evidence, and the two artifacts could no longer be read together —
    // which is the entire reason the grammar is shared. One grammar means one grammar, including its
    // limits. Closing it belongs to the package that owns the rule.
    //
    // This spec exists so the gap is recorded rather than discovered, and so it fails loudly if the
    // evaluation package tightens the rule and this comment goes stale.
    expect(codeOf(() => syntheticSubject({ modelId: 'vendor.alpha/latest' }))).toBe('no-error');
  });

  it('refuses an unknown key', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkSubject({
          ...syntheticSubject(),
          quantization: 'q4',
        } as never),
      ),
    ).toBe('SUBJECT_INVALID');
  });

  it('refuses a short digest — the repo does not accept a weaker identity here', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkSubject({
          ...syntheticSubject(),
          promptDigest: 'abc123',
        }),
      ),
    ).toBe('SUBJECT_INVALID');
    expect(
      codeOf(() =>
        createRiyaBenchmarkSubject({
          ...syntheticSubject(),
          promptDigest: syntheticDigest('abcd').toUpperCase(),
        }),
      ),
    ).toBe('SUBJECT_INVALID');
  });

  it('re-proving a canonical subject is idempotent', () => {
    const once = syntheticSubject();
    expect(createRiyaBenchmarkSubject(once)).toStrictEqual(once);
  });

  it('a different prompt digest is a different subject', () => {
    const a = syntheticSubject();
    const b = syntheticSubject({ promptDigest: syntheticDigest('fee1') });
    expect(a.promptDigest).not.toBe(b.promptDigest);
  });
});

// ---------------------------------------------------------------------------
// 6–10. Environment.
// ---------------------------------------------------------------------------

describe('the environment compares machines without identifying one', () => {
  it('accepts a local profile', () => {
    const environment = syntheticLocalEnvironment();
    expect(environment.kind).toBe('LOCAL_EXPLICIT');
    expect(environment.acceleratorCount).toBe(1);
    expect(Object.isFrozen(environment)).toBe(true);
  });

  it('accepts a hosted profile that claims no hardware', () => {
    const environment = syntheticHostedEnvironment();
    expect(environment.kind).toBe('HOSTED_OPAQUE');
    expect(environment.architectureFamily).toBeUndefined();
    expect(environment.acceleratorCount).toBeUndefined();
    expect(environment.hostMemoryBytes).toBeUndefined();
  });

  it('a HOSTED profile may NOT invent hardware', () => {
    // An invented accelerator count is worse than an absent one: absent is a known unknown.
    for (const extra of [
      { architectureFamily: 'X86_64' as const },
      { acceleratorFamily: 'DISCRETE_GPU' as const },
      { acceleratorCount: 8 },
      { hostMemoryBytes: 68_719_476_736 },
    ]) {
      expect(
        codeOf(() =>
          createRiyaBenchmarkEnvironment({
            version: 1,
            kind: 'HOSTED_OPAQUE',
            ...extra,
          }),
        ),
        JSON.stringify(extra),
      ).toBe('ENVIRONMENT_INVALID');
    }
  });

  it('there is NO FIELD a hostname, user, path or credential could go in', () => {
    for (const leak of [
      { hostname: 'build-box-04' },
      { username: 'kesh' },
      { devicePath: '/dev/nvidia0' },
      { serialNumber: 'GPU-1234' },
      { ipAddress: '10.0.0.4' },
      { apiKey: 'sk-test' },
      { instanceId: 'i-0abc' },
    ]) {
      expect(
        codeOf(() => createRiyaBenchmarkEnvironment({ ...syntheticLocalEnvironment(), ...leak })),
        JSON.stringify(leak),
      ).toBe('ENVIRONMENT_INVALID');
    }
  });

  it('accelerator family and count must agree', () => {
    // "NONE, four of them" is a harness bug that survives review because each field looks fine alone.
    expect(
      codeOf(() =>
        createRiyaBenchmarkEnvironment({
          version: 1,
          kind: 'LOCAL_EXPLICIT',
          architectureFamily: 'X86_64',
          acceleratorFamily: 'NONE',
          acceleratorCount: 4,
        }),
      ),
    ).toBe('ENVIRONMENT_INVALID');
    expect(
      codeOf(() =>
        createRiyaBenchmarkEnvironment({
          version: 1,
          kind: 'LOCAL_EXPLICIT',
          architectureFamily: 'X86_64',
          acceleratorFamily: 'DISCRETE_GPU',
          acceleratorCount: 0,
        }),
      ),
    ).toBe('ENVIRONMENT_INVALID');
    // Per-device memory with no device.
    expect(
      codeOf(() =>
        createRiyaBenchmarkEnvironment({
          version: 1,
          kind: 'LOCAL_EXPLICIT',
          architectureFamily: 'X86_64',
          acceleratorFamily: 'CPU_ONLY',
          acceleratorMemoryBytesPerDevice: 1_073_741_824,
        }),
      ),
    ).toBe('ENVIRONMENT_INVALID');
  });

  it('a local profile must say what it ran on', () => {
    expect(
      codeOf(() => createRiyaBenchmarkEnvironment({ version: 1, kind: 'LOCAL_EXPLICIT' })),
    ).toBe('ENVIRONMENT_INVALID');
  });

  it('re-proving a canonical environment is idempotent, both kinds', () => {
    const local = syntheticLocalEnvironment();
    const hosted = syntheticHostedEnvironment();
    expect(createRiyaBenchmarkEnvironment(local)).toStrictEqual(local);
    expect(createRiyaBenchmarkEnvironment(hosted)).toStrictEqual(hosted);
  });
});

// ---------------------------------------------------------------------------
// 11–16. Workload.
// ---------------------------------------------------------------------------

describe('the workload carries counts and digests, and no text at all', () => {
  it('accepts a well-formed workload', () => {
    const workload = syntheticWorkload();
    expect(workload.concurrency).toBe(1);
    expect(Object.isFrozen(workload)).toBe(true);
  });

  it('there is NO FIELD a prompt, message or transcript could go in', () => {
    for (const leak of [
      { prompt: 'What is the price of a modular kitchen?' },
      { systemPrompt: 'You are Riya.' },
      { messages: [{ role: 'user', content: 'hi' }] },
      { transcript: 'user: hi' },
      { sampleText: 'hello' },
    ]) {
      expect(
        codeOf(() => createRiyaBenchmarkWorkload({ ...syntheticWorkload(), ...leak })),
        JSON.stringify(leak).slice(0, 30),
      ).toBe('WORKLOAD_INVALID');
    }
    // And the only prompt-shaped field is a digest.
    expect(syntheticWorkload().promptProfileDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('refuses non-positive, fractional and absurd counts', () => {
    for (const bad of [
      { inputTokenCount: 0 },
      { measuredRequestCount: 0 },
      { concurrency: 0 },
      { batchSize: 0 },
      { maximumOutputTokens: 0 },
      { concurrency: 1.5 },
      { warmupRequestCount: -1 },
      { concurrency: 100_000 },
    ]) {
      expect(
        codeOf(() => createRiyaBenchmarkWorkload({ ...syntheticWorkload(), ...bad })),
        JSON.stringify(bad),
      ).toBe('WORKLOAD_INVALID');
    }
    // Zero warmups is legitimate: cold start is a real thing to measure.
    expect(
      createRiyaBenchmarkWorkload({ ...syntheticWorkload(), warmupRequestCount: 0 }),
    ).toBeDefined();
  });

  it('the parity key is deterministic and excludes the case id', () => {
    const a = syntheticWorkload({ workloadCaseId: 'case.alpha' });
    const b = syntheticWorkload({ workloadCaseId: 'case.beta' });
    expect(workloadParityKey(a)).toBe(workloadParityKey(b));
    expect(workloadParityKey(a)).toBe(workloadParityKey(syntheticWorkload()));
  });

  it('concurrency changes the parity identity', () => {
    expect(workloadParityKey(syntheticWorkload({ concurrency: 4 }))).not.toBe(
      workloadParityKey(syntheticWorkload()),
    );
  });

  it('the prompt profile digest changes the parity identity', () => {
    expect(
      workloadParityKey(syntheticWorkload({ promptProfileDigest: syntheticDigest('bead') })),
    ).not.toBe(workloadParityKey(syntheticWorkload()));
  });
});

// ---------------------------------------------------------------------------
// 17–22. Observation.
// ---------------------------------------------------------------------------

describe('an observation must be internally honest', () => {
  it('accepts a healthy run', () => {
    const observation = syntheticObservation();
    expect(observation.successfulRequests).toBe(20);
    expect(Object.isFrozen(observation)).toBe(true);
  });

  it('requests must balance', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkObservation({ ...syntheticObservation(), failedRequests: 3 }),
      ),
    ).toBe('REQUEST_COUNT_MISMATCH');
    // And the honest version of that run is accepted.
    expect(
      createRiyaBenchmarkObservation({
        ...syntheticObservation(),
        successfulRequests: 17,
        failedRequests: 3,
      }).failedRequests,
    ).toBe(3);
  });

  it('a p95 below its p50 is swapped fields, not a fast tail', () => {
    expect(
      codeOf(() =>
        createRiyaBenchmarkObservation({
          ...syntheticObservation(),
          endToEndLatencyMicrosP50: 2_000_000,
        }),
      ),
    ).toBe('PERCENTILE_ORDER_INVALID');
  });

  it('a percentile pair must be whole', () => {
    const { timeToFirstTokenMicrosP95: _dropped, ...half } = syntheticObservation();
    expect(codeOf(() => createRiyaBenchmarkObservation(half))).toBe('PERCENTILE_ORDER_INVALID');
  });

  it('THE IMPORTANT ONE: a run where nothing succeeded cannot claim latency', () => {
    // Total failure produces the most flattering numbers a harness can emit — instant
    // time-to-first-token, because there were no tokens. Read out of context later, it looks like
    // the fastest configuration anyone tried.
    expect(
      codeOf(() =>
        createRiyaBenchmarkObservation({
          ...syntheticObservation(),
          successfulRequests: 0,
          failedRequests: 20,
          outputTokensTotal: 0,
        }),
      ),
    ).toBe('PERCENTILE_ORDER_INVALID');
  });

  it('a total-failure run IS representable — with no latency and no tokens', () => {
    // Refusing to record the failure would be its own dishonesty.
    const observation = createRiyaBenchmarkObservation({
      version: 1,
      attemptedRequests: 20,
      successfulRequests: 0,
      failedRequests: 20,
      inputTokensTotal: 10_240,
      outputTokensTotal: 0,
    });
    expect(observation.successfulRequests).toBe(0);
    expect(observation.endToEndLatencyMicrosP50).toBeUndefined();
    expect(observation.decodeMicrosPerOutputTokenP50).toBeUndefined();
  });

  it('tokens and decode speed must tell the same story', () => {
    const {
      decodeMicrosPerOutputTokenP50: _a,
      decodeMicrosPerOutputTokenP95: _b,
      ...noDecode
    } = syntheticObservation();
    expect(codeOf(() => createRiyaBenchmarkObservation(noDecode))).toBe(
      'TOKEN_MEASUREMENT_INVALID',
    );
    expect(
      codeOf(() =>
        createRiyaBenchmarkObservation({ ...syntheticObservation(), outputTokensTotal: 0 }),
      ),
    ).toBe('TOKEN_MEASUREMENT_INVALID');
    expect(
      codeOf(() =>
        createRiyaBenchmarkObservation({ ...syntheticObservation(), inputTokensTotal: 0 }),
      ),
    ).toBe('TOKEN_MEASUREMENT_INVALID');
    expect(
      codeOf(() =>
        createRiyaBenchmarkObservation({
          version: 1,
          attemptedRequests: 5,
          successfulRequests: 0,
          failedRequests: 5,
          inputTokensTotal: 100,
          outputTokensTotal: 40,
        }),
      ),
    ).toBe('TOKEN_MEASUREMENT_INVALID');
  });

  it('refuses fractional, negative and non-finite evidence values', () => {
    for (const bad of [
      { endToEndLatencyMicrosP50: 900_000.5 },
      { successfulRequests: -1 },
      { outputTokensTotal: Number.NaN },
      { endToEndLatencyMicrosP95: Number.POSITIVE_INFINITY },
      { peakHostMemoryBytes: 0 },
    ]) {
      expect(
        codeOf(() => createRiyaBenchmarkObservation({ ...syntheticObservation(), ...bad })),
        JSON.stringify(bad),
      ).toBe('OBSERVATION_INVALID');
    }
  });

  it('memory is optional, and valid when present', () => {
    const {
      peakAcceleratorMemoryBytes: _a,
      peakHostMemoryBytes: _b,
      ...noMemory
    } = syntheticObservation();
    const observation = createRiyaBenchmarkObservation(noMemory);
    expect(observation.peakAcceleratorMemoryBytes).toBeUndefined();
    expect(syntheticObservation().peakHostMemoryBytes).toBe(4_294_967_296);
  });

  it('re-proving a canonical observation is idempotent', () => {
    const once = syntheticObservation();
    expect(createRiyaBenchmarkObservation(once)).toStrictEqual(once);
  });
});
