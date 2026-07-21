/**
 * Stage 3.4.5B — the production projection-registry composition (no database).
 *
 * Proves the composition holds EXACTLY the two real definitions, in the registry's deterministic
 * name order, with the exact names/versions, that the enumerated list is frozen, that duplicate
 * protection (owned by the merged registry) is intact, and that `rm_subject_activity` (Stage 3.6) is
 * absent. Synthetic registries remain independently constructible.
 */
import { describe, expect, it } from 'vitest';

import { dailyEventAcceptanceProjection } from '../projections/handlers/daily-event-acceptance.js';
import { eventTypeActivityProjection } from '../projections/handlers/event-type-activity.js';
import { createProductionProjectionRegistry } from '../projections/production-registry.js';
import {
  createProjectionRegistry,
  ProjectionRegistryError,
} from '../projections/projection-registry.js';

describe('production registry — exactly the two real definitions', () => {
  it('contains exactly two projections', () => {
    const registry = createProductionProjectionRegistry();
    expect(registry.size).toBe(2);
    expect(registry.list()).toHaveLength(2);
  });

  it('enumerates them in deterministic name order (daily-event-acceptance, then event-type-activity)', () => {
    const registry = createProductionProjectionRegistry();
    expect(registry.list().map((d) => d.name)).toEqual([
      'daily-event-acceptance',
      'event-type-activity',
    ]);
  });

  it('registers the exact names and versions', () => {
    const registry = createProductionProjectionRegistry();
    expect(registry.list().map((d) => [d.name, d.version])).toEqual([
      ['daily-event-acceptance', 1],
      ['event-type-activity', 1],
    ]);
  });

  it('resolves each real definition by name to the exact handler (same apply, name, version)', () => {
    // createProjectionRegistry defensively copies + re-freezes each definition, so the stored object
    // is a fresh frozen copy; the apply handler is carried through by reference.
    const registry = createProductionProjectionRegistry();
    const eventType = registry.get('event-type-activity');
    const daily = registry.get('daily-event-acceptance');
    expect(eventType?.apply).toBe(eventTypeActivityProjection.apply);
    expect(eventType?.version).toBe(eventTypeActivityProjection.version);
    expect(daily?.apply).toBe(dailyEventAcceptanceProjection.apply);
    expect(daily?.version).toBe(dailyEventAcceptanceProjection.version);
    expect(registry.has('event-type-activity')).toBe(true);
    expect(registry.has('daily-event-acceptance')).toBe(true);
  });

  it('carries an apply handler for each definition', () => {
    for (const definition of createProductionProjectionRegistry().list()) {
      expect(typeof definition.apply).toBe('function');
    }
  });
});

describe('production registry — immutability and freshness', () => {
  it('returns a frozen enumeration list', () => {
    const registry = createProductionProjectionRegistry();
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it('returns a fresh, independently-frozen registry per call (stable contents)', () => {
    const a = createProductionProjectionRegistry();
    const b = createProductionProjectionRegistry();
    expect(a).not.toBe(b);
    expect(a.list().map((d) => d.name)).toEqual(b.list().map((d) => d.name));
  });
});

describe('production registry — duplicate protection intact and Stage 3.6 excluded', () => {
  it('does NOT register rm_subject_activity / any subject-activity projection (Stage 3.6)', () => {
    const registry = createProductionProjectionRegistry();
    for (const name of ['subject-activity', 'rm_subject_activity', 'rm-subject-activity']) {
      expect(registry.has(name)).toBe(false);
    }
    expect(registry.list().some((d) => d.name.includes('subject'))).toBe(false);
  });

  it('has no duplicate projection name', () => {
    const names = createProductionProjectionRegistry()
      .list()
      .map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('duplicate rejection remains owned by the merged registry mechanism', () => {
    // Re-registering the same real definition twice is refused by createProjectionRegistry — the
    // production composition relies on that mechanism rather than re-implementing it.
    expect(() =>
      createProjectionRegistry([eventTypeActivityProjection, eventTypeActivityProjection]),
    ).toThrow(ProjectionRegistryError);
  });
});
