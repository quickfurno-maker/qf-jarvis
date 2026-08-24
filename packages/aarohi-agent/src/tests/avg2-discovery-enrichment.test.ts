/**
 * AVG-2 — discovery and enrichment, asserted as a DOMAIN with no authority.
 *
 * The overlay's sentence is the spec: enriched content is untrusted reference material that never
 * establishes consent, never proves identity and never grants eligibility to contact. Every describe
 * below is one way that could stop being true.
 *
 * The blocked Core statuses are DERIVED from AVG-1's own exports rather than retyped, so this file
 * cannot drift from the gate it depends on. A restated list would pass here while the real gate
 * changed underneath it, which is the failure mode worth engineering against.
 */
import { describe, expect, it } from 'vitest';

import {
  BLOCKED_CORE_STATUSES,
  CORE_PARTY_STATUSES,
  ELIGIBLE_CORE_STATUSES,
} from '../contracts/existing-vendor-gate.js';
import {
  createEnrichmentClaim,
  ENRICHMENT_ATTRIBUTE_VALUE_KIND,
  ENRICHMENT_ATTRIBUTES,
  ENRICHMENT_EVIDENCE_QUALITIES,
  ENRICHMENT_SOURCE_KINDS,
  enrichmentClaimIdentity,
  MAX_ENRICHMENT_LABEL_LENGTH,
  PRESENCE_SIGNALS,
} from '../contracts/enrichment-claim.js';
import type { EnrichmentClaim } from '../contracts/enrichment-claim.js';
import {
  createEnrichmentProfile,
  MAX_ENRICHMENT_PROFILE_CLAIMS,
  summariseEnrichmentConsistency,
} from '../contracts/enrichment-profile.js';
import { evaluateEnrichmentReviewReadiness } from '../contracts/enrichment-review.js';

const PROSPECT = 'prospect.avg2.001';
const OTHER_PROSPECT = 'prospect.avg2.002';
const LOOKUP = 'lookup.avg2.001';
const INSTANT = '2026-08-24T00:00:00.000Z';

function claimInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prospectRef: PROSPECT,
    attribute: 'CITY_LABEL',
    value: 'Pune',
    source: { kind: 'PUBLIC_DIRECTORY' },
    observedAt: INSTANT,
    evidenceQuality: 'UNVERIFIED_SINGLE_SOURCE',
    ...over,
  };
}

function claim(over: Record<string, unknown> = {}): EnrichmentClaim {
  const result = createEnrichmentClaim(claimInput(over));
  if (!result.ok) {
    throw new Error(`fixture must build: ${result.refusal}`);
  }
  return result.claim;
}

function observation(status: string, over: Record<string, unknown> = {}): unknown {
  return { prospectRef: PROSPECT, coreLookupRef: LOOKUP, status, ...over };
}

