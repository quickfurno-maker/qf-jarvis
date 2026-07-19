/**
 * Stage 3.4.2 — the INTERNAL projection registry (ADR-0035).
 *
 * These tests use DUMMY handlers only. Neither real read-model handler exists yet; both are Stage
 * 3.4.5. Nothing here touches a database, a lock, a checkpoint, or a runner.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CANONICAL_INSTANT_PATTERN,
  defineProjection,
  isCanonicalInstant,
  isProjectionVersion,
  MAX_PROJECTION_VERSION,
  PROJECTION_DEFINITION_ERROR_CODES,
  ProjectionDefinitionError,
  toCanonicalInstant,
  type ProjectionDefinition,
} from '../projections/projection-definition.js';
import {
  createProjectionRegistry,
  MAX_PROJECTION_REGISTRY_SIZE,
  PROJECTION_REGISTRY_ERROR_CODES,
  ProjectionRegistryError,
} from '../projections/projection-registry.js';
import * as publicApi from '../index.js';

/**
 * A dummy handler. It is never invoked by the registry — registration must not call user code.
 * It resolves without doing anything; the `await` exists only so the body is not empty.
 */
const noopHandler = async (): Promise<void> => {
  await Promise.resolve();
};

/** A second, distinct dummy handler, for proving definitions are compared by identity. */
const otherHandler = async (): Promise<void> => {
  await Promise.resolve();
};

interface MutableDefinition {
  name: unknown;
  version: unknown;
  apply: unknown;
}

const validDefinition = (name: string, version = 1): MutableDefinition => ({
  name,
  version,
  apply: noopHandler,
});

// ---------------------------------------------------------------------------
// Registration and resolution
// ---------------------------------------------------------------------------

