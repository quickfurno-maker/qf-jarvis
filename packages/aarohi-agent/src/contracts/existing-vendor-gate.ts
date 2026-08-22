/**
 * The EXISTING-VENDOR GATE (AVG-1, ADR-0085). The most important invariant in this package.
 *
 * ### What it decides, and what it must never do
 *
 * Aarohi owns genuinely net-new, UNREGISTERED vendor acquisition. Before it may own, create or
 * continue a cold-acquisition relationship, it must receive an authoritative Core-derived
 * eligibility observation.
 *
 * The overlay is explicit: if Core says the discovered party is **registered, active, inactive,
 * dormant, former, previously contacted, duplicate or do-not-contact**, Aarohi must **not** create a
 * second cold-acquisition relationship. And — the half that is easiest to get wrong — **absent or
 * ambiguous Core truth is a stop, not a proceed.**
 *
 * ### So the gate is an ALLOWLIST, and it is total
 *
 * Exactly ONE status proceeds. Everything else stops, including every status nobody has governed
 * yet. That direction matters: a gate written as "stop on this list, otherwise proceed" would let a
 * status added to Core next year default to contacting someone. `CORE_STATUS_ROLE` assigns a role to
 * EVERY member of the closed vocabulary and is typed so a new status does not compile until somebody
 * decides what it means.
 *
 * This is the same shape the provider-outcome role map uses in the live-evidence package, and for
 * the same reason: the previous revision of that map let a new class inherit a verdict by falling
 * through, and it was a defect.
 *
 * ### Aarohi holds NO consent authority
 *
 * It stores no copy of a suppression, opt-out, STOP or do-not-contact decision. `DO_NOT_CONTACT`
 * below is an OBSERVATION OF CORE'S DECISION, not a decision this package made or may re-make. Core
 * decides eligibility and re-decides it at execution time; a stale eligible observation is not a
 * standing permission, which is why the observation carries the lookup it came from.
 *
 * ### Nothing here reads a model, a message or a receipt
 *
 * Registration truth may not be inferred from model output, conversation text, a provider receipt, a
 * WhatsApp delivery, memory, RAG or campaign state. The only input is a Core-derived status token.
 */
import { z } from 'zod';

/**
 * What QuickFurno Core reported about the discovered party.
 *
 * Every value except `NOT_REGISTERED` names a party Core already knows. The three at the end are not
 * statuses at all — they are the shapes of NOT KNOWING, and they are first-class members precisely
 * because the overlay makes them stops rather than gaps.
 */
export const CORE_PARTY_STATUSES = [
  /** Core has no record of this party. The ONLY status Aarohi may act on. */
  'NOT_REGISTERED',
  'REGISTERED',
  'ACTIVE',
  'INACTIVE',
  'DORMANT',
  'FORMER',
  /** Core reports prior contact that governance says suppresses further cold outreach. */
  'PREVIOUSLY_CONTACTED',
  'DUPLICATE',
  /** Core's suppression decision, OBSERVED. Never a decision this package makes or re-makes. */
  'DO_NOT_CONTACT',
  /** Core answered, and the answer does not resolve to a governed status. */
  'AMBIGUOUS',
  /** Core has not answered. Not the same as "no record" — nobody looked, or nobody replied. */
  'UNKNOWN',
  /** The lookup could not be performed at all. */
  'CORE_UNAVAILABLE',
] as const;
export type CorePartyStatus = (typeof CORE_PARTY_STATUSES)[number];

/** What a status establishes for cold acquisition. */
export const CORE_STATUS_ROLES = [
  /** Genuinely net-new and unregistered. Aarohi may proceed. */
  'ELIGIBLE_NET_NEW',
  /** Core already knows this party. Relationship ownership is not Aarohi's to create. */
  'EXISTING_RELATIONSHIP',
  /** Core has suppressed contact. */
  'SUPPRESSED',
  /** Core truth is absent or ambiguous. A STOP, never a proceed. */
  'TRUTH_UNRESOLVED',
] as const;
export type CoreStatusRole = (typeof CORE_STATUS_ROLES)[number];

/**
 * The role of every governed status.
 *
 * TOTAL by type. A new `CorePartyStatus` fails to compile until somebody assigns it a role, which is
 * the point: the failure mode this replaces is a new status silently inheriting permission.
 */
