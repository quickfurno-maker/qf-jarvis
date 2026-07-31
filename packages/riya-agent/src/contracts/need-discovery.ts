/**
 * The client need-discovery contract (QFJ-S3-C, ADR-0067).
 *
 * What Riya has learned about a client's requirement, expressed so it cannot become a second source
 * of truth. QuickFurno Core owns the lead; this record is a bounded, content-minimised SNAPSHOT that
 * accompanies a proposal for Core to validate.
 *
 * Two deliberate omissions.
 *
 * No contact details. The inbound envelope and Core already carry the client's identity, so copying a
 * phone number or an email here would duplicate personal data into a second place that then has to be
 * erased twice. `RUNTIME_SUBJECT_STATUSES` already covers erasure and tombstones at the conversation
 * level; this record must never become a reason that erasure misses something.
 *
 * No precise location. `contracts/common/prohibited-content.ts` states the rule directly — a
 * latitude/longitude pair never crosses the canonical boundary, and a city or area identifier is
 * carried instead. `locationRef` is exactly that.
 *
 * Category, city and property type are OPAQUE REFERENCES, not enums, for the reason given in
 * `sales-intent.ts`: the catalogue belongs to Core.
 */
import { z } from 'zod';

import { RiyaBehaviourError } from './errors.js';

/** A bounded opaque reference into a QuickFurno-owned vocabulary. Identifier characters only. */
const REFERENCE = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** Bounded free text. Short by design: a summary, never a transcript. */
const SUMMARY = z.string().min(1).max(500);
const NOTE = z.string().min(1).max(120);

/**
 * How complete the discovery is, and therefore what may follow.
 *
 * This is the field that decides whether a lead proposal is even allowed to be requested, so it is a
 * closed enum rather than a derived boolean.
 */
export const DISCOVERY_COMPLETENESS = [
  /** Enough is known for QuickFurno Core to review a follow-up or lead proposal. */
  'SUFFICIENT_FOR_CORE_REVIEW',
  /** More discovery is required before anything is proposed. */
  'MORE_DISCOVERY_REQUIRED',
  /** A person must look at this before it goes further. */
  'HUMAN_REVIEW_REQUIRED',
] as const;
export type DiscoveryCompleteness = (typeof DISCOVERY_COMPLETENESS)[number];

export const DISCOVERY_COMPLETENESS_FROZEN: readonly DiscoveryCompleteness[] = Object.freeze([
  ...DISCOVERY_COMPLETENESS,
]);

/** The discovery fields Riya may record as still missing. Closed, so no free-form key can appear. */
export const DISCOVERY_FIELDS = [
  'serviceInterest',
  'location',
  'propertyType',
  'scope',
  'budget',
  'timeline',
  'consultationPreference',
] as const;
export type DiscoveryField = (typeof DISCOVERY_FIELDS)[number];

export const DISCOVERY_FIELDS_FROZEN: readonly DiscoveryField[] = Object.freeze([
  ...DISCOVERY_FIELDS,
]);

/** A frozen, content-minimised need-discovery snapshot. */
export interface NeedDiscovery {
  readonly behaviourVersion: 1;
  readonly serviceInterestRef: string | undefined;
  readonly locationRef: string | undefined;
  readonly propertyTypeRef: string | undefined;
  readonly scopeSummary: string | undefined;
  readonly budgetNote: string | undefined;
  readonly timelineNote: string | undefined;
  readonly consultationPreferenceRef: string | undefined;
  readonly completeness: DiscoveryCompleteness;
  readonly missingFields: readonly DiscoveryField[];
}

export interface NeedDiscoveryInput {
  readonly serviceInterestRef?: string;
  readonly locationRef?: string;
  readonly propertyTypeRef?: string;
  readonly scopeSummary?: string;
  readonly budgetNote?: string;
  readonly timelineNote?: string;
  readonly consultationPreferenceRef?: string;
  readonly completeness: DiscoveryCompleteness;
  readonly missingFields?: readonly DiscoveryField[];
}

const needDiscoverySchema = z
  .object({
    serviceInterestRef: REFERENCE.optional(),
    locationRef: REFERENCE.optional(),
    propertyTypeRef: REFERENCE.optional(),
    scopeSummary: SUMMARY.optional(),
    budgetNote: NOTE.optional(),
    timelineNote: NOTE.optional(),
    consultationPreferenceRef: REFERENCE.optional(),
    completeness: z.enum(DISCOVERY_COMPLETENESS),
    missingFields: z.array(z.enum(DISCOVERY_FIELDS)).max(DISCOVERY_FIELDS.length).optional(),
  })
  .strict();

/**
 * Build a frozen need-discovery record.
 *
 * Throws `RiyaBehaviourError('invalid-need-discovery')` on any invalid or unknown field, on a
 * duplicated missing field, or on the one combination that would be a lie: claiming discovery is
 * sufficient for Core review while still listing fields as missing.
 */
export function createNeedDiscovery(input: NeedDiscoveryInput): NeedDiscovery {
  const parsed = needDiscoverySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBehaviourError('invalid-need-discovery');
  }
  const missing = parsed.data.missingFields ?? [];
  if (new Set(missing).size !== missing.length) {
    throw new RiyaBehaviourError('invalid-need-discovery');
  }
  if (parsed.data.completeness === 'SUFFICIENT_FOR_CORE_REVIEW' && missing.length > 0) {
    throw new RiyaBehaviourError('invalid-need-discovery');
  }
  return Object.freeze({
    behaviourVersion: 1 as const,
    serviceInterestRef: parsed.data.serviceInterestRef,
    locationRef: parsed.data.locationRef,
    propertyTypeRef: parsed.data.propertyTypeRef,
    scopeSummary: parsed.data.scopeSummary,
    budgetNote: parsed.data.budgetNote,
    timelineNote: parsed.data.timelineNote,
    consultationPreferenceRef: parsed.data.consultationPreferenceRef,
    completeness: parsed.data.completeness,
    missingFields: Object.freeze([...missing]),
  });
}
