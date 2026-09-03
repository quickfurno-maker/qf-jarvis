/**
 * Bounded run orchestration (AS2 correction pass, ADR-0143 §24).
 *
 * `maxConcurrentCandidates` and `maxConcurrentInvocations` were policy fields nothing enforced — a
 * caller could `Promise.all` any number of candidates and exceed both while the report claimed
 * bounded concurrency. These specs are what make the fields mean something.
 */
import { describe, expect, it } from 'vitest';

import {
  createFakeClaudeInvoker,
  createFakeGptInvoker,
  orchestrateRiyaSyntheticRun,
  RiyaSyntheticGenerationError,
} from '../index.js';
import type {
  RiyaSyntheticGenerationPolicyV1,
  RiyaSyntheticInvokerRegistry,
  RiyaSyntheticModelInvoker,
  RiyaSyntheticRunItem,
} from '../index.js';
import {
  CRITIC_DIMENSIONS,
  gptTaughtAllocation,
  inventory,
  policy,
  scenarios,
} from './fixtures.js';

const INVENTORY = inventory();

/** Tracks how many invocations are in flight at once, across every candidate. */
function tracking(): {
  readonly peak: () => number;
  /** TOTAL invocations attempted, not just those in flight. Zero is the interesting value. */
  readonly calls: () => number;
  readonly wrap: (inner: RiyaSyntheticModelInvoker) => RiyaSyntheticModelInvoker;
} {
  let active = 0;
  let peak = 0;
  let calls = 0;
  return {
    peak: () => peak,
    calls: () => calls,
    wrap: (inner) => ({
      invoke: async (request, structuredInput, options) => {
        active += 1;
        calls += 1;
        if (active > peak) peak = active;
        try {
          return await inner.invoke(request, structuredInput, options);
        } finally {
          active -= 1;
        }
      },
    }),
  };
}

function registry(track: ReturnType<typeof tracking>): RiyaSyntheticInvokerRegistry {
  const slow = { delayMs: 40 };
  const entries: readonly (readonly [string, RiyaSyntheticModelInvoker])[] = [
    ['cfg.planner', createFakeGptInvoker(slow)],
    ['cfg.sim.gpt', createFakeGptInvoker(slow)],
    ['cfg.sim.claude', createFakeClaudeInvoker(slow)],
    ['cfg.teacher.gpt', createFakeGptInvoker(slow)],
    ['cfg.teacher.claude', createFakeClaudeInvoker(slow)],
    ['cfg.verify.gpt', createFakeGptInvoker(slow)],
    ['cfg.verify.claude', createFakeClaudeInvoker(slow)],
    ['cfg.critic.gpt', createFakeGptInvoker(slow)],
    ['cfg.critic.gpt.two', createFakeGptInvoker(slow)],
    ['cfg.critic.claude', createFakeClaudeInvoker(slow)],
    ['cfg.critic.claude.two', createFakeClaudeInvoker(slow)],
  ];
  return new Map(entries.map(([ref, invoker]) => [ref, track.wrap(invoker)]));
}

/** Five distinct scenarios, each with its own generation identity. */
function items(count = 5): readonly RiyaSyntheticRunItem[] {
  return scenarios(count).map((scenario, index) => ({
    scenario,
    allocation: gptTaughtAllocation({ generationRef: `gen.run.${String(index)}` }),
  }));
}

