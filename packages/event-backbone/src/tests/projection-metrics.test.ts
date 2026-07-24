/**
 * QFJ-P03.07G — the in-process metrics registry.
 *
 * The central property under test is CARDINALITY CLOSURE. A position, a failure id, or an actor id is
 * a perfectly safe log field and a catastrophic metric label: every distinct value would create a
 * permanent time series. The type system rejects those keys at compile time; these tests prove the
 * runtime rejects them too, for values that cross a boundary the compiler cannot see.
 */
import { describe, expect, it } from 'vitest';

import {
  createProjectionMetricsRegistry,
  isForbiddenProjectionMetricLabelKey,
  isProjectionMetricLabelKey,
  MAX_SERIES_PER_METRIC,
  NOOP_PROJECTION_METRICS,
  PROJECTION_COUNTER_NAMES,
  PROJECTION_DERIVED_GAUGE_NAMES,
  PROJECTION_GAUGE_NAMES,
  PROJECTION_HISTOGRAM_BUCKETS_SECONDS,
  PROJECTION_HISTOGRAM_NAMES,
  PROJECTION_METRIC_LABEL_KEYS,
  type ProjectionMetricsRegistry,
} from '../observability/projection-metrics.js';

const LABELS = { projection_name: 'event-type-activity', projection_version: 1 } as const;

function sample(registry: ProjectionMetricsRegistry, name: string) {
  return registry.snapshot().find((entry) => entry.name === name);
}

describe('name and label closure', () => {
  it('declares the eleven allowed label keys and rejects anything else', () => {
    expect(PROJECTION_METRIC_LABEL_KEYS).toHaveLength(11);
    for (const key of PROJECTION_METRIC_LABEL_KEYS) {
      expect(isProjectionMetricLabelKey(key)).toBe(true);
    }
    expect(isProjectionMetricLabelKey('failure_id')).toBe(false);
    expect(isProjectionMetricLabelKey('position')).toBe(false);
  });

  it('names the forbidden label keys explicitly, so the prohibition is executable', () => {
    for (const key of [
      'position',
      'failure_id',
      'authorization_id',
      'attempt_id',
      'event_id',
      'actor_id',
      'correlation_id',
      'event_type',
      'message',
      'stack',
      'sqlstate',
      'sql',
    ]) {
      expect(isForbiddenProjectionMetricLabelKey(key)).toBe(true);
      // The two lists must never overlap: a key cannot be both allowed and forbidden.
      expect(isProjectionMetricLabelKey(key)).toBe(false);
    }
  });

  it('covers every required metric across the three kinds', () => {
    expect(PROJECTION_COUNTER_NAMES).toContain('projection_attempts_total');
    expect(PROJECTION_COUNTER_NAMES).toContain('projection_divergence_total');
    expect(PROJECTION_COUNTER_NAMES).toContain('projection_commit_outcome_unknown_total');
    expect(PROJECTION_COUNTER_NAMES).toContain('projection_replay_lease_conflicts_total');
    expect(PROJECTION_GAUGE_NAMES).toContain('projection_blocked_checkpoints');
    expect(PROJECTION_GAUGE_NAMES).toContain('projection_oldest_active_failure_age_seconds');
    expect(PROJECTION_GAUGE_NAMES).toContain('projection_checkpoint_lag_positions');
    expect(PROJECTION_HISTOGRAM_NAMES).toContain('projection_processing_duration_seconds');
  });

  it('rejects a sample carrying a forbidden label key, counting it instead of throwing', () => {
    const registry = createProjectionMetricsRegistry();
    const hostile = { ...LABELS, failure_id: 'abc' } as unknown as {
      projection_name: string;
      projection_version: number;
    };
    expect(() => {
      registry.increment('projection_retry_exhaustion_total', hostile);
    }).not.toThrow();
    expect(registry.snapshot()).toHaveLength(0);
    expect(registry.rejectedSamples()).toBe(1);
  });

  it('rejects an over-long or empty label value', () => {
    const registry = createProjectionMetricsRegistry();
    registry.increment('projection_retry_exhaustion_total', {
      projection_name: 'x'.repeat(65),
      projection_version: 1,
    });
    registry.increment('projection_retry_exhaustion_total', {
      projection_name: '',
      projection_version: 1,
    });
    expect(registry.snapshot()).toHaveLength(0);
    expect(registry.rejectedSamples()).toBe(2);
  });

  it('caps distinct series per metric as a defensive backstop', () => {
    const registry = createProjectionMetricsRegistry();
    for (let index = 0; index < MAX_SERIES_PER_METRIC + 10; index += 1) {
      registry.increment('projection_retry_exhaustion_total', {
        projection_name: `p-${String(index)}`,
        projection_version: 1,
      });
    }
    expect(registry.snapshot()).toHaveLength(MAX_SERIES_PER_METRIC);
    expect(registry.rejectedSamples()).toBe(10);
  });

  it('never exposes a forbidden key in any emitted sample label set', () => {
    const registry = createProjectionMetricsRegistry();
    registry.increment('projection_attempts_total', { ...LABELS, outcome: 'succeeded' });
    registry.setGauge('projection_worker_up', {}, 1);
    for (const entry of registry.snapshot()) {
      for (const key of Object.keys(entry.labels)) {
        expect(isProjectionMetricLabelKey(key)).toBe(true);
        expect(isForbiddenProjectionMetricLabelKey(key)).toBe(false);
      }
    }
  });
});

