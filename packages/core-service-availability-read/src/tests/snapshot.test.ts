/**
 * RWC-P5 — the Core service-availability snapshot parser (ADR-0100 §28).
 *
 * The parser is the whole package. Everything downstream — what the model may say, what may reach
 * P4A, what may be persisted — is downstream of "is this a snapshot Core would recognise?", so the
 * interesting cases here are the ones where a plausible-looking value must be REFUSED rather than
 * quietly repaired.
 *
 * Two rules carry most of the weight:
 *
 * 1. **Availability is explicit.** An active city plus an active service never implies the pair, so a
 *    missing availability row is a refusal rather than an optimistic default.
 * 2. **Duplicates are refused, never deduplicated.** Two rows for one entity means the producer holds
 *    two beliefs, and picking one is a rule nobody wrote down.
 */
import { describe, expect, it } from 'vitest';

import {
  CORE_SERVICE_AVAILABILITY_READ_ERROR_CODES,
  CORE_SERVICE_AVAILABILITY_READ_VERSION,
  CoreServiceAvailabilityReadError,
  parseCoreServiceAvailabilitySnapshotV1,
} from '../index.js';
import { MAX_CORE_SERVICE_AVAILABILITY_SNAPSHOT_CHARS } from '../contract/snapshot.js';
import { syntheticAvailabilitySnapshot } from '../testing/index.js';

/** The smallest thing this contract accepts: one city, one service, one row. */
function minimal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    snapshotRef: 'snap.1',
    taxonomyVersion: 3,
    cities: [{ ref: 'city.alpha', displayName: 'Alpha' }],
    services: [{ ref: 'svc.one', displayName: 'Service One' }],
    availability: [{ serviceRef: 'svc.one', cityRefs: 'ALL' }],
    ...over,
  };
}

const refuses = (value: unknown): void => {
  let thrown: unknown;
  try {
    parseCoreServiceAvailabilitySnapshotV1(value);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CoreServiceAvailabilityReadError);
  expect((thrown as CoreServiceAvailabilityReadError).code).toBe('invalid-snapshot');
};

describe('what a valid snapshot looks like', () => {
  it('accepts the minimum: one city, one service, one ALL row', () => {
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(minimal());
    expect(snapshot.version).toBe(1);
    expect(snapshot.cities).toHaveLength(1);
    expect(snapshot.availability[0]?.cityRefs).toBe('ALL');
  });

  it('accepts an explicit city list', () => {
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({
        cities: [
          { ref: 'city.alpha', displayName: 'Alpha' },
          { ref: 'city.beta', displayName: 'Beta' },
        ],
        availability: [{ serviceRef: 'svc.one', cityRefs: ['city.beta'] }],
      }),
    );
    expect(snapshot.availability[0]?.cityRefs).toStrictEqual(['city.beta']);
  });

  it('accepts an EMPTY city list: a catalogued service currently offered nowhere', () => {
    // Legal and meaningful. Refusing it would force a producer to either lie or omit the service,
    // and omitting it would make the service look unrecognised rather than unavailable.
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({ availability: [{ serviceRef: 'svc.one', cityRefs: [] }] }),
    );
    expect(snapshot.availability[0]?.cityRefs).toStrictEqual([]);
  });

  it('the contract version is 1 and the error vocabulary is exactly two frozen codes', () => {
    expect(CORE_SERVICE_AVAILABILITY_READ_VERSION).toBe(1);
    expect([...CORE_SERVICE_AVAILABILITY_READ_ERROR_CODES]).toStrictEqual([
      'invalid-snapshot',
      'invalid-reader',
    ]);
    expect(Object.isFrozen(CORE_SERVICE_AVAILABILITY_READ_ERROR_CODES)).toBe(true);
  });
});

describe('availability is explicit, and complete', () => {
  it('requires EXACTLY one row per service', () => {
    // A service with no availability row has an availability nobody stated. "Unknown" is not a value
    // this contract can express, so the honest answer is a refusal.
    refuses(
      minimal({
        services: [
          { ref: 'svc.one', displayName: 'Service One' },
          { ref: 'svc.two', displayName: 'Service Two' },
        ],
        availability: [{ serviceRef: 'svc.one', cityRefs: 'ALL' }],
      }),
    );
  });

  it('refuses an availability row for a service that is not in the snapshot', () => {
    refuses(minimal({ availability: [{ serviceRef: 'svc.ghost', cityRefs: 'ALL' }] }));
  });

  it('refuses an explicit cityRef that is not in the snapshot', () => {
    refuses(minimal({ availability: [{ serviceRef: 'svc.one', cityRefs: ['city.ghost'] }] }));
  });

  it('refuses an extra availability row beyond the services', () => {
    refuses(
      minimal({
        availability: [
          { serviceRef: 'svc.one', cityRefs: 'ALL' },
          { serviceRef: 'svc.one', cityRefs: [] },
        ],
      }),
    );
  });
});