describe('the run orchestrator enforces the concurrency policy', () => {
  it('never runs more candidates at once than the policy allows', async () => {
    const track = tracking();

    const result = await orchestrateRiyaSyntheticRun({
      items: items(5),
      inventory: INVENTORY,
      policy: policy({ maxConcurrentCandidates: 2, maxConcurrentInvocations: 8 }),
      invokers: registry(track),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    expect(result.outcomes).toHaveLength(5);
    expect(result.peakConcurrentCandidates).toBeGreaterThan(1);
    expect(result.peakConcurrentCandidates).toBeLessThanOrEqual(2);
  }, 30_000);

  it('never runs more invocations at once than the policy allows, ACROSS candidates', async () => {
    // The failure a per-candidate limiter would miss: three candidates each politely running two
    // calls is six concurrent calls.
    const track = tracking();

    const result = await orchestrateRiyaSyntheticRun({
      items: items(5),
      inventory: INVENTORY,
      policy: policy({ maxConcurrentCandidates: 4, maxConcurrentInvocations: 3 }),
      invokers: registry(track),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    // Measured independently by the wrapper, not just self-reported by the gate.
    expect(track.peak()).toBeGreaterThan(1);
    expect(track.peak()).toBeLessThanOrEqual(3);
    expect(result.peakConcurrentInvocations).toBeLessThanOrEqual(3);
  }, 30_000);

  it('returns outcomes in INPUT order, whatever order they complete in', async () => {
    const track = tracking();
    const planned = items(5);

    const result = await orchestrateRiyaSyntheticRun({
      items: planned,
      inventory: INVENTORY,
      policy: policy({ maxConcurrentCandidates: 3, maxConcurrentInvocations: 4 }),
      invokers: registry(track),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    expect(result.outcomes.map((one) => one.scenarioRef)).toStrictEqual(
      planned.map((one) => one.scenario.scenarioRef),
    );
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe('GENERATED');
    }
  }, 30_000);

  it('records a failed candidate as an outcome rather than abandoning the run', async () => {
    // One bad candidate must not end a run. Throwing here is the pressure that leads somebody to
    // retry until things pass.
    const track = tracking();
    const invokers = new Map(registry(track));
    invokers.set('cfg.teacher.gpt', createFakeGptInvoker({ permanentFailure: true }));

    const result = await orchestrateRiyaSyntheticRun({
      items: items(3),
      inventory: INVENTORY,
      policy: policy({ maxConcurrentCandidates: 2, maxConcurrentInvocations: 4 }),
      invokers,
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    expect(result.outcomes).toHaveLength(3);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe('FAILED');
      expect(outcome.errorCode).toBe('permanent-provider-failure');
    }
    // Permits were freed on the failure path -- a leak would have stalled the run instead.
    expect(result.peakConcurrentCandidates).toBeLessThanOrEqual(2);
  }, 30_000);

  it('stops scheduling new candidates once the run is aborted', async () => {
    const track = tracking();
    const controller = new AbortController();
    controller.abort();

    const result = await orchestrateRiyaSyntheticRun({
      items: items(5),
      inventory: INVENTORY,
      policy: policy({ maxConcurrentCandidates: 2, maxConcurrentInvocations: 4 }),
      invokers: registry(track),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
      signal: controller.signal,
    });

    // Nothing was started, and every scenario is still accounted for.
    expect(result.outcomes).toHaveLength(5);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe('NOT_STARTED');
    }
    expect(track.peak()).toBe(0);
  }, 30_000);

  it('subjects critic invocations to the same shared limit', async () => {
    // Critics are model calls too. A limiter that covered only the conversation would let the critic
    // fan-out blow straight through the ceiling at the end of every candidate.
    const track = tracking();

    await orchestrateRiyaSyntheticRun({
      items: items(4),
      inventory: INVENTORY,
      policy: policy({ maxConcurrentCandidates: 4, maxConcurrentInvocations: 2 }),
      invokers: registry(track),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    expect(track.peak()).toBeLessThanOrEqual(2);
  }, 30_000);
});

/**
 * The public run entry proves its own policy (AS2 final correction, ADR-0143 §24).
 *
 * `orchestrateRiyaSyntheticRun` is exported, so `options.policy` is a runtime value and not a type.
 * It used to read `maxConcurrentInvocations` and `maxConcurrentCandidates` straight off the supplied
 * object to BUILD the two gates, and only the per-candidate path re-proved the policy afterwards.
 *
 * The constructor requires both limits to be at least 1, and the gap was not cosmetic: a forged
 * `maxConcurrentCandidates: 0` produced a gate whose acquire loop waits for a permit nothing ever
 * grants, so the run HUNG before any candidate could reach the deep re-proof that would have rejected
 * it. A hang is the worst possible failure here — no error, no outcome, no evidence, and a caller
 * with nothing to read.
 *
 * These specs pin the entry-level re-proof. Each one asserts three things together, because any two
 * of them can hold while the defect remains: it must SETTLE, it must settle as a REJECTION carrying
 * the closed code, and it must have spent NOTHING.
 */
describe('the public run entry re-proves its policy before building a gate', () => {
  /** A settlement, or the absence of one. A hang is a result this suite has to be able to name. */
  type Settled =
    | { readonly kind: 'rejected'; readonly error: unknown }
    | { readonly kind: 'resolved' }
    | { readonly kind: 'hung' };

  /**
   * Race a run against a deadline.
   *
   * `rejects.toThrow()` would report a hang as a bare test timeout, which reads like a slow machine
   * rather than the specific defect. This distinguishes them, so a regression says `hung` out loud.
   */
  async function settle(promise: Promise<unknown>, ms: number): Promise<Settled> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<Settled>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: 'hung' });
      }, ms);
    });
    const watched: Promise<Settled> = promise.then(
      () => ({ kind: 'resolved' }) as const,
      (error: unknown) => ({ kind: 'rejected', error }) as const,
    );
    try {
      return await Promise.race([watched, guard]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Run with `forged` and report how it ended plus what it spent. */
  async function runWith(
    forged: RiyaSyntheticGenerationPolicyV1,
  ): Promise<{ readonly settled: Settled; readonly calls: number }> {
    const track = tracking();
    const settled = await settle(
      orchestrateRiyaSyntheticRun({
        items: items(3),
        inventory: INVENTORY,
        policy: forged,
        invokers: registry(track),
        criticQualityDimensions: [...CRITIC_DIMENSIONS],
      }),
      2_000,
    );
    return { settled, calls: track.calls() };
  }

  function expectRejectedAsInvalidPolicy(settled: Settled): void {
    // Named explicitly so a hang is not mistaken for a slow rejection.
    expect(settled.kind).toBe('rejected');
    const error = settled.kind === 'rejected' ? settled.error : undefined;
    expect(error).toBeInstanceOf(RiyaSyntheticGenerationError);
    expect((error as RiyaSyntheticGenerationError).code).toBe('invalid-generation-policy');
  }

  it('rejects a forged maxConcurrentCandidates of 0 instead of hanging on a zero-limit gate', async () => {
    // THE hang. `Math.max(1, Math.min(0, items.length))` still starts one worker, and that worker
    // waits forever on the candidate gate.
    const forged: RiyaSyntheticGenerationPolicyV1 = {
      ...policy({ maxConcurrentInvocations: 4 }),
      maxConcurrentCandidates: 0,
    };

    const { settled, calls } = await runWith(forged);

    expectRejectedAsInvalidPolicy(settled);
    expect(calls).toBe(0);
  }, 15_000);

  it('rejects a forged maxConcurrentInvocations of 0, and spends nothing doing it', async () => {
    // The other zero-limit gate. Without the entry re-proof this did not hang, which is arguably
    // worse: the run RESOLVED, reporting every candidate as FAILED, blaming the candidates for a
    // policy that was never valid.
    const forged: RiyaSyntheticGenerationPolicyV1 = {
      ...policy({ maxConcurrentCandidates: 2 }),
      maxConcurrentInvocations: 0,
    };

    const { settled, calls } = await runWith(forged);

    expectRejectedAsInvalidPolicy(settled);
    expect(calls).toBe(0);
  }, 15_000);

  it('rejects a forged maxStructuralRepairAttempts of 50 at the run entry', async () => {
    // Not a concurrency field at all. The point is that the ENTIRE policy is re-proved at the entry,
    // not just the two numbers the gates happen to read — a repair budget of 50 is the retry loop
    // the contract's 0-or-1 bound exists to prevent, and it must not survive one invocation.
    const forged: RiyaSyntheticGenerationPolicyV1 = {
      ...policy(),
      maxStructuralRepairAttempts: 50,
    };

    const { settled, calls } = await runWith(forged);

    expectRejectedAsInvalidPolicy(settled);
    expect(calls).toBe(0);
  }, 15_000);

  it('rejects an inverted timeout hierarchy at the run entry', async () => {
    // A CROSS-FIELD rule, so it proves the constructor itself runs here rather than a field-by-field
    // schema check. A candidate budget below one call's budget can never be satisfied.
    const forged: RiyaSyntheticGenerationPolicyV1 = {
      ...policy(),
      perInvocationTimeoutMs: 5_000,
      candidateTimeoutMs: 2_000,
    };

    const { settled, calls } = await runWith(forged);

    expectRejectedAsInvalidPolicy(settled);
    expect(calls).toBe(0);
  }, 15_000);

  it('still accepts a VALID policy that never went through the constructor', async () => {
    // The non-regression half. Re-proving must reject what is invalid without becoming a demand that
    // callers hand over an object this package built — a plain literal carrying valid values is
    // exactly what a configuration file deserialises into.
    const track = tracking();
    const plain: RiyaSyntheticGenerationPolicyV1 = {
      version: 1,
      policyRef: 'generation.policy.plain.v1',
      policyVersion: 1,
      maxStructuralRepairAttempts: 1,
      maxTransientRetries: 2,
      perInvocationTimeoutMs: 5_000,
      candidateTimeoutMs: 60_000,
      maxConcurrentInvocations: 3,
      maxConcurrentCandidates: 2,
      requireCrossFamilyCritique: true,
      minCriticsPerCandidate: 2,
    };

    const result = await orchestrateRiyaSyntheticRun({
      items: items(3),
      inventory: INVENTORY,
      policy: plain,
      invokers: registry(track),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    expect(result.outcomes).toHaveLength(3);
    for (const outcome of result.outcomes) {
      expect(outcome.status).toBe('GENERATED');
    }
    // And the re-proved limits are the ones that were enforced, not the supplied object's by luck.
    expect(result.peakConcurrentCandidates).toBeLessThanOrEqual(2);
    expect(track.peak()).toBeLessThanOrEqual(3);
  }, 30_000);
});
