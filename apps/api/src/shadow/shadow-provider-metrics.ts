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
import type { CandidateFailureClass } from './shadow-result.js';

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
 * Whether this leg's transport ever delivered a response (QFJ-S2-E-C-R1).
 *
 * This is the ONE fact that makes `server-unavailable` and `transport-error` distinguishable. The Groq
 * adapter maps an HTTP 5xx and a network-level rejection to the SAME
 * `{ status: 'unavailable', retryable: true }`, so the provider result alone cannot separate "the server
 * answered and declined" from "we never got an answer". The counting wrapper already sits between the
 * provider and the real transport, so it can record which happened — without reading the request, the
 * response, or the rejection value.
 */
export type TransportOutcome = 'not-sent' | 'responded' | 'rejected';

export interface CountedTransport<Request, Response> extends CountedTransportLike<
  Request,
  Response
> {
  outcome(): TransportOutcome;
}

/**
 * Wrap a transport so every network request is counted and a third is refused before delegation.
 *
 * The request is passed through untouched and never inspected — in particular its `headers`, which carry
 * the `Authorization` value. A rejection is observed only for the FACT that it happened: the rejection
 * value is re-thrown unchanged and never read, stored or classified.
 */
export function countTransport<Request, Response>(
  inner: CountedTransportLike<Request, Response>,
  counters: ShadowCounters,
): CountedTransport<Request, Response> {
  const state: { outcome: TransportOutcome } = { outcome: 'not-sent' };
  return Object.freeze({
    send(request: Request, signal: AbortSignal): Promise<Response> {
      if (!counters.claim('transportRequests')) {
        // A budget refusal is the runner's own, not the transport's: it leaves `outcome` untouched.
        return Promise.reject(new Error('QFJ_SHADOW_TRANSPORT_BUDGET_EXCEEDED'));
      }
      return inner.send(request, signal).then(
        (response: Response): Response => {
          state.outcome = 'responded';
          return response;
        },
        (error: unknown): never => {
          state.outcome = 'rejected';
          // Re-thrown untouched. Nothing about it is read or retained.
          throw error;
        },
      );
    },
    outcome: (): TransportOutcome => state.outcome,
  });
}

/** What the classifier needs. Closed values only — no result, no response, no error. */
export interface CandidateClassificationInput {
  readonly status: ProviderObservation['status'];
  readonly latencyMs: number;
  readonly transportOutcome: TransportOutcome;
  /** Whether the gateway recorded `shadow-completed` for this leg. */
  readonly accepted: boolean;
  /** The per-attempt bound, so a response that arrived too late is distinguishable. */
  readonly timeoutMs: number;
}

/**
 * Derive the closed candidate failure class (QFJ-S2-E-C-R1).
 *
 * TOTAL over the observation vocabulary and derived only from closed values — never from an exception
 * message, an HTTP status, or a response body.
 */
export function classifyCandidateFailure(
  input: CandidateClassificationInput,
): CandidateFailureClass {
  switch (input.status) {
    // Never delegated to: the run stopped earlier, or the invocation budget refused before the call.
    case 'not-invoked':
    case 'refused-by-budget':
      return 'not-invoked';

    case 'completed':
      if (input.accepted) {
        return 'none';
      }
      // The gateway rejected an otherwise-completed attempt. Lateness is the one rejection that is not
      // about the payload, and `latencyMs` separates it without describing the payload at all.
      return input.latencyMs > input.timeoutMs ? 'server-unavailable' : 'output-invalid';

    // A response arrived and its payload failed the strict contract.
    case 'malformed':
      return 'output-invalid';

    // A response arrived and rejected the request. 429 belongs here — it is a 4xx rejection — and the
    // top-level `reason` still reports `rate-limited`, so no specificity is lost.
    case 'failed':
    case 'rate-limited':
      return 'client-rejected';

    // The attempt was cut off, or threw before yielding any provider response.
    case 'cancelled':
    case 'threw':
      return 'transport-error';

    // The adapter collapses 5xx and network failure into one status; the transport outcome separates
    // them. `not-sent` means the provider decided without ever reaching the wire.
    case 'unavailable':
    case 'timeout':
      return input.transportOutcome === 'responded' ? 'server-unavailable' : 'transport-error';
  }
}
