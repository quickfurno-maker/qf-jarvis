/**
 * The double opt-in and the spend gate (AS3A, ADR-0143 §13, §12, §19, §24).
 *
 * ### The property the opt-in specs exist to hold
 *
 * A machine with two API keys in its environment — a laptop, a shell that sourced a dotenv, a CI
 * runner with secrets attached to an unrelated job — must still run a dry run. If a present
 * credential could arm the network path, then "does this test spend money" would depend on whose
 * machine ran it. So the guard is checked with credentials PRESENT in every case below; the empty
 * environment proves nothing.
 *
 * ### The property the budget specs exist to hold
 *
 * That the code and the words agree about which controls are HARD and which are thresholds. The
 * first review of AS3A found token ceilings described as impossible to exceed while being reconciled
 * after the call — so these specs assert the overshoot rather than pretending it away, and assert
 * separately that the hard controls really cannot be crossed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRiyaSyntheticExecutionBudget } from '../contracts/execution-budget.js';
import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import {
  ANTHROPIC_CREDENTIAL_ENV,
  OPENAI_CREDENTIAL_ENV,
  RIYA_AS3_EXECUTE_ENV,
  readRiyaSyntheticProviderCredential,
  resolveRiyaSyntheticExecutionMode,
  riyaSyntheticCredentialPresence,
} from '../service/execution-guard.js';
import { createRiyaSyntheticSpendGate } from '../service/spend-gate.js';
import type { RiyaSyntheticScheduler } from '../service/spend-gate.js';
import { budgetInput, customerInput, requestFor } from './fixtures.js';

/** An environment that HOLDS both credentials. The configuration that matters. */
const WITH_CREDENTIALS = Object.freeze({
  [OPENAI_CREDENTIAL_ENV]: 'sk-not-a-real-key-fixture',
  [ANTHROPIC_CREDENTIAL_ENV]: 'sk-ant-not-a-real-key-fixture',
});

describe('real calls need BOTH switches, and a credential is neither of them', () => {
  it.each([
    ['credentials but no --execute and no opt-in', false, {}],
    ['credentials and --execute but no environment opt-in', true, {}],
    ['credentials and the opt-in but no --execute', false, { [RIYA_AS3_EXECUTE_ENV]: 'true' }],
  ])('stays in DRY_RUN with %s', (_label, executeFlagPresent, extra) => {
    const mode = resolveRiyaSyntheticExecutionMode({
      executeFlagPresent,
      environment: { ...WITH_CREDENTIALS, ...extra },
    });

    expect(mode).toBe('DRY_RUN');
  });

  it('reaches EXECUTE only with both together', () => {
    const mode = resolveRiyaSyntheticExecutionMode({
      executeFlagPresent: true,
      environment: { ...WITH_CREDENTIALS, [RIYA_AS3_EXECUTE_ENV]: 'true' },
    });

    expect(mode).toBe('EXECUTE');
  });

  it.each([['1'], ['yes'], ['TRUE'], ['True'], [' true'], ['']])(
    'refuses %j as an opt-in value',
    (value) => {
      // Strict on purpose. A permissive parse lets a value somebody set for something else arm a
      // spend, and there is no reader of this variable for whom being strict is inconvenient.
      expect(
        resolveRiyaSyntheticExecutionMode({
          executeFlagPresent: true,
          environment: { ...WITH_CREDENTIALS, [RIYA_AS3_EXECUTE_ENV]: value },
        }),
      ).toBe('DRY_RUN');
    },
  );

  it('decides the mode without reading a credential at all', () => {
    // Proved by construction: an environment with the opt-in and NO credential still reaches
    // EXECUTE. Authorization and credentials are separate questions, decided in that order.
    expect(
      resolveRiyaSyntheticExecutionMode({
        executeFlagPresent: true,
        environment: { [RIYA_AS3_EXECUTE_ENV]: 'true' },
      }),
    ).toBe('EXECUTE');
  });
});

