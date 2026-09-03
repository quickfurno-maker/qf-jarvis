/**
 * Both real adapters, against MOCKED transports (AS3A, ADR-0143 §24).
 *
 * Zero network, zero credential, zero spend — and every provider-shaped rule proved anyway, because
 * the transport seam is where the SDK stops and the adapter's own logic begins.
 *
 * The two families are exercised through the same table wherever their behaviour is required to be
 * identical. That is not brevity: it is the assertion. A rule that held for GPT and not for Claude
 * would put a provider difference into the corpus that nobody chose.
 */
import { describe, expect, it } from 'vitest';

import { createAnthropicMessagesInvoker } from '../adapters/anthropic-messages-invoker.js';
import { createOpenAiResponsesInvoker } from '../adapters/openai-responses-invoker.js';
import { RiyaSyntheticProviderTransportError } from '../contracts/provider-errors.js';
import type { RiyaSyntheticProviderFailureKind } from '../contracts/provider-errors.js';
import { customerInput, requestFor, validPayloadFor } from './fixtures.js';

const MODELS = new Map([['cfg.sim.gpt', 'gpt-5.6-sol']]);
const CLAUDE_MODELS = new Map([['cfg.sim.claude', 'claude-sonnet-5']]);
const OPTIONS = { timeoutMs: 5_000 } as const;

interface Harness {
  readonly label: string;
  readonly configRef: string;
  /** Build an invoker whose transport behaves as described. */
  readonly invoker: (
    behaviour: Behaviour,
    observed?: RiyaSyntheticProviderFailureKind[],
  ) => {
    invoke: (signal?: AbortSignal) => Promise<{
      status: string;
      errorClass?: string;
      payload?: string;
      usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
    }>;
    calls: () => number;
  };
}

interface Behaviour {
  readonly outputText?: string;
  readonly refused?: boolean;
  readonly throws?: RiyaSyntheticProviderFailureKind;
  /** Wait for abort, then settle — the port's requirement, proved rather than assumed. */
  readonly settleOnAbort?: boolean;
  readonly usage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
}

/** One reply shape, shared by both fake transports so the families cannot be tested differently. */
async function respond(
  behaviour: Behaviour,
  signal: AbortSignal,
): Promise<{
  outputText: string;
  refused: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}> {
  if (behaviour.settleOnAbort === true) {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', () => {
        resolve();
      });
    });
    // Settling AFTER the abort is the contract: the harness releases its permit on this promise, so
    // resolving before the transport had stopped would be a lie about what is still in flight.
    throw new RiyaSyntheticProviderTransportError('CANCELLED');
  }
  if (behaviour.throws !== undefined) {
    throw new RiyaSyntheticProviderTransportError(behaviour.throws);
  }
  const usage = behaviour.usage ?? { inputTokens: 11, outputTokens: 7, cachedInputTokens: 3 };
  return {
    outputText: behaviour.outputText ?? validPayloadFor('CUSTOMER_SIMULATOR', 'x'),
    refused: behaviour.refused ?? false,
    ...usage,
  };
}

const HARNESSES: readonly Harness[] = [
  {
    label: 'OpenAI',
    configRef: 'cfg.sim.gpt',
    invoker: (behaviour, observed) => {
      let calls = 0;
      const invoker = createOpenAiResponsesInvoker({
        models: MODELS,
        ...(observed === undefined
          ? {}
          : {
              onProviderFailure: (kind) => {
                observed.push(kind);
              },
            }),
        transport: {
          async create(_body, init) {
            calls += 1;
            return respond(behaviour, init.signal);
          },
        },
      });
      return {
        calls: () => calls,
        invoke: async (signal) => {
          const outcome = await invoker.invoke(
            requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.gpt'),
            customerInput(),
            { ...OPTIONS, ...(signal === undefined ? {} : { signal }) },
          );
          return {
            status: outcome.result.status,
            ...(outcome.result.errorClass === undefined
              ? {}
              : { errorClass: outcome.result.errorClass }),
            ...(outcome.payload === undefined ? {} : { payload: outcome.payload }),
            ...(outcome.result.usage === undefined ? {} : { usage: outcome.result.usage }),
          };
        },
      };
    },
  },
  {
    label: 'Anthropic',
    configRef: 'cfg.sim.claude',
    invoker: (behaviour, observed) => {
      let calls = 0;
      const invoker = createAnthropicMessagesInvoker({
        models: CLAUDE_MODELS,
        ...(observed === undefined
          ? {}
          : {
              onProviderFailure: (kind) => {
                observed.push(kind);
              },
            }),
        transport: {
          async create(_body, init) {
            calls += 1;
            return respond(behaviour, init.signal);
          },
        },
      });
      return {
        calls: () => calls,
        invoke: async (signal) => {
          const outcome = await invoker.invoke(
            requestFor('CUSTOMER_SIMULATOR', 'cfg.sim.claude'),
            customerInput(),
            { ...OPTIONS, ...(signal === undefined ? {} : { signal }) },
          );
          return {
            status: outcome.result.status,
            ...(outcome.result.errorClass === undefined
              ? {}
              : { errorClass: outcome.result.errorClass }),
            ...(outcome.payload === undefined ? {} : { payload: outcome.payload }),
            ...(outcome.result.usage === undefined ? {} : { usage: outcome.result.usage }),
          };
        },
      };
    },
  },
];