describe('duplicates are refused, never deduplicated', () => {
  it('refuses a duplicate city ref', () => {
    refuses(
      minimal({
        cities: [
          { ref: 'city.alpha', displayName: 'Alpha' },
          { ref: 'city.alpha', displayName: 'Alpha Again' },
        ],
      }),
    );
  });

  it('refuses a duplicate service ref', () => {
    refuses(
      minimal({
        services: [
          { ref: 'svc.one', displayName: 'Service One' },
          { ref: 'svc.one', displayName: 'Service One Again' },
        ],
        availability: [{ serviceRef: 'svc.one', cityRefs: 'ALL' }],
      }),
    );
  });

  it('refuses a duplicate availability serviceRef', () => {
    refuses(
      minimal({
        services: [
          { ref: 'svc.one', displayName: 'Service One' },
          { ref: 'svc.two', displayName: 'Service Two' },
        ],
        availability: [
          { serviceRef: 'svc.one', cityRefs: 'ALL' },
          { serviceRef: 'svc.one', cityRefs: 'ALL' },
        ],
      }),
    );
  });

  it('refuses a duplicate cityRef INSIDE an explicit list', () => {
    refuses(
      minimal({
        availability: [{ serviceRef: 'svc.one', cityRefs: ['city.alpha', 'city.alpha'] }],
      }),
    );
  });

  it('a duplicate is caught BEFORE sorting, so ordering cannot hide one', () => {
    refuses(
      minimal({
        cities: [
          { ref: 'city.zulu', displayName: 'Zulu' },
          { ref: 'city.alpha', displayName: 'Alpha' },
          { ref: 'city.zulu', displayName: 'Zulu Again' },
        ],
      }),
    );
  });

  it('two cities MAY share a display name: Core requires no label uniqueness', () => {
    // Real places share names across states. Inventing a uniqueness rule Core does not have would
    // refuse a legitimate catalogue.
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({
        cities: [
          { ref: 'city.alpha.north', displayName: 'Alpha' },
          { ref: 'city.alpha.south', displayName: 'Alpha' },
        ],
      }),
    );
    expect(snapshot.cities).toHaveLength(2);
  });
});

