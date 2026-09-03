/**
 * The spend gate (AS3A, ADR-0143 §12, §19, §23).
 *
 * ### It wraps the invoker, because that is where money is spent
 *
 * The budget could have lived in the executor, checked once per candidate. It does not, because a
 * candidate is many provider calls and the ceiling that matters is on calls. Wrapping the invoker
 * puts the check on the exact line that costs something.
 *
 * ### Two kinds of control, and the difference is not cosmetic
 *
 * **HARD**: the request count, the aggregate output RESERVATION, and the run deadline. Each is
 * checked against something this gate knows before anything is spent — a counter it keeps, a
 * reservation it holds, a timer it armed. None can be exceeded.
 *
 * "Cannot be exceeded" is a claim about CONCURRENCY, not merely about arithmetic. A check sitting on
 * the far side of an `await` from the state it guards is not a control: the second review of AS3A
 * found the request ceiling checked before `reserveOutput`, so two invocations starting in the same
 * turn both read the same count and both proceeded. Every hard control here is now decided on the
 * near side of its last await, with no suspension between the check and the state change it
 * protects.
 *
 * **OBSERVED**: provider-reported input, output and total tokens. These are reconciled AFTER a call
 * returns, so the call that crosses the line has already happened, and under concurrency several may
 * cross together. They stop the run; they do not prevent the crossing. The first review of AS3A found
 * these described as hard ceilings, which is the more dangerous of the two errors — a threshold
 * somebody plans against as though it were a wall.
 *
 * The overshoot is bounded, and bounded by the hard controls: no more than
 * `maxConcurrentInvocations` calls can be in flight, each holding a reservation, and the aggregate
 * reservation is itself capped. So "how far past can this go" has an answer written in the budget
 * rather than in a provider's behaviour.
 *
 * ### The output reservation is what makes the output ceiling real
 *
 * Every invocation reserves its own `maxOutputTokens` — a limit the provider itself enforces — before
 * it is allowed near a transport, and releases it when it settles. A call that does not fit WAITS
 * rather than being refused, because refusing would turn a busy moment into a failed candidate. A
 * call bigger than the whole ceiling is refused immediately: it could never fit, and waiting for that
 * is a deadlock with extra steps.
 *
 * A loop, not an `if`, on the wait — the same reasoning as AS2's concurrency gate. Between a release
 * and a woken continuation actually running, another acquirer can take the room.
 *
 * ### The deadline is armed, not polled
 *
 * Checking elapsed time before each call cannot end a call already in flight, so a slow provider
 * could run a pilot far past its wall clock while every check passed. A real timer aborts the run
 * controller, the composed signal reaches the active invocation, and the adapter settles.
 *
 * ### An auth failure stops everything
 *
 * A rejected credential is not a candidate's problem. Left alone the harness rediscovers it once per
 * candidate, spending real requests to learn the same fact.
 */
import type {
  RiyaSyntheticInvocationOptions,
  RiyaSyntheticInvocationOutcome,
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticModelInvoker,
  RiyaSyntheticUsageV1,
} from '@qf-jarvis/riya-ai-synthetic-generation';

import { riyaSyntheticFailureOutcome } from '../adapters/invocation-runner.js';
import type { RiyaSyntheticExecutionBudgetV1 } from '../contracts/execution-budget.js';
import { riyaSyntheticFailureStopsRun } from '../contracts/provider-errors.js';
import type { RiyaSyntheticProviderFailureKind } from '../contracts/provider-errors.js';

/**
 * Why a run stopped early. Closed, and never a provider message.
 *
 * The names say which kind of control fired. `REQUEST_CEILING` and `OUTPUT_RESERVATION_CEILING` are
 * hard; `OBSERVED_*_THRESHOLD` are not, and a reader of a usage report should not have to look up
 * which was which.
 */
export const RIYA_SYNTHETIC_STOP_REASONS = [
  'REQUEST_CEILING',
  'OUTPUT_RESERVATION_CEILING',
  'WALL_CLOCK_CEILING',
  'OBSERVED_INPUT_TOKEN_THRESHOLD',
  'OBSERVED_OUTPUT_TOKEN_THRESHOLD',
  'OBSERVED_TOTAL_TOKEN_THRESHOLD',
  'PROVIDER_AUTH_FAILURE',
] as const;
export type RiyaSyntheticStopReason = (typeof RIYA_SYNTHETIC_STOP_REASONS)[number];

