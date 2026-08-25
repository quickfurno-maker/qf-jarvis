import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG3_CONTRACT_VERSION,
  BLOCKED_CORE_STATUSES,
  CONTACT_ELIGIBILITY_OUTCOME,
  CORE_PARTY_STATUSES,
  ELIGIBLE_CORE_STATUSES,
  ENRICHMENT_ATTRIBUTES,
  PROSPECT_PRIORITY_MAX_POINTS,
  createEnrichmentClaim,
  createEnrichmentProfile,
  evaluateAcquisitionContactEligibility,
  evaluateProspectPriority,
} from '../index.js';
import type {
  CorePartyStatus,
  EnrichmentAttribute,
  EnrichmentClaim,
  EnrichmentEvidenceQuality,
  EnrichmentProfile,
} from '../index.js';

const PROSPECT_REF = 'prospect.avg3.pune.alpha';
const OBSERVED_AT = '2026-08-24T12:00:00Z';

function claim(
  attribute: EnrichmentAttribute,
  value: string,
  options: {
    readonly sourceRef?: string;
    readonly evidenceQuality?: EnrichmentEvidenceQuality;
    readonly observedAt?: string;
  } = {},
): EnrichmentClaim {
  const built = createEnrichmentClaim({
    prospectRef: PROSPECT_REF,
    attribute,
    value,
    source: {
      kind: 'PUBLIC_DIRECTORY',
      sourceRef: options.sourceRef ?? `src-${attribute.toLowerCase().replace(/_/gu, '-')}`,
    },
    observedAt: options.observedAt ?? OBSERVED_AT,
    evidenceQuality: options.evidenceQuality ?? 'UNVERIFIED_SINGLE_SOURCE',
  });
  if (!built.ok) {
    throw new Error(`claim fixture refused: ${built.refusal}`);
  }
  return built.claim;
}

function profile(claims: readonly EnrichmentClaim[]): EnrichmentProfile {
  const built = createEnrichmentProfile(PROSPECT_REF, claims);
  if (!built.ok) {
    throw new Error(`profile fixture refused: ${built.refusal}`);
  }
  return built.profile;
}

function coreObservation(status: CorePartyStatus, prospectRef = PROSPECT_REF): unknown {
  return {
    prospectRef,
    coreLookupRef: `lookup-${status.toLowerCase().replace(/_/gu, '-')}`,
    status,
  };
}

const fullEvidence = (): readonly EnrichmentClaim[] => [
  claim('BUSINESS_DISPLAY_NAME', 'Alpha Interiors'),
  claim('BUSINESS_CATEGORY_LABEL', 'Interior Design'),
  claim('SERVICE_LABEL', 'Modular Kitchen'),
  claim('CITY_LABEL', 'Pune'),
  claim('LOCALITY_LABEL', 'Kharadi'),
  claim('BUSINESS_DESCRIPTION', 'Residential interior studio'),
  claim('WEBSITE_PRESENCE', 'OBSERVED'),
  claim('PUBLIC_SOCIAL_PRESENCE', 'OBSERVED'),
  claim('PORTFOLIO_SIGNAL', 'OBSERVED'),
];