describe('strictness', () => {
  const rejected: Record<string, unknown> = {
    'a non-object': 'nope',
    null: null,
    'an array': [],
    'a wrong version': minimal({ version: 2 }),
    'a missing version': (() => {
      const { version: _v, ...rest } = minimal();
      return rest;
    })(),
    'an extra top-level key': minimal({ region: 'west' }),
    'an extra key on a city': minimal({
      cities: [{ ref: 'city.alpha', displayName: 'Alpha', population: 1 }],
    }),
    'an extra key on a service': minimal({
      services: [{ ref: 'svc.one', displayName: 'Service One', price: 100 }],
      availability: [{ serviceRef: 'svc.one', cityRefs: 'ALL' }],
    }),
    'an extra key on an availability row': minimal({
      availability: [{ serviceRef: 'svc.one', cityRefs: 'ALL', vendorCount: 4 }],
    }),
    'an aliases key': minimal({
      cities: [{ ref: 'city.alpha', displayName: 'Alpha', aliases: ['Alfa'] }],
    }),
    'a malformed city ref': minimal({ cities: [{ ref: 'city alpha!', displayName: 'Alpha' }] }),
    'an empty city ref': minimal({ cities: [{ ref: '', displayName: 'Alpha' }] }),
    'a malformed display label with a URL': minimal({
      cities: [{ ref: 'city.alpha', displayName: 'Alpha www.example.com' }],
    }),
    'a display label carrying a phone number': minimal({
      cities: [{ ref: 'city.alpha', displayName: 'Alpha 9876543210' }],
    }),
    'a taxonomyVersion of zero': minimal({ taxonomyVersion: 0 }),
    'a non-integer taxonomyVersion': minimal({ taxonomyVersion: 1.5 }),
    'a malformed snapshotRef': minimal({ snapshotRef: 'snap 1!' }),
    'an empty snapshotRef': minimal({ snapshotRef: '' }),
    'an unknown availability sentinel': minimal({
      availability: [{ serviceRef: 'svc.one', cityRefs: 'EVERYWHERE' }],
    }),
  };
  for (const [label, value] of Object.entries(rejected)) {
    it(`refuses ${label}`, () => {
      refuses(value);
    });
  }

  it('refuses more than 64 cities', () => {
    const cities = Array.from({ length: 65 }, (_unused, index) => ({
      ref: `city.c${String(index)}`,
      displayName: `City ${String(index)}`,
    }));
    refuses(minimal({ cities }));
  });

  it('refuses more than 64 services', () => {
    const services = Array.from({ length: 65 }, (_unused, index) => ({
      ref: `svc.s${String(index)}`,
      displayName: `Service ${String(index)}`,
    }));
    refuses(
      minimal({
        services,
        availability: services.map((s) => ({ serviceRef: s.ref, cityRefs: 'ALL' })),
      }),
    );
  });

  it('refuses a snapshot whose CANONICAL serialization exceeds the bound', () => {
    // A snapshot is model context, and context that can grow without limit is a request that
    // eventually fails a budget nobody was watching. Long-but-legal refs are the realistic way to
    // reach the bound while every individual field still validates.
    const long = (prefix: string, index: number): string =>
      `${prefix}.${'x'.repeat(100)}.${String(index)}`;
    const cities = Array.from({ length: 40 }, (_unused, index) => ({
      ref: long('city', index),
      displayName: 'A City With A Fairly Long Name',
    }));
    const services = Array.from({ length: 40 }, (_unused, index) => ({
      ref: long('svc', index),
      displayName: 'A Service With A Fairly Long Name',
    }));
    const availability = services.map((service) => ({
      serviceRef: service.ref,
      cityRefs: cities.map((city) => city.ref),
    }));
    const oversized = minimal({ cities, services, availability });
    expect(JSON.stringify(oversized).length).toBeGreaterThan(
      MAX_CORE_SERVICE_AVAILABILITY_SNAPSHOT_CHARS,
    );
    refuses(oversized);
  });

  it('a realistic catalogue fits the bound comfortably', () => {
    // The bound must not be so tight that an ordinary marketplace cannot be described. Thirty cities
    // and twenty-five services, with one service restricted, is a realistic regional shape.
    const cities = Array.from({ length: 30 }, (_unused, index) => ({
      ref: `city.c${String(index)}`,
      displayName: `City Number ${String(index)}`,
    }));
    const services = Array.from({ length: 25 }, (_unused, index) => ({
      ref: `svc.s${String(index)}`,
      displayName: `Service Number ${String(index)}`,
    }));
    const availability = services.map((service, index) =>
      index === 0
        ? { serviceRef: service.ref, cityRefs: cities.slice(0, 3).map((city) => city.ref) }
        : { serviceRef: service.ref, cityRefs: 'ALL' as const },
    );
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({ cities, services, availability }),
    );
    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(
      MAX_CORE_SERVICE_AVAILABILITY_SNAPSHOT_CHARS,
    );
  });
});