export interface RiyaSyntheticSpendLedgerV1 {
  readonly providerRequests: number;
  /** Provider-REPORTED. Observed, and may sit slightly past its threshold. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** Output exposure held by in-flight calls right now. Zero once a run is drained. */
  readonly reservedOutputTokens: number;
  /** The most output exposure ever held at once. Never above `maxReservedOutputTokens`. */
  readonly peakReservedOutputTokens: number;
  readonly elapsedMs: number;
}

export interface RiyaSyntheticSpendGate {
  /** Wrap an invoker so every call it makes is reserved, counted and bounded. */
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
  /** Cancel the run deadline. Always called, so a finished pilot leaves no timer behind. */
  readonly dispose: () => void;
}

/** Arm a one-shot timer. Injected so a spec can drive the deadline without waiting for it. */
export type RiyaSyntheticScheduler = (delayMs: number, fire: () => void) => () => void;

const defaultScheduler: RiyaSyntheticScheduler = (delayMs, fire) => {
  const handle = setTimeout(fire, delayMs);
  // A pilot must not hold a process open on its own deadline.
  handle.unref();
  return (): void => {
    clearTimeout(handle);
  };
};

export interface CreateSpendGateOptions {
  readonly budget: RiyaSyntheticExecutionBudgetV1;
  /** Monotonic milliseconds, for evidence. Never the thing that ENDS a run — a timer does that. */
  readonly now: () => number;
  /** Aborted the moment a control fires, so scheduling and in-flight work both stop. */
  readonly controller: AbortController;
  readonly scheduler?: RiyaSyntheticScheduler;
}