describe('credentials are reported as presence, never as a value', () => {
  it('reports two booleans', () => {
    const presence = riyaSyntheticCredentialPresence(WITH_CREDENTIALS);

    expect(presence).toStrictEqual({
      openaiCredentialPresent: true,
      anthropicCredentialPresent: true,
    });
    // No value, no prefix, and no length — a length narrows a key.
    expect(JSON.stringify(presence)).not.toContain('sk-');
  });

  it.each([[undefined], [''], ['   ']])('treats %j as absent', (value) => {
    expect(
      riyaSyntheticCredentialPresence({ [OPENAI_CREDENTIAL_ENV]: value }).openaiCredentialPresent,
    ).toBe(false);
  });

  it('refuses to hand back a missing credential', () => {
    expect(() => readRiyaSyntheticProviderCredential({}, OPENAI_CREDENTIAL_ENV)).toThrow(
      RiyaSyntheticPilotError,
    );
  });

  it('never puts the value in the error', () => {
    try {
      readRiyaSyntheticProviderCredential({ [OPENAI_CREDENTIAL_ENV]: '  ' }, OPENAI_CREDENTIAL_ENV);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as RiyaSyntheticPilotError).code).toBe('missing-provider-credential');
      expect((error as Error).message).not.toContain('sk-');
    }
  });
});

// -------------------------------------------------------------------------------------------------
// The spend gate.
// -------------------------------------------------------------------------------------------------

interface FakeInvoker {
  readonly invoker: Parameters<ReturnType<typeof createRiyaSyntheticSpendGate>['wrap']>[0];
  readonly calls: () => number;
  readonly inFlight: () => number;
  readonly peakInFlight: () => number;
  readonly releaseAll: () => void;
}

/**
 * An invoker whose calls are counted, whose usage is fixed, and which can be held open.
 *
 * `hold` is what makes the reservation spec possible: a call that never settles keeps its
 * reservation, which is exactly the state a concurrency ceiling has to bound.
 */
function fakeInvoker(
  usage: { inputTokens: number; outputTokens: number },
  hold = false,
): FakeInvoker {
  let calls = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const releases: (() => void)[] = [];

  return {
    calls: () => calls,
    inFlight: () => inFlight,
    peakInFlight: () => peakInFlight,
    releaseAll: () => {
      while (releases.length > 0) releases.shift()?.();
    },
    invoker: {
      async invoke(request) {
        calls += 1;
        inFlight += 1;
        if (inFlight > peakInFlight) peakInFlight = inFlight;
        if (hold) {
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        }
        inFlight -= 1;
        return {
          result: {
            version: 1 as const,
            requestRef: request.requestRef,
            configRef: request.configRef,
            role: request.role,
            status: 'SUCCESS' as const,
            outputDigest: 'a'.repeat(64),
            usage: { ...usage, cachedInputTokens: 0 },
          },
          payload: '{}',
        };
      },
    },
  };
}

/** A scheduler a spec drives by hand. Nothing waits on a real clock. */
function manualScheduler(): {
  readonly scheduler: RiyaSyntheticScheduler;
  readonly fire: () => void;
} {
  let armed: (() => void) | undefined;
  return {
    scheduler: (_delayMs, fire) => {
      armed = fire;
      return () => {
        armed = undefined;
      };
    },
    fire: () => {
      armed?.();
    },
  };
}

function gateFor(
  overrides: Record<string, unknown> = {},
  extras: { readonly now?: () => number; readonly scheduler?: RiyaSyntheticScheduler } = {},
) {
  const controller = new AbortController();
  const budget = createRiyaSyntheticExecutionBudget(
    budgetInput(overrides) as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
  );
  return {
    controller,
    budget,
    gate: createRiyaSyntheticSpendGate({
      budget,
      now: extras.now ?? (() => 0),
      controller,
      ...(extras.scheduler === undefined ? {} : { scheduler: extras.scheduler }),
    }),
  };
}

