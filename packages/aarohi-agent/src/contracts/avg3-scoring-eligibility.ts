/**
 * AVG-3 — prospect priority scoring and acquisition contact eligibility (ADR-0112).
 *
 * These are deliberately two different decisions.
 *
 * The priority assessment ranks the REVIEW READINESS of untrusted AVG-2 enrichment evidence. It does
 * not predict conversion, decide what is true, establish identity, carry commercial truth or grant
 * contact permission. Conflicts never get resolved here: a conflicting attribute earns no points.
 *
 * Contact eligibility accepts NO priority assessment at all. It parses the canonical profile and
 * delegates the authority question to the existing AVG-1 Core gate. A high priority can therefore be
 * refused, while a zero-point profile can still be Core-eligible. That separation is structural, not
 * a convention.
 *
 * Pure domain only: no clock, network, storage, provider, channel, credential or execution path.
 */
import { ENRICHMENT_ATTRIBUTE_VALUE_KIND } from './enrichment-claim.js';
import type { EnrichmentAttribute } from './enrichment-claim.js';
import { parseEnrichmentProfile, summariseEnrichmentConsistency } from './enrichment-profile.js';
import { evaluateAcquisitionEligibility } from './existing-vendor-gate.js';
import type { AcquisitionRefusalReason, CorePartyStatus } from './existing-vendor-gate.js';

/** Version of the complete AVG-3 offline-domain contract in this package. */
export const AAROHI_AVG3_CONTRACT_VERSION = 1 as const;
export type AarohiAvg3ContractVersion = typeof AAROHI_AVG3_CONTRACT_VERSION;

/**
 * V1 is intentionally unweighted: one usable attribute, one point.
 *
 * No city, service, category or presence signal is silently more important than another. A future
 * weighted business-fit policy requires its own governed source and a contract-version change.
 */
export const PROSPECT_PRIORITY_MAX_POINTS = 9 as const;

/** Why a priority assessment could not be produced. */
export const PROSPECT_PRIORITY_REFUSALS = ['PROFILE_INVALID'] as const;
export type ProspectPriorityRefusal = (typeof PROSPECT_PRIORITY_REFUSALS)[number];

export interface ProspectPriorityAssessment {
  readonly contractVersion: AarohiAvg3ContractVersion;
  readonly prospectRef: string;
  readonly points: number;
  readonly maximumPoints: typeof PROSPECT_PRIORITY_MAX_POINTS;
  readonly basis: 'UNTRUSTED_ENRICHMENT_EVIDENCE';
  readonly creditedAttributes: readonly EnrichmentAttribute[];
  readonly conflictingAttributes: readonly EnrichmentAttribute[];
}

export type ProspectPriorityResult =
  | { readonly ok: true; readonly assessment: ProspectPriorityAssessment }
  | { readonly ok: false; readonly refusal: ProspectPriorityRefusal };

/**
 * Rank one canonical AVG-2 profile by evidence readiness.
 *
 * Rules:
 * - malformed/non-canonical profiles fail closed;
 * - a label attribute earns one point only when its surviving claims agree;
 * - a presence attribute earns one point only when claims agree on OBSERVED;
 * - NOT_OBSERVED, INSUFFICIENT and CONFLICTING earn zero;
 * - source count and evidence-quality labels are never multipliers or tie-breakers.
 *
 * The function does not consult Core. Core truth belongs to the separate contact-eligibility gate.
 */
export function evaluateProspectPriority(profile: unknown): ProspectPriorityResult {
  const parsed = parseEnrichmentProfile(profile);
  if (parsed === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'PROFILE_INVALID' as const });
  }

  const summary = summariseEnrichmentConsistency(parsed);
  const credited: EnrichmentAttribute[] = [];

  for (const attributeSummary of summary.attributes) {
    if (attributeSummary.verdict !== 'CONSISTENT') {
      continue;
    }

    if (
      ENRICHMENT_ATTRIBUTE_VALUE_KIND[attributeSummary.attribute] === 'PRESENCE_SIGNAL' &&
      attributeSummary.distinctValues[0] !== 'OBSERVED'
    ) {
      continue;
    }

    credited.push(attributeSummary.attribute);
  }

  const points = credited.length;

  return Object.freeze({
    ok: true as const,
    assessment: Object.freeze({
      contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
      prospectRef: parsed.prospectRef,
      points,
      maximumPoints: PROSPECT_PRIORITY_MAX_POINTS,
      basis: 'UNTRUSTED_ENRICHMENT_EVIDENCE' as const,
      creditedAttributes: Object.freeze(credited),
      conflictingAttributes: Object.freeze([...summary.conflictingAttributes]),
    }),
  });
}

/**
 * The point-in-time result of the AVG-3 Core gate.
 *
 * `CONTACT_ELIGIBLE` is a prerequisite for a later governed outreach workspace. It is not a standing
 * permission to send anything. Core owns suppression/relationship truth and must re-evaluate it at
 * the later execution boundary.
 */
export const CONTACT_ELIGIBILITY_OUTCOME = 'CONTACT_ELIGIBLE' as const;
export type ContactEligibilityOutcome = typeof CONTACT_ELIGIBILITY_OUTCOME;

export const CONTACT_ELIGIBILITY_REFUSALS = ['PROFILE_INVALID', 'CORE_GATE_REFUSED'] as const;
export type ContactEligibilityRefusal = (typeof CONTACT_ELIGIBILITY_REFUSALS)[number];

export type AcquisitionContactEligibilityVerdict =
  | {
      readonly contractVersion: AarohiAvg3ContractVersion;
      readonly eligible: true;
      readonly outcome: ContactEligibilityOutcome;
      readonly coreStatus: CorePartyStatus;
    }
  | {
      readonly contractVersion: AarohiAvg3ContractVersion;
      readonly eligible: false;
      readonly refusal: 'PROFILE_INVALID';
    }
  | {
      readonly contractVersion: AarohiAvg3ContractVersion;
      readonly eligible: false;
      readonly refusal: 'CORE_GATE_REFUSED';
      readonly coreReason: AcquisitionRefusalReason;
    };

/**
 * Decide whether a canonical prospect profile passes the CURRENT Core gate for cold acquisition.
 *
 * Priority is intentionally absent from this signature. The only proceed path is the one already
 * allowlisted by AVG-1 (`NOT_REGISTERED`). Existing relationship, previous contact, suppression,
 * duplicate, ambiguous truth, unknown truth and Core unavailability all fail closed through the
 * existing gate rather than being reimplemented here.
 */
export function evaluateAcquisitionContactEligibility(
  profile: unknown,
  coreObservation: unknown,
): AcquisitionContactEligibilityVerdict {
  const parsed = parseEnrichmentProfile(profile);
  if (parsed === undefined) {
    return Object.freeze({
      contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
      eligible: false as const,
      refusal: 'PROFILE_INVALID' as const,
    });
  }

  const core = evaluateAcquisitionEligibility(parsed.prospectRef, coreObservation);
  if (!core.eligible) {
    return Object.freeze({
      contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
      eligible: false as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      coreReason: core.reason,
    });
  }

  return Object.freeze({
    contractVersion: AAROHI_AVG3_CONTRACT_VERSION,
    eligible: true as const,
    outcome: CONTACT_ELIGIBILITY_OUTCOME,
    coreStatus: core.status,
  });
}