describe('catalogue refs must be storable by the frozen Riya continuity contract', () => {
  // The incompatibility this closes. Core's generic `entityIdSchema` allows 128 characters, and that
  // is right for Core's wider contract system. But a ref from this snapshot does not stop here: the
  // model emits it, RWC-P4A merges it, and `evolveRiyaConversation` rebuilds the discovery through
  // the real `createNeedDiscovery`, whose `REFERENCE` is capped at 64.
  //
  // Without the cap, this boundary would accept a 65-to-128-character ref, show it to the model as a
  // legitimate choice, confirm the model "emitted a ref present in the snapshot" -- and then be
  // unable to persist it. The contract would be asserting an identifier the frozen continuity
  // contract says can never exist.
  //
  // No truncation, no hashing, no alias, no remapping: every one of those would invent an identifier
  // Core never published. A longer ref is a contract incompatibility, refused before the model.

  const ref = (prefix: string, length: number): string =>
    `${prefix}.${'x'.repeat(length - prefix.length - 1)}`;

  it('a 64-character city ref is accepted', () => {
    const cityRef = ref('city', 64);
    expect(cityRef).toHaveLength(64);
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({
        cities: [{ ref: cityRef, displayName: 'Alpha' }],
        availability: [{ serviceRef: 'svc.one', cityRefs: [cityRef] }],
      }),
    );
    expect(snapshot.cities[0]?.ref).toHaveLength(64);
  });

  it('a 64-character service ref is accepted', () => {
    const serviceRef = ref('svc', 64);
    expect(serviceRef).toHaveLength(64);
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({
        services: [{ ref: serviceRef, displayName: 'Service One' }],
        availability: [{ serviceRef, cityRefs: 'ALL' }],
      }),
    );
    expect(snapshot.services[0]?.ref).toHaveLength(64);
  });

  it('a 65-character city ref is refused', () => {
    const cityRef = ref('city', 65);
    expect(cityRef).toHaveLength(65);
    refuses(
      minimal({
        cities: [{ ref: cityRef, displayName: 'Alpha' }],
        availability: [{ serviceRef: 'svc.one', cityRefs: [cityRef] }],
      }),
    );
  });

  it('a 65-character service ref is refused', () => {
    const serviceRef = ref('svc', 65);
    refuses(
      minimal({
        services: [{ ref: serviceRef, displayName: 'Service One' }],
        availability: [{ serviceRef, cityRefs: 'ALL' }],
      }),
    );
  });

  it('a 65-character availability serviceRef is refused', () => {
    // Refused on its own terms, not merely because it fails the reference-integrity check.
    refuses(minimal({ availability: [{ serviceRef: ref('svc', 65), cityRefs: 'ALL' }] }));
  });

  it('a 65-character explicit availability cityRef is refused', () => {
    refuses(minimal({ availability: [{ serviceRef: 'svc.one', cityRefs: [ref('city', 65)] }] }));
  });

  it('a 128-character ref -- valid to Core generic entityIdSchema -- is refused by THIS contract', () => {
    // The whole point stated as one case: legal for Core, unusable by Riya, therefore refused here.
    const cityRef = ref('city', 128);
    expect(cityRef).toHaveLength(128);
    refuses(
      minimal({
        cities: [{ ref: cityRef, displayName: 'Alpha' }],
        availability: [{ serviceRef: 'svc.one', cityRefs: [cityRef] }],
      }),
    );
  });

  it('the refusal still carries nothing about the ref it refused', () => {
    let message = '';
    try {
      parseCoreServiceAvailabilitySnapshotV1(
        minimal({ cities: [{ ref: `city.oversized-${'z'.repeat(60)}`, displayName: 'Alpha' }] }),
      );
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    for (const forbidden of ['oversized', 'zzz', '64', '128', 'length']) {
      expect(message.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('an EMPTY active catalogue is business truth, not a broken read', () => {
  // The distinction this block exists for: "Core currently offers nothing" and "Core could not be
  // read" are different facts with different consequences. The reader's failure path reports the
  // second; the snapshot must be able to express the first, or a paused marketplace would look
  // permanently like an outage.

  it('accepts a completely empty active view', () => {
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({ cities: [], services: [], availability: [] }),
    );
    expect(snapshot.cities).toStrictEqual([]);
    expect(snapshot.services).toStrictEqual([]);
    expect(snapshot.availability).toStrictEqual([]);
    // Still a real snapshot: it says WHICH view this is.
    expect(snapshot.snapshotRef).toBe('snap.1');
    expect(snapshot.taxonomyVersion).toBe(3);
  });

  it('accepts active cities with no active services', () => {
    // A region is live but nothing is being sold there yet.
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({ services: [], availability: [] }),
    );
    expect(snapshot.cities).toHaveLength(1);
    expect(snapshot.services).toStrictEqual([]);
  });

  it('accepts a service with no active cities, offered nowhere', () => {
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({ cities: [], availability: [{ serviceRef: 'svc.one', cityRefs: [] }] }),
    );
    expect(snapshot.cities).toStrictEqual([]);
    expect(snapshot.availability[0]?.cityRefs).toStrictEqual([]);
  });

  it('accepts `ALL` over an empty city set: every city of none is none', () => {
    // `ALL` is a statement about THIS snapshot, so it degrades correctly rather than becoming a
    // promise about cities Core never published.
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(minimal({ cities: [] }));
    expect(snapshot.availability[0]?.cityRefs).toBe('ALL');
  });

  it('refuses availability rows when there are no services to describe', () => {
    // The one-row-per-service rule with no services reduces to "availability must be empty", and a
    // row about a service the snapshot does not list is meaningless either way.
    refuses(minimal({ services: [], availability: [{ serviceRef: 'svc.one', cityRefs: 'ALL' }] }));
  });

  it('refuses an explicit city reference when there are no cities', () => {
    refuses(
      minimal({ cities: [], availability: [{ serviceRef: 'svc.one', cityRefs: ['city.alpha'] }] }),
    );
  });

  it('the empty canonical output is deterministic and deeply frozen', () => {
    const a = parseCoreServiceAvailabilitySnapshotV1(
      minimal({ cities: [], services: [], availability: [] }),
    );
    const b = parseCoreServiceAvailabilitySnapshotV1(
      minimal({ cities: [], services: [], availability: [] }),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.cities)).toBe(true);
    expect(Object.isFrozen(a.services)).toBe(true);
    expect(Object.isFrozen(a.availability)).toBe(true);
  });
});

describe('the canonical output', () => {
  it('sorts cities, services, availability rows and explicit city lists by ref', () => {
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(
      minimal({
        cities: [
          { ref: 'city.zulu', displayName: 'Zulu' },
          { ref: 'city.alpha', displayName: 'Alpha' },
          { ref: 'city.mike', displayName: 'Mike' },
        ],
        services: [
          { ref: 'svc.two', displayName: 'Two' },
          { ref: 'svc.one', displayName: 'One' },
        ],
        availability: [
          { serviceRef: 'svc.two', cityRefs: ['city.zulu', 'city.alpha'] },
          { serviceRef: 'svc.one', cityRefs: 'ALL' },
        ],
      }),
    );
    expect(snapshot.cities.map((c) => c.ref)).toStrictEqual([
      'city.alpha',
      'city.mike',
      'city.zulu',
    ]);
    expect(snapshot.services.map((s) => s.ref)).toStrictEqual(['svc.one', 'svc.two']);
    expect(snapshot.availability.map((a) => a.serviceRef)).toStrictEqual(['svc.one', 'svc.two']);
    expect(snapshot.availability[1]?.cityRefs).toStrictEqual(['city.alpha', 'city.zulu']);
  });

  it('is deterministic: two differently-ordered inputs serialize identically', () => {
    // This is what makes a model request reproducible. Input order must not change a single byte of
    // what the model is shown.
    const a = parseCoreServiceAvailabilitySnapshotV1(
      minimal({
        cities: [
          { ref: 'city.alpha', displayName: 'Alpha' },
          { ref: 'city.beta', displayName: 'Beta' },
        ],
        availability: [{ serviceRef: 'svc.one', cityRefs: ['city.beta', 'city.alpha'] }],
      }),
    );
    const b = parseCoreServiceAvailabilitySnapshotV1(
      minimal({
        cities: [
          { ref: 'city.beta', displayName: 'Beta' },
          { ref: 'city.alpha', displayName: 'Alpha' },
        ],
        availability: [{ serviceRef: 'svc.one', cityRefs: ['city.alpha', 'city.beta'] }],
      }),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is deeply frozen', () => {
    const snapshot = syntheticAvailabilitySnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.cities)).toBe(true);
    expect(Object.isFrozen(snapshot.cities[0])).toBe(true);
    expect(Object.isFrozen(snapshot.services)).toBe(true);
    expect(Object.isFrozen(snapshot.services[0])).toBe(true);
    expect(Object.isFrozen(snapshot.availability)).toBe(true);
    expect(Object.isFrozen(snapshot.availability[0])).toBe(true);
    const explicit = snapshot.availability.find((row) => row.cityRefs !== 'ALL');
    expect(Object.isFrozen(explicit?.cityRefs)).toBe(true);
  });

  it('does not mutate or retain the caller object', () => {
    const input = minimal({
      cities: [
        { ref: 'city.zulu', displayName: 'Zulu' },
        { ref: 'city.alpha', displayName: 'Alpha' },
      ],
    });
    const before = JSON.stringify(input);
    const snapshot = parseCoreServiceAvailabilitySnapshotV1(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(snapshot.cities).not.toBe((input as { cities: unknown }).cities);
    expect(snapshot.cities[0]).not.toBe((input as { cities: readonly unknown[] }).cities[0]);
  });

  it('re-parsing a canonical snapshot is a fixed point', () => {
    const once = syntheticAvailabilitySnapshot();
    const twice = parseCoreServiceAvailabilitySnapshotV1(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('errors carry nothing about what they refused', () => {
  it('never quotes a ref, a label or the value', () => {
    let message = '';
    try {
      parseCoreServiceAvailabilitySnapshotV1(
        minimal({ cities: [{ ref: 'city.secret-internal-codename', displayName: 'Alpha!!!' }] }),
      );
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    for (const forbidden of [
      'secret-internal-codename',
      'Alpha',
      'displayName',
      'zod',
      'expected',
    ]) {
      expect(message.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