export const CORE_STATUS_ROLE: Readonly<Record<CorePartyStatus, CoreStatusRole>> = Object.freeze({
  // The allowlist. Exactly one member, and it is the whole reason this agent exists.
  NOT_REGISTERED: 'ELIGIBLE_NET_NEW',

  // Core already knows the party. Routing is Core's; creating a second cold relationship is refused.
  REGISTERED: 'EXISTING_RELATIONSHIP',
  ACTIVE: 'EXISTING_RELATIONSHIP',
  INACTIVE: 'EXISTING_RELATIONSHIP',
  DORMANT: 'EXISTING_RELATIONSHIP',
  FORMER: 'EXISTING_RELATIONSHIP',
  DUPLICATE: 'EXISTING_RELATIONSHIP',

  // Core's own suppression decisions, observed and obeyed.
  PREVIOUSLY_CONTACTED: 'SUPPRESSED',
  DO_NOT_CONTACT: 'SUPPRESSED',

  // Not knowing. A stop, not a gap.
  AMBIGUOUS: 'TRUTH_UNRESOLVED',
  UNKNOWN: 'TRUTH_UNRESOLVED',
  CORE_UNAVAILABLE: 'TRUTH_UNRESOLVED',
});

/** The statuses that permit cold acquisition. DERIVED from the map, never restated. */
export const ELIGIBLE_CORE_STATUSES: readonly CorePartyStatus[] = Object.freeze(
  CORE_PARTY_STATUSES.filter((one) => CORE_STATUS_ROLE[one] === 'ELIGIBLE_NET_NEW'),
);

/** The statuses that refuse it. Derived as the complement, so a status can never be in neither. */
export const BLOCKED_CORE_STATUSES: readonly CorePartyStatus[] = Object.freeze(
  CORE_PARTY_STATUSES.filter((one) => CORE_STATUS_ROLE[one] !== 'ELIGIBLE_NET_NEW'),
);

/**
 * An eligibility OBSERVATION derived from Core.
 *
 * It carries the lookup it came from so it cannot be silently reused for a different prospect, and
 * so a reader can tell an observation apart from an assumption. It is not a permission and it does
 * not expire into one: Core re-decides eligibility at execution time.
 */
export interface CoreEligibilityObservation {
  /** The prospect this lookup was performed for. */
  readonly prospectRef: string;
  /** The opaque token the lookup was performed under. Never a Core vendor id. */
  readonly coreLookupRef: string;
  readonly status: CorePartyStatus;
}

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const coreEligibilityObservationSchema = z
  .object({
    prospectRef: OPAQUE_REF,
    coreLookupRef: OPAQUE_REF,
    status: z.enum(CORE_PARTY_STATUSES),
  })
  .strict();

/** Why acquisition may not proceed. Closed, content-free, and never a free-text explanation. */
export const ACQUISITION_REFUSAL_REASONS = [
  /** Core already knows this party; ownership is not Aarohi's to create. */
  'EXISTING_CORE_RELATIONSHIP',
  /** Core has suppressed contact with this party. */
  'CORE_SUPPRESSED',
  /** Core truth is absent, ambiguous or unavailable. A stop, not a proceed. */
  'CORE_TRUTH_UNRESOLVED',
  /** The observation did not parse, or did not describe this prospect. */
  'OBSERVATION_INVALID',
] as const;
export type AcquisitionRefusalReason = (typeof ACQUISITION_REFUSAL_REASONS)[number];

/** The gate's verdict. Frozen, and a refusal always names why. */
export type AcquisitionEligibility =
  | { readonly eligible: true; readonly status: CorePartyStatus }
  | { readonly eligible: false; readonly reason: AcquisitionRefusalReason };

/**
 * Decide whether cold acquisition may proceed for this prospect.
 *
 * Fails closed on every path that is not the one allowlisted status, including a malformed
 * observation and an observation that belongs to a different prospect. The switch is exhaustive over
 * the role map with no default branch.
 */
export function evaluateAcquisitionEligibility(
  prospectRef: string,
  observation: unknown,
): AcquisitionEligibility {
  const parsed = coreEligibilityObservationSchema.safeParse(observation);
  if (!parsed.success) {
    return Object.freeze({ eligible: false as const, reason: 'OBSERVATION_INVALID' as const });
  }
  if (parsed.data.prospectRef !== prospectRef) {
    // An observation about a different party is not weak evidence about this one — it is none.
    return Object.freeze({ eligible: false as const, reason: 'OBSERVATION_INVALID' as const });
  }

  const status = parsed.data.status;
  switch (CORE_STATUS_ROLE[status]) {
    case 'ELIGIBLE_NET_NEW':
      return Object.freeze({ eligible: true as const, status });
    case 'EXISTING_RELATIONSHIP':
      return Object.freeze({
        eligible: false as const,
        reason: 'EXISTING_CORE_RELATIONSHIP' as const,
      });
    case 'SUPPRESSED':
      return Object.freeze({ eligible: false as const, reason: 'CORE_SUPPRESSED' as const });
    case 'TRUTH_UNRESOLVED':
      return Object.freeze({
        eligible: false as const,
        reason: 'CORE_TRUTH_UNRESOLVED' as const,
      });
  }
}
