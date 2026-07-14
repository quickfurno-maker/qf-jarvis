/**
 * **Retired versions, the guard's reach, and the taxonomy label.**
 *
 * Three things this suite exists to stop:
 *
 * 1. **A retired version quietly becoming ingestible again.** v1 permitted arbitrary free text and
 *    an open dictionary. It is withdrawn, and it must fail — with an error that says *withdrawn*,
 *    not *unknown*, because those two send different people to different pages at 2am.
 * 2. **A new payload skipping the guard.** "All payloads are guarded" is a claim; this makes it a
 *    check.
 * 3. **The taxonomy label quietly becoming free text** — or, in the other direction, quietly
 *    rejecting a legitimate Hindi or Hinglish service name.
 */

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_EVENT_TYPES,
  CANONICAL_PAYLOAD_KEYS,
  isGuardedPayloadSchema,
  isRetiredCanonicalVersion,
  RETIRED_EVENT_VERSIONS,
  resolveCanonicalPayloadSchema,
  safeParseCanonicalEvent,
  taxonomyLabelSchema,
  UNSUPPORTED_RETIRED_VERSION,
  UNSUPPORTED_UNKNOWN_VERSION,
} from '../index.js';
import { VALID_EVENT_FIXTURES } from '../fixtures/index.js';

const INHERITED_EVENT_TYPES = CANONICAL_EVENT_TYPES.filter(
  (eventType) => !eventType.startsWith('qf.taxonomy.'),
);

/** A v2 fixture, re-stamped at some other version. The payload is irrelevant: dispatch fails first. */
function atVersion(eventVersion: number): unknown {
  const base = VALID_EVENT_FIXTURES.find(
    (event) => event.eventType === 'qf.recommendation.created',
  );

  return { ...structuredClone(base), eventVersion };
}

describe('the retirement catalogue', () => {
  it('covers all 41 inherited event families, and no taxonomy event', () => {
    expect(RETIRED_EVENT_VERSIONS).toHaveLength(41);
    expect(INHERITED_EVENT_TYPES).toHaveLength(41);

    const retired = new Set(RETIRED_EVENT_VERSIONS.map((record) => record.eventType));

    for (const eventType of INHERITED_EVENT_TYPES) {
      expect(retired.has(eventType), `${eventType} has no retirement record`).toBe(true);
    }

    // A taxonomy event is new. There is nothing to retire, and claiming otherwise would be
    // inventing a history it does not have.
    for (const record of RETIRED_EVENT_VERSIONS) {
      expect(record.eventType.startsWith('qf.taxonomy.')).toBe(false);
    }
  });

  it.each(RETIRED_EVENT_VERSIONS.map((record) => [record.eventType, record] as const))(
    '%s records why it went, and what it cost',
    (_eventType, record) => {
      expect(record.retiredVersion).toBe(1);
      expect(record.replacementVersion).toBe(2);
      expect(record.retirementReason.trim()).not.toBe('');

      // The zero-length migration window, justified by measurement rather than by assertion.
      // A migration window exists to let producers and consumers migrate; there were none.
      expect(record.migrationWindow).toBe('zero');
      expect(record.producerCount).toBe(0);
      expect(record.consumerCount).toBe(0);
      expect(record.persistedEventCount).toBe(0);
      expect(record.retiredBeforeLiveUse).toBe(true);

      expect(record.decisionReference).toBe('ADR-0026');
      // ADR-0026 was accepted on 2026-07-13, and the acceptance explicitly covered the
      // zero-length migration window and the immediate retirement of v1. The record now says
      // `accepted` because that is true — and it carries who and when, so the claim is checkable.
      expect(record.decisionStatus).toBe('accepted');
      expect(record.acceptedOn).toBe('2026-07-13');
      expect(record.acceptedBy).toBe('Keshav Sharma');
    },
  );

  it('does not restore any retired v1 schema to the active registry', () => {
    for (const record of RETIRED_EVENT_VERSIONS) {
      expect(isRetiredCanonicalVersion(record.eventType, 1)).toBe(true);
      expect(resolveCanonicalPayloadSchema(record.eventType, 1)).toBeUndefined();
    }
  });
});

