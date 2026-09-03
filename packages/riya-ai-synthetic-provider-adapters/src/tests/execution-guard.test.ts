/**
 * The double opt-in and the spend gate (AS3A, ADR-0143 §13, §12, §19, §24).
 *
 * ### The property these specs exist to hold
 *
 * A machine with two API keys in its environment — a laptop, a shell that sourced a dotenv, a CI
 * runner with secrets attached to an unrelated job — must still run a dry run. If a present
 * credential could arm the network path, then "does this test spend money" would depend on whose
 * machine ran it, and nobody could answer it by reading the code.
 *
 * So the guard is checked with credentials PRESENT in every case below. That is the interesting
 * configuration; the empty environment proves nothing.
 */
import { describe, expect, it } from 'vitest';

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

/** An invoker whose calls are counted and whose usage is fixed, so a ceiling is reachable. */
function countingInvoker(usage: { inputTokens: number; outputTokens: number }): {
  invoker: Parameters<ReturnType<typeof createRiyaSyntheticSpendGate>['wrap']>[0];
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    invoker: {
      invoke(request) {
        calls += 1;
        return Promise.resolve({
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
        });
      },
    },
  };
}

function gateFor(overrides: Record<string, unknown> = {}, clock: () => number = () => 0) {
  const controller = new AbortController();
  const budget = createRiyaSyntheticExecutionBudget(
    budgetInput(overrides) as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
  );
  return {
    controller,
    gate: createRiyaSyntheticSpendGate({ budget, now: clock, controller }),
  };
}

describe('the spend gate stops the run at every ceiling', () => {
  it('refuses the call that would exceed the request ceiling, and aborts the run', async () => {
    const { gate, controller } = gateFor({ maxCandidates: 1, maxProviderRequests: 2 });
    const counting = countingInvoker({ inputTokens: 1, outputTokens: 1 });
    const wrapped = gate.wrap(counting.invoker);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wrapped.invoke(requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'), customerInput(), {
        timeoutMs: 1_000,
      });
    }

    // Two got through; the third was refused, and refusal is not a provider failure.
    expect(counting.calls()).toBe(2);
    expect(gate.stopReason()).toBe('REQUEST_CEILING');
    // ABORTED too. Refusal alone would let the run keep starting candidates that immediately fail.
    expect(controller.signal.aborted).toBe(true);
  });

  it.each([
    ['INPUT_TOKEN_CEILING', { maxInputTokens: 150 }, { inputTokens: 100, outputTokens: 1 }],
    ['OUTPUT_TOKEN_CEILING', { maxOutputTokens: 150 }, { inputTokens: 1, outputTokens: 100 }],
    [
      'TOTAL_TOKEN_CEILING',
      { maxInputTokens: 1_000, maxOutputTokens: 1_000, maxTotalTokens: 1_000 },
      { inputTokens: 400, outputTokens: 400 },
    ],
  ])('stops at the %s', async (reason, overrides, usage) => {
    const { gate } = gateFor(overrides);
    const counting = countingInvoker(usage);
    const wrapped = gate.wrap(counting.invoker);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await wrapped.invoke(requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'), customerInput(), {
        timeoutMs: 1_000,
      });
    }

    expect(gate.stopReason()).toBe(reason);
  });

  it('stops when the wall clock is spent', async () => {
    let clock = 0;
    const { gate } = gateFor({ maxWallClockMs: 600_000 }, () => clock);
    const counting = countingInvoker({ inputTokens: 1, outputTokens: 1 });
    const wrapped = gate.wrap(counting.invoker);

    await wrapped.invoke(requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'), customerInput(), {
      timeoutMs: 1_000,
    });
    clock = 600_001;
    await wrapped.invoke(requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'), customerInput(), {
      timeoutMs: 1_000,
    });

    expect(counting.calls()).toBe(1);
    expect(gate.stopReason()).toBe('WALL_CLOCK_CEILING');
  });

  it('counts a request BEFORE it is sent, so failures cannot spend without limit', async () => {
    const { gate } = gateFor({ maxCandidates: 1, maxProviderRequests: 3 });
    const wrapped = gate.wrap({
      invoke: () => Promise.reject(new Error('transport exploded')),
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        wrapped.invoke(requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'), customerInput(), {
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow();
    }

    expect(gate.ledger().providerRequests).toBe(3);
  });

  it('stops the whole run on an auth fault, and on nothing else', () => {
    const { gate, controller } = gateFor();

    for (const harmless of [
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'TRANSIENT_PROVIDER_FAILURE',
      'PERMANENT_PROVIDER_FAILURE',
      'TIMEOUT',
      'MALFORMED_OUTPUT',
    ] as const) {
      gate.observeProviderFailure(harmless);
    }
    expect(gate.stopReason()).toBeUndefined();
    expect(controller.signal.aborted).toBe(false);

    // A rejected credential is not a candidate's problem: left alone the harness would rediscover it
    // once per candidate, spending real requests to learn the same fact.
    gate.observeProviderFailure('AUTH_OR_CONFIG');

    expect(gate.stopReason()).toBe('PROVIDER_AUTH_FAILURE');
    expect(controller.signal.aborted).toBe(true);
  });

  it('keeps the FIRST stop reason when a second ceiling is reached while unwinding', () => {
    const { gate } = gateFor();

    gate.observeProviderFailure('AUTH_OR_CONFIG');
    gate.observeProviderFailure('AUTH_OR_CONFIG');

    expect(gate.stopReason()).toBe('PROVIDER_AUTH_FAILURE');
  });
});
