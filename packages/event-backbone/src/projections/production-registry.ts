/**
 * The production projection-registry composition (Stage 3.4.5B, ADR-0038 §deferrals).
 *
 * This is the internal composition point ADR-0038 deferred: the single place that wires the two real
 * read-model projection definitions into an immutable {@link ProjectionRegistry}. It adds no mechanism
 * of its own — it reuses the merged Stage 3.4.2 `createProjectionRegistry`, which snapshots, validates,
 * copies, freezes, deterministically name-orders, and rejects duplicate names (even across versions).
 *
 * Exactly TWO production definitions, and nothing else:
 *   - `event-type-activity` v1  → `qf_jarvis.rm_event_type_activity`
 *   - `daily-event-acceptance` v1 → `qf_jarvis.rm_daily_event_acceptance`
 *
 * `rm_subject_activity` is a Stage 3.6 model and is deliberately NOT registered here. There is no
 * rebuild-only definition. Because `createProjectionRegistry` orders by name, enumeration is always
 * `daily-event-acceptance` then `event-type-activity`, on every process and every run.
 *
 * Not exported from the package root — the barrel's 39-symbol runtime surface is unchanged. The
 * production worker composition (`projection-worker-cli.ts`) constructs this registry internally;
 * synthetic tests continue to build their own registries directly from `createProjectionRegistry`.
 */
import { dailyEventAcceptanceProjection } from './handlers/daily-event-acceptance.js';
import { eventTypeActivityProjection } from './handlers/event-type-activity.js';
import { createProjectionRegistry, type ProjectionRegistry } from './projection-registry.js';

/**
 * Build the immutable production registry containing exactly the two real read-model projections.
 *
 * A fresh, independently-frozen registry each call — the caller (the worker composition root) builds
 * it once at startup. Duplicate-name protection and deterministic ordering are owned by
 * `createProjectionRegistry`; this function only supplies the fixed two-element definition list.
 */
export function createProductionProjectionRegistry(): ProjectionRegistry {
  return createProjectionRegistry([eventTypeActivityProjection, dailyEventAcceptanceProjection]);
}