describe('a claim is untrusted evidence, and the dangerous shapes have nowhere to go', () => {
  it('accepts a well-formed label claim and freezes it', () => {
    const built = claim();
    expect(built.attribute).toBe('CITY_LABEL');
    expect(built.valueKind).toBe('LABEL_TEXT');
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.source)).toBe(true);
  });

  it('refuses an unknown key rather than stripping it', () => {
    // Silently narrowing would let a caller believe `vendorId` was stored and honoured.
    for (const smuggled of [
      { vendorId: 'v-1' },
      { registrationNumber: 'REG-1' },
      { packageTier: 'GOLD' },
      { consentStatus: 'OPTED_IN' },
      { isActive: true },
      { paymentStatus: 'PAID' },
      { leadEligibility: 'ELIGIBLE' },
      { phone: '9822012345' },
      { email: 'someone@example.com' },
      { score: 91 },
    ]) {
      const result = createEnrichmentClaim(claimInput(smuggled));
      expect(result.ok, Object.keys(smuggled)[0]).toBe(false);
      expect(result.ok ? undefined : result.refusal).toBe('CLAIM_SHAPE_INVALID');
    }
  });

  it('refuses an attribute outside the closed vocabulary', () => {
    for (const attribute of ['PHONE_NUMBER', 'EMAIL', 'VENDOR_ID', 'PACKAGE_TIER', 'CONSENT']) {
      const result = createEnrichmentClaim(claimInput({ attribute }));
      expect(result.ok, attribute).toBe(false);
      expect(result.ok ? undefined : result.refusal).toBe('CLAIM_SHAPE_INVALID');
    }
  });

  it('refuses overlong free text', () => {
    const result = createEnrichmentClaim(
      claimInput({ value: 'x'.repeat(MAX_ENRICHMENT_LABEL_LENGTH + 1) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.refusal).toBe('CLAIM_SHAPE_INVALID');
  });

  it('refuses a label carrying a contact SHAPE, whatever attribute it hides behind', () => {
    // A phone number wearing a display name is still a phone number, and Aarohi holds no consent.
    for (const value of [
      'Studio Nine someone@example.com',
      'Studio Nine https://example.com',
      'Studio Nine www.example.com',
      'Studio Nine //example.com',
      'Call 9822012345',
      'Call 98220 12345',
      'Call +91-98220-12345',
    ]) {
      for (const attribute of ['BUSINESS_DISPLAY_NAME', 'BUSINESS_DESCRIPTION', 'LOCALITY_LABEL']) {
        const result = createEnrichmentClaim(claimInput({ attribute, value }));
        expect(result.ok, `${attribute} / ${value}`).toBe(false);
        expect(result.ok ? undefined : result.refusal).toBe('LABEL_VALUE_REFUSED');
      }
    }
  });

  it('keeps ordinary business labels usable', () => {
    // The screen is conservative, not hostile: a real display name must still parse.
    for (const value of ['Studio Nine Interiors', 'Kharadi', 'Modular kitchen and wardrobe work']) {
      expect(createEnrichmentClaim(claimInput({ value })).ok, value).toBe(true);
    }
  });

  it('gives presence attributes NO room for a destination', () => {
    const presence = ENRICHMENT_ATTRIBUTES.filter(
      (one) => ENRICHMENT_ATTRIBUTE_VALUE_KIND[one] === 'PRESENCE_SIGNAL',
    );
    expect(presence).toStrictEqual([
      'WEBSITE_PRESENCE',
      'PUBLIC_SOCIAL_PRESENCE',
      'PORTFOLIO_SIGNAL',
    ]);
    for (const attribute of presence) {
      for (const signal of PRESENCE_SIGNALS) {
        expect(createEnrichmentClaim(claimInput({ attribute, value: signal })).ok).toBe(true);
      }
      // Anything that is not a signal — a link above all — is refused.
      for (const value of ['https://example.com', 'example.com', 'yes', 'OBSERVED_AT_EXAMPLE']) {
        const result = createEnrichmentClaim(claimInput({ attribute, value }));
        expect(result.ok, `${attribute} / ${value}`).toBe(false);
        expect(result.ok ? undefined : result.refusal).toBe('PRESENCE_VALUE_INVALID');
      }
    }
  });

  it('never echoes the refused value in the refusal', () => {
    const secret = 'someone@example.com';
    const result = createEnrichmentClaim(claimInput({ value: `Studio ${secret}` }));
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe('provenance is evidence, never authority', () => {
  it('requires a source on every claim', () => {
    const result = createEnrichmentClaim({
      prospectRef: PROSPECT,
      attribute: 'CITY_LABEL',
      value: 'Pune',
      observedAt: INSTANT,
      evidenceQuality: 'UNVERIFIED_SINGLE_SOURCE',
    });
    expect(result.ok).toBe(false);
  });

  it('closes the source vocabulary and refuses anything outside it', () => {
    for (const kind of ENRICHMENT_SOURCE_KINDS) {
      expect(createEnrichmentClaim(claimInput({ source: { kind } })).ok, kind).toBe(true);
    }
    for (const kind of ['SCRAPED', 'PURCHASED_LIST', 'CORE', 'VERIFIED_PARTNER']) {
      expect(createEnrichmentClaim(claimInput({ source: { kind } })).ok, kind).toBe(false);
    }
  });

  it('refuses a source ref that is malformed or contact-shaped', () => {
    for (const sourceRef of ['has space', 'https://example.com/x', '9822012345', '']) {
      const result = createEnrichmentClaim(
        claimInput({ source: { kind: 'PUBLIC_DIRECTORY', sourceRef } }),
      );
      expect(result.ok, sourceRef).toBe(false);
    }
    expect(
      createEnrichmentClaim(
        claimInput({ source: { kind: 'PUBLIC_DIRECTORY', sourceRef: 'dir.42' } }),
      ).ok,
    ).toBe(true);
  });

  it('carries no permission, authority or verification flag on a source', () => {
    for (const extra of [
      { consented: true },
      { authorised: true },
      { verified: true },
      { permission: 'GRANTED' },
    ]) {
      const result = createEnrichmentClaim(
        claimInput({ source: { kind: 'PUBLIC_DIRECTORY', ...extra } }),
      );
      expect(result.ok, Object.keys(extra)[0]).toBe(false);
    }
  });

  it('spells every evidence-quality level UNVERIFIED, so none can read as truth', () => {
    expect(ENRICHMENT_EVIDENCE_QUALITIES.length).toBeGreaterThan(0);
    for (const quality of ENRICHMENT_EVIDENCE_QUALITIES) {
      expect(quality.startsWith('UNVERIFIED_'), quality).toBe(true);
    }
    for (const quality of ENRICHMENT_EVIDENCE_QUALITIES) {
      expect(quality, quality).not.toMatch(/^VERIFIED/u);
    }
  });

  it('requires a caller-supplied instant and refuses a malformed one', () => {
    for (const observedAt of ['2026-08-24', 'not-an-instant', '2026-13-01T00:00:00Z', 1]) {
      expect(createEnrichmentClaim(claimInput({ observedAt })).ok, String(observedAt)).toBe(false);
    }
    expect(createEnrichmentClaim(claimInput({ observedAt: '2026-08-24T00:00:00Z' })).ok).toBe(true);
  });
});

describe('a profile binds to exactly one prospect', () => {
  it('refuses a claim belonging to another prospect rather than dropping it', () => {
    const foreign = claim({ prospectRef: OTHER_PROSPECT });
    const result = createEnrichmentProfile(PROSPECT, [claim(), foreign]);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.refusal).toBe('CLAIM_PROSPECT_MISMATCH');
  });

  it('refuses an invalid prospect ref and an oversized claim set', () => {
    expect(createEnrichmentProfile('has space', []).ok).toBe(false);
    const many = Array.from({ length: MAX_ENRICHMENT_PROFILE_CLAIMS + 1 }, (_, i) =>
      claim({ value: `Pune ${String(i)}` }),
    );
    const result = createEnrichmentProfile(PROSPECT, many);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.refusal).toBe('CLAIM_LIMIT_EXCEEDED');
  });

  it('freezes the profile and its claim list, and does not reorder the caller array', () => {
    const input = [
      claim({ attribute: 'CITY_LABEL' }),
      claim({ attribute: 'BUSINESS_DISPLAY_NAME' }),
    ];
    const snapshot = [...input];
    const result = createEnrichmentProfile(PROSPECT, input);
    if (!result.ok) throw new Error('profile must build');
    expect(Object.isFrozen(result.profile)).toBe(true);
    expect(Object.isFrozen(result.profile.claims)).toBe(true);
    expect(input).toStrictEqual(snapshot);
    expect(() => {
      (result.profile.claims as EnrichmentClaim[]).push(claim());
    }).toThrow();
  });
});

describe('conflicting evidence is reported, never resolved', () => {
  const kharadi = claim({ attribute: 'LOCALITY_LABEL', value: 'Kharadi' });
  const vimanNagar = claim({
    attribute: 'LOCALITY_LABEL',
    value: 'Viman Nagar',
    source: { kind: 'PUBLIC_WEBSITE' },
  });

  it('collapses a claim identical in every field, and only that', () => {
    const twice = createEnrichmentProfile(PROSPECT, [kharadi, kharadi]);
    if (!twice.ok) throw new Error('profile must build');
    expect(twice.profile.claims).toHaveLength(1);

    // Same value, different source: two pieces of evidence, and both survive.
    const corroborated = claim({
      attribute: 'LOCALITY_LABEL',
      value: 'Kharadi',
      source: { kind: 'PUBLIC_WEBSITE' },
    });
    const both = createEnrichmentProfile(PROSPECT, [kharadi, corroborated]);
    if (!both.ok) throw new Error('profile must build');
    expect(both.profile.claims).toHaveLength(2);
    expect(enrichmentClaimIdentity(kharadi)).not.toBe(enrichmentClaimIdentity(corroborated));
  });

  it('keeps both values and names the conflict, choosing neither', () => {
    const result = createEnrichmentProfile(PROSPECT, [kharadi, vimanNagar]);
    if (!result.ok) throw new Error('profile must build');
    const summary = summariseEnrichmentConsistency(result.profile);
    expect(summary.overall).toBe('CONFLICTING');
    expect(summary.conflictingAttributes).toStrictEqual(['LOCALITY_LABEL']);
    const locality = summary.attributes.find((one) => one.attribute === 'LOCALITY_LABEL');
    expect(locality?.verdict).toBe('CONFLICTING');
    expect(locality?.distinctValues).toStrictEqual(['Kharadi', 'Viman Nagar']);
    expect(locality?.claimCount).toBe(2);
  });

  it('gives the same verdict whatever order the evidence arrives in', () => {
    const forward = createEnrichmentProfile(PROSPECT, [kharadi, vimanNagar]);
    const reverse = createEnrichmentProfile(PROSPECT, [vimanNagar, kharadi]);
    if (!forward.ok || !reverse.ok) throw new Error('profiles must build');
    expect(summariseEnrichmentConsistency(forward.profile)).toStrictEqual(
      summariseEnrichmentConsistency(reverse.profile),
    );
    expect(forward.profile.claims).toStrictEqual(reverse.profile.claims);
  });

  it('does not let evidence quality break a tie', () => {
    // A "corroborated" claim does not outrank a single-source one. Outranking is how a conflict
    // quietly becomes a fact.
    const confident = claim({
      attribute: 'LOCALITY_LABEL',
      value: 'Viman Nagar',
      source: { kind: 'PUBLIC_WEBSITE' },
      evidenceQuality: 'UNVERIFIED_CORROBORATED',
    });
    const result = createEnrichmentProfile(PROSPECT, [kharadi, confident]);
    if (!result.ok) throw new Error('profile must build');
    const summary = summariseEnrichmentConsistency(result.profile);
    expect(summary.overall).toBe('CONFLICTING');
    expect(
      summary.attributes.find((one) => one.attribute === 'LOCALITY_LABEL')?.distinctValues,
    ).toStrictEqual(['Kharadi', 'Viman Nagar']);
  });

  it('reports agreement as agreement, and absence as INSUFFICIENT', () => {
    const agreeing = createEnrichmentProfile(PROSPECT, [
      claim({ attribute: 'CITY_LABEL', value: 'Pune' }),
      claim({ attribute: 'CITY_LABEL', value: 'Pune', source: { kind: 'PUBLIC_WEBSITE' } }),
    ]);
    if (!agreeing.ok) throw new Error('profile must build');
    const summary = summariseEnrichmentConsistency(agreeing.profile);
    expect(summary.overall).toBe('CONSISTENT');
    expect(summary.attributes.find((one) => one.attribute === 'CITY_LABEL')?.verdict).toBe(
      'CONSISTENT',
    );
    expect(summary.attributes.find((one) => one.attribute === 'SERVICE_LABEL')?.verdict).toBe(
      'INSUFFICIENT',
    );

    const empty = createEnrichmentProfile(PROSPECT, []);
    if (!empty.ok) throw new Error('profile must build');
    expect(summariseEnrichmentConsistency(empty.profile).overall).toBe('INSUFFICIENT');
  });

  it('covers every attribute in the summary, so nothing is silently unreported', () => {
    const built = createEnrichmentProfile(PROSPECT, [kharadi]);
    if (!built.ok) throw new Error('profile must build');
    const summary = summariseEnrichmentConsistency(built.profile);
    expect(summary.attributes.map((one) => one.attribute)).toStrictEqual([
      ...ENRICHMENT_ATTRIBUTES,
    ]);
  });
});

describe('the AVG-1 Core gate remains the only eligibility authority', () => {
  function profileFor(prospectRef: string) {
    const built = createEnrichmentProfile(prospectRef, [claim({ prospectRef })]);
    if (!built.ok) throw new Error('profile must build');
    return built.profile;
  }

  it('permits exactly the AVG-1 eligible status, derived not retyped', () => {
    expect([...ELIGIBLE_CORE_STATUSES]).toStrictEqual(['NOT_REGISTERED']);
    const verdict = evaluateEnrichmentReviewReadiness(
      profileFor(PROSPECT),
      observation('NOT_REGISTERED'),
    );
    expect(verdict.reviewable).toBe(true);
    expect(verdict.reviewable ? verdict.outcome : undefined).toBe('ENRICHMENT_REVIEWABLE');
    expect(verdict.reviewable ? verdict.coreStatus : undefined).toBe('NOT_REGISTERED');
  });

  it('stops on EVERY blocked Core status', () => {
    // Derived from AVG-1, so this cannot drift from the gate it is testing.
    expect(BLOCKED_CORE_STATUSES.length).toBe(CORE_PARTY_STATUSES.length - 1);
    for (const status of BLOCKED_CORE_STATUSES) {
      const verdict = evaluateEnrichmentReviewReadiness(profileFor(PROSPECT), observation(status));
      expect(verdict.reviewable, status).toBe(false);
      expect(verdict.reviewable ? undefined : verdict.refusal, status).toBe('CORE_GATE_REFUSED');
      expect(verdict.reviewable ? undefined : verdict.gateReason, status).toBeDefined();
    }
  });

  it('stops on a missing, malformed or mismatched observation', () => {
    const profile = profileFor(PROSPECT);
    for (const bad of [
      undefined,
      null,
      {},
      'NOT_REGISTERED',
      { prospectRef: PROSPECT, status: 'NOT_REGISTERED' },
      { prospectRef: OTHER_PROSPECT, coreLookupRef: LOOKUP, status: 'NOT_REGISTERED' },
    ]) {
      const verdict = evaluateEnrichmentReviewReadiness(profile, bad);
      expect(verdict.reviewable, JSON.stringify(bad)).toBe(false);
      expect(verdict.reviewable ? undefined : verdict.refusal).toBe('CORE_GATE_REFUSED');
    }
  });

  it('cannot reuse one prospect eligible observation for another prospect', () => {
    // The observation is valid and eligible — for a DIFFERENT party.
    const verdict = evaluateEnrichmentReviewReadiness(
      profileFor(OTHER_PROSPECT),
      observation('NOT_REGISTERED'),
    );
    expect(verdict.reviewable).toBe(false);
    expect(verdict.reviewable ? undefined : verdict.gateReason).toBe('OBSERVATION_INVALID');
  });

  it('refuses a profile that is not a profile', () => {
    for (const bad of [undefined, null, {}, 'profile', { prospectRef: PROSPECT }]) {
      const verdict = evaluateEnrichmentReviewReadiness(bad, observation('NOT_REGISTERED'));
      expect(verdict.reviewable, JSON.stringify(bad)).toBe(false);
      expect(verdict.reviewable ? undefined : verdict.refusal).toBe('PROFILE_INVALID');
    }
  });

  it('IGNORES enrichment quality entirely — richer evidence never moves the verdict', () => {
    // The defect this guards: "good enrichment" becoming "eligible". An empty profile and a rich,
    // corroborated, fully consistent one must reach the identical verdict for identical Core truth.
    const empty = createEnrichmentProfile(PROSPECT, []);
    const rich = createEnrichmentProfile(PROSPECT, [
      claim({ attribute: 'BUSINESS_DISPLAY_NAME', value: 'Studio Nine Interiors' }),
      claim({ attribute: 'CITY_LABEL', value: 'Pune', evidenceQuality: 'UNVERIFIED_CORROBORATED' }),
      claim({ attribute: 'WEBSITE_PRESENCE', value: 'OBSERVED' }),
    ]);
    if (!empty.ok || !rich.ok) throw new Error('profiles must build');

    for (const status of CORE_PARTY_STATUSES) {
      const a = evaluateEnrichmentReviewReadiness(empty.profile, observation(status));
      const b = evaluateEnrichmentReviewReadiness(rich.profile, observation(status));
      expect(a, status).toStrictEqual(b);
    }

    // And a conflicted profile is exactly as reviewable — conflicts are what a reviewer is for.
    const conflicted = createEnrichmentProfile(PROSPECT, [
      claim({ attribute: 'LOCALITY_LABEL', value: 'Kharadi' }),
      claim({
        attribute: 'LOCALITY_LABEL',
        value: 'Viman Nagar',
        source: { kind: 'PUBLIC_WEBSITE' },
      }),
    ]);
    if (!conflicted.ok) throw new Error('profile must build');
    expect(
      evaluateEnrichmentReviewReadiness(conflicted.profile, observation('NOT_REGISTERED')),
    ).toStrictEqual(evaluateEnrichmentReviewReadiness(rich.profile, observation('NOT_REGISTERED')));
  });

  it('freezes its verdict', () => {
    const verdict = evaluateEnrichmentReviewReadiness(
      profileFor(PROSPECT),
      observation('NOT_REGISTERED'),
    );
    expect(Object.isFrozen(verdict)).toBe(true);
  });
});

describe('REVIEWABLE is not permission, and the vocabulary says so', () => {
  it('introduces no send, contact, authorize or verified-vendor token', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    const surface = Object.keys(barrel).join(' ');
    for (const forbidden of [
      'canSend',
      'canContact',
      'contactApproved',
      'permissionGranted',
      'eligibleToMessage',
      'readyToExecute',
      'VERIFIED_VENDOR',
      'ACTIVE_VENDOR',
      'consent',
      'optIn',
      'suppression',
      'score',
      'rank',
      'outreach',
    ]) {
      expect(surface, `public surface must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('names its success token REVIEWABLE and nothing stronger', () => {
    const verdict = evaluateEnrichmentReviewReadiness(
      (() => {
        const built = createEnrichmentProfile(PROSPECT, []);
        if (!built.ok) throw new Error('profile must build');
        return built.profile;
      })(),
      observation('NOT_REGISTERED'),
    );
    expect(JSON.stringify(verdict)).toContain('ENRICHMENT_REVIEWABLE');
    expect(JSON.stringify(verdict)).not.toContain('AUTHORIZED');
    expect(JSON.stringify(verdict)).not.toContain('APPROVED');
  });
});
