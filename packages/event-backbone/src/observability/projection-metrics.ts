/**
 * The INTERNAL in-process metrics registry for projection failure operations (QFJ-P03.07G, ADR-0040).
 *
 * A small, dependency-free registry of counters, gauges and histograms. It brings in no third-party
 * metrics library, starts no exporter, opens no socket, writes no file, and persists nothing. What it
 * holds is readable through {@link ProjectionMetricsRegistry.snapshot}, which is what the read-only
 * inspection CLI and the tests consume.
 *
 * ### Cardinality is enforced by the type system, not by review
 *
 * The fastest way to destroy a metrics system is a label whose value space is unbounded — a position, a
 * UUID, an actor id, an event type. Those are all perfectly safe as LOG FIELDS (a log line is not
 * indexed by its fields) and all catastrophic as LABELS (every distinct value creates a permanent time
 * series). Relying on reviewers to remember the difference does not scale.
 *
 * So each metric declares its exact label shape in {@link ProjectionMetricLabels}, and the mutation
 * methods are generic over the metric name. Passing an unknown label key, omitting a required one, or
 * passing a value outside a closed vocabulary is a COMPILE error, and TypeScript's excess-property
 * check on object literals rejects `failure_id`/`position`/`actor_id` at the call site. Runtime
 * validation backs this up for values that cross a boundary the compiler cannot see.
 *
 * ### Nothing here may throw into a correctness path
 *
 * A rejected sample is DROPPED and counted (see {@link ProjectionMetricsRegistry.rejectedSamples}),
 * never thrown. Call sites are already guarded, but a metrics registry that can throw is one refactor
 * away from aborting a transaction, so the guarantee is made here too.
 *
 * ### Durability
 *
 * Counters and histograms are PROCESS-LOCAL: they start at zero and reset when the process restarts,
 * so alerting on them must use rate/delta windows, never absolute values. The gauges are DERIVED —
 * they are set from database reads (see `projection-health.ts`), so they are correct immediately after
 * a restart. That split is deliberate and is documented in the alerting specification.
 *
 * Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import type {
  ProjectionFailureStatus,
  ProjectionReplayAttemptState,
  ProjectionReplayAuthorizationState,
} from '../projections/projection-failure-persistence.js';
import type { ProjectionFailureCategory } from '../projections/projection-failure-taxonomy.js';
import type { ProjectionRunnerErrorCode } from '../projections/projection-runner-errors.js';

import type {
  ProjectionDivergenceKind,
  ProjectionInfrastructurePhase,
  ProjectionLogSafeCode,
  ProjectionRunOutcome,
} from './projection-log-events.js';

// --- Label keys ----------------------------------------------------------------------------------

/**
 * The ONLY label keys any projection metric may carry. Every one has a closed or small-bounded value
 * space: a validated projection name (≤ 64 chars, canonical pattern), a small version integer, or a
 * member of a closed vocabulary.
 */
export const PROJECTION_METRIC_LABEL_KEYS = [
  'projection_name',
  'projection_version',
  'outcome',
  'category',
  'safe_error_code',
  'status',
  'attempt_state',
  'authorization_state',
  'runner_error_code',
  'divergence_kind',
  'phase',
] as const;
export type ProjectionMetricLabelKey = (typeof PROJECTION_METRIC_LABEL_KEYS)[number];

