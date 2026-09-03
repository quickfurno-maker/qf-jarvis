/**
 * Fail before spending, and hold the permit until the work is over (AS2 second correction).
 *
 * Two rules with one shared consequence — tokens are not refundable, so a defect discovered halfway
 * through a run has already been paid for:
 *
 * - **H** every external contract is re-proved at the public boundary BEFORE any invocation;
 * - **I** a timed-out call keeps its concurrency permit until it has actually settled.
 *
 * Plus the two structural guards those depend on: the shared gate is not a public parameter (**J**),
 * and abort stops scheduling mid-run, not only before it (**K**).
 */
import { describe, expect, it } from 'vitest';

import {
  RiyaSyntheticGenerationError,
  createFakeClaudeInvoker,
  createFakeGptInvoker,
  createRiyaSyntheticInvocationResult,
  generateRiyaSyntheticCandidate,
  orchestrateRiyaSyntheticRun,
} from '../index.js';
import type {
  GenerateRiyaSyntheticCandidateOptions,
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

const firstScenario = () => {
  const one = scenarios(3)[0];
  if (one === undefined) throw new Error('scheduler produced no scenario');
  return one;
};

/** Counts every invocation, so "zero tokens spent" is measured rather than assumed. */
function counting(): {
  readonly total: () => number;
  readonly registry: () => RiyaSyntheticInvokerRegistry;
} {
  let calls = 0;
  const wrap = (inner: RiyaSyntheticModelInvoker): RiyaSyntheticModelInvoker => ({
    invoke: async (request, structuredInput, options) => {
      calls += 1;
      return inner.invoke(request, structuredInput, options);
    },
  });
  const refs = [
    'cfg.planner',
    'cfg.sim.gpt',
    'cfg.sim.claude',
    'cfg.teacher.gpt',
    'cfg.teacher.claude',
    'cfg.verify.gpt',
    'cfg.verify.claude',
    'cfg.critic.gpt',
    'cfg.critic.gpt.two',
    'cfg.critic.claude',
    'cfg.critic.claude.two',
  ];
  return {
    total: () => calls,
    registry: () =>
      new Map(
        refs.map((ref) => [
          ref,
          wrap(ref.includes('claude') ? createFakeClaudeInvoker() : createFakeGptInvoker()),
        ]),
      ),
  };
}

const baseOptions = (
  invokers: RiyaSyntheticInvokerRegistry,
): GenerateRiyaSyntheticCandidateOptions => ({
  scenario: firstScenario(),
  allocation: gptTaughtAllocation(),
  inventory: INVENTORY,
  policy: policy(),
  invokers,
  criticQualityDimensions: [...CRITIC_DIMENSIONS],
});

// ---------------------------------------------------------------------------
// BLOCKER H — invalid input costs nothing.
// ---------------------------------------------------------------------------

describe('the public generation boundary re-proves every contract before spending', () => {
  it('refuses a forged scenario without invoking anything', async () => {
    // TypeScript types are not runtime authority. A cast object reaches this function exactly as a
    // parsed or hand-assembled one would.
    const spy = counting();
    const forged = { ...firstScenario(), targetAssistantTurns: 99 };

    await expect(
      generateRiyaSyntheticCandidate({
        ...baseOptions(spy.registry()),
        scenario: forged,
      }),
    ).rejects.toThrow();
    expect(spy.total()).toBe(0);
  });

  it('refuses a forged allocation without invoking anything', async () => {
    const spy = counting();
    const forged = { ...gptTaughtAllocation(), annotationVerifierConfigRef: 'cfg.teacher.gpt' };

    await expect(
      generateRiyaSyntheticCandidate({
        ...baseOptions(spy.registry()),
        allocation: forged,
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
    expect(spy.total()).toBe(0);
  });

  it('refuses a forged inventory without invoking anything', async () => {
    const spy = counting();
    const forged = {
      ...INVENTORY,
      configs: INVENTORY.configs.map((one) => ({ ...one, modelFamilyRef: 'https://leak/' })),
    };

    await expect(
      generateRiyaSyntheticCandidate({
        ...baseOptions(spy.registry()),
        inventory: forged,
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
    expect(spy.total()).toBe(0);
  });

  it('refuses a forged policy without invoking anything', async () => {
    const spy = counting();
    const forged = { ...policy(), maxStructuralRepairAttempts: 50 };

    await expect(
      generateRiyaSyntheticCandidate({
        ...baseOptions(spy.registry()),
        policy: forged,
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
    expect(spy.total()).toBe(0);
  });

  it('refuses a critic dimension outside the canonical vocabulary', async () => {
    const spy = counting();

    await expect(
      generateRiyaSyntheticCandidate({
        ...baseOptions(spy.registry()),
        criticQualityDimensions: ['NOT_A_DIMENSION'] as never,
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
    expect(spy.total()).toBe(0);
  });
});

describe('a run is preflighted before any worker starts', () => {
  const runItems = (): readonly RiyaSyntheticRunItem[] =>
    scenarios(3).map((scenario, index) => ({
      scenario,
      allocation: gptTaughtAllocation({ generationRef: `gen.pre.${String(index)}` }),
    }));

  it('refuses duplicate scenarioRefs before invoking anything', async () => {
    const spy = counting();
    const items = runItems();
    const duplicated = [items[0], items[0]].filter((one) => one !== undefined);

    await expect(
      orchestrateRiyaSyntheticRun({
        items: duplicated,
        inventory: INVENTORY,
        policy: policy(),
        invokers: spy.registry(),
        criticQualityDimensions: [...CRITIC_DIMENSIONS],
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
    expect(spy.total()).toBe(0);
  });

  it('refuses duplicate generationRefs before invoking anything', async () => {
    // Two candidates under one generation identity means two trajectories claiming one provenance
    // record, and AS1 evidence that cannot say which is which.
    const spy = counting();
    const shared = gptTaughtAllocation({ generationRef: 'gen.same' });
    const items = scenarios(2).map((scenario) => ({ scenario, allocation: shared }));

    await expect(
      orchestrateRiyaSyntheticRun({
        items,
        inventory: INVENTORY,
        policy: policy(),
        invokers: spy.registry(),
        criticQualityDimensions: [...CRITIC_DIMENSIONS],
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
    expect(spy.total()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BLOCKER I — the permit is held until the call is really over.
// ---------------------------------------------------------------------------

describe('a timed-out invocation keeps its permit until it settles', () => {
  it('does not let a second call start during the first call abort cleanup', async () => {
    // The defect: releasing the permit when the caller STOPS WAITING rather than when the work ends.
    // A second invocation could then start while the first was still live, so real provider
    // concurrency exceeded the policy while the gate's own numbers looked compliant.
    let active = 0;
    let peak = 0;
    let cleanupOverlapped = false;

    /** Observes abort, then takes a bounded moment to clean up before settling. */
    const slowToCleanUp: RiyaSyntheticModelInvoker = {
      invoke: async (request, _structuredInput, options) => {
        active += 1;
        if (active > peak) peak = active;
        try {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 5_000);
            options.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              // Cleanup window: if the harness frees the permit now, another call can overlap.
              setTimeout(resolve, 400);
            });
          });
          if (active > 1) cleanupOverlapped = true;
          return {
            result: createRiyaSyntheticInvocationResult({
              requestRef: request.requestRef,
              configRef: request.configRef,
              role: request.role,
              status: 'CANCELLED',
              errorClass: 'CANCELLED',
            }),
          };
        } finally {
          active -= 1;
        }
      },
    };

    const spy = counting();
    const invokers = new Map(spy.registry());
    invokers.set('cfg.sim.claude', slowToCleanUp);

    await expect(
      generateRiyaSyntheticCandidate({
        ...baseOptions(invokers),
        policy: policy({
          perInvocationTimeoutMs: 1_000,
          candidateTimeoutMs: 60_000,
          maxConcurrentInvocations: 1,
          maxTransientRetries: 0,
        }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);

    // Never more than one real call in flight, and nothing overlapped the cleanup window.
    expect(peak).toBeLessThanOrEqual(1);
    expect(cleanupOverlapped).toBe(false);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// BLOCKER J — the shared gate is not a public parameter.
// ---------------------------------------------------------------------------

describe('concurrency enforcement is internal, not a caller parameter', () => {
  it('has no invocationGate on the public options type', () => {
    const options = baseOptions(counting().registry());

    // `invocationGate` is deliberately absent from the PUBLIC options: a caller able to pass its own
    // gate could hand in a no-op and defeat policy.maxConcurrentInvocations. The directive sits on
    // the offending PROPERTY, which is where the compiler reports it.
    const forged: GenerateRiyaSyntheticCandidateOptions = {
      ...options,
      // @ts-expect-error -- proving the public surface refuses the gate.
      invocationGate: () => null,
    };

    expect(forged).toBeDefined();
  });

  it('exports no concurrency gate or semaphore helper', async () => {
    const barrel: Record<string, unknown> = await import('../index.js');

    for (const key of Object.keys(barrel)) {
      const upper = key.toUpperCase();
      expect(upper, key).not.toContain('CONCURRENCYGATE');
      expect(upper, key).not.toContain('SEMAPHORE');
      expect(upper, key).not.toContain('INVOCATIONGATE');
    }
  });
});

// ---------------------------------------------------------------------------
// BLOCKER K — abort stops scheduling MID-run.
// ---------------------------------------------------------------------------

describe('aborting an active run stops new candidates', () => {
  it('starts nothing further and leaves unscheduled items NOT_STARTED', async () => {
    const controller = new AbortController();
    let started = 0;

    const slow = (inner: RiyaSyntheticModelInvoker): RiyaSyntheticModelInvoker => ({
      invoke: async (request, structuredInput, options) => {
        started += 1;
        // Abort once a candidate is genuinely in flight, not before the run begins.
        if (started === 2) controller.abort();
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        return inner.invoke(request, structuredInput, options);
      },
    });

    const refs = [
      'cfg.planner',
      'cfg.sim.gpt',
      'cfg.sim.claude',
      'cfg.teacher.gpt',
      'cfg.teacher.claude',
      'cfg.verify.gpt',
      'cfg.verify.claude',
      'cfg.critic.gpt',
      'cfg.critic.gpt.two',
      'cfg.critic.claude',
      'cfg.critic.claude.two',
    ];
    const invokers = new Map(
      refs.map((ref) => [
        ref,
        slow(ref.includes('claude') ? createFakeClaudeInvoker() : createFakeGptInvoker()),
      ]),
    );

    const items = scenarios(6).map((scenario, index) => ({
      scenario,
      allocation: gptTaughtAllocation({ generationRef: `gen.mid.${String(index)}` }),
    }));

    const result = await orchestrateRiyaSyntheticRun({
      items,
      inventory: INVENTORY,
      policy: policy({ maxConcurrentCandidates: 1, maxConcurrentInvocations: 2 }),
      invokers,
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
      signal: controller.signal,
    });

    // The run resolves rather than hanging, every item is accounted for, and the tail was never
    // attempted -- NOT_STARTED, not FAILED, because it was never tried.
    expect(result.outcomes).toHaveLength(6);
    const notStarted = result.outcomes.filter((one) => one.status === 'NOT_STARTED');
    expect(notStarted.length).toBeGreaterThan(0);
    expect(result.peakConcurrentCandidates).toBeLessThanOrEqual(1);
  }, 30_000);
});
