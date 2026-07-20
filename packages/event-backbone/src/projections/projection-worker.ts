/**
 * The INTERNAL projection worker/scheduler (Stage 3.4.5A, ADR-0038).
 *
 * The runner {@link runProjectionOnce} processes AT MOST one position for ONE projection per call. The
 * worker is the loop that drives it repeatedly across the whole registry — nothing more. It does NOT
 * add a queue, a real handler, a read model, a rebuild, a dead letter, a managed migration, or a
 * package-root export.
 *
 * ### Deterministic handler failure vs. non-result failure — the isolation boundary
 *
 * `runProjectionOnce` represents a **deterministic projection-handler failure** through its CLOSED
 * result union — a poison event comes back as `retry-scheduled` or `blocked-now`, never as a thrown
 * value. Every one of the seven closed results (`busy`, `caught-up`, `succeeded`, `retry-scheduled`,
 * `blocked-now`, `blocked-existing`, `retry-pending`) is recorded and the cycle **continues** to the
 * next projection. That is the isolation mechanism: one poisoned projection never stalls another.
 *
 * A **non-result** failure at any injected seam — `registry.list()`, the registry snapshot, `now()`,
 * `runOnce()`, validating a returned result, or `sleep()` — cannot be reasoned about at the cycle
 * level. It is normalised to a fresh, closed {@link ProjectionWorkerError} whose `code` and `message`
 * are repository-owned constants, and the caught value is **discarded without any inspection** — every
 * `catch` here has **no binding**, so the value is never read, `instanceof`-checked, stringified,
 * interpolated, enumerated, spread, prototype/descriptor-inspected, preserved as `cause`, or logged.
 *
 * ### Scheduling and lifecycle
 *   - **Deterministic traversal.** A cycle takes ONE registry snapshot and offers EVERY definition in
 *     it exactly one `runOnce` invocation, in ascending name order, sequentially, at most one position
 *     per projection. A cycle finishes the WHOLE snapshot unless a non-result failure aborts it; it
 *     never returns a partial cycle as completed, and it does NOT observe the abort signal itself.
 *   - **Cancellation is the loop's job (drain the active cycle).** `runProjectionWorker` checks abort
 *     BEFORE beginning a cycle and AFTER the complete cycle; once a cycle begins it runs to completion
 *     (drain), then the worker starts no following cycle and does not sleep.
 *   - **No busy-spin.** After a cycle that advanced no position, the worker SLEEPS until the earliest
 *     scheduled retry (`next_attempt_at`) or a bounded poll interval, whichever is sooner.
 *   - **Injected time and sleep.** The worker reads the clock ONLY through the injected `now()` and
 *     yields ONLY through `sleep()` (injectable; defaults to the repository {@link abortableSleep}); it
 *     never calls `Date.now()` in scheduling.
 *   - **Injected pool, NOT owned.** The worker borrows the caller's pool and NEVER closes it.
 *   - **Safe observability.** Recorded outcomes carry only the projection name/version (from the
 *     registry DEFINITION, never caller-returned text) and the closed outcome kind — all frozen.
 *
 * Not exported from the package root — internal projection vocabulary (the barrel is unchanged).
 */
import type { DatabasePool } from '../persistence/pool.js';

import {
  isCanonicalInstant,
  type CanonicalInstant,
  type ProjectionDefinition,
} from './projection-definition.js';
import { ProjectionInputError } from './projection-errors.js';
import type { ProjectionRegistry } from './projection-registry.js';
import type { ProjectionRunResult } from './projection-run-result.js';
import { runProjectionOnce } from './projection-runner.js';
import type { RunProjectionInput } from './projection-runner.js';

/** The bounded poll interval: at least 100 ms so the loop cannot hot-spin, at most 60 s so it stays live. */
export const MIN_POLL_INTERVAL_MS = 100;
export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const MAX_POLL_INTERVAL_MS = 60_000;

// --- The closed worker-error vocabulary --------------------------------------------------------

const PROJECTION_WORKER_ERROR_MESSAGES = {
  'projection-worker-cycle-failed':
    'A projection worker cycle aborted: a runner, registry, clock, or result operation raised a non-result failure.',
  'projection-worker-sleep-failed':
    'A projection worker sleep failed; the worker could not yield between cycles.',
} as const;

/** One closed worker failure code. */
export type ProjectionWorkerErrorCode = keyof typeof PROJECTION_WORKER_ERROR_MESSAGES;

/** The closed set of worker failure codes. */
export const PROJECTION_WORKER_ERROR_CODES = Object.freeze(
  Object.keys(PROJECTION_WORKER_ERROR_MESSAGES) as ProjectionWorkerErrorCode[],
);