describe('valid definitions register and resolve', () => {
  it('registers one projection and resolves it by name', () => {
    const registry = createProjectionRegistry([validDefinition('event-type-activity', 3)]);

    const found = registry.get('event-type-activity');
    expect(found).toBeDefined();
    expect(found?.name).toBe('event-type-activity');
    expect(found?.version).toBe(3);
    expect(found?.apply).toBe(noopHandler);
    expect(registry.size).toBe(1);
    expect(registry.has('event-type-activity')).toBe(true);
  });

  it('registers several projections and resolves each independently', () => {
    const registry = createProjectionRegistry([
      validDefinition('daily-event-acceptance'),
      validDefinition('event-type-activity', 2),
    ]);

    expect(registry.size).toBe(2);
    expect(registry.get('daily-event-acceptance')?.version).toBe(1);
    expect(registry.get('event-type-activity')?.version).toBe(2);
  });

  it('does not invoke any handler during registration', () => {
    const handler = vi.fn(async () => {
      await Promise.resolve();
    });
    createProjectionRegistry([{ name: 'a-projection', version: 1, apply: handler }]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts the maximum storable version', () => {
    const registry = createProjectionRegistry([
      validDefinition('a-projection', MAX_PROJECTION_VERSION),
    ]);
    expect(registry.get('a-projection')?.version).toBe(MAX_PROJECTION_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Deterministic enumeration
// ---------------------------------------------------------------------------

describe('enumeration is deterministic and sorted by projection name', () => {
  it('sorts by name regardless of input order', () => {
    const forward = createProjectionRegistry([
      validDefinition('zulu-projection'),
      validDefinition('alpha-projection'),
      validDefinition('mike-projection'),
    ]);
    const reverse = createProjectionRegistry([
      validDefinition('mike-projection'),
      validDefinition('alpha-projection'),
      validDefinition('zulu-projection'),
    ]);

    const names = (r: { list(): readonly ProjectionDefinition[] }): string[] =>
      r.list().map((d) => d.name);

    expect(names(forward)).toEqual(['alpha-projection', 'mike-projection', 'zulu-projection']);
    expect(names(reverse)).toEqual(names(forward));
  });

  it('returns the same order on repeated calls', () => {
    const registry = createProjectionRegistry([
      validDefinition('b-projection'),
      validDefinition('a-projection'),
    ]);
    expect(registry.list().map((d) => d.name)).toEqual(registry.list().map((d) => d.name));
  });

  it('orders by code unit, not by locale', () => {
    // Bounded lowercase kebab-case ASCII: 'a-b' < 'ab' because '-' (0x2D) < 'b' (0x62).
    const registry = createProjectionRegistry([validDefinition('ab'), validDefinition('a-b')]);
    expect(registry.list().map((d) => d.name)).toEqual(['a-b', 'ab']);
  });
});

// ---------------------------------------------------------------------------
// Duplicate names
// ---------------------------------------------------------------------------

describe('duplicate projection names are rejected', () => {
  it('rejects the same name at the same version', () => {
    expect(() =>
      createProjectionRegistry([validDefinition('a-projection'), validDefinition('a-projection')]),
    ).toThrow(ProjectionRegistryError);
  });

  it('rejects the same name at DIFFERENT versions — one name means one active definition', () => {
    let caught: unknown;
    try {
      createProjectionRegistry([
        validDefinition('a-projection', 1),
        validDefinition('a-projection', 2),
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-duplicate-name');
  });

  it('rejects a duplicate even when the handlers differ', () => {
    expect(() =>
      createProjectionRegistry([
        { name: 'a-projection', version: 1, apply: noopHandler },
        { name: 'a-projection', version: 1, apply: otherHandler },
      ]),
    ).toThrow(ProjectionRegistryError);
  });
});

// ---------------------------------------------------------------------------
// Invalid names
// ---------------------------------------------------------------------------

describe('invalid projection names fail closed', () => {
  it.each([
    ['empty', ''],
    ['uppercase', 'EventTypeActivity'],
    ['leading digit', '1-projection'],
    ['trailing hyphen', 'a-projection-'],
    ['doubled hyphen', 'a--projection'],
    ['whitespace', 'a projection'],
    ['path-like', 'a/projection'],
    ['underscore', 'a_projection'],
    ['over-length', 'a'.repeat(65)],
  ])('rejects a %s name', (_label, name) => {
    expect(() => createProjectionRegistry([validDefinition(name)])).toThrow(
      ProjectionDefinitionError,
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 7],
    ['object', {}],
    ['array', []],
  ])('rejects a %s name', (_label, name) => {
    expect(() => createProjectionRegistry([{ name, version: 1, apply: noopHandler }])).toThrow(
      ProjectionDefinitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Invalid versions
// ---------------------------------------------------------------------------

describe('invalid projection versions fail closed', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 2],
    ['above the storable range', MAX_PROJECTION_VERSION + 1],
    ['negative zero', -0],
  ])('rejects a %s version', (_label, version) => {
    expect(() =>
      createProjectionRegistry([{ name: 'a-projection', version, apply: noopHandler }]),
    ).toThrow(ProjectionDefinitionError);
  });

  it.each([
    ['string', '1'],
    ['bigint', 1n],
    ['null', null],
    ['undefined', undefined],
    ['boolean', true],
  ])('rejects a %s version', (_label, version) => {
    expect(() =>
      createProjectionRegistry([{ name: 'a-projection', version, apply: noopHandler }]),
    ).toThrow(ProjectionDefinitionError);
  });

  it('classifies versions consistently through isProjectionVersion', () => {
    expect(isProjectionVersion(1)).toBe(true);
    expect(isProjectionVersion(MAX_PROJECTION_VERSION)).toBe(true);
    expect(isProjectionVersion(0)).toBe(false);
    expect(isProjectionVersion(1.5)).toBe(false);
    expect(isProjectionVersion(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Missing / malformed handlers and definitions
// ---------------------------------------------------------------------------

describe('missing or non-function handlers fail closed', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['string', 'apply'],
    ['number', 1],
    ['object', {}],
    ['array', []],
    ['true', true],
  ])('rejects a %s handler', (_label, apply) => {
    expect(() => createProjectionRegistry([{ name: 'a-projection', version: 1, apply }])).toThrow(
      ProjectionDefinitionError,
    );
  });

  it('rejects a definition with the apply key entirely absent', () => {
    expect(() => createProjectionRegistry([{ name: 'a-projection', version: 1 }])).toThrow(
      ProjectionDefinitionError,
    );
  });
});

describe('malformed definitions fail closed', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'a-projection'],
    ['number', 1],
    ['array', []],
    ['true', true],
  ])('rejects a %s definition', (_label, definition) => {
    expect(() => createProjectionRegistry([definition])).toThrow(ProjectionDefinitionError);
  });
});

// ---------------------------------------------------------------------------
// Empty / non-array registry
// ---------------------------------------------------------------------------

describe('an empty registry is rejected', () => {
  it('rejects an empty array with the empty code', () => {
    let caught: unknown;
    try {
      createProjectionRegistry([]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-empty');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['string', 'a-projection'],
    ['Map', new Map()],
  ])('rejects a %s instead of an array', (_label, input) => {
    let caught: unknown;
    try {
      createProjectionRegistry(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-invalid');
  });
});

// ---------------------------------------------------------------------------
// Immutability — the caller cannot reach in after construction
// ---------------------------------------------------------------------------

describe('the registry does not trust or retain the caller objects', () => {
  it('is unaffected by mutating the caller ARRAY after construction', () => {
    const input: MutableDefinition[] = [validDefinition('a-projection')];
    const registry = createProjectionRegistry(input);

    input.push(validDefinition('b-projection'));
    input.length = 0;

    expect(registry.size).toBe(1);
    expect(registry.get('a-projection')).toBeDefined();
    expect(registry.get('b-projection')).toBeUndefined();
    expect(registry.list()).toHaveLength(1);
  });

  it('is unaffected by mutating a caller DEFINITION object after construction', () => {
    const definition: MutableDefinition = validDefinition('a-projection', 1);
    const registry = createProjectionRegistry([definition]);

    definition.name = 'b-projection';
    definition.version = 99;
    definition.apply = otherHandler;

    const found = registry.get('a-projection');
    expect(found?.name).toBe('a-projection');
    expect(found?.version).toBe(1);
    expect(found?.apply).toBe(noopHandler);
    expect(registry.get('b-projection')).toBeUndefined();
  });

  it('drops extra properties rather than carrying them along', () => {
    const registry = createProjectionRegistry([
      { name: 'a-projection', version: 1, apply: noopHandler, injected: 'unexpected' },
    ]);
    expect(registry.get('a-projection')).not.toHaveProperty('injected');
  });

  it('freezes each returned definition', () => {
    const registry = createProjectionRegistry([validDefinition('a-projection')]);
    const found = registry.get('a-projection');

    expect(found).toBeDefined();
    expect(Object.isFrozen(found)).toBe(true);
    expect(() => {
      (found as unknown as MutableDefinition).version = 99;
    }).toThrow(TypeError);
    expect(found?.version).toBe(1);
  });

  it('freezes the enumerated list', () => {
    const registry = createProjectionRegistry([validDefinition('a-projection')]);
    const listed = registry.list();

    expect(Object.isFrozen(listed)).toBe(true);
    expect(() => {
      (listed as ProjectionDefinition[]).push(defineProjection(validDefinition('b-projection')));
    }).toThrow(TypeError);
    expect(registry.size).toBe(1);
    expect(registry.list()).toHaveLength(1);
  });

  it('freezes the registry object itself', () => {
    const registry = createProjectionRegistry([validDefinition('a-projection')]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(() => {
      (registry as unknown as { get: unknown }).get = (): undefined => undefined;
    }).toThrow(TypeError);
  });

  it('exposes no mutable array or Map on the registry surface', () => {
    const registry = createProjectionRegistry([validDefinition('a-projection')]);

    for (const value of Object.values(registry)) {
      expect(value).not.toBeInstanceOf(Map);
      expect(value).not.toBeInstanceOf(Set);
      expect(Array.isArray(value) && !Object.isFrozen(value)).toBe(false);
    }
    expect(Object.keys(registry).sort()).toEqual(['get', 'has', 'list', 'size']);
  });
});

// ---------------------------------------------------------------------------
// Lookup misses
// ---------------------------------------------------------------------------

describe('lookup returns undefined rather than throwing', () => {
  it('returns undefined for an unknown but VALID name', () => {
    const registry = createProjectionRegistry([validDefinition('a-projection')]);
    expect(registry.get('never-registered')).toBeUndefined();
    expect(registry.has('never-registered')).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['uppercase', 'A-Projection'],
    ['null', null],
    ['undefined', undefined],
    ['number', 1],
    ['object', {}],
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
  ])('returns undefined for a %s lookup key', (_label, key) => {
    const registry = createProjectionRegistry([validDefinition('a-projection')]);
    expect(registry.get(key)).toBeUndefined();
    expect(registry.has(key)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Safe errors
// ---------------------------------------------------------------------------

describe('registry and definition errors are safe', () => {
  it('does not leak the offending name, version, or object into the message', () => {
    const secret = 'SUPER-SECRET-VALUE-9f3a';
    let caught: unknown;
    try {
      createProjectionRegistry([{ name: secret, version: 1, apply: noopHandler }]);
    } catch (error) {
      caught = error;
    }

    const rendered = `${(caught as Error).message} ${(caught as Error).stack ?? ''}`;
    expect(caught).toBeInstanceOf(ProjectionDefinitionError);
    expect((caught as Error).message).not.toContain(secret);
    expect(rendered).not.toContain(secret);
  });

  it('does not leak handler source text', () => {
    const marker = 'CANARY_TOKEN_IN_HANDLER_SOURCE';
    const handler = (): string => marker;
    let caught: unknown;
    try {
      // A non-async function is still a function, so force failure on the version instead and
      // confirm the handler's source never appears.
      createProjectionRegistry([{ name: 'a-projection', version: 0, apply: handler }]);
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(marker);
    // The real leak signals: the handler's own source text or arrow syntax.
    expect((caught as Error).message).not.toContain('=>');
    expect((caught as Error).message).not.toContain('CANARY');
    // Stricter than a keyword ban: the message must be EXACTLY one of the closed, fixed messages,
    // so no caller-controlled text can be present at all. (The fixed text legitimately contains the
    // word "function" when describing the required apply handler; that is repository-owned prose.)
    const fixedMessages = PROJECTION_DEFINITION_ERROR_CODES.map(
      (code) => new ProjectionDefinitionError(code).message,
    );
    expect(fixedMessages).toContain((caught as Error).message);
  });

  it('does not leak an arbitrary stringified object', () => {
    const probe = { tenant: 'acme', token: 'tok_live_abc123' };
    let caught: unknown;
    try {
      createProjectionRegistry([{ name: 'a-projection', version: probe, apply: noopHandler }]);
    } catch (error) {
      caught = error;
    }

    const message = (caught as Error).message;
    expect(message).not.toContain('acme');
    expect(message).not.toContain('tok_live_abc123');
    expect(message).not.toContain('[object Object]');
  });

  it('carries a stable code and a bounded message on every failure path', () => {
    const cases: (() => unknown)[] = [
      () => createProjectionRegistry([]),
      () => createProjectionRegistry('nope'),
      () => createProjectionRegistry([validDefinition('a'), validDefinition('a')]),
      () => createProjectionRegistry([validDefinition('BAD')]),
      () => createProjectionRegistry([{ name: 'a-projection', version: 1, apply: 'no' }]),
    ];

    for (const run of cases) {
      let caught: unknown;
      try {
        run();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error & { code?: string };
      expect(typeof error.code).toBe('string');
      expect(error.code?.length).toBeGreaterThan(0);
      expect(error.message.length).toBeLessThanOrEqual(200);
    }
  });
});

// ---------------------------------------------------------------------------
// The canonical acceptance instant
// ---------------------------------------------------------------------------

describe('the acceptance instant is an immutable canonical value, not a Date', () => {
  it('converts a Date into a canonical UTC string', () => {
    const instant = toCanonicalInstant(new Date(Date.UTC(2026, 6, 19, 2, 46, 50, 123)));
    expect(instant).toBe('2026-07-19T02:46:50.123Z');
    expect(typeof instant).toBe('string');
    expect(CANONICAL_INSTANT_PATTERN.test(instant)).toBe(true);
  });

  it('shares no state with the source Date — mutating it cannot change the instant', () => {
    const source = new Date(Date.UTC(2026, 6, 19, 2, 46, 50, 123));
    const instant = toCanonicalInstant(source);

    source.setTime(0);

    expect(instant).toBe('2026-07-19T02:46:50.123Z');
  });

  it('accepts an already-canonical string unchanged', () => {
    expect(toCanonicalInstant('2026-07-19T02:46:50.123Z')).toBe('2026-07-19T02:46:50.123Z');
  });

  it.each([
    ['an invalid Date', new Date(Number.NaN)],
    ['a non-UTC offset string', '2026-07-19T02:46:50.123+05:30'],
    ['a second-precision string', '2026-07-19T02:46:50Z'],
    ['a bare date', '2026-07-19'],
    ['a number', 1_763_000_000_000],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(() => toCanonicalInstant(value)).toThrow(ProjectionDefinitionError);
  });

  it('classifies canonical instants consistently', () => {
    expect(isCanonicalInstant('2026-07-19T02:46:50.123Z')).toBe(true);
    expect(isCanonicalInstant('2026-07-19T02:46:50Z')).toBe(false);
    expect(isCanonicalInstant(new Date())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Correction 1 — SEMANTIC canonical-instant validation
// ---------------------------------------------------------------------------

describe('canonical-instant validation is semantic, not merely shaped', () => {
  it.each([
    ['a normal instant', '2026-07-19T02:46:50.123Z'],
    ['a leap day', '2024-02-29T00:00:00.000Z'],
    ['the epoch', '1970-01-01T00:00:00.000Z'],
    ['end of year', '2026-12-31T23:59:59.999Z'],
    ['start of day', '2026-07-19T00:00:00.000Z'],
  ])('accepts %s', (_label, value) => {
    expect(isCanonicalInstant(value)).toBe(true);
    expect(toCanonicalInstant(value)).toBe(value);
  });

  // Each of these MATCHES the shape pattern but names no real instant. Shape alone must not pass.
  it.each([
    ['an impossible day (Feb 30)', '2026-02-30T02:46:50.123Z'],
    ['a leap day in a non-leap year', '2026-02-29T00:00:00.000Z'],
    ['an impossible month (13)', '2026-13-19T02:46:50.123Z'],
    ['hour 24', '2026-07-19T24:00:00.000Z'],
    ['minute 60', '2026-07-19T02:60:00.000Z'],
    ['second 60 (leap second)', '2026-07-19T23:59:60.000Z'],
    ['day 00', '2026-07-00T00:00:00.000Z'],
    ['month 00', '2026-00-19T00:00:00.000Z'],
    ['day 32', '2026-01-32T00:00:00.000Z'],
    ['April 31', '2026-04-31T00:00:00.000Z'],
  ])('rejects %s even though it matches the shape pattern', (_label, value) => {
    expect(CANONICAL_INSTANT_PATTERN.test(value)).toBe(true);
    expect(isCanonicalInstant(value)).toBe(false);
    expect(() => toCanonicalInstant(value)).toThrow(ProjectionDefinitionError);
  });

  it('requires an EXACT byte round-trip, so a rolled-over date is refused', () => {
    // Feb 30 parses, but re-serialises as Mar 2 — a different string, therefore invalid.
    expect(isCanonicalInstant('2026-02-30T02:46:50.123Z')).toBe(false);
    // Hour 24 parses as the next midnight — again a different string.
    expect(isCanonicalInstant('2026-07-19T24:00:00.000Z')).toBe(false);
    // A genuinely canonical instant round-trips to itself.
    const good = '2026-07-19T02:46:50.123Z';
    expect(new Date(Date.parse(good)).toISOString()).toBe(good);
    expect(isCanonicalInstant(good)).toBe(true);
  });

  it.each([
    ['a non-UTC offset', '2026-07-19T02:46:50.123+05:30'],
    ['second precision', '2026-07-19T02:46:50Z'],
    ['microsecond precision', '2026-07-19T02:46:50.123456Z'],
    ['a bare date', '2026-07-19'],
    ['a space separator', '2026-07-19 02:46:50.123Z'],
    ['lowercase z', '2026-07-19T02:46:50.123z'],
    ['empty', ''],
  ])('rejects %s as non-canonical', (_label, value) => {
    expect(isCanonicalInstant(value)).toBe(false);
    expect(() => toCanonicalInstant(value)).toThrow(ProjectionDefinitionError);
  });

  it('rejects an invalid Date without leaking a native error', () => {
    let caught: unknown;
    try {
      toCanonicalInstant(new Date(Number.NaN));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionDefinitionError);
    expect((caught as ProjectionDefinitionError).code).toBe('projection-event-invalid');
    expect((caught as Error).message).not.toContain('Invalid');
    expect((caught as Error).message).not.toContain('RangeError');
  });

  it('never throws from isCanonicalInstant, whatever it is given', () => {
    for (const value of [
      null,
      undefined,
      0,
      Number.NaN,
      {},
      [],
      new Date(Number.NaN),
      Symbol('x'),
      1n,
      (): string => '2026-07-19T02:46:50.123Z',
    ]) {
      expect(() => isCanonicalInstant(value)).not.toThrow();
      expect(isCanonicalInstant(value)).toBe(false);
    }
  });

  it('does NOT call caller-overridable getTime or toISOString on a Date subclass', () => {
    const INJECTED = 'INJECTED-INSTANT-MARKER-7c21';
    let getTimeCalls = 0;
    let toISOStringCalls = 0;

    class HostileDate extends Date {
      public override getTime(): number {
        getTimeCalls += 1;
        return 0;
      }
      public override toISOString(): string {
        toISOStringCalls += 1;
        return INJECTED;
      }
    }

    const hostile = new HostileDate(Date.UTC(2026, 6, 19, 2, 46, 50, 123));
    const converted = toCanonicalInstant(hostile);

    // The INTRINSIC serialisation of the real underlying date — not the override's text.
    expect(converted).toBe('2026-07-19T02:46:50.123Z');
    expect(converted).not.toContain(INJECTED);
    expect(getTimeCalls).toBe(0);
    expect(toISOStringCalls).toBe(0);
  });

  it('rejects a Date subclass whose overrides hide an INVALID underlying date', () => {
    class LyingDate extends Date {
      public override toISOString(): string {
        return '2026-07-19T02:46:50.123Z';
      }
      public override getTime(): number {
        return 1_784_429_210_123;
      }
    }
    // The underlying [[DateValue]] is NaN, so the intrinsic serialiser throws and we reject —
    // the override's plausible-looking string must not rescue it.
    const lying = new LyingDate(Number.NaN);
    expect(() => toCanonicalInstant(lying)).toThrow(ProjectionDefinitionError);
  });

  it('rejects a plain object impersonating a Date', () => {
    const impostor = {
      toISOString: (): string => '2026-07-19T02:46:50.123Z',
      getTime: (): number => 1_784_429_210_123,
    };
    expect(() => toCanonicalInstant(impostor)).toThrow(ProjectionDefinitionError);
  });
});

// ---------------------------------------------------------------------------
// Correction 2 — single-snapshot definition validation
// ---------------------------------------------------------------------------

describe('every accepted definition property is read exactly once', () => {
  it('reads name, version and apply exactly once each', () => {
    const reads = { name: 0, version: 0, apply: 0 };
    const candidate = {
      get name(): string {
        reads.name += 1;
        return 'a-projection';
      },
      get version(): number {
        reads.version += 1;
        return 1;
      },
      get apply(): () => Promise<void> {
        reads.apply += 1;
        return noopHandler;
      },
    };

    createProjectionRegistry([candidate]);

    expect(reads).toEqual({ name: 1, version: 1, apply: 1 });
  });

  it('a getter cannot pass validation and then substitute another value', () => {
    let nameReads = 0;
    const candidate = {
      get name(): string {
        nameReads += 1;
        // Valid on the first read; a different (still valid) name on any later read.
        return nameReads === 1 ? 'a-projection' : 'b-projection';
      },
      version: 1,
      apply: noopHandler,
    };

    const registry = createProjectionRegistry([candidate]);

    expect(nameReads).toBe(1);
    expect(registry.get('a-projection')).toBeDefined();
    expect(registry.get('b-projection')).toBeUndefined();
    expect(registry.list().map((d) => d.name)).toEqual(['a-projection']);
  });

  it('a valid-then-INVALID version getter cannot corrupt the frozen definition', () => {
    let versionReads = 0;
    const candidate = {
      name: 'a-projection',
      get version(): unknown {
        versionReads += 1;
        return versionReads === 1 ? 7 : { evil: true };
      },
      apply: noopHandler,
    };

    const registry = createProjectionRegistry([candidate]);
    const found = registry.get('a-projection');

    expect(versionReads).toBe(1);
    expect(found?.version).toBe(7);
    expect(Object.isFrozen(found)).toBe(true);
  });

  it('a valid-then-different apply getter cannot swap the stored handler', () => {
    let applyReads = 0;
    const candidate = {
      name: 'a-projection',
      version: 1,
      get apply(): () => Promise<void> {
        applyReads += 1;
        return applyReads === 1 ? noopHandler : otherHandler;
      },
    };

    const registry = createProjectionRegistry([candidate]);

    expect(applyReads).toBe(1);
    expect(registry.get('a-projection')?.apply).toBe(noopHandler);
  });
});

describe('throwing getters and proxy traps produce only safe typed errors', () => {
  const SECRET = 'GETTER-SECRET-MARKER-4b9d';

  it.each(['name', 'version', 'apply'])('contains a throwing %s getter', (property) => {
    const candidate: Record<string, unknown> = {
      name: 'a-projection',
      version: 1,
      apply: noopHandler,
    };
    Object.defineProperty(candidate, property, {
      get(): never {
        throw new Error(SECRET);
      },
      enumerable: true,
      configurable: true,
    });

    let caught: unknown;
    try {
      createProjectionRegistry([candidate]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionDefinitionError);
    expect((caught as ProjectionDefinitionError).code).toBe('projection-definition-unreadable');

    const error = caught as Error & { cause?: unknown };
    expect(error.message).not.toContain(SECRET);
    expect(error.stack ?? '').not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(Object.getOwnPropertyNames(error))).not.toContain(SECRET);
  });

  it('contains a proxy whose get trap throws', () => {
    const hostile = new Proxy(
      { name: 'a-projection', version: 1, apply: noopHandler },
      {
        get(): never {
          throw new Error(SECRET);
        },
      },
    );

    let caught: unknown;
    try {
      createProjectionRegistry([hostile]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionDefinitionError);
    expect((caught as Error).message).not.toContain(SECRET);
    expect((caught as Error).stack ?? '').not.toContain(SECRET);
  });

  it('contains a REVOKED proxy as a definition', () => {
    const { proxy, revoke } = Proxy.revocable(
      { name: 'a-projection', version: 1, apply: noopHandler },
      {},
    );
    revoke();

    let caught: unknown;
    try {
      createProjectionRegistry([proxy]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionDefinitionError);
    expect((caught as ProjectionDefinitionError).code).toBe('projection-definition-unreadable');
  });

  it('never exposes a public constructor path that accepts an arbitrary message', () => {
    // The message is chosen by a closed repository-owned table keyed on the code.
    const fromCode = new ProjectionDefinitionError('projection-definition-invalid');
    expect(fromCode.message.length).toBeGreaterThan(0);
    expect(fromCode.message).not.toContain(SECRET);

    // Passing arbitrary text where a code belongs yields no message text, never the input —
    // AND the runtime-normalised `.code` falls back to the safe generic code, not the secret.
    const forged = new ProjectionDefinitionError(
      SECRET as unknown as 'projection-definition-invalid',
    );
    expect(forged.message).not.toContain(SECRET);
    expect(forged.code).toBe('projection-definition-invalid');
    expect(forged.code).not.toContain(SECRET);

    // Every declared code maps to a non-empty fixed message.
    for (const code of PROJECTION_DEFINITION_ERROR_CODES) {
      expect(new ProjectionDefinitionError(code).message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Correction 1 (this round) — error CODE is runtime-normalised, not just the message
// ---------------------------------------------------------------------------

describe('a forged runtime error code cannot survive in .code, .message, or serialization', () => {
  const FORGED = 'FORGED-CODE-SECRET-8d4e';

  it('normalizes an unknown ProjectionDefinitionError code to the safe fallback', () => {
    const error = new ProjectionDefinitionError(
      FORGED as unknown as 'projection-definition-invalid',
    );
    expect(error.code).toBe('projection-definition-invalid');
    expect(error.message).toBe(
      new ProjectionDefinitionError('projection-definition-invalid').message,
    );
    // No marker anywhere reachable: message, code, stack, own-property serialization, JSON.
    const rendered = `${error.message} ${error.code} ${error.stack ?? ''} ${JSON.stringify(
      Object.getOwnPropertyNames(error).map(
        (k) => (error as unknown as Record<string, unknown>)[k],
      ),
    )}`;
    expect(rendered).not.toContain(FORGED);
    expect(JSON.stringify(error)).not.toContain(FORGED);
  });

  it('normalizes an unknown ProjectionRegistryError code to the safe fallback', () => {
    const error = new ProjectionRegistryError(FORGED as unknown as 'projection-registry-invalid');
    expect(error.code).toBe('projection-registry-invalid');
    expect(error.message).toBe(new ProjectionRegistryError('projection-registry-invalid').message);
    const rendered = `${error.message} ${error.code} ${error.stack ?? ''}`;
    expect(rendered).not.toContain(FORGED);
    expect(JSON.stringify(error)).not.toContain(FORGED);
  });

  it('rejects a prototype-polluting code string as unknown, not a table hit', () => {
    // `in` would match inherited `constructor`; hasOwnProperty must not. Both fall back safely.
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(
        new ProjectionDefinitionError(key as unknown as 'projection-definition-invalid').code,
      ).toBe('projection-definition-invalid');
      expect(
        new ProjectionRegistryError(key as unknown as 'projection-registry-invalid').code,
      ).toBe('projection-registry-invalid');
    }
  });

  it('still maps every declared code EXACTLY to its intended fixed message', () => {
    for (const code of PROJECTION_DEFINITION_ERROR_CODES) {
      expect(new ProjectionDefinitionError(code).code).toBe(code);
      expect(new ProjectionDefinitionError(code).message.length).toBeGreaterThan(0);
    }
    for (const code of PROJECTION_REGISTRY_ERROR_CODES) {
      expect(new ProjectionRegistryError(code).code).toBe(code);
      expect(new ProjectionRegistryError(code).message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Correction 3 — safe registry input snapshot
// ---------------------------------------------------------------------------

describe('the registry snapshots its input without invoking caller methods', () => {
  it('does NOT call a caller-defined slice', () => {
    let sliceCalls = 0;
    const input: unknown[] = [validDefinition('a-projection')];
    Object.defineProperty(input, 'slice', {
      value: function hostileSlice(): unknown[] {
        sliceCalls += 1;
        return [validDefinition('b-projection')];
      },
      configurable: true,
      writable: true,
    });

    const registry = createProjectionRegistry(input);

    expect(sliceCalls).toBe(0);
    expect(registry.get('a-projection')).toBeDefined();
    expect(registry.get('b-projection')).toBeUndefined();
  });

  it('contains a throwing element getter', () => {
    const SECRET = 'ELEMENT-SECRET-MARKER-2fa8';
    const input: unknown[] = [];
    Object.defineProperty(input, '0', {
      get(): never {
        throw new Error(SECRET);
      },
      enumerable: true,
      configurable: true,
    });
    // NB: defining index '0' already updates the array's length to 1. An array's `length` is
    // non-configurable, so it must not be redefined here.
    expect(input.length).toBe(1);

    let caught: unknown;
    try {
      createProjectionRegistry(input);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-unreadable');
    expect((caught as Error).message).not.toContain(SECRET);
    expect((caught as Error).stack ?? '').not.toContain(SECRET);
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('contains an array proxy whose get trap throws', () => {
    const SECRET = 'PROXY-SECRET-MARKER-91cc';
    const hostile = new Proxy([validDefinition('a-projection')], {
      get(target, property, receiver): unknown {
        if (property === 'length') {
          return Reflect.get(target, property, receiver);
        }
        throw new Error(SECRET);
      },
    });

    let caught: unknown;
    try {
      createProjectionRegistry(hostile);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-unreadable');
    expect((caught as Error).message).not.toContain(SECRET);
  });

  it('contains a REVOKED array proxy', () => {
    const { proxy, revoke } = Proxy.revocable([validDefinition('a-projection')], {});
    revoke();

    let caught: unknown;
    try {
      createProjectionRegistry(proxy);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-unreadable');
  });

  it('contains a hostile length', () => {
    for (const hostileLength of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
      const hostile = new Proxy([] as unknown[], {
        get(target, property, receiver): unknown {
          if (property === 'length') {
            return hostileLength;
          }
          return Reflect.get(target, property, receiver);
        },
      });

      let caught: unknown;
      try {
        createProjectionRegistry(hostile);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ProjectionRegistryError);
    }
  });

  it('preserves the deliberate empty and invalid classifications', () => {
    const empty = ((): unknown => {
      try {
        createProjectionRegistry([]);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect((empty as ProjectionRegistryError).code).toBe('projection-registry-empty');

    const invalid = ((): unknown => {
      try {
        createProjectionRegistry({});
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect((invalid as ProjectionRegistryError).code).toBe('projection-registry-invalid');
  });

  it('preserves the ProjectionDefinitionError classification for a malformed element', () => {
    let caught: unknown;
    try {
      createProjectionRegistry([validDefinition('a-projection'), { name: 'BAD', version: 1 }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionDefinitionError);
  });

  it('never exposes a registry-error constructor path accepting arbitrary text', () => {
    const SECRET = 'REGISTRY-CTOR-SECRET-33ab';
    const forged = new ProjectionRegistryError(SECRET as unknown as 'projection-registry-invalid');
    expect(forged.message).not.toContain(SECRET);
    // The runtime-normalised code must be the safe fallback, never the forged secret.
    expect(forged.code).toBe('projection-registry-invalid');
    expect(forged.code).not.toContain(SECRET);

    for (const code of PROJECTION_REGISTRY_ERROR_CODES) {
      expect(new ProjectionRegistryError(code).message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Correction 2 (this round) — a caller-thrown typed error is NEVER preserved
// ---------------------------------------------------------------------------

describe('an error thrown by caller-controlled element access is replaced, never rethrown', () => {
  /** Build an array whose element `0` getter throws whatever `make()` returns. */
  const arrayWithThrowingElement = (make: () => unknown): unknown[] => {
    const input: unknown[] = [];
    Object.defineProperty(input, '0', {
      get(): never {
        throw make();
      },
      enumerable: true,
      configurable: true,
    });
    return input;
  };

  const runAndCatch = (input: unknown): unknown => {
    try {
      createProjectionRegistry(input);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('replaces a caller-thrown plain ProjectionRegistryError with a fresh unreadable error', () => {
    // The caller throws a DIFFERENT deliberate code; it must NOT be rethrown unchanged.
    const thrown = new ProjectionRegistryError('projection-registry-duplicate-name');
    const caught = runAndCatch(arrayWithThrowingElement(() => thrown));

    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect(caught).not.toBe(thrown);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-unreadable');
  });

  it('replaces a subclass that overwrites message and code with a secret', () => {
    const SECRET = 'SUBCLASS-SECRET-a11ce';
    class HostileRegistryError extends ProjectionRegistryError {
      public constructor() {
        super('projection-registry-invalid');
        this.message = SECRET;
        (this as unknown as { code: string }).code = SECRET;
      }
    }
    const caught = runAndCatch(arrayWithThrowingElement(() => new HostileRegistryError()));

    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-unreadable');
    expect((caught as Error).message).not.toContain(SECRET);
    expect((caught as Error).stack ?? '').not.toContain(SECRET);
  });

  it('replaces an error carrying a secret cause and custom enumerable properties', () => {
    const SECRET = 'CAUSE-SECRET-77f0';
    const caught = runAndCatch(
      arrayWithThrowingElement(() => {
        const error = new Error('outer') as Error & { cause?: unknown; tenant?: string };
        error.cause = { token: SECRET };
        error.tenant = SECRET;
        return error;
      }),
    );

    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-unreadable');
    const error = caught as Error & { cause?: unknown };
    expect(error.cause).toBeUndefined();
    const rendered = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error)} ${JSON.stringify(
      Object.getOwnPropertyNames(error),
    )}`;
    expect(rendered).not.toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// Correction 3 (this round) — the registry snapshot is length-bounded
// ---------------------------------------------------------------------------

describe('the registry snapshot is bounded to prevent a construction-time DoS', () => {
  it('rejects a sparse array of length 1025 immediately, reading zero elements', () => {
    // A sparse array: length 1025, but the element getter (if ever reached) would record a read.
    const input = new Array<unknown>(MAX_PROJECTION_REGISTRY_SIZE + 1);
    let elementReads = 0;
    Object.defineProperty(input, '0', {
      get(): unknown {
        elementReads += 1;
        return validDefinition('a-projection');
      },
      enumerable: true,
      configurable: true,
    });

    let caught: unknown;
    try {
      createProjectionRegistry(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-too-large');
    expect(elementReads).toBe(0);
  });

  it('rejects a proxy reporting Number.MAX_SAFE_INTEGER immediately, reading zero elements', () => {
    let indexReads = 0;
    const hostile = new Proxy([] as unknown[], {
      get(target, property, receiver): unknown {
        if (property === 'length') {
          return Number.MAX_SAFE_INTEGER;
        }
        // Any numeric index access would be a read we must prove never happens.
        if (typeof property === 'string' && /^\d+$/.test(property)) {
          indexReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    let caught: unknown;
    try {
      createProjectionRegistry(hostile);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionRegistryError);
    expect((caught as ProjectionRegistryError).code).toBe('projection-registry-too-large');
    expect(indexReads).toBe(0);
  });

  it('the too-large error carries no caller text', () => {
    const input = new Array<unknown>(MAX_PROJECTION_REGISTRY_SIZE + 1);
    let caught: unknown;
    try {
      createProjectionRegistry(input);
    } catch (error) {
      caught = error;
    }
    const message = (caught as Error).message;
    expect(message).not.toContain(String(MAX_PROJECTION_REGISTRY_SIZE + 1));
    expect(message.length).toBeLessThanOrEqual(200);
  });

  it('accepts a registry exactly AT the bound and one comfortably under it', () => {
    // Exactly at the bound: 1024 distinct definitions.
    const atBound = Array.from({ length: MAX_PROJECTION_REGISTRY_SIZE }, (_unused, index) =>
      validDefinition(`p${String(index)}-projection`),
    );
    const registry = createProjectionRegistry(atBound);
    expect(registry.size).toBe(MAX_PROJECTION_REGISTRY_SIZE);

    // Ordinary small registries are entirely unaffected.
    const small = createProjectionRegistry([validDefinition('a-projection')]);
    expect(small.size).toBe(1);
  });

  it('MAX_PROJECTION_REGISTRY_SIZE is the documented 1024', () => {
    expect(MAX_PROJECTION_REGISTRY_SIZE).toBe(1_024);
  });
});

// ---------------------------------------------------------------------------
// Correction 3 — detached get / has do not depend on `this`
// ---------------------------------------------------------------------------

describe('get and has work when detached from the registry', () => {
  it('supports destructured get and has', () => {
    const registry = createProjectionRegistry([validDefinition('a-projection', 4)]);
    const { get, has } = registry;

    expect(() => get('a-projection')).not.toThrow();
    expect(get('a-projection')?.version).toBe(4);
    expect(has('a-projection')).toBe(true);
    expect(has('never-registered')).toBe(false);
    expect(get('never-registered')).toBeUndefined();
  });

  it('supports get and has invoked with an unrelated receiver', () => {
    const registry = createProjectionRegistry([validDefinition('a-projection')]);

    // Invoked through Reflect.apply with assorted receivers: none of them may influence the result,
    // because neither function reads `this`.
    expect(Reflect.apply(registry.get, undefined, ['a-projection'])).toBeDefined();
    expect(Reflect.apply(registry.has, undefined, ['a-projection'])).toBe(true);
    expect(Reflect.apply(registry.has, { byName: new Map() }, ['a-projection'])).toBe(true);
    expect(Reflect.apply(registry.has, null, ['never-registered'])).toBe(false);
  });

  it('supports has passed as a bare callback', () => {
    const registry = createProjectionRegistry([
      validDefinition('a-projection'),
      validDefinition('b-projection'),
    ]);
    const names = ['a-projection', 'b-projection', 'never-registered'];

    expect(names.filter((name) => registry.has(name))).toEqual(['a-projection', 'b-projection']);
    // Passed bare, with no receiver at all.
    expect(names.filter(registry.has)).toEqual(['a-projection', 'b-projection']);
  });
});

// ---------------------------------------------------------------------------
// Containment — nothing leaks to the package root
// ---------------------------------------------------------------------------

describe('the Stage 3.4.2 registry is INTERNAL', () => {
  it('exports no projection-registry symbol from the package root', () => {
    for (const symbol of [
      'createProjectionRegistry',
      'ProjectionRegistry',
      'ProjectionRegistryError',
      'PROJECTION_REGISTRY_ERROR_CODES',
      'defineProjection',
      'ProjectionDefinition',
      'ProjectionDefinitionError',
      'PROJECTION_DEFINITION_ERROR_CODES',
      'ProjectionEvent',
      'ProjectionHandler',
      'toCanonicalInstant',
      'isCanonicalInstant',
      'CanonicalInstant',
      'CANONICAL_INSTANT_PATTERN',
      'isProjectionVersion',
      'MAX_PROJECTION_VERSION',
      'MAX_PROJECTION_REGISTRY_SIZE',
      'PROJECTION_REGISTRY_ERROR_CODES',
      'readEventAtPosition',
      'ProjectionStoredDataError',
      'ProjectionInputError',
    ]) {
      expect(publicApi).not.toHaveProperty(symbol);
    }
  });

  it('adds no projection vocabulary to the root surface at all', () => {
    const rootKeys = Object.keys(publicApi);
    expect(rootKeys.filter((key) => key.toLowerCase().includes('projection'))).toEqual([]);
    expect(rootKeys.filter((key) => key.toLowerCase().includes('registry'))).toEqual([]);
  });
});
