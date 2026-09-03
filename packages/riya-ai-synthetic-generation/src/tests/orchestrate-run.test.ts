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
} from '../index.js';
import type {
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
  readonly wrap: (inner: RiyaSyntheticModelInvoker) => RiyaSyntheticModelInvoker;
} {
  let active = 0;
  let peak = 0;
  return {
    peak: () => peak,
    wrap: (inner) => ({
      invoke: async (request, structuredInput, options) => {
        active += 1;
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