const WORKER_FALLBACK_CODE: ProjectionWorkerErrorCode = 'projection-worker-cycle-failed';

/** Normalise an arbitrary value into a known code, or the safe fallback (hasOwnProperty gate). */
function normalizeWorkerCode(code: unknown): ProjectionWorkerErrorCode {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(PROJECTION_WORKER_ERROR_MESSAGES, code)
    ? (code as ProjectionWorkerErrorCode)
    : WORKER_FALLBACK_CODE;
}

/**
 * A projection worker operation failed. The constructor takes ONLY a code (runtime-normalised); both
 * the `code` and the `message` are repository-owned constants, the stack is freshly generated, and no
 * `cause` or caller text is ever retained. Exported for tests; NOT re-exported from the package root.
 */
export class ProjectionWorkerError extends Error {
  public readonly code: ProjectionWorkerErrorCode;

  public constructor(code: ProjectionWorkerErrorCode) {
    const safeCode = normalizeWorkerCode(code);
    super(PROJECTION_WORKER_ERROR_MESSAGES[safeCode]);
    this.name = 'ProjectionWorkerError';
    this.code = safeCode;
  }
}

// --- Public shapes ------------------------------------------------------------------------------

/** A per-projection outcome for one cycle. Only closed, non-identifying fields — safe to log. Frozen. */
export interface ProjectionWorkerOutcome {
  readonly projectionName: string;
  readonly projectionVersion: number;
  /** One of the runner's seven closed result outcomes. A non-result failure aborts the cycle instead. */
  readonly outcome: ProjectionRunResult['outcome'];
}

/** The result of ONE deterministic cycle over the whole registry. Frozen. */
export interface ProjectionCycleResult {
  readonly outcomes: readonly ProjectionWorkerOutcome[];
  /** True iff at least one projection advanced a position (`succeeded`) this cycle. */
  readonly progressed: boolean;
  /** The earliest scheduled retry instant across this cycle, or `null` if none is scheduled. */
  readonly earliestNextAttemptAt: CanonicalInstant | null;
}

/** Why {@link runProjectionWorker} returned. A long-running worker returns only on abort. */
export type ProjectionWorkerStoppedBy = 'aborted' | 'max-cycles';

/** A frozen summary of a worker run. Returned ONLY when the worker stops cleanly (never on a throw). */
export interface ProjectionWorkerSummary {
  readonly cycles: number;
  /** Total `succeeded` outcomes across all cycles (positions advanced). */
  readonly succeeded: number;
  readonly stoppedBy: ProjectionWorkerStoppedBy;
}

/** The single-invocation runner the worker drives. Defaults to {@link runProjectionOnce}; injectable for tests. */
export type RunProjectionOnce = (input: RunProjectionInput) => Promise<ProjectionRunResult>;

/** An abortable sleep: resolves after `ms`, or EARLY (never rejecting) when `signal` aborts. */
export type WorkerSleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface ProjectionWorkerDeps {
  /** Borrowed, NEVER closed by the worker. */
  readonly pool: DatabasePool;
  readonly registry: ProjectionRegistry;
  /** The injected clock — a canonical UTC instant. The worker reads no other clock. */
  readonly now: () => CanonicalInstant;
  /** The injected abortable sleep. Defaults to {@link abortableSleep}. */
  readonly sleep?: WorkerSleep;
  /** Optional cooperative-cancellation signal for graceful shutdown. */
  readonly signal?: AbortSignal;
  /** Bounded poll interval (ms), MIN..MAX. Defaults to {@link DEFAULT_POLL_INTERVAL_MS}. */
  readonly pollIntervalMs?: number;
  /** Optional bound on the number of cycles (for tests / bounded runs). Undefined => until aborted. */
  readonly maxCycles?: number;
  /** Injected single-invocation runner. Defaults to {@link runProjectionOnce}. */
  readonly runOnce?: RunProjectionOnce;
}

// --- Repository-owned abortable sleep -----------------------------------------------------------

