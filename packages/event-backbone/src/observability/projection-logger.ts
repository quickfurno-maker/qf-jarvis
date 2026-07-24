/**
 * The INTERNAL structured logger for projection failure operations (QFJ-P03.07G, ADR-0040).
 *
 * A deliberately small, dependency-free JSON Lines writer over an INJECTED sink and an INJECTED
 * canonical clock. It brings in no third-party logging library, opens no file, holds no buffer, starts
 * no timer, and — critically — contains no reference to `process.stdout` or `process.stderr`. Library
 * code that writes straight to a process stream is untestable and unmockable; the worker CLI already
 * proves the alternative with its injected `writeOut`/`writeErr` seams, and this module follows it.
 *
 * ### Telemetry is never allowed to break correctness
 *
 * Every emission path is wrapped so that a throwing sink, a throwing clock, or a serialisation failure
 * is swallowed. A logger that can throw would propagate into the runner's own error handling and could
 * abort a transaction that was otherwise about to commit correctly — telemetry causing data loss. That
 * must be impossible, so it is made impossible here rather than at every call site.
 *
 * ### Fields are projected, not copied
 *
 * The record written to the sink is built by an EXPLICIT per-event projection (see `projectFields`),
 * never by spreading the caller's object. The type system already constrains the shape, but a
 * structurally-typed object can always carry extra properties at runtime, and a spread would faithfully
 * serialise whatever a future caller attached — a raw error, a payload fragment, an operator's free
 * text. Projecting explicitly means an unknown property cannot reach the sink even if it is present on
 * the argument.
 *
 * ### Volume control
 *
 * Two conditions in this contract recur on EVERY worker cycle for as long as they hold, and would
 * otherwise flood: a `blocked` projection and a divergence. The blocked case is handled at the call
 * sites (transition events fire on `blocked-now` only, never on `blocked-existing`). The divergence
 * case is handled here, because a divergence persists nothing and its first observation must never be
 * dropped: the first is always emitted at `critical`, and repeats for the same
 * (name, version, kind) are suppressed for a bounded window. `projection.commit.outcomeUnknown` is
 * never suppressed and never downgraded.
 *
 * Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import type { CanonicalInstant } from '../projections/projection-definition.js';

import {
  PROJECTION_LOG_SEVERITY_BY_EVENT,
  projectionLogSeverityRank,
  type ProjectionLogEvent,
  type ProjectionLogIdentity,
  type ProjectionLogSeverity,
  type ProjectionScopedLogEvent,
  type ProjectionWorkerScopedLogEvent,
} from './projection-log-events.js';

/** Where a serialised line goes. One method, synchronous, allowed to throw (the writer swallows it). */
export interface ProjectionLogSink {
  readonly write: (line: string) => void;
}

/**
 * The emission surface used by the runner, worker, and the E/F services.
 *
 * Two methods rather than one because the two scopes carry different identity requirements, and a
 * single method taking an optional identity would let a projection-scoped event be emitted without one.
 */
export interface ProjectionLogger {
  /** Emit an event that describes ONE projection. */
  readonly projectionEvent: (
    identity: ProjectionLogIdentity,
    event: ProjectionScopedLogEvent,
  ) => void;
  /** Emit an event that describes a worker run spanning the registry. */
  readonly workerEvent: (event: ProjectionWorkerScopedLogEvent) => void;
}

/** Default minimum severity. `info` keeps the `debug`-level per-cycle event off unless asked for. */
export const DEFAULT_PROJECTION_LOG_MIN_SEVERITY: ProjectionLogSeverity = 'info';

/**
 * Default suppression window for REPEATED divergences of the same kind on the same projection
 * (5 minutes). The first observation is always emitted; this only bounds the repeats a polling worker
 * would otherwise produce every cycle until an operator intervenes.
 */
export const DEFAULT_DIVERGENCE_REPEAT_SUPPRESSION_MS = 300_000;

/** Sampling disabled — `projection.worker.cycle` is not emitted at all. This is the default. */
export const WORKER_CYCLE_SAMPLING_OFF = 0;

export interface ProjectionLoggerOptions {
  /** Where lines go. Required — there is no implicit process-stream default. */
  readonly sink: ProjectionLogSink;
  /** The injected canonical clock. `Date.now()` is never called anywhere in this module. */
  readonly now: () => CanonicalInstant;
  /** Minimum severity to emit. Defaults to {@link DEFAULT_PROJECTION_LOG_MIN_SEVERITY}. */
  readonly minSeverity?: ProjectionLogSeverity;
  /**
   * Emit every Nth `projection.worker.cycle` event. `0` (the default) disables them entirely. `1`
   * emits every cycle. Deterministic counting, never `Math.random()` — a sampled logger must still be
   * testable.
   */
  readonly workerCycleSampling?: number;
  /** Window for suppressing repeated divergences. Defaults to {@link DEFAULT_DIVERGENCE_REPEAT_SUPPRESSION_MS}. */
  readonly divergenceRepeatSuppressionMs?: number;
}

