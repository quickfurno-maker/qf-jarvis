/**
 * The AS3A contracts: the execution budget, the pilot plan, and the failure taxonomy.
 *
 * These are the objects that decide what a run is allowed to spend and what a failure means. They are
 * validated here as runtime values, not as types, because every one of them arrives from a JSON file
 * or an SDK — the two places a TypeScript annotation says nothing true about.
 */
import { describe, expect, it } from 'vitest';

import { createRiyaSyntheticExecutionBudget } from '../contracts/execution-budget.js';
import { createRiyaSyntheticPilotPlan } from '../contracts/pilot-plan.js';
import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import {
  classifyRiyaSyntheticProviderFailure,
  riyaSyntheticErrorClassFor,
  riyaSyntheticFailureIsRetryable,
  riyaSyntheticFailureStopsRun,
} from '../contracts/provider-errors.js';
import { budgetInput, inventoryInput, policyInput, runPlanInput } from './fixtures.js';

describe('the execution budget separates hard controls from observed thresholds', () => {
  it('names the two kinds differently, so a reader cannot mistake one for the other', () => {
    const budget = createRiyaSyntheticExecutionBudget(
      budgetInput() as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
    );

    // HARD: checked against something this repository knows before anything is spent.
    expect(budget.maxProviderRequests).toBeGreaterThan(0);
    expect(budget.maxRequestInputUtf8Bytes).toBeGreaterThan(0);
    expect(budget.maxReservedOutputTokens).toBeGreaterThan(0);
    expect(budget.maxWallClockMs).toBeGreaterThan(0);
    // OBSERVED: compared against what a provider reported for a call that already happened.
    expect(budget.maxObservedInputTokens).toBeGreaterThan(0);
    expect(budget.maxObservedOutputTokens).toBeGreaterThan(0);
    expect(budget.maxObservedTotalTokens).toBeGreaterThan(0);
    // The pre-correction names are gone, not aliased. An alias would let a reader keep planning
    // against a threshold they believed was a wall.
    expect(budget).not.toHaveProperty('maxInputTokens');
    expect(budget).not.toHaveProperty('maxOutputTokens');
    expect(budget).not.toHaveProperty('maxTotalTokens');
  });

  it('accepts a well-formed budget and freezes it', () => {
    const budget = createRiyaSyntheticExecutionBudget(
      budgetInput() as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
    );

    expect(budget.version).toBe(1);
    expect(Object.isFrozen(budget)).toBe(true);
  });

  it.each([
    ['a zero candidate ceiling', { maxCandidates: 0 }],
    ['a zero request ceiling', { maxProviderRequests: 0 }],
    ['a wall clock under ten minutes', { maxWallClockMs: 1_000 }],
    ['a request byte ceiling below 4 KiB', { maxRequestInputUtf8Bytes: 10 }],
    ['an observed total below the input direction', { maxObservedTotalTokens: 1 }],
    ['fewer requests than candidates', { maxCandidates: 10, maxProviderRequests: 5 }],
    ['an unknown field', { somethingElse: true }],
    ['the old pre-correction field names', { maxInputTokens: 500_000 }],
    ['a reservation ceiling of zero', { maxReservedOutputTokens: 0 }],
    ['an observed output threshold of zero', { maxObservedOutputTokens: 0 }],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      createRiyaSyntheticExecutionBudget(
        budgetInput(overrides) as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
      ),
    ).toThrow(RiyaSyntheticPilotError);
  });

  it.each([
    [
      'a small reservation ceiling under a large observed threshold',
      { maxReservedOutputTokens: 1_000, maxObservedOutputTokens: 200_000 },
    ],
    [
      'a large reservation ceiling over a small observed threshold',
      { maxReservedOutputTokens: 200_000, maxObservedOutputTokens: 1_000 },
    ],
    [
      'the two output limits set equal',
      { maxReservedOutputTokens: 50_000, maxObservedOutputTokens: 50_000 },
    ],
  ])('accepts %s, because they measure different quantities', (_label, overrides) => {
    // `maxReservedOutputTokens` bounds the INSTANTANEOUS exposure of calls in flight;
    // `maxObservedOutputTokens` bounds CUMULATIVE reported output across completed calls. An earlier
    // version imposed an ordering between them and described it backwards. Both orderings are
    // legitimate: a small reservation with a large threshold throttles concurrency while cumulative
    // usage climbs across many sequential calls; a large reservation with a small threshold permits
    // wide concurrency and stops once completed usage crosses the line.
    const budget = createRiyaSyntheticExecutionBudget(
      budgetInput(overrides) as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
    );

    expect(budget.maxReservedOutputTokens).toBeGreaterThan(0);
    expect(budget.maxObservedOutputTokens).toBeGreaterThan(0);
  });

  it.each([
    ['auth failures', { stopOnProviderAuthFailure: false }],
    ['budget exhaustion', { stopOnBudgetExhaustion: false }],
  ])('refuses a budget that would not stop on %s', (_label, overrides) => {
    // The flags exist so a manifest records that the run was governed by them, not so a caller can
    // switch them off. A pilot that continued past its ceiling would not have a ceiling.
    expect(() =>
      createRiyaSyntheticExecutionBudget(
        budgetInput(overrides) as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
      ),
    ).toThrow(RiyaSyntheticPilotError);
  });
});

/** A complete plan, as a plain object — exactly what a file deserialises into. */
function planInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planRef: 'pilot.as3a.test.v1',
    runPlan: runPlanInput(),
    inventory: inventoryInput(),
    policy: policyInput(),
    budget: budgetInput(),
    acceptancePolicy: acceptancePolicyInput(),
    allocations: [{ ...GPT }],
    criticQualityDimensions: ['CLARITY'],
    ...overrides,
  };
}