const OPTIONS = { timeoutMs: 1_000 } as const;

async function invoke(
  wrapped: Parameters<ReturnType<typeof createRiyaSyntheticSpendGate>['wrap']>[0],
  maxOutputTokens = 2_048,
): Promise<string> {
  const outcome = await wrapped.invoke(
    requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt', { maxOutputTokens }),
    customerInput(),
    OPTIONS,
  );
  return outcome.result.status;
}

describe('HARD control: the provider request ceiling cannot be crossed', () => {
  it('refuses the call that would exceed it, and aborts the run', async () => {
    const { gate, controller } = gateFor({ maxCandidates: 1, maxProviderRequests: 2 });
    const fake = fakeInvoker({ inputTokens: 1, outputTokens: 1 });
    const wrapped = gate.wrap(fake.invoker);

    for (let attempt = 0; attempt < 4; attempt += 1) await invoke(wrapped);

    // Two got through; the third never reached the invoker at all.
    expect(fake.calls()).toBe(2);
    expect(gate.stopReason()).toBe('REQUEST_CEILING');
    // ABORTED too. Refusal alone would let the run keep starting candidates that immediately fail.
    expect(controller.signal.aborted).toBe(true);
    gate.dispose();
  });

  it('counts a request BEFORE it is sent, so failures cannot spend without limit', async () => {
    const { gate } = gateFor({ maxCandidates: 1, maxProviderRequests: 3 });
    const wrapped = gate.wrap({
      invoke: () => Promise.reject(new Error('transport exploded')),
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(invoke(wrapped)).rejects.toThrow();
    }

    expect(gate.ledger().providerRequests).toBe(3);
    gate.dispose();
  });
});

describe('HARD control: aggregate output exposure is reserved, not counted afterwards', () => {
  it('never lets two concurrent calls hold more reservation than the ceiling allows', async () => {
    // The ceiling is 150 and each request asks for 100, so the two cannot be in flight together.
    const { gate } = gateFor({
      maxReservedOutputTokens: 150,
      maxObservedOutputTokens: 150,
      maxObservedTotalTokens: 700_000,
      maxConcurrentInvocations: 4,
    });
    const fake = fakeInvoker({ inputTokens: 1, outputTokens: 1 }, true);
    const wrapped = gate.wrap(fake.invoker);

    const first = invoke(wrapped, 100);
    const second = invoke(wrapped, 100);
    // Let both attempts reach the gate.
    await Promise.resolve();
    await Promise.resolve();

    // Only ONE is inside the transport; the other is waiting for room rather than being refused.
    expect(fake.inFlight()).toBe(1);
    expect(gate.ledger().reservedOutputTokens).toBe(100);

    fake.releaseAll();
    await first;
    // The release wakes the waiter, which then runs and must itself be released.
    await Promise.resolve();
    fake.releaseAll();
    await second;

    expect(fake.calls()).toBe(2);
    expect(fake.peakInFlight()).toBe(1);
    // Never above the ceiling, at any instant.
    expect(gate.ledger().peakReservedOutputTokens).toBeLessThanOrEqual(150);
    // And fully released once the run drained. A leak would stall the next call forever.
    expect(gate.ledger().reservedOutputTokens).toBe(0);
    gate.dispose();
  });

  it('releases the reservation even when the invoker throws', async () => {
    const { gate } = gateFor({ maxReservedOutputTokens: 150, maxObservedOutputTokens: 150 });
    const wrapped = gate.wrap({ invoke: () => Promise.reject(new Error('boom')) });

    await expect(invoke(wrapped, 100)).rejects.toThrow();

    expect(gate.ledger().reservedOutputTokens).toBe(0);
    gate.dispose();
  });

  it('refuses a single request larger than the whole ceiling rather than waiting forever', async () => {
    // Waiting for room that can never exist is a deadlock. The budget and the policy disagree about
    // what one call may produce, and saying so is the only useful answer.
    const { gate } = gateFor({ maxReservedOutputTokens: 50, maxObservedOutputTokens: 150 });
    const fake = fakeInvoker({ inputTokens: 1, outputTokens: 1 });
    const wrapped = gate.wrap(fake.invoker);

    const status = await invoke(wrapped, 100);

    expect(status).toBe('CANCELLED');
    expect(fake.calls()).toBe(0);
    expect(gate.stopReason()).toBe('OUTPUT_RESERVATION_CEILING');
    gate.dispose();
  });
});

describe('OBSERVED thresholds stop the run, and do not pretend to prevent the crossing', () => {
  it('lets the crossing call complete, then stops — 150 threshold, two 100-token calls', async () => {
    // THE semantics the first review asked to be stated honestly. Call 1 reports 100 and is under
    // the line; call 2 is therefore allowed and reports another 100. The observed total ends at 200,
    // ABOVE the 150 threshold, and there is no call 3.
    const { gate } = gateFor({
      maxObservedInputTokens: 150,
      maxObservedOutputTokens: 200_000,
      maxObservedTotalTokens: 700_000,
    });
    const fake = fakeInvoker({ inputTokens: 100, outputTokens: 0 });
    const wrapped = gate.wrap(fake.invoker);

    for (let attempt = 0; attempt < 5; attempt += 1) await invoke(wrapped);

    expect(fake.calls()).toBe(2);
    // Reported truthfully, overshoot and all. Rounding it down to the threshold would be a lie about
    // what was spent.
    expect(gate.ledger().inputTokens).toBe(200);
    expect(gate.stopReason()).toBe('OBSERVED_INPUT_TOKEN_THRESHOLD');
    gate.dispose();
  });

  it.each([
    [
      'OBSERVED_OUTPUT_TOKEN_THRESHOLD',
      { maxObservedOutputTokens: 150 },
      { inputTokens: 1, outputTokens: 100 },
    ],
    [
      'OBSERVED_TOTAL_TOKEN_THRESHOLD',
      {
        maxObservedInputTokens: 1_000,
        maxObservedOutputTokens: 1_000,
        maxObservedTotalTokens: 1_000,
      },
      { inputTokens: 400, outputTokens: 400 },
    ],
  ])('stops at the %s', async (reason, overrides, usage) => {
    const { gate } = gateFor({ maxReservedOutputTokens: 150, ...overrides });
    const wrapped = gate.wrap(fakeInvoker(usage).invoker);

    for (let attempt = 0; attempt < 5; attempt += 1) await invoke(wrapped, 100);

    expect(gate.stopReason()).toBe(reason);
    gate.dispose();
  });

  it('starts no further provider request once a threshold has been crossed', async () => {
    const { gate, controller } = gateFor({ maxObservedInputTokens: 150 });
    const fake = fakeInvoker({ inputTokens: 100, outputTokens: 0 });
    const wrapped = gate.wrap(fake.invoker);

    for (let attempt = 0; attempt < 2; attempt += 1) await invoke(wrapped);
    const callsAtStop = fake.calls();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await invoke(wrapped)).toBe('CANCELLED');
    }

    expect(fake.calls()).toBe(callsAtStop);
    // And no NEW candidate starts either: AS2's orchestrator watches this signal.
    expect(controller.signal.aborted).toBe(true);
    gate.dispose();
  });
});