describe('a retired version and an unknown version fail differently', () => {
  it.each(INHERITED_EVENT_TYPES)('%s at v1 fails as unsupported_retired_version', (eventType) => {
    const fixture = VALID_EVENT_FIXTURES.find((event) => event.eventType === eventType);
    const retired = { ...structuredClone(fixture), eventVersion: 1 };

    const result = safeParseCanonicalEvent(retired);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe(UNSUPPORTED_RETIRED_VERSION);
    }
  });

  it('an unknown FUTURE version fails as unsupported_unknown_version', () => {
    const result = safeParseCanonicalEvent(atVersion(3));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe(UNSUPPORTED_UNKNOWN_VERSION);
    }
  });

  it('the two codes are distinct — collapsing them loses who must be upgraded', () => {
    // A retired version means the PRODUCER is behind. An unknown version means the CONSUMER is.
    // Different people, different pages, different hours of the night.
    expect(UNSUPPORTED_RETIRED_VERSION).not.toBe(UNSUPPORTED_UNKNOWN_VERSION);

    const retiredResult = safeParseCanonicalEvent(atVersion(1));
    const unknownResult = safeParseCanonicalEvent(atVersion(3));

    expect(retiredResult.success).toBe(false);
    expect(unknownResult.success).toBe(false);

    if (!retiredResult.success && !unknownResult.success) {
      expect(retiredResult.error.issues[0]?.code).not.toBe(unknownResult.error.issues[0]?.code);
    }
  });

  it('the retired error explains the withdrawal, and never falls back to another version', () => {
    const result = safeParseCanonicalEvent(atVersion(1));

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? '';

      expect(message).toContain('RETIRED');
      expect(message).toContain('version 2');
      // The failure must be explicable without a git archaeology session.
      expect(message.length).toBeGreaterThan(80);
    }
  });

  it('an unknown TYPE still fails as unknown, not as retired', () => {
    const result = safeParseCanonicalEvent({
      ...(atVersion(2) as object),
      eventType: 'qf.lead.created',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe(UNSUPPORTED_UNKNOWN_VERSION);
    }
  });
});

describe('no registered v2 payload bypasses the deep guard', () => {
  it.each(CANONICAL_PAYLOAD_KEYS)('%s carries the prohibited-content guard', (key) => {
    const [eventType, version] = key.split('@');
    const schema = resolveCanonicalPayloadSchema(eventType ?? '', Number(version));

    // Structural, not conventional. A payload that skipped the guard fails the build.
    expect(isGuardedPayloadSchema(schema)).toBe(true);
  });

  it('the guard reaches into an embedded governance contract', () => {
    const fixture = VALID_EVENT_FIXTURES.find(
      (event) => event.eventType === 'qf.recommendation.created',
    );

    const poisoned = structuredClone(fixture) as {
      payload: { recommendation: { rationale: string } };
    };

    // A coordinate written into the recommendation's own governance prose — 2,000 characters of
    // human-authored text, three levels down inside a contract this stage did not re-version.
    poisoned.payload.recommendation.rationale = 'The site is at GPS: 18.5204, 73.8567';

    const result = safeParseCanonicalEvent(poisoned);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path);
      expect(paths.some((path) => path.includes('rationale'))).toBe(true);
    }
  });

  it('the guard reaches a phone number inside an embedded contract', () => {
    const fixture = VALID_EVENT_FIXTURES.find(
      (event) => event.eventType === 'qf.recommendation.created',
    );

    const poisoned = structuredClone(fixture) as {
      payload: { recommendation: { summary: string } };
    };
    poisoned.payload.recommendation.summary = 'Call the client on +91 98765 43210';

    expect(safeParseCanonicalEvent(poisoned).success).toBe(false);
  });

  it('every registered v2 payload still rejects an unknown key', () => {
    for (const fixture of VALID_EVENT_FIXTURES) {
      const widened = structuredClone(fixture) as { payload: Record<string, unknown> };
      widened.payload['smuggledField'] = 'anything at all';

      expect(
        safeParseCanonicalEvent(widened).success,
        `${fixture.eventType} accepted an unknown payload key`,
      ).toBe(false);
    }
  });
});