const GPT = {
  generationRef: 'gen.as3a.gpt',
  scenarioPlannerConfigRef: 'cfg.sim.gpt',
  customerSimulatorConfigRef: 'cfg.sim.claude',
  riyaTeacherConfigRef: 'cfg.teacher.gpt',
  annotationVerifierConfigRef: 'cfg.verify.claude',
  criticConfigRefs: ['cfg.critic.claude', 'cfg.critic.gpt'],
};

function acceptancePolicyInput(): Record<string, unknown> {
  return {
    policyId: 'riya-as3a-pilot-acceptance',
    policyVersion: 1,
    baseReleasePolicy: undefined,
    criticPolicy: {},
    diversityPolicy: {},
    assistantTurnTolerance: 1,
  };
}

describe('the pilot plan is deep-proved before anything can be spent', () => {
  it('rejects a plan whose nested contract is invalid', () => {
    // The acceptance policy above is deliberately incomplete. A plan is one artifact to a reader, so
    // a nested rejection surfaces as `invalid-pilot-plan` rather than as the nested code — and it is
    // still a rejection, which is the part that matters.
    expect(() => createRiyaSyntheticPilotPlan(planInput())).toThrow(RiyaSyntheticPilotError);
  });

  it.each([
    ['a missing plan ref', { planRef: undefined }],
    ['an empty allocation list', { allocations: [] }],
    ['an unknown top-level key', { unexpected: 1 }],
    ['a non-object', undefined],
  ])('rejects %s', (_label, overrides) => {
    const input = overrides === undefined ? 'not-an-object' : planInput(overrides);
    expect(() => createRiyaSyntheticPilotPlan(input)).toThrow(RiyaSyntheticPilotError);
  });

  it('rejects two allocations sharing one generation identity', () => {
    // Two candidates under one provenance record means AS1 evidence that cannot say which trajectory
    // it describes.
    expect(() =>
      createRiyaSyntheticPilotPlan(planInput({ allocations: [{ ...GPT }, { ...GPT }] })),
    ).toThrow(RiyaSyntheticPilotError);
  });

  it('rejects a repeated critic dimension', () => {
    expect(() =>
      createRiyaSyntheticPilotPlan(planInput({ criticQualityDimensions: ['CLARITY', 'CLARITY'] })),
    ).toThrow(RiyaSyntheticPilotError);
  });
});

describe('provider failures are classified from signals, never from a message', () => {
  it.each([
    [{ aborted: true }, 'CANCELLED'],
    [{ aborted: true, timedOut: true }, 'CANCELLED'],
    [{ timedOut: true }, 'TIMEOUT'],
    [{ status: 408 }, 'TIMEOUT'],
    [{ status: 401 }, 'AUTH_OR_CONFIG'],
    [{ status: 403 }, 'AUTH_OR_CONFIG'],
    [{ status: 429 }, 'RATE_LIMITED'],
    [{ status: 503 }, 'PROVIDER_UNAVAILABLE'],
    [{ status: 500 }, 'TRANSIENT_PROVIDER_FAILURE'],
    [{ status: 400 }, 'PERMANENT_PROVIDER_FAILURE'],
    [{ status: 404 }, 'PERMANENT_PROVIDER_FAILURE'],
    [{}, 'TRANSIENT_PROVIDER_FAILURE'],
  ])('maps %o to %s', (signals, expected) => {
    expect(classifyRiyaSyntheticProviderFailure(signals)).toBe(expected);
  });

  it('lets cancellation outrank an expired deadline', () => {
    // When a run is cancelled at the moment a call was also about to expire, "somebody cancelled it"
    // is the true statement. Reporting a timeout would send a reader looking for a slow provider.
    expect(classifyRiyaSyntheticProviderFailure({ aborted: true, timedOut: true })).toBe(
      'CANCELLED',
    );
  });

  it('stops the run for an auth fault and for nothing else', () => {
    expect(riyaSyntheticFailureStopsRun('AUTH_OR_CONFIG')).toBe(true);
    for (const kind of [
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'TRANSIENT_PROVIDER_FAILURE',
      'PERMANENT_PROVIDER_FAILURE',
      'TIMEOUT',
      'CANCELLED',
      'MALFORMED_OUTPUT',
    ] as const) {
      expect(riyaSyntheticFailureStopsRun(kind), kind).toBe(false);
    }
  });

  it('never marks a permanent failure or an auth fault retryable', () => {
    expect(riyaSyntheticFailureIsRetryable('PERMANENT_PROVIDER_FAILURE')).toBe(false);
    expect(riyaSyntheticFailureIsRetryable('AUTH_OR_CONFIG')).toBe(false);
    expect(riyaSyntheticFailureIsRetryable('RATE_LIMITED')).toBe(true);
  });

  it('collapses an auth fault onto PERMANENT so the candidate loop cannot retry it', () => {
    // The run is being stopped for it a level up. Mapping it to TRANSIENT would make the same doomed
    // call once per candidate on the way out.
    expect(riyaSyntheticErrorClassFor('AUTH_OR_CONFIG')).toBe('PERMANENT');
    expect(riyaSyntheticErrorClassFor('RATE_LIMITED')).toBe('TRANSIENT');
    expect(riyaSyntheticErrorClassFor('TIMEOUT')).toBe('TIMEOUT');
    expect(riyaSyntheticErrorClassFor('CANCELLED')).toBe('CANCELLED');
    expect(riyaSyntheticErrorClassFor('MALFORMED_OUTPUT')).toBe('MALFORMED_OUTPUT');
  });
});