describe('HARD control: the run deadline fires while a call is in flight', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts an active invocation rather than waiting for a per-invocation timeout', async () => {
    // The wall clock is SHORTER than the per-invocation timeout, and the transport is slow. Before
    // the correction this could only be caught by the per-invocation timeout, so a pilot could run
    // far past its wall clock while every pre-call check passed.
    const manual = manualScheduler();
    const { gate, controller } = gateFor({}, { scheduler: manual.scheduler });

    let observedSignal: AbortSignal | undefined;
    const wrapped = gate.wrap({
      async invoke(request, _structuredInput, invocationOptions) {
        observedSignal = invocationOptions.signal;
        // Settles only once the signal aborts -- the port's requirement, and what lets the harness
        // release its permit knowing nothing is in flight.
        await new Promise<void>((resolve) => {
          if (invocationOptions.signal?.aborted === true) {
            resolve();
            return;
          }
          invocationOptions.signal?.addEventListener('abort', () => {
            resolve();
          });
        });
        return {
          result: {
            version: 1 as const,
            requestRef: request.requestRef,
            configRef: request.configRef,
            role: request.role,
            status: 'CANCELLED' as const,
            errorClass: 'CANCELLED' as const,
          },
        };
      },
    });

    const pending = wrapped.invoke(
      requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'),
      customerInput(),
      { timeoutMs: 600_000, signal: controller.signal },
    );
    await Promise.resolve();

    // The deadline fires while the call is open.
    manual.fire();
    const outcome = await pending;

    expect(gate.stopReason()).toBe('WALL_CLOCK_CEILING');
    expect(controller.signal.aborted).toBe(true);
    expect(observedSignal?.aborted).toBe(true);
    expect(outcome.result.status).toBe('CANCELLED');
    // The run resolved without anyone waiting out the 600-second per-invocation budget.
    gate.dispose();
  });

  it('starts no further call after the deadline, and leaks no reservation', async () => {
    const manual = manualScheduler();
    const { gate } = gateFor({}, { scheduler: manual.scheduler });
    const fake = fakeInvoker({ inputTokens: 1, outputTokens: 1 });
    const wrapped = gate.wrap(fake.invoker);

    await invoke(wrapped);
    manual.fire();
    expect(await invoke(wrapped)).toBe('CANCELLED');

    expect(fake.calls()).toBe(1);
    expect(gate.stopReason()).toBe('WALL_CLOCK_CEILING');
    expect(gate.ledger().reservedOutputTokens).toBe(0);
    gate.dispose();
  });

  it('wakes a call waiting for reservation room when the run stops', async () => {
    // Otherwise a waiter would sit forever on a release that is never coming.
    const manual = manualScheduler();
    const { gate } = gateFor(
      { maxReservedOutputTokens: 150, maxObservedOutputTokens: 150 },
      { scheduler: manual.scheduler },
    );
    const fake = fakeInvoker({ inputTokens: 1, outputTokens: 1 }, true);
    const wrapped = gate.wrap(fake.invoker);

    const first = invoke(wrapped, 100);
    const waiting = invoke(wrapped, 100);
    await Promise.resolve();
    await Promise.resolve();

    manual.fire();
    fake.releaseAll();

    expect(await waiting).toBe('CANCELLED');
    await first;
    expect(gate.stopReason()).toBe('WALL_CLOCK_CEILING');
    gate.dispose();
  });
});

describe('an auth failure stops the whole run, and nothing else does', () => {
  it('ignores every other failure kind', () => {
    const { gate, controller } = gateFor();

    for (const harmless of [
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'TRANSIENT_PROVIDER_FAILURE',
      'PERMANENT_PROVIDER_FAILURE',
      'REQUEST_TOO_LARGE',
      'TIMEOUT',
      'MALFORMED_OUTPUT',
    ] as const) {
      gate.observeProviderFailure(harmless);
    }
    expect(gate.stopReason()).toBeUndefined();
    expect(controller.signal.aborted).toBe(false);

    gate.observeProviderFailure('AUTH_OR_CONFIG');

    expect(gate.stopReason()).toBe('PROVIDER_AUTH_FAILURE');
    expect(controller.signal.aborted).toBe(true);
    gate.dispose();
  });

  it('keeps the FIRST stop reason when another control fires while unwinding', () => {
    const { gate } = gateFor();

    gate.observeProviderFailure('AUTH_OR_CONFIG');
    gate.observeProviderFailure('AUTH_OR_CONFIG');

    expect(gate.stopReason()).toBe('PROVIDER_AUTH_FAILURE');
    gate.dispose();
  });
});