describe('taxonomy labels: multilingual names are valid, PII is not', () => {
  /**
   * The five-word cap was removed, and these are the reason. Every one of them is a legitimate
   * service name that a word count would have refused — and refusing them buys **no** safety,
   * because none of them carries a phone number, an address or a coordinate.
   */
  const VALID_LABELS: readonly string[] = [
    // English, short
    'Pune',
    'Interior Designers',
    'Carpentry & Joinery',
    'Civil Work',
    'Modular Factory',
    // English, longer than five words — previously rejected, and wrongly
    'Modular Kitchen and Wardrobe Design Services',
    'Full Home Interior Design and Renovation',
    // Hinglish — how these categories are actually written
    'Modular Kitchen aur Wardrobe Designers',
    'Ghar ka Interior Design aur Renovation',
    'Sofa Repair aur Upholstery Service',
    // Hindi (Devanagari)
    'रसोई डिज़ाइनर',
    'घर का इंटीरियर डिज़ाइन और नवीनीकरण',
    // Punctuation that real names carry
    'Sofas, Chairs & Beds',
    'Design Studio (Premium)',
    'Pvt. Ltd. Contractors',
  ];

  it.each(VALID_LABELS)('accepts the legitimate label "%s"', (label) => {
    expect(taxonomyLabelSchema.safeParse(label).success).toBe(true);
  });

  it('accepts a label longer than five words', () => {
    const label = 'Full Home Interior Design and Renovation';

    expect(label.split(/\s+/)).toHaveLength(6);
    expect(taxonomyLabelSchema.safeParse(label).success).toBe(true);
  });

  /**
   * And the other half of the point: **a word count never was the boundary.** Each of these is
   * five words or fewer, and every one of them is refused — because the boundary is *content*.
   */
  const POISONED_SHORT_LABELS: readonly (readonly [string, string])[] = [
    ['a phone number', 'Carpenters Pune 9876543210'],
    ['an E.164 phone', 'Call +91 98765 43210'],
    ['an email address', 'Contact us hello@example.invalid'],
    ['a URL', 'Interiors https://example.invalid'],
    ['a bare domain', 'Interiors example.com'],
    ['a www URL', 'Designers www.example.invalid'],
    ['a GPS coordinate', 'Site GPS: 18.5204, 73.8567'],
    ['a bare coordinate pair', 'Kothrud 18.5204, 73.8567'],
    ['a map link', 'Here maps.google.com'],
  ];

  it.each(POISONED_SHORT_LABELS)('refuses a short label carrying %s', (_label, value) => {
    expect(value.split(/\s+/).length).toBeLessThanOrEqual(5);
    expect(taxonomyLabelSchema.safeParse(value).success).toBe(false);
  });

  it('refuses message punctuation, control characters and repeated whitespace', () => {
    expect(taxonomyLabelSchema.safeParse('What do you want?').success).toBe(false);
    expect(taxonomyLabelSchema.safeParse('Interiors!').success).toBe(false);
    expect(taxonomyLabelSchema.safeParse('Interior  Designers').success).toBe(false); // double space
    expect(taxonomyLabelSchema.safeParse('Interior\nDesigners').success).toBe(false);
    expect(taxonomyLabelSchema.safeParse('  Interiors').success).toBe(false); // padded
    expect(taxonomyLabelSchema.safeParse('').success).toBe(false);
  });

  it('is bounded at 64 characters', () => {
    expect(taxonomyLabelSchema.safeParse('A'.repeat(64)).success).toBe(true);
    expect(taxonomyLabelSchema.safeParse('A'.repeat(65)).success).toBe(false);
  });
});
