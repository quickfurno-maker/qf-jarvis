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

  it('registers every type at version 1, and no other version', () => {
    for (const entry of CANONICAL_EVENT_ENTRIES) {
      expect(entry.eventVersion).toBe(1);
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
      expect(result.data.eventVersion).toBe(1);
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
      expect(result.error.issues[0]?.code).toBe('unknown_contract');
    }
  });

  it('rejects an unknown future version, and does NOT fall back to v1', () => {
    const future = { ...cloneFixture(firstEventFixture()), eventVersion: 2 };

    const result = safeParseCanonicalEvent(future);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('unknown_contract');
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
    expect(isRegisteredCanonicalEvent('qf.recommendation.created', 1)).toBe(true);
    expect(isRegisteredCanonicalEvent('qf.recommendation.created', 2)).toBe(false);
    expect(isRegisteredCanonicalEvent('qf.lead.created', 1)).toBe(false);
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
