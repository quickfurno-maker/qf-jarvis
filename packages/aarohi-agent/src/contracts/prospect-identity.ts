/**
 * The Jarvis-side PROSPECT identity (AVG-1, ADR-0085).
 *
 * ### A prospect is explicitly NOT a vendor
 *
 * That sentence is the whole contract. The overlay states it in those words: no prospect record may
 * shadow, pre-empt or become a second source of vendor truth, and QuickFurno Core remains
 * authoritative the moment a party is registered.
 *
 * So this identity is deliberately built so it CANNOT be mistaken for one. It carries no Core vendor
 * id, no registration number, no activation state and no commercial fact. It is an opaque handle for
 * "a business Aarohi is considering approaching", and the moment Core says that business is
 * registered, this handle stops being the thing anyone should be reasoning about.
 *
 * ### Why there is no contact detail here
 *
 * A domain contract that carried a phone number or an email would be a copy of exactly the data Core
 * owns consent for, sitting in a package that holds no consent authority. Aarohi holds no consent,
 * opt-out, suppression, STOP or do-not-contact authority and stores no copy of one — so the shape
 * that would invite a suppression decision to be made here does not exist.
 *
 * Reaching a business is an execution concern, and execution goes Core/human -> n8n -> provider.
 *
 * ### Frozen, strict, opaque
 *
 * Unknown keys are refused rather than dropped. A caller that tried to attach `vendorId`,
 * `phone` or `isActive` gets an error, not a silently narrowed object.
 */
import { z } from 'zod';

/** The governed agent id this package speaks as, matching the control-plane roster (ADR-0085). */
export const AAROHI_AGENT_ID = 'aarohi' as const;

/** The AVG-1 contract version. Additive future versions get a new literal. */
export const AAROHI_PROSPECT_CONTRACT_VERSION = 1 as const;
export type AarohiProspectContractVersion = typeof AAROHI_PROSPECT_CONTRACT_VERSION;

/** A bounded, opaque identifier. Never a name, never a contact detail, never a Core vendor id. */
const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * Where a candidate business was first noticed.
 *
 * A PROVENANCE label, and nothing more. It never establishes consent, never proves identity and
 * never grants eligibility to contact — the overlay says exactly that of enriched material at AVG-2,
 * and the same rule binds the weaker fact of where something was seen.
 */
export const PROSPECT_DISCOVERY_SOURCES = [
  'UNKNOWN',
  'MANUAL_ENTRY',
  'PUBLIC_DIRECTORY',
  'PUBLIC_SOCIAL_PROFILE',
  'INBOUND_UNSOLICITED',
  'PARTNER_REFERRAL',
] as const;
export type ProspectDiscoverySource = (typeof PROSPECT_DISCOVERY_SOURCES)[number];

/**
 * A Jarvis-side prospect reference.
 *
 * `prospectRef` is Aarohi's own opaque handle. `coreLookupRef` is the opaque token a Core
 * existing-vendor lookup was performed under — it is NOT a vendor id and does not become one: it
 * exists so an eligibility observation can be tied to the lookup that produced it, and so a stale
 * observation cannot be silently reused for a different prospect.
 */
export interface ProspectIdentity {
  readonly contractVersion: AarohiProspectContractVersion;
  readonly prospectRef: string;
  readonly coreLookupRef?: string | undefined;
  readonly discoverySource: ProspectDiscoverySource;
}

export const prospectIdentitySchema = z
  .object({
    prospectRef: OPAQUE_REF,
    coreLookupRef: OPAQUE_REF.optional(),
    discoverySource: z.enum(PROSPECT_DISCOVERY_SOURCES),
  })
  .strict();

/**
 * Build a frozen prospect identity, or refuse.
 *
 * Returns `undefined` rather than throwing on invalid input, so a caller cannot accidentally treat a
 * partially-built identity as usable — there is no partially-built identity.
 */
export function createProspectIdentity(value: unknown): ProspectIdentity | undefined {
  const parsed = prospectIdentitySchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return Object.freeze({
    contractVersion: AAROHI_PROSPECT_CONTRACT_VERSION,
    prospectRef: parsed.data.prospectRef,
    ...(parsed.data.coreLookupRef === undefined
      ? {}
      : { coreLookupRef: parsed.data.coreLookupRef }),
    discoverySource: parsed.data.discoverySource,
  });
}
