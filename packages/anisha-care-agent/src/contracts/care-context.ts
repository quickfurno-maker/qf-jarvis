/**
 * The content-minimised CUSTOMER-CARE context snapshot.
 *
 * ### Opaque references and BANDS, never values
 *
 * The same discipline the vendor package holds, for the same reason. A care context that carried an
 * order total, a refund amount or a customer's contact details would put commercial and personal
 * data into a structure that travels toward a model boundary. What a care turn actually needs is
 * WHICH order and ROUGHLY how significant it is — an opaque reference and a band answer both.
 *
 * So: no money, no balances, no totals, no addresses, no phone numbers, no names, no free text.
 * A band is a closed token; a reference is an opaque bounded identifier this package never resolves.
 *
 * ### It is a SNAPSHOT, not a state machine
 *
 * Nothing here is mutated and nothing here is persisted. The care conversation's durable state is
 * owned elsewhere; this is what one turn was told, frozen.
 */
import { z } from 'zod';

/** A bounded, opaque identifier. Never a name, never a number with meaning, never free text. */
const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * How significant the matter is, as a BAND.
 *
 * Deliberately not an amount. "Is this a large order" is answerable without knowing that it is
 * ₹4,20,000, and the band cannot be de-anonymised back into a total.
 */
export const CARE_VALUE_BANDS = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type CareValueBand = (typeof CARE_VALUE_BANDS)[number];

/**
 * How long the matter has been open, as a BAND.
 *
 * Ageing changes how a care turn should be handled, and a band carries that without carrying a
 * timestamp that could be correlated against other records.
 */
export const CARE_AGE_BANDS = ['UNKNOWN', 'NEW', 'RECENT', 'AGEING', 'OVERDUE'] as const;
export type CareAgeBand = (typeof CARE_AGE_BANDS)[number];

/**
 * Where the underlying engagement has reached, as a closed token.
 *
 * A STATE THIS PACKAGE WAS TOLD, never one it decides. Care may explain where something is; moving
 * it is QuickFurno Core's.
 */
export const CARE_ENGAGEMENT_STAGES = [
  'UNKNOWN',
  'ORDER_PLACED',
  'IN_PRODUCTION',
  'SCHEDULED',
  'DELIVERED',
  'INSTALLED',
  'CLOSED',
] as const;
export type CareEngagementStage = (typeof CARE_ENGAGEMENT_STAGES)[number];

/** What one care turn was told about the matter it concerns. Frozen, opaque, banded. */
export interface CareContext {
  /** Which engagement this turn is about. Opaque; this package never resolves it. */
  readonly engagementRef?: string | undefined;
  /** Which open care matter, when one exists. Opaque. */
  readonly caseRef?: string | undefined;
  readonly stage?: CareEngagementStage | undefined;
  readonly valueBand?: CareValueBand | undefined;
  readonly ageBand?: CareAgeBand | undefined;
  /** Whether a care matter is already open. A boolean, never a count of them. */
  readonly hasOpenCase?: boolean | undefined;
  /** Whether this matter has already been escalated once. Repeat escalation reads differently. */
  readonly previouslyEscalated?: boolean | undefined;
}

export const careContextSchema = z
  .object({
    engagementRef: OPAQUE_REF.optional(),
    caseRef: OPAQUE_REF.optional(),
    stage: z.enum(CARE_ENGAGEMENT_STAGES).optional(),
    valueBand: z.enum(CARE_VALUE_BANDS).optional(),
    ageBand: z.enum(CARE_AGE_BANDS).optional(),
    hasOpenCase: z.boolean().optional(),
    previouslyEscalated: z.boolean().optional(),
  })
  .strict();

/**
 * Validate and FREEZE a care context, or reject it.
 *
 * `.strict()` is the point: an unknown key is refused rather than dropped. A caller that tried to
 * attach `orderTotal` or `customerPhone` gets an error, not a silently narrowed object — which is
 * the difference between a boundary and a convention.
 */
export function parseCareContext(value: unknown): CareContext | undefined {
  const parsed = careContextSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return Object.freeze({ ...parsed.data });
}
