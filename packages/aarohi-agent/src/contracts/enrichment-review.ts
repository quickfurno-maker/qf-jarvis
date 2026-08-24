/**
 * The ENRICHMENT REVIEW BOUNDARY (AVG-2, ADR-0111).
 *
 * ### The one risk this file exists to refuse
 *
 * The biggest design hazard in AVG-2 is that "good enrichment" quietly becomes "eligible". A profile
 * with nine corroborated claims feels more actionable than a profile with one, and the moment that
 * feeling reaches the code, enrichment has become an eligibility authority it has no right to be.
 *
 * So the verdict below reads the Core gate and NOTHING ELSE. Claim count, evidence quality,
 * corroboration and consistency are not consulted, and a spec proves it: the same Core observation
 * produces the same verdict for an empty profile and a rich one. There is no threshold to tune and
 * no score to raise, because AVG-3 owns scoring and outreach eligibility, not this slice.
 *
 * ### The gate is REUSED, never restated
 *
 * `evaluateAcquisitionEligibility` from AVG-1 is called directly. This file contains no copy of the
 * Core status map, no second existing-vendor gate and no consent gate. A second implementation would
 * drift from the first, and the drift would be discovered by someone being contacted.
 *
 * Exactly one Core status proceeds. Existing relationships, suppression, ambiguity, absence and an
 * unavailable Core all stop, as does an observation that is malformed or describes a different
 * prospect. Absent Core truth is a stop, not a gap.
 *
 * ### What REVIEWABLE means, stated so it cannot be misread
 *
 *   REVIEWABLE is not CONTACT AUTHORIZED.
 *   REVIEWABLE is not EXECUTION ELIGIBLE.
 *   REVIEWABLE is not CONSENT.
 *   REVIEWABLE is not CORE ACTIVE.
 *   REVIEWABLE is not VERIFIED VENDOR.
 *
 * It means one thing: a human may look at this untrusted profile. Core re-decides communications
 * eligibility at execution time in a later phase, and a stale reviewable verdict is not a standing
 * permission — which is why the verdict carries the Core status it was derived from rather than a
 * bare boolean.
 *
 * The success token is `ENRICHMENT_REVIEWABLE`. There is deliberately no `canSend`, `canContact`,
 * `contactApproved`, `authorized`, `permissionGranted`, `eligibleToMessage` or `readyToExecute`
 * anywhere in this package, and a spec asserts their absence from the public surface.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage.
 */
import { evaluateAcquisitionEligibility } from './existing-vendor-gate.js';
import type { AcquisitionRefusalReason, CorePartyStatus } from './existing-vendor-gate.js';
import type { EnrichmentProfile } from './enrichment-profile.js';

/** The single success token. Named so it cannot be read as permission to contact anyone. */
export const ENRICHMENT_REVIEW_OUTCOME = 'ENRICHMENT_REVIEWABLE' as const;
export type EnrichmentReviewOutcome = typeof ENRICHMENT_REVIEW_OUTCOME;

/** Why a profile may not move to review. Closed, and content-free. */
export const ENRICHMENT_REVIEW_REFUSALS = [
  /** The profile was not a usable AVG-2 profile. */
  'PROFILE_INVALID',
  /** The Core gate refused. The AVG-1 reason travels alongside, unaltered. */
  'CORE_GATE_REFUSED',
] as const;
export type EnrichmentReviewRefusal = (typeof ENRICHMENT_REVIEW_REFUSALS)[number];

/**
 * The boundary's verdict.
 *
 * A pass carries the Core status it rests on, so a reader can never mistake the verdict for a fact
 * this package established. A refusal carries AVG-1's own reason rather than a re-derived one.
 */
export type EnrichmentReviewVerdict =
  | {
      readonly reviewable: true;
      readonly outcome: EnrichmentReviewOutcome;
      readonly coreStatus: CorePartyStatus;
    }
  | {
      readonly reviewable: false;
      readonly refusal: EnrichmentReviewRefusal;
      readonly gateReason?: AcquisitionRefusalReason | undefined;
    };

function isUsableProfile(value: unknown): value is EnrichmentProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { prospectRef?: unknown; claims?: unknown };
  return typeof candidate.prospectRef === 'string' && Array.isArray(candidate.claims);
}

/**
 * Decide whether an enrichment profile may move to human review.
 *
 * Fails closed on every path that is not the one allowlisted Core status. The Core observation must
 * describe THIS profile's prospect: AVG-1 already refuses a mismatched observation, and passing the
 * profile's own `prospectRef` is what makes that check apply here rather than being assumed.
 *
 * Note what is NOT an input: claim count, evidence quality, consistency, conflict state. A profile
 * whose every attribute conflicts is exactly as reviewable as one that agrees, because conflicts are
 * what a reviewer is FOR. Making agreement a gate would have made this function a truth engine.
 */
export function evaluateEnrichmentReviewReadiness(
  profile: unknown,
  coreObservation: unknown,
): EnrichmentReviewVerdict {
  if (!isUsableProfile(profile)) {
    return Object.freeze({ reviewable: false as const, refusal: 'PROFILE_INVALID' as const });
  }

  // The AVG-1 gate, called rather than copied. It owns the status map and the mismatch check.
  const eligibility = evaluateAcquisitionEligibility(profile.prospectRef, coreObservation);
  if (!eligibility.eligible) {
    return Object.freeze({
      reviewable: false as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      gateReason: eligibility.reason,
    });
  }

  return Object.freeze({
    reviewable: true as const,
    outcome: ENRICHMENT_REVIEW_OUTCOME,
    coreStatus: eligibility.status,
  });
}
