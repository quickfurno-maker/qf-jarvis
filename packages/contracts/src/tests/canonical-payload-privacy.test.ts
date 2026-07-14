/**
 * **Stage 3.1.4 — the canonical payload privacy boundary.**
 *
 * Two locks, and the tests are organised around which one is doing the work:
 *
 * **The primary control is the schema.** Every event resolves to exactly one strict,
 * event-specific payload; there is no free text, no open dictionary, no unknown key, and no
 * permissive fallback. *A payload with nowhere to put a coordinate does not need to be searched
 * for one.*
 *
 * **The second lock is the prohibited-content scan**, for the fields that legitimately hold
 * human-authored governance text and for the day somebody adds a field without thinking.
 *
 * ### The false-positive suite is not padding
 *
 * A detector that fires on ordinary business values is a detector somebody switches off — and its
 * removal is a one-line diff with a sympathetic reviewer. So the positive cases below (ISO dates,
 * semantic versions, prices, percentages, UUIDs, taxonomy labels, reason codes) are load-bearing:
 * **if the guard ever starts rejecting them, this suite fails, and that is the point.**
 */

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_EVENT_ENTRIES,
  CANONICAL_EVENT_TYPES,
  CANONICAL_PAYLOAD_KEYS,
  canonicalPayloadKey,
  derivedSignalSchema,
  inspectProhibitedContent,
  isFreeOfProhibitedContent,
  isProhibitedKey,
  isRegisteredCanonicalEvent,
  keySegments,
  observationPayloadV2Schema,
  resolveCanonicalPayloadSchema,
  safeParseCanonicalEvent,
  taxonomyLabelSchema,
} from '../index.js';
import { VALID_EVENT_FIXTURES } from '../fixtures/index.js';

describe('the payload registry is the primary control', () => {
  it('every registered event resolves to exactly one payload schema', () => {
    for (const entry of CANONICAL_EVENT_ENTRIES) {
      const schema = resolveCanonicalPayloadSchema(entry.eventType, entry.eventVersion);

      expect(
        schema,
        `${entry.eventType}@${String(entry.eventVersion)} has no payload schema`,
      ).toBeDefined();
    }
  });

  it('the payload registry and the event registry cover exactly the same contracts', () => {
    const fromEvents = CANONICAL_EVENT_ENTRIES.map((entry) =>
      canonicalPayloadKey(entry.eventType, entry.eventVersion),
    ).toSorted();

    expect([...CANONICAL_PAYLOAD_KEYS].toSorted()).toStrictEqual(fromEvents);
  });

  it('has no permissive fallback: an unregistered event or version resolves to nothing', () => {
    // The failure this prevents: a "default" schema that accepts an event nobody designed, and
    // therefore an event nobody reviewed.
    expect(resolveCanonicalPayloadSchema('qf.lead.created', 1)).toBeUndefined();
    expect(resolveCanonicalPayloadSchema('qf.client.requirement-completed', 99)).toBeUndefined();
    expect(resolveCanonicalPayloadSchema('', 1)).toBeUndefined();
  });

  it('does not resolve inherited events at version 1 — the version that permitted free text', () => {
    for (const eventType of CANONICAL_EVENT_TYPES) {
      if (eventType.startsWith('qf.taxonomy.')) continue;

      expect(resolveCanonicalPayloadSchema(eventType, 1)).toBeUndefined();
      expect(isRegisteredCanonicalEvent(eventType, 1)).toBe(false);
      expect(isRegisteredCanonicalEvent(eventType, 2)).toBe(true);
    }
  });

  it('registers the 11 taxonomy events at version 1, because they are new', () => {
    const taxonomy = CANONICAL_EVENT_TYPES.filter((type) => type.startsWith('qf.taxonomy.'));

    expect(taxonomy).toHaveLength(11);

    for (const eventType of taxonomy) {
      expect(isRegisteredCanonicalEvent(eventType, 1)).toBe(true);
    }
  });
});