/**
 * The repository-owned abortable sleep. Uses `setTimeout` (never `setInterval`), resolves normally when
 * the timer completes and EARLY when `signal` aborts, clears the timer on abort, removes its abort
 * listener on every exit path, resolves immediately WITHOUT creating a timer when already aborted, and
 * never rejects — so it leaves no timer, listener, or unresolved promise. Injectable for deterministic
 * tests (the worker accepts a `sleep` override); this is the production default.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted === true) {
      resolve(); // already aborted: no timer is created
      return;
    }
    // A const holder avoids a forward reference from onAbort to the timer handle.
    const state: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
    const onAbort = (): void => {
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    state.timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

// --- Validation ---------------------------------------------------------------------------------

function assertPollIntervalOrUndefined(value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < MIN_POLL_INTERVAL_MS ||
    value > MAX_POLL_INTERVAL_MS
  ) {
    throw new ProjectionInputError(
      `the projection worker poll interval must be an integer between ${String(MIN_POLL_INTERVAL_MS)} and ${String(MAX_POLL_INTERVAL_MS)} ms.`,
    );
  }
}

function assertMaxCyclesOrUndefined(value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new ProjectionInputError(
      'the projection worker max cycles must be a non-negative integer.',
    );
  }
}

/** Validate the injected numeric bounds BEFORE any work. Fails closed with {@link ProjectionInputError}. */
function assertWorkerDeps(deps: ProjectionWorkerDeps): void {
  assertPollIntervalOrUndefined(deps.pollIntervalMs);
  assertMaxCyclesOrUndefined(deps.maxCycles);
}

/** The earlier of two canonical instants (either may be null). Pure string comparison — no clock. */
function earlierInstant(left: CanonicalInstant | null, right: CanonicalInstant): CanonicalInstant {
  return left === null || right < left ? right : left;
}

/** The seven closed runner outcomes. A returned result outside this set fails closed. */
const CLOSED_OUTCOMES: ReadonlySet<string> = new Set<string>([
  'busy',
  'caught-up',
  'succeeded',
  'retry-scheduled',
  'blocked-now',
  'blocked-existing',
  'retry-pending',
]);

function isClosedOutcome(value: string): value is ProjectionRunResult['outcome'] {
  return CLOSED_OUTCOMES.has(value);
}

/**
 * Copy the registry's listing into ONE repository-owned snapshot, defensively. `registry.list()` and
 * every element access are caller-controlled (a hostile injected registry may throw or proxy), so the
 * caller wraps this in a bindingless `catch`; here we only ensure a single, order-stable copy that a
 * later `list()` cannot change mid-cycle.
 */
function snapshotRegistry(registry: ProjectionRegistry): readonly ProjectionDefinition[] {
  const copy: ProjectionDefinition[] = [];
  for (const definition of registry.list()) {
    copy.push(definition);
  }
  return copy;
}

// --- The cycle and the loop ---------------------------------------------------------------------

/**
 * Run ONE deterministic cycle over a single registry snapshot: offer every definition exactly one
 * `runOnce` invocation, in name order, and RECORD each of the runner's seven closed results. A cycle
 * finishes the WHOLE snapshot unless a NON-result failure aborts it — a throw from `registry.list()`,
 * the snapshot, `now()`, `runOnce()`, or result validation is discarded (bindingless `catch`) and a
 * fresh {@link ProjectionWorkerError} (`projection-worker-cycle-failed`) is thrown. It NEVER returns a
 * partial cycle, and it does NOT observe the abort signal (cancellation belongs to the loop).
 *
 * Each returned result is validated before use: the `outcome` must be one of the seven closed kinds,
 * the returned identity must MATCH the requested definition, and a scheduled-retry outcome must carry a
 * valid canonical `next_attempt_at`. The recorded outcome's name/version come from the registry
 * DEFINITION (validated), never from caller-returned text.
 */