export function createRiyaSyntheticSpendGate(
  options: CreateSpendGateOptions,
): RiyaSyntheticSpendGate {
  const { budget, now, controller } = options;
  const scheduler = options.scheduler ?? defaultScheduler;
  const startedAt = now();

  let providerRequests = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reservedOutputTokens = 0;
  let peakReservedOutputTokens = 0;
  let stopped: RiyaSyntheticStopReason | undefined;

  /** Everyone waiting for output reservation room. Woken on release AND on stop. */
  const waiters: (() => void)[] = [];

  /**
   * Read `stopped` through a function.
   *
   * It is a value that CHANGES while a continuation is suspended, and TypeScript narrows it after
   * the first check — so the post-await re-check below would be treated as impossible and reported
   * as dead code. The call defeats that narrowing, which is the difference between a control and a
   * comment. AS2's orchestrator does the same thing with its abort flag, for the same reason.
   */
  const runStopped = (): RiyaSyntheticStopReason | undefined => stopped;

  const wakeAll = (): void => {
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) next();
    }
  };

  const stop = (reason: RiyaSyntheticStopReason): void => {
    // FIRST reason wins. A later control firing while the run unwinds must not overwrite the reason
    // it actually stopped for -- that is the line somebody reads to understand the run.
    stopped ??= reason;
    if (!controller.signal.aborted) controller.abort();
    // A waiter blocked on reservation room would otherwise wait for a release that is never coming.
    wakeAll();
  };

  // THE run deadline. Armed once, at construction, which is the moment EXECUTE begins.
  const cancelDeadline = scheduler(budget.maxWallClockMs, () => {
    stop('WALL_CLOCK_CEILING');
  });

  const elapsed = (): number => now() - startedAt;

  /** The observed threshold crossed, if any. Reconciled after a call, never before. */
  const observedThresholdCrossed = (): RiyaSyntheticStopReason | undefined => {
    if (inputTokens >= budget.maxObservedInputTokens) return 'OBSERVED_INPUT_TOKEN_THRESHOLD';
    if (outputTokens >= budget.maxObservedOutputTokens) return 'OBSERVED_OUTPUT_TOKEN_THRESHOLD';
    if (inputTokens + outputTokens >= budget.maxObservedTotalTokens) {
      return 'OBSERVED_TOTAL_TOKEN_THRESHOLD';
    }
    return undefined;
  };

  /**
   * Reserve output exposure for one call. Resolves true when the room is held.
   *
   * Waits rather than refuses, so a busy moment costs latency rather than a candidate.
   */
  const reserveOutput = async (tokens: number): Promise<boolean> => {
    if (tokens > budget.maxReservedOutputTokens) {
      // Could never fit. Waiting would be a deadlock, and stopping is the honest answer: the budget
      // and the policy disagree about what one call may produce.
      stop('OUTPUT_RESERVATION_CEILING');
      return false;
    }
    for (;;) {
      if (runStopped() !== undefined) return false;
      if (reservedOutputTokens + tokens <= budget.maxReservedOutputTokens) {
        reservedOutputTokens += tokens;
        if (reservedOutputTokens > peakReservedOutputTokens) {
          peakReservedOutputTokens = reservedOutputTokens;
        }
        return true;
      }
      // A LOOP, not an `if`: between a release and this continuation running, another acquirer can
      // take the room, and incrementing on a waiter's behalf would let the reservation drift above
      // the ceiling under exactly the load the ceiling exists for.
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
  };

  const releaseOutput = (tokens: number): void => {
    reservedOutputTokens -= tokens;
    const next = waiters.shift();
    if (next !== undefined) next();
  };

  const record = (usage: RiyaSyntheticUsageV1 | undefined): void => {
    if (usage === undefined) return;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    // A call already sent may carry the run past a threshold. The honest response is to stop the
    // NEXT one rather than to pretend the tokens were not spent.
    const crossed = observedThresholdCrossed();
    if (crossed !== undefined) stop(crossed);
  };

  return {
    wrap(inner: RiyaSyntheticModelInvoker): RiyaSyntheticModelInvoker {
      return {
        async invoke(
          request: RiyaSyntheticInvocationRequestV1,
          structuredInput: unknown,
          invocationOptions: RiyaSyntheticInvocationOptions,
        ): Promise<RiyaSyntheticInvocationOutcome> {
          if (runStopped() !== undefined) {
            // The run is over. Refused as CANCELLED, which is what it is -- not a provider failure,
            // and not something a retry policy should ever act on.
            return riyaSyntheticFailureOutcome(request, 'CANCELLED');
          }
          // A cheap early rejection, so an exhausted run does not queue for reservation room it will
          // never be allowed to use. It is NOT the control -- the decision is re-made below.
          if (providerRequests >= budget.maxProviderRequests) {
            stop('REQUEST_CEILING');
            return riyaSyntheticFailureOutcome(request, 'CANCELLED');
          }
          const alreadyCrossed = observedThresholdCrossed();
          if (alreadyCrossed !== undefined) {
            stop(alreadyCrossed);
            return riyaSyntheticFailureOutcome(request, 'CANCELLED');
          }

          // HARD output exposure. Held for the whole call, so concurrent calls cannot collectively
          // exceed what one of them was individually allowed to produce.
          const reservation = request.maxOutputTokens;
          const reserved = await reserveOutput(reservation);
          if (!reserved) {
            return riyaSyntheticFailureOutcome(request, 'CANCELLED');
          }

          // ---- THE REQUEST BUDGET DECISION, re-made AFTER the await ---------------------------
          //
          // The check above is worth nothing on its own. `reserveOutput` is async, so awaiting it
          // yields to the microtask queue even when the room is free -- and two invocations started
          // in the same turn would both read `providerRequests === 0`, both pass, and both increment
          // afterwards. With a ceiling of one, two calls would reach the provider. That is the
          // failure this re-check exists to prevent, and the reason a control has to be decided on
          // the near side of its last await.
          //
          // From here to the increment there is no `await`, and JavaScript resumes one continuation
          // at a time, so the check and the increment are atomic with respect to every other
          // invocation.
          if (runStopped() !== undefined || providerRequests >= budget.maxProviderRequests) {
            if (runStopped() === undefined) stop('REQUEST_CEILING');
            // The loser is holding reservation room it will never use. Released explicitly, because
            // the `finally` below covers only a call that actually entered the transport -- and a
            // reservation abandoned here would stall the run at its own ceiling forever.
            releaseOutput(reservation);
            return riyaSyntheticFailureOutcome(request, 'CANCELLED');
          }
          providerRequests += 1;

          try {
            const outcome = await inner.invoke(request, structuredInput, invocationOptions);
            record(outcome.result.usage);
            return outcome;
          } finally {
            // Released on EVERY path, including a throw. A leaked reservation would stall the run at
            // its own ceiling and look exactly like a slow provider.
            releaseOutput(reservation);
          }
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
        reservedOutputTokens,
        peakReservedOutputTokens,
        elapsedMs: elapsed(),
      }),

    dispose: (): void => {
      cancelDeadline();
      wakeAll();
    },
  };
}