describe('arbitrary free text is gone from the payload', () => {
  it('rejects the v1 free-text `detail` field outright — there is no such field any more', () => {
    const result = observationPayloadV2Schema.safeParse({
      reasonCode: 'requirement.complete',
      detail: 'the client wants a wardrobe',
    });

    // Not "the content was scanned and refused". The FIELD does not exist. That is the difference
    // between a schema and a detector, and it is the whole design.
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key on any payload', () => {
    expect(
      observationPayloadV2Schema.safeParse({ reasonCode: 'x.y', whateverIWant: 'anything' })
        .success,
    ).toBe(false);
  });

  it('accepts a reason code and bounded signals, which is all an observation needs', () => {
    const result = observationPayloadV2Schema.safeParse({
      reasonCode: 'lead.quality-below-threshold',
      signals: [
        { code: 'completeness', band: 'low' },
        { code: 'contact-attempts', count: 3 },
        { code: 'quality', score: 62.5 },
        { code: 'duplicate', present: true },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('a signal cannot carry a sentence, because it has no field that holds one', () => {
    expect(derivedSignalSchema.safeParse({ code: 'x', note: 'a sentence' }).success).toBe(false);
    expect(derivedSignalSchema.safeParse({ code: 'x', value: 1.5 }).success).toBe(false); // out of 0..1
    expect(derivedSignalSchema.safeParse({ code: 'x', count: -1 }).success).toBe(false);
    expect(derivedSignalSchema.safeParse({ code: 'x', score: 101 }).success).toBe(false);
    expect(derivedSignalSchema.safeParse({ code: 'NotAToken' }).success).toBe(false);
  });
});

describe('GPS and location content is refused, in every shape it arrives in', () => {
  const COORDINATE_CASES: readonly (readonly [string, unknown])[] = [
    ['a labelled GPS string', { signal: 'GPS: 18.5204, 73.8567' }],
    ['a bare coordinate pair', { signal: '18.5204,73.8567' }],
    ['a spaced coordinate pair', { signal: '18.5204, 73.8567' }],
    ['lat= lng= inside a string', { signal: 'lat=18.5204 lng=73.8567' }],
    ['structured latitude/longitude', { latitude: 18.5204, longitude: 73.8567 }],
    ['string latitude/longitude', { lat: '18.5204', lng: '73.8567' }],
    ['a coordinate array', { point: [18.5204, 73.8567] }],
    ['a renamed coordinate array', { somewhere: [18.5204, 73.8567] }],
    ['snake_case coordinates', { geo_lat: 18.5204, geo_lng: 73.8567 }],
    ['a map link', { signal: 'https://maps.google.com/?q=18.5204,73.8567' }],
    ['a geo: URI', { signal: 'geo:18.5204,73.8567' }],
  ];

  it.each(COORDINATE_CASES)('refuses %s', (_label, value) => {
    expect(isFreeOfProhibitedContent(value)).toBe(false);
  });

  it('a structured coordinate is caught even though no regex could see it', () => {
    // `[18.5204, 73.8567]` never becomes a string, so a regex over strings would never fire.
    // **A regex alone is not a coordinate defence for structured data**, which is why the array
    // and the numeric key rules exist beside the patterns rather than instead of them.
    const issues = inspectProhibitedContent({ where: [18.5204, 73.8567] });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('prohibited.location.coordinate-array');
  });

  it('never echoes the value it rejected', () => {
    const issues = inspectProhibitedContent({ signal: 'GPS: 18.5204, 73.8567' });

    // A validator that quotes the secret it just refused has written it to a log.
    for (const issue of issues) {
      expect(issue.message).not.toContain('18.5204');
      expect(issue.message).not.toContain('73.8567');
    }
  });
});

describe('renaming an unsafe field does not make it safe', () => {
  const RENAMED: readonly string[] = [
    'phone',
    'client_phone',
    'clientPhone',
    'ClientPhone',
    'CLIENT-PHONE',
    'vendorEmailAddress',
    'client_name',
    'ownerFullName',
    'businessName',
    'office_address_line1',
    'requirementText',
    'leadMessage',
    'internalNotes',
    'apiKey',
    'SERVICE_ROLE_KEY',
    'connection_string',
    'latitude',
    'geo_point',
    'gpsCoordinates',
  ];

  it.each(RENAMED)('refuses the key "%s"', (key) => {
    expect(isProhibitedKey(key)).toBe(true);
  });

  it('splits keys into segments, so a qualifier cannot hide the noun', () => {
    expect(keySegments('clientPhone')).toStrictEqual(['client', 'phone']);
    expect(keySegments('client_phone')).toStrictEqual(['client', 'phone']);
    expect(keySegments('CLIENT-PHONE')).toStrictEqual(['client', 'phone']);
  });
});

describe('contact details and credentials are refused', () => {
  const CASES: readonly (readonly [string, unknown])[] = [
    ['an email in a value', { signal: 'reach me at somebody@example.invalid' }],
    ['an E.164 phone', { signal: '+91 98765 43210' }],
    ['a bare 10-digit phone', { signal: '9876543210' }],
    ['a JWT', { signal: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkifQ.SflKxwRJSMeKKF2QT4' }],
    ['a bearer credential', { signal: 'Bearer abcdef1234567890' }],
    ['a provider token', { signal: 'sbp_0123456789abcdef' }],
    ['a private key', { signal: '-----BEGIN PRIVATE KEY-----' }],
    ['a connection string', { signal: 'postgresql://user:pw@host:5432/db' }],
    ['a transcript key', { transcript: 'anything' }],
    ['a prompt key', { prompt: 'anything' }],
  ];

  it.each(CASES)('refuses %s', (_label, value) => {
    expect(isFreeOfProhibitedContent(value)).toBe(false);
  });
});

describe('the false-positive controls — ordinary business values MUST survive', () => {
  /**
   * If any of these starts failing, the guard has become too greedy and somebody will switch it
   * off. **A rule that cries wolf is worse than no rule**, because its removal is a one-line diff.
   */
  const SAFE_CASES: readonly (readonly [string, unknown])[] = [
    ['an ISO date', { occurredAt: '2026-07-13T09:15:00Z' }],
    ['a semantic version', { modelVersion: '2.14.3' }],
    ['an ordinary integer', { vendorCount: 3 }],
    ['a batch number', { batchNumber: 2 }],
    ['a price band', { priceBand: 'medium' }],
    ['a percentage', { completeness: 0.87 }],
    ['a score', { score: 72.5 }],
    ['a category code', { categoryId: 'CORE-CAT-INTERIORS' }],
    ['a city code', { cityId: 'CORE-CITY-PUNE' }],
    ['a UUID', { correlationId: 'a100000a-0000-4000-8000-000000000001' }],
    ['a UUID with a long zero run', { eventId: 'e0000001-0000-4000-8000-000000000001' }],
    ['a bounded taxonomy label', { cityName: 'Pune', categoryName: 'Interior Designers' }],
    ['a hyphenated taxonomy label', { subcategoryName: 'Carpentry & Joinery' }],
    ['a reason code', { reasonCode: 'lead.quality-below-threshold' }],
    ['a status enum', { state: 'deactivated' }],
    ['an approval level', { approvalLevel: 'founder' }],
    ['a delivery state', { deliveryState: 'delivered' }],
    ['a result code', { resultCode: 'provider-accepted' }],
    ['a count of contact attempts', { contactAttempts: 4 }],
    ['an opaque recipient reference', { recipient: { entityType: 'client', entityId: 'C-1' } }],
    ['two coarse numbers', { range: [1.5, 2.5] }],
    ['two out-of-range numbers', { pair: [123.4567, 456.789] }],
    ['a taxonomy version', { taxonomyVersion: 15 }],
  ];

  it.each(SAFE_CASES)('accepts %s', (_label, value) => {
    expect(isFreeOfProhibitedContent(value)).toBe(true);
  });

  it('accepts the taxonomy labels the business actually uses', () => {
    for (const label of [
      'Pune',
      'Mumbai',
      'Interior Designers',
      'Carpenters',
      'Modular Factory',
      'Premium Interiors',
      'Sofa',
      'Painter',
      'Civil Work',
      'Carpentry & Joinery',
    ]) {
      expect(taxonomyLabelSchema.safeParse(label).success, label).toBe(true);
    }
  });

  it('refuses a label carrying contact data, a coordinate, or a URL — whatever its length', () => {
    // The boundary is CONTENT, not prose style. An earlier version of this schema capped a label
    // at five words; that was removed, because a word count stops nothing that matters
    // ("Kothrud 9876543210" is two words) and it rejects legitimate Hindi and Hinglish service
    // names. See retired-versions.test.ts for the multilingual cases.
    expect(taxonomyLabelSchema.safeParse('Carpenters Pune 9876543210').success).toBe(false);
    expect(taxonomyLabelSchema.safeParse('Site GPS: 18.5204, 73.8567').success).toBe(false);
    expect(taxonomyLabelSchema.safeParse('Interiors https://example.invalid').success).toBe(false);
    expect(taxonomyLabelSchema.safeParse('What do you want?').success).toBe(false);
    expect(taxonomyLabelSchema.safeParse('x'.repeat(65)).success).toBe(false);
  });

  it('accepts a benign label longer than five words — the honest residual, stated', () => {
    // A benign sentence under 64 characters, carrying no contact data and no coordinates, IS
    // accepted. That is a deliberate trade and it is not hidden: it is untidy, and it leaks
    // nothing. **The thing being defended is the client's phone number and front door — not the
    // taxonomy's prose style.** A word-count *recommendation* belongs in a UI, and must never
    // invalidate a canonical event.
    expect(taxonomyLabelSchema.safeParse('Full Home Interior Design and Renovation').success).toBe(
      true,
    );
  });
});

describe('every valid fixture still parses, and every event is fixture-covered', () => {
  it('parses every valid event fixture through the registry', () => {
    for (const fixture of VALID_EVENT_FIXTURES) {
      const result = safeParseCanonicalEvent(structuredClone(fixture));

      expect(result.success, `${fixture.eventType}@${String(fixture.eventVersion)}`).toBe(true);
    }
  });

  it('covers every registered contract with a fixture', () => {
    const covered = new Set(
      VALID_EVENT_FIXTURES.map((event) => canonicalPayloadKey(event.eventType, event.eventVersion)),
    );

    for (const key of CANONICAL_PAYLOAD_KEYS) {
      expect(covered.has(key), `${key} is registered but has no valid fixture`).toBe(true);
    }
  });
});

describe('taxonomy: Core decides, Jarvis is told', () => {
  it('carries permanent ids and a taxonomy version, not just labels', () => {
    const moved = VALID_EVENT_FIXTURES.find(
      (event) => event.eventType === 'qf.taxonomy.subcategory-moved',
    );

    expect(moved).toBeDefined();

    const payload = moved?.payload as Record<string, unknown>;

    // The id and the label are unchanged by a move; only the parent is. A consumer that keyed on
    // the label would see nothing happen — which is why logic keys on the id and the version.
    expect(payload['nodeId']).toBeDefined();
    expect(payload['taxonomyVersion']).toBeTypeOf('number');
    expect(payload['parentCategoryId']).toBeDefined();
    expect(payload['previousParentCategoryId']).toBeDefined();
  });

  it('a historical event keeps its historical taxonomy version', () => {
    // Two events, two versions, and neither is rewritten to agree with the other. Rewriting
    // history to agree with the present is how a replay stops being evidence.
    const created = VALID_EVENT_FIXTURES.find(
      (event) => event.eventType === 'qf.taxonomy.category-created',
    );
    const updated = VALID_EVENT_FIXTURES.find(
      (event) => event.eventType === 'qf.taxonomy.category-updated',
    );

    const createdVersion = (created?.payload as { taxonomyVersion: number }).taxonomyVersion;
    const updatedVersion = (updated?.payload as { taxonomyVersion: number }).taxonomyVersion;

    expect(createdVersion).toBeLessThan(updatedVersion);
  });

  it('there is no taxonomy event Jarvis could author — these are Core facts', () => {
    // Every canonical event, taxonomy included, is sourced from `quickfurno-core` by the
    // envelope's literal. Jarvis has no create, update or deactivate to send: taxonomy
    // administration is Core/admin-only, and this stage grants no new authority.
    for (const fixture of VALID_EVENT_FIXTURES) {
      if (!fixture.eventType.startsWith('qf.taxonomy.')) continue;
      expect(fixture.source).toBe('quickfurno-core');
    }
  });
});

describe('the guard cannot be crashed by hostile input', () => {
  it('survives a cyclic object', () => {
    const cyclic: Record<string, unknown> = { code: 'x' };
    cyclic['self'] = cyclic;

    // A validator may reject anything. It may never crash — an overflow turns the guard into the
    // thing the hostile input kills.
    expect(() => inspectProhibitedContent(cyclic)).not.toThrow();
  });

  it('bounds its own recursion depth', () => {
    let deep: Record<string, unknown> = { code: 'x' };
    for (let i = 0; i < 200; i += 1) {
      deep = { nested: deep };
    }

    expect(() => inspectProhibitedContent(deep)).not.toThrow();
    expect(isFreeOfProhibitedContent(deep)).toBe(false); // depth is itself refused
  });
});