/** An ordered key/value pair destined for the serialised record. Values are already JSON-safe. */
type Field = readonly [string, string | number | boolean | null];

/** Render a bigint position as a decimal string. `JSON.stringify` throws on a bigint, so this is required. */
function position(value: bigint): string {
  return value.toString();
}

/** Render a nullable bigint position. */
function nullablePosition(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * Project an event onto its EXACT declared fields, in declaration order.
 *
 * Exhaustive over the closed union: adding an event without a case here is a compile error, because
 * the final `never` assignment fails to type-check. Nothing is spread and nothing is copied
 * reflectively, so a property that is not named below cannot reach the sink.
 */
function projectFields(event: ProjectionLogEvent): readonly Field[] {
  switch (event.event) {
    case 'projection.retry.scheduled':
      return [
        ['position', position(event.position)],
        ['attemptNumber', event.attemptNumber],
        ['safeErrorCode', event.safeErrorCode],
        ['nextAttemptAt', event.nextAttemptAt],
      ];
    case 'projection.retry.exhausted':
      return [
        ['position', position(event.position)],
        ['attemptNumber', event.attemptNumber],
        ['safeErrorCode', event.safeErrorCode],
        ['failureId', event.failureId],
      ];
    case 'projection.blocked':
      return [
        ['blockedPosition', position(event.blockedPosition)],
        ['safeErrorCode', event.safeErrorCode],
        ['failureId', event.failureId],
      ];
    case 'projection.failure.created':
      return [
        ['failureId', event.failureId],
        ['position', position(event.position)],
        ['category', event.category],
        ['safeErrorCode', event.safeErrorCode],
        ['automaticAttemptCount', event.automaticAttemptCount],
        ['generation', event.generation],
      ];
    case 'projection.failure.acknowledged':
      return [
        ['failureId', event.failureId],
        ['actorType', event.actorType],
        ['actorId', event.actorId],
        ['resultingGeneration', event.resultingGeneration],
      ];
    case 'projection.failure.quarantined':
      return [
        ['failureId', event.failureId],
        ['actorType', event.actorType],
        ['actorId', event.actorId],
        ['resultingGeneration', event.resultingGeneration],
      ];
    case 'projection.replay.authorized':
      return [
        ['failureId', event.failureId],
        ['authorizationId', event.authorizationId],
        ['actorType', event.actorType],
        ['actorId', event.actorId],
        ['expiresAt', event.expiresAt],
        ['resultingGeneration', event.resultingGeneration],
      ];
    case 'projection.replay.lease.acquired':
      return [
        ['failureId', event.failureId],
        ['authorizationId', event.authorizationId],
        ['attemptId', event.attemptId],
        ['attemptNumber', event.attemptNumber],
        ['leaseExpiresAt', event.leaseExpiresAt],
      ];
    case 'projection.replay.lease.takenOver':
      return [
        ['failureId', event.failureId],
        ['authorizationId', event.authorizationId],
        ['attemptId', event.attemptId],
        ['attemptNumber', event.attemptNumber],
        ['leaseExpiresAt', event.leaseExpiresAt],
        ['abandonedAttemptId', event.abandonedAttemptId],
      ];
    case 'projection.replay.started':
      return [
        ['failureId', event.failureId],
        ['attemptId', event.attemptId],
        ['position', position(event.position)],
      ];
    case 'projection.replay.succeeded':
      return [
        ['failureId', event.failureId],
        ['attemptId', event.attemptId],
        ['position', position(event.position)],
        ['resumedToPosition', position(event.resumedToPosition)],
      ];
    case 'projection.replay.failed':
      return [
        ['failureId', event.failureId],
        ['attemptId', event.attemptId],
        ['position', position(event.position)],
        ['safeErrorCode', event.safeErrorCode],
      ];
    case 'projection.divergence.detected':
      return [
        ['runnerErrorCode', event.runnerErrorCode],
        ['position', position(event.position)],
        ['divergenceKind', event.divergenceKind],
      ];
    case 'projection.infrastructure.failed':
      return [
        ['runnerErrorCode', event.runnerErrorCode],
        ['phase', event.phase],
      ];
    case 'projection.commit.outcomeUnknown':
      return [
        ['runnerErrorCode', event.runnerErrorCode],
        ['position', position(event.position)],
        ['phase', event.phase],
      ];
    case 'projection.worker.cycle':
      return [
        ['outcome', event.outcome],
        ['position', nullablePosition(event.position)],
      ];
    case 'projection.worker.started':
      return [];
    case 'projection.worker.stopped':
      return [
        ['cycles', event.cycles],
        ['succeeded', event.succeeded],
        ['stoppedBy', event.stoppedBy],
      ];
    default: {
      // Exhaustiveness guard: a new event variant without a case above fails to compile here.
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * Parse a canonical instant to epoch milliseconds for window arithmetic.
 *
 * Returns `null` rather than throwing on anything unparseable, so a bad clock degrades suppression to
 * "always emit" instead of breaking emission.
 */
function instantToMillis(instant: CanonicalInstant): number | null {
  const parsed = Date.parse(instant);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Create the default JSON Lines logger.
 *
 * Record key order is stable and deliberate: `event`, `severity`, `at`, then the projection identity
 * (absent for worker-scoped events), then the event's own fields in declaration order. Stable ordering
 * makes lines diffable and test assertions exact.
 */
export function createProjectionLogger(options: ProjectionLoggerOptions): ProjectionLogger {
  const minRank = projectionLogSeverityRank(
    options.minSeverity ?? DEFAULT_PROJECTION_LOG_MIN_SEVERITY,
  );
  const cycleSampling = options.workerCycleSampling ?? WORKER_CYCLE_SAMPLING_OFF;
  const suppressionMs =
    options.divergenceRepeatSuppressionMs ?? DEFAULT_DIVERGENCE_REPEAT_SUPPRESSION_MS;

  /** Last emission time per (name, version, divergenceKind). Process-local and bounded by that key. */
  const lastDivergenceAt = new Map<string, number>();
  /** Deterministic cycle counter for sampling. */
  let cycleCount = 0;

  /**
   * Decide whether a divergence repeat is suppressed. The FIRST observation for a key is always
   * emitted; a repeat inside the window is dropped. A null clock reading disables suppression.
   */
  function divergenceSuppressed(key: string, atMillis: number | null): boolean {
    if (atMillis === null) {
      return false;
    }
    const previous = lastDivergenceAt.get(key);
    if (previous !== undefined && atMillis - previous < suppressionMs) {
      return true;
    }
    lastDivergenceAt.set(key, atMillis);
    return false;
  }

  function emit(identity: ProjectionLogIdentity | null, event: ProjectionLogEvent): void {
    try {
      const severity = PROJECTION_LOG_SEVERITY_BY_EVENT[event.event];
      if (projectionLogSeverityRank(severity) < minRank) {
        return;
      }

      // The per-cycle event is additionally gated by deterministic sampling; `0` disables it entirely.
      if (event.event === 'projection.worker.cycle') {
        if (cycleSampling <= 0) {
          return;
        }
        cycleCount += 1;
        if (cycleCount % cycleSampling !== 0) {
          return;
        }
      }

      const at = options.now();

      if (event.event === 'projection.divergence.detected' && identity !== null) {
        const key = `${identity.projectionName}:${String(identity.projectionVersion)}:${event.divergenceKind}`;
        if (divergenceSuppressed(key, instantToMillis(at))) {
          return;
        }
      }

      const record: Record<string, string | number | boolean | null> = {
        event: event.event,
        severity,
        at,
      };
      if (identity !== null) {
        record['projectionName'] = identity.projectionName;
        record['projectionVersion'] = identity.projectionVersion;
      }
      for (const [key, value] of projectFields(event)) {
        record[key] = value;
      }

      options.sink.write(JSON.stringify(record));
    } catch {
      // Swallowed without inspection. A telemetry failure must never alter a durable outcome, and the
      // caught value must never be examined — it could itself be hostile.
    }
  }

  return {
    projectionEvent: (identity, event) => {
      emit(identity, event);
    },
    workerEvent: (event) => {
      emit(null, event);
    },
  };
}

/**
 * A logger that discards everything. The default wherever a logger is optional, so instrumentation can
 * be added to a call site without forcing every existing caller (and every existing test) to supply
 * one. Costs one no-op call.
 */
export const NOOP_PROJECTION_LOGGER: ProjectionLogger = Object.freeze({
  projectionEvent: () => {
    /* discard */
  },
  workerEvent: () => {
    /* discard */
  },
});