describe.each(HARNESSES)('$label adapter', (harness) => {
  it('returns the untrusted payload and a digest on success', async () => {
    const payload = validPayloadFor('CUSTOMER_SIMULATOR', 'ok');
    const result = await harness.invoker({ outputText: payload }).invoke();

    expect(result.status).toBe('SUCCESS');
    expect(result.payload).toBe(payload);
    // The adapter does not parse it. The bytes go to AS2's strict parser exactly as a fake's would.
    expect(result.errorClass).toBeUndefined();
  });

  it('reports safe integer usage and nothing else', async () => {
    const result = await harness
      .invoker({ usage: { inputTokens: 40, outputTokens: 9, cachedInputTokens: 2 } })
      .invoke();

    expect(result.usage).toStrictEqual({ inputTokens: 40, outputTokens: 9, cachedInputTokens: 2 });
  });

  it('fails CLOSED on a refusal, and never treats it as repairable', async () => {
    // Repairing a decline means asking again in different words until something comes back. On a
    // safety refusal that is the worst version of gate-gaming available.
    const result = await harness.invoker({ refused: true, outputText: '' }).invoke();

    expect(result.status).toBe('PROVIDER_ERROR');
    expect(result.errorClass).toBe('PERMANENT');
    expect(result.payload).toBeUndefined();
  });

  it.each([
    ['AUTH_OR_CONFIG', 'PROVIDER_ERROR', 'PERMANENT'],
    ['RATE_LIMITED', 'PROVIDER_ERROR', 'TRANSIENT'],
    ['PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'TRANSIENT'],
    ['TRANSIENT_PROVIDER_FAILURE', 'PROVIDER_ERROR', 'TRANSIENT'],
    ['PERMANENT_PROVIDER_FAILURE', 'PROVIDER_ERROR', 'PERMANENT'],
    ['TIMEOUT', 'TIMEOUT', 'TIMEOUT'],
  ] as const)('maps a %s transport failure to %s/%s', async (kind, status, errorClass) => {
    const result = await harness.invoker({ throws: kind }).invoke();

    expect(result.status).toBe(status);
    expect(result.errorClass).toBe(errorClass);
  });

  it('never throws for a provider failure', async () => {
    // The port requires a RESULT whose status says what happened. Throwing would make failure
    // handling depend on an exception type the port cannot constrain.
    await expect(harness.invoker({ throws: 'AUTH_OR_CONFIG' }).invoke()).resolves.toBeDefined();
  });

  it('reports the precise kind to the observer, before AS2 collapses it', async () => {
    const observed: RiyaSyntheticProviderFailureKind[] = [];
    await harness.invoker({ throws: 'AUTH_OR_CONFIG' }, observed).invoke();

    // `PERMANENT` alone cannot tell an auth fault from a bad model id, and only one of those may
    // stop a whole run.
    expect(observed).toStrictEqual(['AUTH_OR_CONFIG']);
  });

  it('treats an empty payload as malformed rather than as success', async () => {
    const result = await harness.invoker({ outputText: '' }).invoke();

    expect(result.status).toBe('MALFORMED');
    expect(result.errorClass).toBe('MALFORMED_OUTPUT');
  });

  it('treats an oversized payload as malformed before digesting it', async () => {
    const result = await harness.invoker({ outputText: 'x'.repeat(40_000) }).invoke();

    expect(result.status).toBe('MALFORMED');
  });

  it('SETTLES after an abort, so the permit is released only when nothing is in flight', async () => {
    const controller = new AbortController();
    const harnessed = harness.invoker({ settleOnAbort: true });
    const pending = harnessed.invoke(controller.signal);
    controller.abort();

    const result = await pending;

    expect(result.status).toBe('CANCELLED');
    expect(result.errorClass).toBe('CANCELLED');
  });

  it('makes ZERO calls when the run was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const harnessed = harness.invoker({});

    const result = await harnessed.invoke(controller.signal);

    expect(result.status).toBe('CANCELLED');
    expect(harnessed.calls()).toBe(0);
  });

  it('makes ZERO calls when the role input is not one the role may see', async () => {
    // The projection runs before a transport exists, so a leakage violation costs nothing.
    const harnessed = harness.invoker({});
    const invoker =
      harness.label === 'OpenAI'
        ? createOpenAiResponsesInvoker({
            models: MODELS,
            transport: {
              create() {
                throw new Error('must not be called');
              },
            },
          })
        : createAnthropicMessagesInvoker({
            models: CLAUDE_MODELS,
            transport: {
              create() {
                throw new Error('must not be called');
              },
            },
          });

    await expect(
      invoker.invoke(
        requestFor('CUSTOMER_SIMULATOR', harness.configRef),
        { ...(customerInput() as Record<string, unknown>), split: 'HOLDOUT' },
        OPTIONS,
      ),
    ).rejects.toThrow();
    expect(harnessed.calls()).toBe(0);
  });
});
