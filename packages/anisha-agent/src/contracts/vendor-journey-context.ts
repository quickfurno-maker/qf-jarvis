/**
 * The vendor-journey context snapshot (QFJ-S3-D-A, ADR-0070).
 *
 * What Anisha knows about where a vendor stands, expressed so it cannot become a second vendor
 * profile. QuickFurno Core owns the vendor; this record is a bounded, content-minimised SNAPSHOT of
 * REFERENCES to Core-owned state, and it accompanies a decision so Core can review it.
 *
 * Three deliberate omissions.
 *
 * No vendor identity. No name, phone, email or address — the inbound envelope and Core already carry
 * identity, and duplicating it here would create a second place erasure has to reach.
 *
 * No money. `packageReadinessBand` is a BAND, and the authority matrix is explicit that Jarvis holds
 * no balance, deducts nothing, refunds nothing and records no payment. A balance, price, credit count,
 * package cost, payment status or subscription object has no field to sit in — which is a stronger
 * guarantee than a rule saying not to put one there.
 *
 * No documents or profile content. Verification is a Core decision; this record can say a verification
 * status reference exists, never what it decided or what evidence produced it.
 *
 * Stage, onboarding step and verification status are OPAQUE REFERENCES, not enums, for the same reason
 * Riya's catalogue fields are: the vocabulary belongs to Core and changes on a business cadence.
 */
import { z } from 'zod';

import { AnishaBehaviourError } from './errors.js';
import { PACKAGE_READINESS_BANDS } from './vendor-journey-intent.js';
import type { PackageReadinessBand } from './vendor-journey-intent.js';

/** A bounded opaque reference into a QuickFurno-owned vocabulary. Identifier characters only. */
const REFERENCE = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * How complete the context is, and therefore what may follow.
 *
 * This is the field that decides whether a Core-reviewed follow-up may even be requested, so it is a
 * closed enum rather than a derived boolean.
 */
export const VENDOR_JOURNEY_CONTEXT_COMPLETENESS = [
  /** Enough is known for QuickFurno Core to review a vendor follow-up. */
  'SUFFICIENT_FOR_CORE_REVIEW',
  /** More context is required before anything is proposed. */
  'MORE_CONTEXT_REQUIRED',
  /** A person must look at this before it goes further. */
  'HUMAN_REVIEW_REQUIRED',
] as const;
export type VendorJourneyContextCompleteness = (typeof VENDOR_JOURNEY_CONTEXT_COMPLETENESS)[number];

export const VENDOR_JOURNEY_CONTEXT_COMPLETENESS_FROZEN: readonly VendorJourneyContextCompleteness[] =
  Object.freeze([...VENDOR_JOURNEY_CONTEXT_COMPLETENESS]);

/** The context fields Anisha may record as still missing. Closed, so no free-form key can appear. */
export const VENDOR_JOURNEY_CONTEXT_FIELDS = [
  'VENDOR_STAGE',
  'ONBOARDING_STEP',
  'VERIFICATION_STATUS',
  'PACKAGE_READINESS',
] as const;
export type VendorJourneyContextField = (typeof VENDOR_JOURNEY_CONTEXT_FIELDS)[number];

export const VENDOR_JOURNEY_CONTEXT_FIELDS_FROZEN: readonly VendorJourneyContextField[] =
  Object.freeze([...VENDOR_JOURNEY_CONTEXT_FIELDS]);

/** A frozen, content-minimised vendor-journey snapshot. */
export interface VendorJourneyContext {
  readonly behaviourVersion: 1;
  readonly vendorStageRef: string | undefined;
  readonly onboardingStepRef: string | undefined;
  readonly verificationStatusRef: string | undefined;
  readonly packageReadinessBand: PackageReadinessBand | undefined;
  readonly completeness: VendorJourneyContextCompleteness;
  readonly missingFields: readonly VendorJourneyContextField[];
}

export interface VendorJourneyContextInput {
  readonly vendorStageRef?: string;
  readonly onboardingStepRef?: string;
  readonly verificationStatusRef?: string;
  readonly packageReadinessBand?: PackageReadinessBand;
  readonly completeness: VendorJourneyContextCompleteness;
  readonly missingFields?: readonly VendorJourneyContextField[];
}

const contextSchema = z
  .object({
    vendorStageRef: REFERENCE.optional(),
    onboardingStepRef: REFERENCE.optional(),
    verificationStatusRef: REFERENCE.optional(),
    packageReadinessBand: z.enum(PACKAGE_READINESS_BANDS).optional(),
    completeness: z.enum(VENDOR_JOURNEY_CONTEXT_COMPLETENESS),
    missingFields: z
      .array(z.enum(VENDOR_JOURNEY_CONTEXT_FIELDS))
      .max(VENDOR_JOURNEY_CONTEXT_FIELDS.length)
      .optional(),
  })
  .strict();

/** Which supplied value each closed field name refers to, so "missing" and "present" can be compared. */
const PRESENCE_BY_FIELD: Readonly<
  Record<VendorJourneyContextField, keyof VendorJourneyContextInput>
> = Object.freeze({
  VENDOR_STAGE: 'vendorStageRef',
  ONBOARDING_STEP: 'onboardingStepRef',
  VERIFICATION_STATUS: 'verificationStatusRef',
  PACKAGE_READINESS: 'packageReadinessBand',
});

/**
 * Build a frozen vendor-journey context.
 *
 * Throws `AnishaBehaviourError('invalid-vendor-journey-context')` on any invalid or unknown field, a
 * duplicated missing field, or a contradiction:
 *
 * - `SUFFICIENT_FOR_CORE_REVIEW` while fields are still listed missing — the one combination that
 *   would be a lie, because it invites Core to review a snapshot that admits it is incomplete;
 * - `MORE_CONTEXT_REQUIRED` with nothing listed missing — a claim with no content;
 * - a field listed as missing whose value was nonetheless supplied — the record disagreeing with
 *   itself, which is worse than either answer alone.
 *
 * `HUMAN_REVIEW_REQUIRED` deliberately permits any number of missing fields: a person may need to look
 * precisely because the picture is complete and still wrong.
 *
 * An absent field need NOT be listed missing. Relevance depends on the intent — a routine question
 * does not need an onboarding step — and forcing exhaustive listing would turn the snapshot into a
 * checklist of everything Core knows.
 */
export function createVendorJourneyContext(input: VendorJourneyContextInput): VendorJourneyContext {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) {
    throw new AnishaBehaviourError('invalid-vendor-journey-context');
  }
  const data = parsed.data;
  const missing = data.missingFields ?? [];

  if (new Set(missing).size !== missing.length) {
    throw new AnishaBehaviourError('invalid-vendor-journey-context');
  }
  if (data.completeness === 'SUFFICIENT_FOR_CORE_REVIEW' && missing.length > 0) {
    throw new AnishaBehaviourError('invalid-vendor-journey-context');
  }
  if (data.completeness === 'MORE_CONTEXT_REQUIRED' && missing.length === 0) {
    throw new AnishaBehaviourError('invalid-vendor-journey-context');
  }
  for (const field of missing) {
    if (data[PRESENCE_BY_FIELD[field]] !== undefined) {
      throw new AnishaBehaviourError('invalid-vendor-journey-context');
    }
  }

  return Object.freeze({
    behaviourVersion: 1 as const,
    vendorStageRef: data.vendorStageRef,
    onboardingStepRef: data.onboardingStepRef,
    verificationStatusRef: data.verificationStatusRef,
    packageReadinessBand: data.packageReadinessBand,
    completeness: data.completeness,
    missingFields: Object.freeze([...missing]),
  });
}