/** True iff `value` is an allowed label key. */
export function isProjectionMetricLabelKey(value: unknown): value is ProjectionMetricLabelKey {
  return (
    typeof value === 'string' && (PROJECTION_METRIC_LABEL_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Keys that are explicitly FORBIDDEN as labels, listed so the prohibition is executable rather than
 * merely documented. Every one is either unbounded in cardinality (positions, UUIDs, ids) or sensitive
 * (operator text, correlation ids, error text). All of these except the sensitive ones are permitted
 * as LOG FIELDS — the distinction is the point.
 */
export const FORBIDDEN_PROJECTION_METRIC_LABEL_KEYS = [
  'position',
  'blocked_position',
  'event_storage_sequence',
  'failure_id',
  'authorization_id',
  'attempt_id',
  'event_id',
  'actor_id',
  'reason',
  'correlation_id',
  'subject',
  'event_type',
  'message',
  'stack',
  'sqlstate',
  'sql',
] as const;
export type ForbiddenProjectionMetricLabelKey =
  (typeof FORBIDDEN_PROJECTION_METRIC_LABEL_KEYS)[number];

/** True iff `value` is an explicitly forbidden label key. */
export function isForbiddenProjectionMetricLabelKey(
  value: unknown,
): value is ForbiddenProjectionMetricLabelKey {
  return (
    typeof value === 'string' &&
    (FORBIDDEN_PROJECTION_METRIC_LABEL_KEYS as readonly string[]).includes(value)
  );
}

// --- Metric names and their exact label shapes ---------------------------------------------------

/** The projection identity labels carried by nearly every metric. */
interface ProjectionLabels {
  readonly projection_name: string;
  readonly projection_version: number;
}

/**
 * The exact label shape of every metric. This map IS the contract: the generic mutation methods below
 * index into it, so a call site cannot supply a key that is not declared here.
 */
export interface ProjectionMetricLabels {
  // --- counters (process-local) ---
  readonly projection_attempts_total: ProjectionLabels & { readonly outcome: ProjectionRunOutcome };
  readonly projection_deterministic_failures_total: ProjectionLabels & {
    readonly safe_error_code: ProjectionLogSafeCode;
  };
  readonly projection_infrastructure_failures_total: ProjectionLabels & {
    readonly runner_error_code: ProjectionRunnerErrorCode;
    readonly phase: ProjectionInfrastructurePhase;
  };
  readonly projection_retry_exhaustion_total: ProjectionLabels;
  readonly projection_divergence_total: ProjectionLabels & {
    readonly divergence_kind: ProjectionDivergenceKind;
  };
  readonly projection_commit_outcome_unknown_total: ProjectionLabels;
  readonly projection_replay_attempts_total: ProjectionLabels & {
    readonly attempt_state: ProjectionReplayAttemptState;
  };
  readonly projection_replay_authorizations_total: ProjectionLabels & {
    readonly authorization_state: ProjectionReplayAuthorizationState;
  };
  readonly projection_replay_lease_conflicts_total: ProjectionLabels;
  readonly projection_worker_cycles_total: { readonly outcome: ProjectionRunOutcome };
  readonly projection_failures_created_total: ProjectionLabels & {
    readonly category: ProjectionFailureCategory;
  };

  // --- derived gauges (rebuilt from PostgreSQL) ---
  readonly projection_blocked_checkpoints: ProjectionLabels;
  readonly projection_active_failures: ProjectionLabels & {
    readonly status: ProjectionFailureStatus;
  };
  readonly projection_oldest_active_failure_age_seconds: ProjectionLabels;
  readonly projection_checkpoint_lag_positions: ProjectionLabels;

  // --- process gauge ---
  readonly projection_worker_up: Record<string, never>;

  // --- histograms (process-local) ---
  readonly projection_processing_duration_seconds: ProjectionLabels & {
    readonly outcome: ProjectionRunOutcome;
  };
  readonly projection_retry_backoff_seconds: ProjectionLabels;
}

/** Every metric name. */
export type ProjectionMetricName = keyof ProjectionMetricLabels;

/** Counter names — monotonic, process-local, reset on restart. */
export const PROJECTION_COUNTER_NAMES = [
  'projection_attempts_total',
  'projection_deterministic_failures_total',
  'projection_infrastructure_failures_total',
  'projection_retry_exhaustion_total',
  'projection_divergence_total',
  'projection_commit_outcome_unknown_total',
  'projection_replay_attempts_total',
  'projection_replay_authorizations_total',
  'projection_replay_lease_conflicts_total',
  'projection_worker_cycles_total',
  'projection_failures_created_total',
] as const;
export type ProjectionCounterName = (typeof PROJECTION_COUNTER_NAMES)[number];

/** Gauge names — set, not incremented. All but `projection_worker_up` are derived from the database. */
export const PROJECTION_GAUGE_NAMES = [
  'projection_blocked_checkpoints',
  'projection_active_failures',
  'projection_oldest_active_failure_age_seconds',
  'projection_checkpoint_lag_positions',
  'projection_worker_up',
] as const;
export type ProjectionGaugeName = (typeof PROJECTION_GAUGE_NAMES)[number];

/** Gauges rebuilt wholesale from a database read; `replaceGauge` clears their stale series first. */
export const PROJECTION_DERIVED_GAUGE_NAMES = [
  'projection_blocked_checkpoints',
  'projection_active_failures',
  'projection_oldest_active_failure_age_seconds',
  'projection_checkpoint_lag_positions',
] as const;
export type ProjectionDerivedGaugeName = (typeof PROJECTION_DERIVED_GAUGE_NAMES)[number];

/** Histogram names. */
export const PROJECTION_HISTOGRAM_NAMES = [
  'projection_processing_duration_seconds',
  'projection_retry_backoff_seconds',
] as const;
export type ProjectionHistogramName = (typeof PROJECTION_HISTOGRAM_NAMES)[number];

/** All metric names, for conformance tests and the CLI. */
export const PROJECTION_METRIC_NAMES: readonly ProjectionMetricName[] = [
  ...PROJECTION_COUNTER_NAMES,
  ...PROJECTION_GAUGE_NAMES,
  ...PROJECTION_HISTOGRAM_NAMES,
];

/** The metric kind, for snapshot consumers. */
export type ProjectionMetricKind = 'counter' | 'gauge' | 'histogram';

/**
 * Explicit, bounded histogram buckets (seconds), upper-inclusive, with an implicit `+Inf` overflow.
 * Fixed rather than configurable: a caller-supplied bucket list is another unbounded input.
 */
export const PROJECTION_HISTOGRAM_BUCKETS_SECONDS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
];

/**
 * Hard cap on distinct label combinations per metric. A defensive backstop only — the closed label
 * vocabulary already bounds cardinality — but it means that even a defect upstream cannot grow the
 * registry without limit inside a long-running worker. Samples beyond the cap are dropped and counted.
 */
export const MAX_SERIES_PER_METRIC = 512;

/** Maximum accepted length of the `projection_name` label value (matches the column bound). */
export const MAX_PROJECTION_NAME_LABEL_LENGTH = 64;

// --- Snapshot shapes -----------------------------------------------------------------------------

/** One materialised series. `labels` is a frozen plain object with only allowed keys. */
export interface ProjectionMetricSample {
  readonly name: ProjectionMetricName;
  readonly kind: ProjectionMetricKind;
  readonly labels: Readonly<Record<string, string | number>>;
  /** Counter total, gauge value, or histogram sum. */
  readonly value: number;
  /** Histogram only: observation count. */
  readonly count?: number;
  /** Histogram only: cumulative bucket counts aligned to {@link PROJECTION_HISTOGRAM_BUCKETS_SECONDS}. */
  readonly buckets?: readonly number[];
}

// --- Registry ------------------------------------------------------------------------------------

export interface ProjectionMetricsRegistry {
  /** Add to a counter (default 1). A rejected sample is dropped and counted, never thrown. */
  readonly increment: <N extends ProjectionCounterName>(
    name: N,
    labels: ProjectionMetricLabels[N],
    by?: number,
  ) => void;
  /** Set a gauge series. */
  readonly setGauge: <N extends ProjectionGaugeName>(
    name: N,
    labels: ProjectionMetricLabels[N],
    value: number,
  ) => void;
  /**
   * Replace ALL series of a derived gauge in one step. Required because a derived gauge is rebuilt
   * from a query: if a projection stops being blocked, its old series must DISAPPEAR rather than
   * linger at its last value, which `setGauge` alone cannot express.
   */
  readonly replaceGauge: <N extends ProjectionDerivedGaugeName>(
    name: N,
    series: readonly { readonly labels: ProjectionMetricLabels[N]; readonly value: number }[],
  ) => void;
  /** Record a histogram observation in seconds. */
  readonly observe: <N extends ProjectionHistogramName>(
    name: N,
    labels: ProjectionMetricLabels[N],
    seconds: number,
  ) => void;
  /** All materialised series, sorted by metric name then serialised labels. Stable for tests. */
  readonly snapshot: () => readonly ProjectionMetricSample[];
  /** How many samples were rejected (bad label key, bad value, or series cap). Never throws. */
  readonly rejectedSamples: () => number;
  /** Discard everything. Test-only convenience; never called by runtime code. */
  readonly reset: () => void;
}

/** Internal per-series state. */
interface SeriesState {
  readonly labels: Readonly<Record<string, string | number>>;
  value: number;
  count: number;
  buckets: number[];
}

/** Metric kind lookup, built once. */
const METRIC_KIND: Readonly<Record<string, ProjectionMetricKind>> = Object.freeze({
  ...Object.fromEntries(PROJECTION_COUNTER_NAMES.map((n) => [n, 'counter' as const])),
  ...Object.fromEntries(PROJECTION_GAUGE_NAMES.map((n) => [n, 'gauge' as const])),
  ...Object.fromEntries(PROJECTION_HISTOGRAM_NAMES.map((n) => [n, 'histogram' as const])),
});

/**
 * Validate a label object at runtime and return a frozen, key-sorted copy — or `null` to reject.
 *
 * Own enumerable keys are read exactly once into a local snapshot, so a getter cannot present one
 * value to the validator and another to the writer. Inherited properties are ignored.
 */
function normaliseLabels(labels: object): Readonly<Record<string, string | number>> | null {
  const entries: [string, string | number][] = [];
  for (const key of Object.keys(labels)) {
    if (!isProjectionMetricLabelKey(key)) {
      return null;
    }
    const value: unknown = (labels as Record<string, unknown>)[key];
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      entries.push([key, value]);
      continue;
    }
    if (typeof value !== 'string') {
      return null;
    }
    if (value.length === 0 || value.length > MAX_PROJECTION_NAME_LABEL_LENGTH) {
      return null;
    }
    entries.push([key, value]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.freeze(Object.fromEntries(entries));
}

/** A stable series key from already-normalised labels. */
function seriesKey(labels: Readonly<Record<string, string | number>>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(',');
}

/** Create an empty registry. */
export function createProjectionMetricsRegistry(): ProjectionMetricsRegistry {
  const metrics = new Map<string, Map<string, SeriesState>>();
  let rejected = 0;

  function seriesFor(name: string): Map<string, SeriesState> {
    let series = metrics.get(name);
    if (series === undefined) {
      series = new Map<string, SeriesState>();
      metrics.set(name, series);
    }
    return series;
  }

  /** Resolve (or create) one series. Returns `null` and counts a rejection on any violation. */
  function resolve(name: string, labels: object): SeriesState | null {
    const normalised = normaliseLabels(labels);
    if (normalised === null) {
      rejected += 1;
      return null;
    }
    const series = seriesFor(name);
    const key = seriesKey(normalised);
    const existing = series.get(key);
    if (existing !== undefined) {
      return existing;
    }
    if (series.size >= MAX_SERIES_PER_METRIC) {
      rejected += 1;
      return null;
    }
    const created: SeriesState = {
      labels: normalised,
      value: 0,
      count: 0,
      buckets: PROJECTION_HISTOGRAM_BUCKETS_SECONDS.map(() => 0),
    };
    series.set(key, created);
    return created;
  }

  return {
    increment: (name, labels, by = 1) => {
      try {
        if (!Number.isFinite(by) || by < 0) {
          rejected += 1;
          return;
        }
        const state = resolve(name, labels);
        if (state === null) {
          return;
        }
        state.value += by;
      } catch {
        rejected += 1;
      }
    },

    setGauge: (name, labels, value) => {
      try {
        if (!Number.isFinite(value)) {
          rejected += 1;
          return;
        }
        const state = resolve(name, labels);
        if (state === null) {
          return;
        }
        state.value = value;
      } catch {
        rejected += 1;
      }
    },

    replaceGauge: (name, seriesList) => {
      try {
        // Clear first so a series that no longer appears in the query result disappears rather than
        // remaining frozen at its last observed value.
        metrics.set(name, new Map<string, SeriesState>());
        for (const entry of seriesList) {
          if (!Number.isFinite(entry.value)) {
            rejected += 1;
            continue;
          }
          const state = resolve(name, entry.labels);
          if (state === null) {
            continue;
          }
          state.value = entry.value;
        }
      } catch {
        rejected += 1;
      }
    },

    observe: (name, labels, seconds) => {
      try {
        if (!Number.isFinite(seconds) || seconds < 0) {
          rejected += 1;
          return;
        }
        const state = resolve(name, labels);
        if (state === null) {
          return;
        }
        state.value += seconds;
        state.count += 1;
        for (let index = 0; index < PROJECTION_HISTOGRAM_BUCKETS_SECONDS.length; index += 1) {
          const bound = PROJECTION_HISTOGRAM_BUCKETS_SECONDS[index];
          if (bound !== undefined && seconds <= bound) {
            const current = state.buckets[index];
            state.buckets[index] = (current ?? 0) + 1;
          }
        }
      } catch {
        rejected += 1;
      }
    },

    snapshot: () => {
      const samples: ProjectionMetricSample[] = [];
      const names = [...metrics.keys()].sort();
      for (const name of names) {
        const kind = METRIC_KIND[name] ?? 'counter';
        const series = metrics.get(name);
        if (series === undefined) {
          continue;
        }
        const keys = [...series.keys()].sort();
        for (const key of keys) {
          const state = series.get(key);
          if (state === undefined) {
            continue;
          }
          samples.push(
            Object.freeze(
              kind === 'histogram'
                ? {
                    name: name as ProjectionMetricName,
                    kind,
                    labels: state.labels,
                    value: state.value,
                    count: state.count,
                    buckets: Object.freeze([...state.buckets]),
                  }
                : {
                    name: name as ProjectionMetricName,
                    kind,
                    labels: state.labels,
                    value: state.value,
                  },
            ),
          );
        }
      }
      return Object.freeze(samples);
    },

    rejectedSamples: () => rejected,

    reset: () => {
      metrics.clear();
      rejected = 0;
    },
  };
}

/**
 * A registry that discards everything. The default wherever metrics are optional, so instrumentation
 * can be added without forcing every existing caller and test to construct a registry.
 */
export const NOOP_PROJECTION_METRICS: ProjectionMetricsRegistry = Object.freeze({
  increment: () => {
    /* discard */
  },
  setGauge: () => {
    /* discard */
  },
  replaceGauge: () => {
    /* discard */
  },
  observe: () => {
    /* discard */
  },
  snapshot: () => Object.freeze([]),
  rejectedSamples: () => 0,
  reset: () => {
    /* discard */
  },
});
