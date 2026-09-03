/**
 * The spend gate (AS3A, ADR-0143 §12, §19, §23).
 *
 * ### It wraps the invoker, because that is where money is spent
 *
 * The budget could have lived in the executor, checked once per candidate. It does not, because a
 * candidate is many provider calls and the ceiling that matters is on calls. Wrapping the invoker
 * puts the check on the exact line that costs something: nothing is spent that the gate did not
 * count first.
 *
 * ### The candidate ceiling is enforced by CONSTRUCTION, not here
 *
 * `maxCandidates` truncates the scheduled item list in preflight, so a run never starts a candidate
 * it may not finish. A second check inside the gate would be a control that can never fire, and a
 * control that can never fire is one nobody maintains.
 *
 * ### Stopping has two halves, and both are needed
 *
 * When a ceiling is reached the gate does two things. It ABORTS the run, which makes AS2's
 * orchestrator stop scheduling new candidates and lets in-flight ones unwind; and it REFUSES
 * subsequent calls itself. Either alone leaks: an abort still lets a candidate already past the
 * scheduling check make its next call, and refusal alone would let the run keep starting candidates
 * that immediately fail, burning wall-clock to produce nothing.
 *
 * ### An auth failure stops everything
 *
 * A rejected credential is not a candidate's problem. Left alone, the harness would rediscover it
 * once per candidate, spending real requests to learn the same fact — which is the single most
 * embarrassing way to spend a budget. The first `AUTH_OR_CONFIG` stops the run.
 *
 * ### Reserve before, reconcile after
 *
 * A request is counted BEFORE it is sent and its tokens are added AFTER they come back. A gate that
 * counted only on success would let failures spend without limit, and failures are exactly what a
 * runaway run produces.
 *
 * ### The clock is injected
 *
 * Wall-clock enforcement needs a clock, and reading one directly would make every spec time-dependent
 * and every artifact machine-dependent. It is a parameter.
 */
import type {
  RiyaSyntheticInvocationOptions,
  RiyaSyntheticInvocationOutcome,
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticModelInvoker,
  RiyaSyntheticUsageV1,
} from '@qf-jarvis/riya-ai-synthetic-generation';

import type { RiyaSyntheticExecutionBudgetV1 } from '../contracts/execution-budget.js';
import { riyaSyntheticFailureOutcome } from '../adapters/invocation-runner.js';
import { riyaSyntheticFailureStopsRun } from '../contracts/provider-errors.js';
import type { RiyaSyntheticProviderFailureKind } from '../contracts/provider-errors.js';

/** Why a run stopped early. Closed, and never a provider message. */
export const RIYA_SYNTHETIC_STOP_REASONS = [
  'REQUEST_CEILING',
  'INPUT_TOKEN_CEILING',
  'OUTPUT_TOKEN_CEILING',
  'TOTAL_TOKEN_CEILING',
  'WALL_CLOCK_CEILING',
  'PROVIDER_AUTH_FAILURE',
] as const;
export type RiyaSyntheticStopReason = (typeof RIYA_SYNTHETIC_STOP_REASONS)[number];

export interface RiyaSyntheticSpendLedgerV1 {
  readonly providerRequests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly elapsedMs: number;
}

export interface RiyaSyntheticSpendGate {
  /** Wrap an invoker so every call it makes is counted and bounded. */
  readonly wrap: (inner: RiyaSyntheticModelInvoker) => RiyaSyntheticModelInvoker;
  /**
   * Hand this to each adapter as `onProviderFailure`.
   *
   * The precise kind, before AS2's class collapses it. Only `AUTH_OR_CONFIG` stops the run: a bad
   * model id and an over-long input also arrive as `PERMANENT`, and ending a whole pilot for one
   * malformed request would be a worse failure than the request.
   */
  readonly observeProviderFailure: (kind: RiyaSyntheticProviderFailureKind) => void;
  readonly stopReason: () => RiyaSyntheticStopReason | undefined;
  readonly ledger: () => RiyaSyntheticSpendLedgerV1;
}

export interface CreateSpendGateOptions {
  readonly budget: RiyaSyntheticExecutionBudgetV1;
  /** Monotonic milliseconds. Injected, never read from a global. */
  readonly now: () => number;
  /** Aborted the moment a ceiling is reached, so scheduling stops as well as spending. */
  readonly controller: AbortController;
}

export function createRiyaSyntheticSpendGate(
  options: CreateSpendGateOptions,
): RiyaSyntheticSpendGate {
  const { budget, now, controller } = options;
  const startedAt = now();

  let providerRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopped: RiyaSyntheticStopReason | undefined;

  const stop = (reason: RiyaSyntheticStopReason): void => {
    // FIRST reason wins. A later ceiling reached while unwinding must not overwrite the reason the
    // run actually stopped for -- that is the line somebody reads to understand the run.
    stopped ??= reason;
    if (!controller.signal.aborted) controller.abort();
  };

  const elapsed = (): number => now() - startedAt;

  /** The ceiling reached, if any, checked before a request is allowed out. */
  const ceilingReached = (): RiyaSyntheticStopReason | undefined => {
    if (elapsed() >= budget.maxWallClockMs) return 'WALL_CLOCK_CEILING';
    if (providerRequests >= budget.maxProviderRequests) return 'REQUEST_CEILING';
    if (inputTokens >= budget.maxInputTokens) return 'INPUT_TOKEN_CEILING';
    if (outputTokens >= budget.maxOutputTokens) return 'OUTPUT_TOKEN_CEILING';
    if (inputTokens + outputTokens >= budget.maxTotalTokens) return 'TOTAL_TOKEN_CEILING';
    return undefined;
  };

  const record = (usage: RiyaSyntheticUsageV1 | undefined): void => {
    if (usage === undefined) return;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    // Reconciled AFTER the fact: a call already sent may carry the run past a ceiling, and the honest
    // response is to stop the next one rather than to pretend the tokens were not spent.
    const reached = ceilingReached();
    if (reached !== undefined) stop(reached);
  };

  return {
    wrap(inner: RiyaSyntheticModelInvoker): RiyaSyntheticModelInvoker {
      return {
        async invoke(
          request: RiyaSyntheticInvocationRequestV1,
          structuredInput: unknown,
          invocationOptions: RiyaSyntheticInvocationOptions,
        ): Promise<RiyaSyntheticInvocationOutcome> {
          if (stopped !== undefined) {
            // The run is over. Refused as CANCELLED, which is what it is -- not a provider failure,
            // and not something a retry policy should ever act on.
            return riyaSyntheticFailureOutcome(request, 'CANCELLED');
          }
          const reached = ceilingReached();
          if (reached !== undefined) {
            stop(reached);
            return riyaSyntheticFailureOutcome(request, 'CANCELLED');
          }

          // Reserved BEFORE the call. A request counted only on return would let a burst of
          // in-flight calls all pass the same check.
          providerRequests += 1;

          const outcome = await inner.invoke(request, structuredInput, invocationOptions);
          record(outcome.result.usage);
          return outcome;
        },
      };
    },

    observeProviderFailure(kind: RiyaSyntheticProviderFailureKind): void {
      if (budget.stopOnProviderAuthFailure && riyaSyntheticFailureStopsRun(kind)) {
        stop('PROVIDER_AUTH_FAILURE');
      }
    },

    stopReason: () => stopped,

    ledger: (): RiyaSyntheticSpendLedgerV1 =>
      Object.freeze({
        providerRequests,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        elapsedMs: elapsed(),
      }),
  };
}
