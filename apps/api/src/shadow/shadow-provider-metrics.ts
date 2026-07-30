/**
 * Counting wrappers around a provider and a transport (QFJ-S2-E-B, ADR-0065 §2, §10).
 *
 * The wrappers exist for two reasons the gateway cannot serve:
 *
 *   1. **Counting.** The shadow invocation is invisible in `provenance.attempts`, so the runner counts
 *      health checks, invocations and transport requests itself, and refuses past the budget.
 *   2. **Observing the candidate.** The gateway returns stable success even when the shadow fails, so
 *      the runner must learn the candidate's outcome from somewhere. It learns it here — from the
 *      closed `ProviderInvocationResult.status` and `latencyMs`, never from the output.
 *
 * What a wrapper must never do: log, retain a prompt, retain a response, read an `Authorization` value,
 * retain a header, retain model output, or attach an arbitrary error. `recordOutcome` therefore receives
 * only a status, a latency and a usage record — the output branch of the result union is never touched.
 */
import type {
  ModelProvider,
  ProviderHealth,
  ProviderInvocationInput,
  ProviderInvocationResult,
  ModelUsage,
} from '@qf-jarvis/model-gateway';

import type { CountedOperation, ShadowCounters } from './shadow-counters.js';

/** What the runner learns about one provider. Status, latency and token counts — never content. */
export interface ProviderObservation {
  /** The closed provider status of the last attempt, or `not-invoked`. */
  readonly status:
    'not-invoked' | ProviderInvocationResult['status'] | 'threw' | 'refused-by-budget';
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly invocations: number;
}

export interface ObservedProvider {
  readonly provider: ModelProvider;
  observation(): ProviderObservation;
}

/** Extract only the numeric token fields. The usage object itself is never retained. */
function tokensOf(usage: ModelUsage | undefined): { input: number; output: number } {
  return { input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 };
}

/**
 * Wrap one provider so its health checks and invocations are counted and its outcome is observable.
 *
 * `invocationOperation` distinguishes the stable leg from the candidate leg, so each has its own budget
 * of exactly one and neither can borrow the other's.
 */
export function observeProvider(
  inner: ModelProvider,
  counters: ShadowCounters,
  invocationOperation: Extract<CountedOperation, 'stableInvocations' | 'candidateInvocations'>,
): ObservedProvider {
  const state: {
    status: ProviderObservation['status'];
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    invocations: number;
  } = {
    status: 'not-invoked',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    invocations: 0,
  };

  const provider: ModelProvider = Object.freeze({
    descriptor: inner.descriptor,
    capabilities: () => inner.capabilities(),

    async health(): Promise<ProviderHealth> {
      if (!counters.claim('healthChecks')) {
        // Refuse rather than delegate. The gateway treats an unavailable provider as excluded.
        return { available: false };
      }
      return inner.health();
    },

    async invoke(input: ProviderInvocationInput): Promise<ProviderInvocationResult> {
      if (!counters.claim(invocationOperation)) {
        state.status = 'refused-by-budget';
        // A budget refusal must not reach the provider at all.
        return { status: 'failed', retryable: false };
      }
      state.invocations += 1;
      let result: ProviderInvocationResult;
      try {
        result = await inner.invoke(input);
      } catch {
        // The raw error is discarded: it can carry a body or a header.
        state.status = 'threw';
        return { status: 'failed', retryable: false };
      }
      state.status = result.status;
      if (result.status === 'completed') {
        state.latencyMs = result.latencyMs;
        const tokens = tokensOf(result.usage);
        state.inputTokens = tokens.input;
        state.outputTokens = tokens.output;
        // `result.output` is deliberately NOT read here.
      } else if (result.status === 'timeout' || result.status === 'malformed') {
        state.latencyMs = result.latencyMs;
      }
      return result;
    },
  });

  return Object.freeze({
    provider,
    observation: (): ProviderObservation => Object.freeze({ ...state }),
  });
}

/** The narrow transport shape both provider adapters share. Declared locally to avoid a deep import. */
export interface CountedTransportLike<Request, Response> {
  send(request: Request, signal: AbortSignal): Promise<Response>;
}

/**
 * Wrap a transport so every network request is counted and a third is refused before delegation.
 *
 * The request is passed through untouched and never inspected — in particular its `headers`, which carry
 * the `Authorization` value.
 */
export function countTransport<Request, Response>(
  inner: CountedTransportLike<Request, Response>,
  counters: ShadowCounters,
): CountedTransportLike<Request, Response> {
  return Object.freeze({
    send(request: Request, signal: AbortSignal): Promise<Response> {
      if (!counters.claim('transportRequests')) {
        return Promise.reject(new Error('QFJ_SHADOW_TRANSPORT_BUDGET_EXCEEDED'));
      }
      return inner.send(request, signal);
    },
  });
}
