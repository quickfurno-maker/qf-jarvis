/**
 * The registry: dispatch by type + version, and fail closed on anything else.
 */

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_EVENT_ENTRIES,
  CANONICAL_EVENT_REGISTRY,
  CANONICAL_EVENT_TYPES,
  canonicalEventKey,
  isRegisteredCanonicalEvent,
  parseCanonicalEvent,
  safeParseCanonicalEvent,
} from '../index.js';
import { cloneFixture, VALID_EVENT_FIXTURES } from '../fixtures/index.js';

describe('registry composition', () => {
  it('registers exactly the catalogued event types', () => {
    const registered = CANONICAL_EVENT_ENTRIES.map((entry) => entry.eventType).sort();
    expect(registered).toStrictEqual([...CANONICAL_EVENT_TYPES].sort());
  });

  it('registers each type at exactly one version, and version 1 is no longer among them', () => {
    // Stage 3.1.4 moved the inherited events to version 2 and deregistered version 1, which had
    // carried an arbitrary free-text `detail` and an open `signals` dictionary. The taxonomy
    // events are new in that stage, so they begin — correctly — at version 1.
    const byType = new Map<string, number[]>();

    for (const entry of CANONICAL_EVENT_ENTRIES) {
      byType.set(entry.eventType, [...(byType.get(entry.eventType) ?? []), entry.eventVersion]);
    }

    for (const [eventType, versions] of byType) {
      expect(versions, `${eventType} is registered at more than one version`).toHaveLength(1);

      const [version] = versions;
      const expected = eventType.startsWith('qf.taxonomy.') ? 1 : 2;

      expect(version, `${eventType} should be registered at v${String(expected)}`).toBe(expected);
    }
  });

  it('does not register the superseded version 1 of any inherited event', () => {
    // The whole point of the stage. If v1 were still registered, the door it opened would still
    // be open, and closing a door while leaving it open is not a fix.
    for (const eventType of CANONICAL_EVENT_TYPES) {
      if (eventType.startsWith('qf.taxonomy.')) continue;
      expect(isRegisteredCanonicalEvent(eventType, 1)).toBe(false);
    }
  });

  it('has a valid fixture for every registered contract, so none is registered untested', () => {
    const fixtureKeys = new Set(
      VALID_EVENT_FIXTURES.map((event) => canonicalEventKey(event.eventType, event.eventVersion)),
    );

    for (const key of CANONICAL_EVENT_REGISTRY.keys()) {
      expect(fixtureKeys.has(key)).toBe(true);
    }
    expect(fixtureKeys.size).toBe(CANONICAL_EVENT_REGISTRY.size);
  });
});

/** The fixtures are a non-empty readonly array; index access is checked, not asserted. */
function firstEventFixture(): (typeof VALID_EVENT_FIXTURES)[number] {
  const first = VALID_EVENT_FIXTURES[0];
  if (first === undefined) {
    throw new Error('Expected at least one canonical event fixture');
  }
  return first;
}

describe('dispatch', () => {
  it.each(VALID_EVENT_FIXTURES)('routes $eventType to its own contract', (event) => {
    const result = safeParseCanonicalEvent(cloneFixture(event));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventType).toBe(event.eventType);
      expect(result.data.eventVersion).toBe(event.eventVersion);
    }
  });

  it('narrows the discriminated union on eventType', () => {
    const event = parseCanonicalEvent(cloneFixture(firstEventFixture()));

    // Exhaustive narrowing: a new event type nobody handled becomes a compile
    // error rather than a silently ignored message.
    switch (event.eventType) {
      case 'qf.recommendation.created':
        expect(event.payload.recommendation.producingSystem).toBe('qf-jarvis');
        break;
      default:
        throw new Error(`Unexpected fixture ordering: ${event.eventType}`);
    }
  });
});

describe('failing closed', () => {
  it('rejects an unknown event type', () => {
    const result = safeParseCanonicalEvent({
      ...cloneFixture(firstEventFixture()),
      eventType: 'qf.lead.created',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('unsupported_unknown_version');
    }
  });

  it('rejects an unknown future version, and does NOT fall back to an earlier one', () => {
    // Version 3: 2 is now the registered version, so the 'unknown future' case moved up.
    const future = { ...cloneFixture(firstEventFixture()), eventVersion: 3 };

    const result = safeParseCanonicalEvent(future);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('unsupported_unknown_version');
      // The message must make the no-fallback rule explicit: this is the failure
      // mode where a v2 payload gets parsed as a v1 and the changed fields are
      // silently dropped.
      expect(result.error.message).toContain('never falls back');
    }
  });

  it('rejects an envelope with no type or version at all', () => {
    expect(safeParseCanonicalEvent({}).success).toBe(false);
    expect(safeParseCanonicalEvent(null).success).toBe(false);
    expect(safeParseCanonicalEvent('nope').success).toBe(false);
  });

  it('reports registration for known pairs only', () => {
    expect(isRegisteredCanonicalEvent('qf.recommendation.created', 2)).toBe(true);
    // v1 is deregistered: the version that permitted free text is no longer ingestible.
    expect(isRegisteredCanonicalEvent('qf.recommendation.created', 1)).toBe(false);
    expect(isRegisteredCanonicalEvent('qf.recommendation.created', 3)).toBe(false);
    expect(isRegisteredCanonicalEvent('qf.lead.created', 2)).toBe(false);
  });

  it('throws a structured error from the throwing parser', () => {
    expect(() => parseCanonicalEvent({ eventType: 'nope', eventVersion: 1 })).toThrow(
      /No registered canonical event contract/,
    );
  });
});

describe('the registry is static', () => {
  it('exposes no mutator at all, so no caller can teach it a new shape at runtime', () => {
    // Not "the type hides `set`" — `set` genuinely does not exist. A registry that
    // accepts schemas at runtime is a registry an attacker can teach to accept a
    // payload nobody reviewed. Adding an event type must be a diff, and therefore
    // a reviewer.
    const exposed = Object.keys(CANONICAL_EVENT_REGISTRY).sort();

    expect(exposed).toStrictEqual(['get', 'has', 'keys', 'size']);
    expect(Object.isFrozen(CANONICAL_EVENT_REGISTRY)).toBe(true);
  });
});