describe('counter, gauge, and histogram behaviour', () => {
  it('accumulates a counter per distinct label set', () => {
    const registry = createProjectionMetricsRegistry();
    registry.increment('projection_attempts_total', { ...LABELS, outcome: 'succeeded' });
    registry.increment('projection_attempts_total', { ...LABELS, outcome: 'succeeded' }, 2);
    registry.increment('projection_attempts_total', { ...LABELS, outcome: 'busy' });
    const samples = registry.snapshot().filter((s) => s.name === 'projection_attempts_total');
    expect(samples).toHaveLength(2);
    expect(samples.find((s) => s.labels['outcome'] === 'succeeded')?.value).toBe(3);
    expect(samples.find((s) => s.labels['outcome'] === 'busy')?.value).toBe(1);
  });

  it('rejects a negative or non-finite counter increment', () => {
    const registry = createProjectionMetricsRegistry();
    registry.increment('projection_retry_exhaustion_total', LABELS, -1);
    registry.increment('projection_retry_exhaustion_total', LABELS, Number.NaN);
    expect(registry.snapshot()).toHaveLength(0);
    expect(registry.rejectedSamples()).toBe(2);
  });

  it('sets rather than accumulates a gauge', () => {
    const registry = createProjectionMetricsRegistry();
    registry.setGauge('projection_checkpoint_lag_positions', LABELS, 10);
    registry.setGauge('projection_checkpoint_lag_positions', LABELS, 4);
    expect(sample(registry, 'projection_checkpoint_lag_positions')?.value).toBe(4);
  });

  it('replaceGauge REMOVES series absent from the new reading', () => {
    const registry = createProjectionMetricsRegistry();
    registry.replaceGauge('projection_blocked_checkpoints', [
      { labels: LABELS, value: 1 },
      { labels: { projection_name: 'daily-event-acceptance', projection_version: 1 }, value: 1 },
    ]);
    expect(registry.snapshot()).toHaveLength(2);

    // The second projection is no longer blocked. A stale `1` here would keep the blocked-projection
    // alert firing after the incident closed — which is exactly why replace exists.
    registry.replaceGauge('projection_blocked_checkpoints', [{ labels: LABELS, value: 1 }]);
    const remaining = registry.snapshot();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.labels['projection_name']).toBe('event-type-activity');
  });

  it('records histogram sum, count, and cumulative buckets', () => {
    const registry = createProjectionMetricsRegistry();
    registry.observe(
      'projection_processing_duration_seconds',
      { ...LABELS, outcome: 'succeeded' },
      0.02,
    );
    registry.observe(
      'projection_processing_duration_seconds',
      { ...LABELS, outcome: 'succeeded' },
      0.4,
    );
    const entry = sample(registry, 'projection_processing_duration_seconds');
    expect(entry?.kind).toBe('histogram');
    expect(entry?.count).toBe(2);
    expect(entry?.value).toBeCloseTo(0.42, 10);
    expect(entry?.buckets).toHaveLength(PROJECTION_HISTOGRAM_BUCKETS_SECONDS.length);
    // 0.02 falls in every bucket from 0.025 up; 0.4 from 0.5 up.
    const buckets = entry?.buckets ?? [];
    expect(buckets[0]).toBe(0); // 0.005
    expect(buckets[PROJECTION_HISTOGRAM_BUCKETS_SECONDS.length - 1]).toBe(2); // 60
  });

  it('produces a stable, sorted snapshot', () => {
    const registry = createProjectionMetricsRegistry();
    registry.increment('projection_retry_exhaustion_total', LABELS);
    registry.increment('projection_attempts_total', { ...LABELS, outcome: 'busy' });
    const names = registry.snapshot().map((entry) => entry.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('durability semantics', () => {
  it('classifies every state gauge as DERIVED, so a restart rebuilds it from the database', () => {
    // Counters reset on restart (rate signals); derived gauges are read back (state signals). Alerting
    // depends on the distinction: an absolute-value alert on a counter would break at every deploy.
    for (const name of PROJECTION_DERIVED_GAUGE_NAMES) {
      expect(PROJECTION_GAUGE_NAMES).toContain(name);
      expect(PROJECTION_COUNTER_NAMES).not.toContain(name);
    }
    expect(PROJECTION_DERIVED_GAUGE_NAMES).not.toContain('projection_worker_up');
  });

  it('starts empty — a fresh registry models a restarted process', () => {
    const registry = createProjectionMetricsRegistry();
    registry.increment('projection_retry_exhaustion_total', LABELS);
    expect(sample(registry, 'projection_retry_exhaustion_total')?.value).toBe(1);
    registry.reset();
    expect(registry.snapshot()).toHaveLength(0);
    expect(createProjectionMetricsRegistry().snapshot()).toHaveLength(0);
  });

  it('discards everything through the no-op registry without throwing', () => {
    expect(() => {
      NOOP_PROJECTION_METRICS.increment('projection_retry_exhaustion_total', LABELS);
      NOOP_PROJECTION_METRICS.setGauge('projection_worker_up', {}, 1);
      NOOP_PROJECTION_METRICS.replaceGauge('projection_blocked_checkpoints', []);
      NOOP_PROJECTION_METRICS.observe('projection_retry_backoff_seconds', LABELS, 1);
    }).not.toThrow();
    expect(NOOP_PROJECTION_METRICS.snapshot()).toHaveLength(0);
    expect(NOOP_PROJECTION_METRICS.rejectedSamples()).toBe(0);
  });
});