describe('AVG-3 prospect priority is deterministic evidence readiness, never authority', () => {
  it('uses one point per governed enrichment attribute with no hidden weighting', () => {
    expect(PROSPECT_PRIORITY_MAX_POINTS).toBe(ENRICHMENT_ATTRIBUTES.length);
    expect(PROSPECT_PRIORITY_MAX_POINTS).toBe(9);
  });

  it('scores an empty canonical profile at zero and freezes the result', () => {
    const result = evaluateProspectPriority(profile([]));
    expect(result).toStrictEqual({
      ok: true,
      assessment: {
        contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
        prospectRef: PROSPECT_REF,
        points: 0,
        maximumPoints: 9,
        basis: 'UNTRUSTED_ENRICHMENT_EVIDENCE',
        creditedAttributes: [],
        conflictingAttributes: [],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.assessment)).toBe(true);
      expect(Object.isFrozen(result.assessment.creditedAttributes)).toBe(true);
      expect(Object.isFrozen(result.assessment.conflictingAttributes)).toBe(true);
    }
  });

  it('credits all consistent labels plus OBSERVED presence and reaches exactly 9', () => {
    const result = evaluateProspectPriority(profile(fullEvidence()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.assessment.points).toBe(9);
    expect(result.assessment.creditedAttributes).toStrictEqual([...ENRICHMENT_ATTRIBUTES]);
    expect(result.assessment.conflictingAttributes).toStrictEqual([]);
  });

  it('gives NOT_OBSERVED presence no points', () => {
    const result = evaluateProspectPriority(
      profile([
        claim('WEBSITE_PRESENCE', 'NOT_OBSERVED'),
        claim('PUBLIC_SOCIAL_PRESENCE', 'NOT_OBSERVED'),
        claim('PORTFOLIO_SIGNAL', 'NOT_OBSERVED'),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.assessment.points).toBe(0);
    expect(result.assessment.creditedAttributes).toStrictEqual([]);
  });

  it('never resolves a conflict into points, even when other evidence is consistent', () => {
    const result = evaluateProspectPriority(
      profile([
        claim('CITY_LABEL', 'Pune', { sourceRef: 'city-a' }),
        claim('CITY_LABEL', 'Mumbai', {
          sourceRef: 'city-b',
          evidenceQuality: 'UNVERIFIED_CORROBORATED',
          observedAt: '2026-08-24T12:00:01Z',
        }),
        claim('SERVICE_LABEL', 'Modular Kitchen', { sourceRef: 'service-a' }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.assessment.points).toBe(1);
    expect(result.assessment.creditedAttributes).toStrictEqual(['SERVICE_LABEL']);
    expect(result.assessment.conflictingAttributes).toStrictEqual(['CITY_LABEL']);
  });

  it('does not let source count or evidence-quality labels multiply points', () => {
    const oneSource = evaluateProspectPriority(
      profile([
        claim('SERVICE_LABEL', 'Modular Kitchen', {
          sourceRef: 'service-single',
          evidenceQuality: 'UNVERIFIED_SINGLE_SOURCE',
        }),
      ]),
    );
    const corroborated = evaluateProspectPriority(
      profile([
        claim('SERVICE_LABEL', 'Modular Kitchen', {
          sourceRef: 'service-a',
          evidenceQuality: 'UNVERIFIED_SINGLE_SOURCE',
        }),
        claim('SERVICE_LABEL', 'Modular Kitchen', {
          sourceRef: 'service-b',
          evidenceQuality: 'UNVERIFIED_CORROBORATED',
          observedAt: '2026-08-24T12:00:01Z',
        }),
      ]),
    );

    expect(oneSource.ok).toBe(true);
    expect(corroborated.ok).toBe(true);
    if (!oneSource.ok || !corroborated.ok) return;

    expect(oneSource.assessment.points).toBe(1);
    expect(corroborated.assessment.points).toBe(1);
  });

  it('is order-independent because canonical evidence produces one priority answer', () => {
    const evidence = fullEvidence();
    const forward = evaluateProspectPriority(profile(evidence));
    const reversed = evaluateProspectPriority(profile([...evidence].reverse()));
    expect(reversed).toStrictEqual(forward);
  });

  it('refuses a profile that the canonical AVG-2 parser refuses', () => {
    expect(evaluateProspectPriority({ prospectRef: PROSPECT_REF, claims: [] })).toStrictEqual({
      ok: false,
      refusal: 'PROFILE_INVALID',
    });
  });
});

describe('AVG-3 contact eligibility is Core-gated and structurally independent of priority', () => {
  it('keeps exactly the AVG-1 allowlist: NOT_REGISTERED proceeds and every other status stops', () => {
    const canonical = profile([]);

    expect(ELIGIBLE_CORE_STATUSES).toStrictEqual(['NOT_REGISTERED']);
    expect(BLOCKED_CORE_STATUSES).toHaveLength(CORE_PARTY_STATUSES.length - 1);

    for (const status of CORE_PARTY_STATUSES) {
      const result = evaluateAcquisitionContactEligibility(canonical, coreObservation(status));
      if (status === 'NOT_REGISTERED') {
        expect(result).toStrictEqual({
          contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
          eligible: true,
          outcome: CONTACT_ELIGIBILITY_OUTCOME,
          coreStatus: 'NOT_REGISTERED',
        });
      } else {
        expect(result.eligible, status).toBe(false);
        if (!result.eligible) {
          expect(result.refusal, status).toBe('CORE_GATE_REFUSED');
        }
      }
    }
  });

  it('propagates the Core refusal classes rather than inventing a second eligibility rule', () => {
    const canonical = profile([]);

    expect(
      evaluateAcquisitionContactEligibility(canonical, coreObservation('PREVIOUSLY_CONTACTED')),
    ).toMatchObject({
      eligible: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'CORE_SUPPRESSED',
    });

    expect(
      evaluateAcquisitionContactEligibility(canonical, coreObservation('DO_NOT_CONTACT')),
    ).toMatchObject({
      eligible: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'CORE_SUPPRESSED',
    });

    expect(
      evaluateAcquisitionContactEligibility(canonical, coreObservation('REGISTERED')),
    ).toMatchObject({
      eligible: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'EXISTING_CORE_RELATIONSHIP',
    });

    expect(
      evaluateAcquisitionContactEligibility(canonical, coreObservation('AMBIGUOUS')),
    ).toMatchObject({
      eligible: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'CORE_TRUTH_UNRESOLVED',
    });
  });

  it('fails closed on an invalid profile before the Core observation can matter', () => {
    expect(
      evaluateAcquisitionContactEligibility(
        { prospectRef: PROSPECT_REF, claims: [] },
        coreObservation('NOT_REGISTERED'),
      ),
    ).toStrictEqual({
      contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
      eligible: false,
      refusal: 'PROFILE_INVALID',
    });
  });

  it('fails closed when the Core observation belongs to another prospect', () => {
    const result = evaluateAcquisitionContactEligibility(
      profile([]),
      coreObservation('NOT_REGISTERED', 'prospect.somebody-else'),
    );
    expect(result).toMatchObject({
      eligible: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'OBSERVATION_INVALID',
    });
  });

  it('proves a maximum-priority profile is still refused by Core', () => {
    const highPriority = profile(fullEvidence());
    const priority = evaluateProspectPriority(highPriority);
    expect(priority.ok).toBe(true);
    if (!priority.ok) return;
    expect(priority.assessment.points).toBe(PROSPECT_PRIORITY_MAX_POINTS);

    expect(
      evaluateAcquisitionContactEligibility(highPriority, coreObservation('DO_NOT_CONTACT')),
    ).toMatchObject({
      eligible: false,
      refusal: 'CORE_GATE_REFUSED',
      coreReason: 'CORE_SUPPRESSED',
    });
  });

  it('proves a zero-point profile can pass the same Core gate', () => {
    const zeroPriority = profile([]);
    const priority = evaluateProspectPriority(zeroPriority);
    expect(priority.ok).toBe(true);
    if (!priority.ok) return;
    expect(priority.assessment.points).toBe(0);

    expect(
      evaluateAcquisitionContactEligibility(zeroPriority, coreObservation('NOT_REGISTERED')),
    ).toStrictEqual({
      contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
      eligible: true,
      outcome: CONTACT_ELIGIBILITY_OUTCOME,
      coreStatus: 'NOT_REGISTERED',
    });
  });

  it('keeps the two APIs structurally separate', () => {
    expect(evaluateProspectPriority.length).toBe(1);
    expect(evaluateAcquisitionContactEligibility.length).toBe(2);
  });
});