export async function runProjectionCycle(
  deps: ProjectionWorkerDeps,
): Promise<ProjectionCycleResult> {
  assertWorkerDeps(deps);
  const runOnce = deps.runOnce ?? runProjectionOnce;

  let snapshot: readonly ProjectionDefinition[];
  try {
    snapshot = snapshotRegistry(deps.registry);
  } catch {
    throw new ProjectionWorkerError('projection-worker-cycle-failed');
  }

  const outcomes: ProjectionWorkerOutcome[] = [];
  let progressed = false;
  let earliestNextAttemptAt: CanonicalInstant | null = null;

  for (const definition of snapshot) {
    try {
      // Read the definition identity, invoke the runner, and validate the result — all inside one
      // bindingless-guarded region. Any throw or malformed/hostile result aborts the whole cycle.
      const name = definition.name;
      const version = definition.version;
      const result = await runOnce({
        pool: deps.pool,
        registry: deps.registry,
        name,
        version,
        now: deps.now(),
      });

      const rawOutcome: unknown = (result as { outcome?: unknown }).outcome;
      if (typeof rawOutcome !== 'string' || !isClosedOutcome(rawOutcome)) {
        throw new Error(); // discarded by the bindingless catch below
      }
      if (
        (result as { projectionName?: unknown }).projectionName !== name ||
        (result as { projectionVersion?: unknown }).projectionVersion !== version
      ) {
        throw new Error(); // identity mismatch => fail closed
      }
      if (rawOutcome === 'retry-scheduled' || rawOutcome === 'retry-pending') {
        const rawNext: unknown = (result as { nextAttemptAt?: unknown }).nextAttemptAt;
        if (!isCanonicalInstant(rawNext)) {
          throw new Error(); // a scheduled retry must carry a valid canonical instant
        }
        earliestNextAttemptAt = earlierInstant(earliestNextAttemptAt, rawNext);
      }
      if (rawOutcome === 'succeeded') {
        progressed = true;
      }
      // Build the recorded outcome from the DEFINITION's validated name/version — never caller text.
      outcomes.push(
        Object.freeze({ projectionName: name, projectionVersion: version, outcome: rawOutcome }),
      );
    } catch {
      throw new ProjectionWorkerError('projection-worker-cycle-failed');
    }
  }

  return Object.freeze({
    outcomes: Object.freeze(outcomes),
    progressed,
    earliestNextAttemptAt,
  });
}

/**
 * Compute the no-progress sleep delay (ms), clamped to `[0, pollIntervalMs]`. The wake-up is the
 * earliest scheduled retry if known and parseable; otherwise the bounded poll interval. Uses the
 * injected `now` — never `Date.now()`; `Date.parse` here parses GIVEN canonical strings.
 */
function computeWakeDelayMs(
  earliestNextAttemptAt: CanonicalInstant | null,
  now: CanonicalInstant,
  pollIntervalMs: number,
): number {
  if (earliestNextAttemptAt === null) {
    return pollIntervalMs;
  }
  const nowMs = Date.parse(now);
  const nextMs = Date.parse(earliestNextAttemptAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextMs)) {
    return pollIntervalMs;
  }
  const delta = nextMs - nowMs;
  if (delta <= 0) {
    return 0;
  }
  return Math.min(delta, pollIntervalMs);
}

/**
 * Drive the whole registry in a loop until the signal aborts (or `maxCycles` is reached). Cancellation
 * is observed BEFORE a cycle and AFTER the complete cycle (never mid-cycle — the active cycle drains).
 * A cycle that advanced a position loops again immediately; one that advanced nothing sleeps until the
 * next scheduled retry or the bounded poll interval (no busy-spin). Returns a frozen summary ONLY on a
 * clean stop; a non-result failure propagates as a {@link ProjectionWorkerError} and NO summary is
 * returned. A sleep rejection is a failure (`projection-worker-sleep-failed`), NOT a silent aborted stop.
 */
export async function runProjectionWorker(
  deps: ProjectionWorkerDeps,
): Promise<ProjectionWorkerSummary> {
  assertWorkerDeps(deps);
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = deps.sleep ?? abortableSleep;
  const aborted = (): boolean => deps.signal?.aborted === true;

  let cycles = 0;
  let succeeded = 0;

  for (;;) {
    if (aborted()) {
      return Object.freeze({ cycles, succeeded, stoppedBy: 'aborted' });
    }
    if (deps.maxCycles !== undefined && cycles >= deps.maxCycles) {
      return Object.freeze({ cycles, succeeded, stoppedBy: 'max-cycles' });
    }

    // Once a cycle begins it drains to completion; a non-result failure propagates (no summary).
    const cycle = await runProjectionCycle(deps);
    cycles += 1;
    for (const outcome of cycle.outcomes) {
      if (outcome.outcome === 'succeeded') {
        succeeded += 1;
      }
    }

    // Abort observed AFTER the complete cycle: stop before sleeping or starting another (drain complete).
    if (aborted()) {
      return Object.freeze({ cycles, succeeded, stoppedBy: 'aborted' });
    }

    if (cycle.progressed) {
      continue; // more positions are likely available — keep going immediately
    }

    // Read the clock through the injected seam (guarded), then yield through the injected sleep. A sleep
    // rejection is a failure, not a silent stop.
    let currentNow: CanonicalInstant;
    try {
      currentNow = deps.now();
    } catch {
      throw new ProjectionWorkerError('projection-worker-cycle-failed');
    }
    const delayMs = computeWakeDelayMs(cycle.earliestNextAttemptAt, currentNow, pollIntervalMs);
    try {
      await sleep(delayMs, deps.signal);
    } catch {
      throw new ProjectionWorkerError('projection-worker-sleep-failed');
    }
  }
}
