/**
 * The ENRICHMENT CLAIM (AVG-2, ADR-0111).
 *
 * ### One sentence decides the whole file
 *
 * An enrichment fact is an UNTRUSTED, PROVENANCE-BOUND CLAIM. The overlay says enriched content is
 * "untrusted reference material — it never establishes consent, never proves identity, and never
 * grants eligibility to contact", and everything below exists so that sentence survives contact with
 * a caller who would like it to mean something stronger.
 *
 * "This business appears to be an interior designer in Pune" is legitimate review material. It must
 * never become "this is a verified QuickFurno vendor", "this party may be contacted", "this party
 * consented", "Core has no record of them" or "this identity is resolved". Those are QuickFurno
 * Core's facts, and a claim shaped so it could be mistaken for one would make this package a second
 * source of vendor truth — the exact failure AVG-1 was built to prevent.
 *
 * ### So the dangerous shapes have no field to occupy
 *
 * The attribute vocabulary is CLOSED, and there is deliberately no generic key/value map. A caller
 * cannot invent `phone`, `email`, `vendorId`, `registrationNumber`, `packageTier`, `consentStatus`,
 * `isActive`, `paymentStatus` or `leadEligibility`, because there is nowhere to put them: unknown
 * keys are refused rather than silently stripped, and an unlisted attribute is refused rather than
 * carried as free text.
 *
 * ### Presence attributes cannot hold a destination
 *
 * `WEBSITE_PRESENCE`, `PUBLIC_SOCIAL_PRESENCE` and `PORTFOLIO_SIGNAL` are typed as a two-member
 * signal, not as text. That is the difference between recording "a public presence was observed" and
 * recording a location something could be sent to. A URL to a public profile is a deliverable
 * coordinate in everything but name, and if the field accepted text somebody would eventually put
 * one there. It does not accept text, so they cannot.
 *
 * Label attributes are bounded text, and text is screened for contact SHAPES — an address, a
 * fetchable location, a dialable run of digits — so a phone number cannot arrive wearing a display
 * name. The screen is deliberately conservative: it will refuse some innocent strings, and refusing
 * a legitimate description is a smaller failure than storing a phone number Aarohi holds no consent
 * for.
 *
 * ### Evidence quality is not authority, and its own names say so
 *
 * Every member of the quality vocabulary begins with `UNVERIFIED_`. There is no `VERIFIED` level and
 * there must never be one: corroboration across sources is still corroboration across sources, and
 * a human typing something in is still a human typing something in. Nothing downstream may treat any
 * level as truth, and a spec proves the Core gate ignores it entirely.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage. `observedAt` is supplied by
 * the caller and validated, never read from a clock, so a replayed claim parses identically forever.
 */
import { z } from 'zod';

/** The AVG-2 contract version. Additive future versions get a new literal. */
export const AAROHI_ENRICHMENT_CONTRACT_VERSION = 1 as const;
export type AarohiEnrichmentContractVersion = typeof AAROHI_ENRICHMENT_CONTRACT_VERSION;

/**
 * A bounded, opaque identifier — same shape AVG-1 uses for its refs.
 *
 * The character class excludes `/`, `@` and whitespace, so a fetchable location or an address cannot
 * be spelled here at all. That is structural rather than advisory.
 */
const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** The longest a label may be. One bound for every text attribute, so there is one number to review. */
export const MAX_ENRICHMENT_LABEL_LENGTH = 240;

/**
 * What an enrichment claim may be ABOUT. Closed, conservative and review-oriented.
 *
 * Every member is something a human reviewer could sensibly read on a candidate profile. None of
 * them is a Core fact, a commercial fact, a consent fact or a destination.
 */
export const ENRICHMENT_ATTRIBUTES = [
  'BUSINESS_DISPLAY_NAME',
  'BUSINESS_CATEGORY_LABEL',
  'SERVICE_LABEL',
  'CITY_LABEL',
  'LOCALITY_LABEL',
  'BUSINESS_DESCRIPTION',
  'WEBSITE_PRESENCE',
  'PUBLIC_SOCIAL_PRESENCE',
  'PORTFOLIO_SIGNAL',
] as const;
export type EnrichmentAttribute = (typeof ENRICHMENT_ATTRIBUTES)[number];

/** How an attribute's value is carried. */
export const ENRICHMENT_VALUE_KINDS = ['LABEL_TEXT', 'PRESENCE_SIGNAL'] as const;
export type EnrichmentValueKind = (typeof ENRICHMENT_VALUE_KINDS)[number];

/**
 * The value kind of every attribute.
 *
 * TOTAL by type, for the reason AVG-1's status role map is: an attribute added without a decision
 * does not compile. The failure mode this prevents is a new presence-shaped attribute defaulting to
 * free text and quietly becoming somewhere to put a link.
 */
export const ENRICHMENT_ATTRIBUTE_VALUE_KIND: Readonly<
  Record<EnrichmentAttribute, EnrichmentValueKind>
> = Object.freeze({
  BUSINESS_DISPLAY_NAME: 'LABEL_TEXT',
  BUSINESS_CATEGORY_LABEL: 'LABEL_TEXT',
  SERVICE_LABEL: 'LABEL_TEXT',
  CITY_LABEL: 'LABEL_TEXT',
  LOCALITY_LABEL: 'LABEL_TEXT',
  BUSINESS_DESCRIPTION: 'LABEL_TEXT',

  // Presence, never a place. These three record THAT something public was observed, never where.
  WEBSITE_PRESENCE: 'PRESENCE_SIGNAL',
  PUBLIC_SOCIAL_PRESENCE: 'PRESENCE_SIGNAL',
  PORTFOLIO_SIGNAL: 'PRESENCE_SIGNAL',
});

/** The only values a presence attribute may take. Two members, and neither is a destination. */
export const PRESENCE_SIGNALS = ['OBSERVED', 'NOT_OBSERVED'] as const;
export type PresenceSignal = (typeof PRESENCE_SIGNALS)[number];

/**
 * Where a CLAIM came from.
 *
 * Deliberately its own vocabulary rather than AVG-1's `PROSPECT_DISCOVERY_SOURCES`. "Where the
 * prospect was first noticed" and "where this particular claim came from" are different facts, and
 * forcing one label to carry both would make the first one wrong the moment a second source
 * contributed anything.
 *
 * It is evidence, not authority:
 *
 * - source existence is not identity proof;
 * - source visibility is not consent;
 * - source confidence is not Core truth;
 * - source recurrence is not permission;
 * - a public profile is not a registration status.
 */
export const ENRICHMENT_SOURCE_KINDS = [
  'MANUAL_REVIEW',
  'PUBLIC_DIRECTORY',
  'PUBLIC_WEBSITE',
  'PUBLIC_SOCIAL_PROFILE',
  'INBOUND_UNSOLICITED',
  'PARTNER_REFERRAL',
  'UNKNOWN',
] as const;
export type EnrichmentSourceKind = (typeof ENRICHMENT_SOURCE_KINDS)[number];

/**
 * How good the evidence is, and nothing about whether it is TRUE.
 *
 * Every member begins with `UNVERIFIED_` on purpose. A spec asserts that prefix over the whole
 * vocabulary, so a future `VERIFIED_` level cannot be added without the assertion failing and
 * somebody having to argue for it in review.
 */
export const ENRICHMENT_EVIDENCE_QUALITIES = [
  'UNVERIFIED_SINGLE_SOURCE',
  'UNVERIFIED_CORROBORATED',
  'UNVERIFIED_OPERATOR_ENTERED',
] as const;
export type EnrichmentEvidenceQuality = (typeof ENRICHMENT_EVIDENCE_QUALITIES)[number];

/**
 * Shapes a label may not contain.
 *
 * Named by SHAPE rather than by platform, so no channel name appears in this package and no future
 * channel is missed by omission. The screen is conservative by design.
 */
const CONTACT_SHAPES: readonly RegExp[] = Object.freeze([
  // An address.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u,
  // A fetchable location, with or without a scheme.
  /(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\//u,
  /\bwww\./iu,
  // A dialable run: seven or more digits, however they are spaced.
  /(?:\d[\s().+-]{0,2}){7,}/u,
]);

function hasContactShape(text: string): boolean {
  return CONTACT_SHAPES.some((one) => one.test(text));
}

/** A bounded label that carries no contact shape. */
const LABEL_TEXT = z
  .string()
  .min(1)
  .max(MAX_ENRICHMENT_LABEL_LENGTH)
  .refine((one) => !hasContactShape(one));

/**
 * Where the claim came from. `sourceRef` is opaque and optional.
 *
 * It is screened with the same contact shapes as a label, because the opaque character class alone
 * would still admit a bare run of digits.
 */
export interface EnrichmentSource {
  readonly kind: EnrichmentSourceKind;
  readonly sourceRef?: string | undefined;
}

export const enrichmentSourceSchema = z
  .object({
    kind: z.enum(ENRICHMENT_SOURCE_KINDS),
    sourceRef: OPAQUE_REF.refine((one) => !hasContactShape(one)).optional(),
  })
  .strict();

/** An ISO-8601 UTC instant, supplied by the caller. No clock is read here, ever. */
const OBSERVED_AT = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u)
  .refine((one) => !Number.isNaN(new Date(one).getTime()));

/**
 * ONE observed claim about ONE prospect.
 *
 * The value type follows the attribute: a presence attribute takes a signal, a label attribute takes
 * bounded screened text. There is no third option and no escape hatch.
 */
export interface EnrichmentClaim {
  readonly contractVersion: AarohiEnrichmentContractVersion;
  readonly prospectRef: string;
  readonly attribute: EnrichmentAttribute;
  readonly valueKind: EnrichmentValueKind;
  /** A `PresenceSignal` when the attribute is a presence one; screened label text otherwise. */
  readonly value: string;
  readonly source: EnrichmentSource;
  readonly observedAt: string;
  readonly evidenceQuality: EnrichmentEvidenceQuality;
}

/**
 * Whether a value is legal FOR ITS ATTRIBUTE. The one rule, in one place.
 *
 * Both the builder and the canonical schema call this, so they cannot disagree about what a claim
 * is. The first revision of this file expressed the rule only inside the builder and left the
 * exported schema accepting any bounded string -- which meant the public contract certified a social
 * URL under `PUBLIC_SOCIAL_PRESENCE` and a phone number under `BUSINESS_DESCRIPTION` that the
 * builder refused seconds later. A contract that says two things depending on which half you read
 * is not a contract.
 */
function isValueLegalForAttribute(attribute: EnrichmentAttribute, value: string): boolean {
  return ENRICHMENT_ATTRIBUTE_VALUE_KIND[attribute] === 'PRESENCE_SIGNAL'
    ? (PRESENCE_SIGNALS as readonly string[]).includes(value)
    : LABEL_TEXT.safeParse(value).success;
}

/**
 * The INPUT a caller hands to {@link createEnrichmentClaim}.
 *
 * PRIVATE on purpose. Exporting an input schema beside a built-claim schema is what produced the
 * disagreement above: two public shapes, both looking canonical, agreeing on most values and
 * differing on exactly the dangerous ones. `enrichmentClaimSchema` below is the ONE public canonical
 * schema, and it describes a BUILT claim.
 *
 * `contractVersion` and `valueKind` are absent here because the builder DERIVES them. A caller that
 * could supply them could supply a claim whose `valueKind` disagreed with its attribute.
 */
const claimInputSchema = z
  .object({
    prospectRef: OPAQUE_REF,
    attribute: z.enum(ENRICHMENT_ATTRIBUTES),
    value: z.string().min(1).max(MAX_ENRICHMENT_LABEL_LENGTH),
    source: enrichmentSourceSchema,
    observedAt: OBSERVED_AT,
    evidenceQuality: z.enum(ENRICHMENT_EVIDENCE_QUALITIES),
  })
  .strict();

/**
 * The CANONICAL public schema for a BUILT `EnrichmentClaim`.
 *
 * It certifies exactly what `createEnrichmentClaim` produces and refuses exactly what that builder
 * refuses:
 *
 * - the contract version must be the canonical literal, so an unversioned or foreign object fails;
 * - `valueKind` must be the kind the attribute actually has, so it cannot be forged to unlock the
 *   wrong value rules;
 * - the value must be legal for its attribute -- a presence signal for a presence attribute, a
 *   bounded contact-screened label otherwise.
 *
 * This is what makes a claim reaching the profile parser trustworthy without the profile having to
 * re-derive any of it.
 */
export const enrichmentClaimSchema = z
  .object({
    contractVersion: z.literal(AAROHI_ENRICHMENT_CONTRACT_VERSION),
    prospectRef: OPAQUE_REF,
    attribute: z.enum(ENRICHMENT_ATTRIBUTES),
    valueKind: z.enum(ENRICHMENT_VALUE_KINDS),
    value: z.string().min(1).max(MAX_ENRICHMENT_LABEL_LENGTH),
    source: enrichmentSourceSchema,
    observedAt: OBSERVED_AT,
    evidenceQuality: z.enum(ENRICHMENT_EVIDENCE_QUALITIES),
  })
  .strict()
  .refine((claim) => claim.valueKind === ENRICHMENT_ATTRIBUTE_VALUE_KIND[claim.attribute])
  .refine((claim) => isValueLegalForAttribute(claim.attribute, claim.value));

/** Why a claim was refused. Closed, and never an echo of the value that failed. */
export const ENRICHMENT_CLAIM_REFUSALS = [
  /** The object did not parse: unknown key, missing field, unlisted attribute, bad instant. */
  'CLAIM_SHAPE_INVALID',
  /** A presence attribute was given something other than a presence signal. */
  'PRESENCE_VALUE_INVALID',
  /** A label carried an address, a fetchable location or a dialable run. */
  'LABEL_VALUE_REFUSED',
] as const;
export type EnrichmentClaimRefusal = (typeof ENRICHMENT_CLAIM_REFUSALS)[number];

export type EnrichmentClaimResult =
  | { readonly ok: true; readonly claim: EnrichmentClaim }
  | { readonly ok: false; readonly refusal: EnrichmentClaimRefusal };

/**
 * Assemble the frozen claim from already-validated parts.
 *
 * Every field is copied by value and both levels are frozen, so nothing a caller still holds a
 * reference to can reach into a claim afterwards. Used by the builder AND by
 * {@link parseEnrichmentClaim}, so a parsed claim and a built claim are the same object shape by
 * construction rather than by two functions agreeing.
 */
function freezeClaim(parts: {
  readonly prospectRef: string;
  readonly attribute: EnrichmentAttribute;
  readonly value: string;
  readonly source: { readonly kind: EnrichmentSourceKind; readonly sourceRef?: string | undefined };
  readonly observedAt: string;
  readonly evidenceQuality: EnrichmentEvidenceQuality;
}): EnrichmentClaim {
  return Object.freeze({
    contractVersion: AAROHI_ENRICHMENT_CONTRACT_VERSION,
    prospectRef: parts.prospectRef,
    attribute: parts.attribute,
    valueKind: ENRICHMENT_ATTRIBUTE_VALUE_KIND[parts.attribute],
    value: parts.value,
    source: Object.freeze({
      kind: parts.source.kind,
      ...(parts.source.sourceRef === undefined ? {} : { sourceRef: parts.source.sourceRef }),
    }),
    observedAt: parts.observedAt,
    evidenceQuality: parts.evidenceQuality,
  });
}

/**
 * Build a frozen claim from caller INPUT, or refuse.
 *
 * Refusals are closed tokens and carry nothing from the input — a refusal that quoted the value
 * would put the very content this contract screens for into whatever read the refusal. The two
 * value refusals stay distinct because they point at different mistakes: a presence attribute given
 * a destination, and a label carrying a contact shape.
 */
export function createEnrichmentClaim(value: unknown): EnrichmentClaimResult {
  const parsed = claimInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'CLAIM_SHAPE_INVALID' as const });
  }

  const attribute = parsed.data.attribute;
  const valueKind = ENRICHMENT_ATTRIBUTE_VALUE_KIND[attribute];

  if (valueKind === 'PRESENCE_SIGNAL') {
    // A presence attribute records THAT something was observed. It has no room for where.
    if (!(PRESENCE_SIGNALS as readonly string[]).includes(parsed.data.value)) {
      return Object.freeze({ ok: false as const, refusal: 'PRESENCE_VALUE_INVALID' as const });
    }
  } else if (!LABEL_TEXT.safeParse(parsed.data.value).success) {
    return Object.freeze({ ok: false as const, refusal: 'LABEL_VALUE_REFUSED' as const });
  }

  return Object.freeze({ ok: true as const, claim: freezeClaim(parsed.data) });
}

/**
 * Re-parse an ALREADY-BUILT claim and return a fresh frozen copy, or `undefined`.
 *
 * This is what lets a profile stop trusting its own TypeScript types. A caller can hand
 * `createEnrichmentProfile` a plain object that merely LOOKS like a claim — TypeScript is erased at
 * runtime and says nothing about what actually arrives — so every claim is re-validated here against
 * the canonical schema and rebuilt from the parsed data.
 *
 * The rebuild matters as much as the validation: the returned claim shares no object identity with
 * the caller's, so mutating the original afterwards cannot reach into a profile that was already
 * assembled.
 */
export function parseEnrichmentClaim(value: unknown): EnrichmentClaim | undefined {
  const parsed = enrichmentClaimSchema.safeParse(value);
  return parsed.success ? freezeClaim(parsed.data) : undefined;
}

/**
 * A total, stable identity for one claim — every field, in a fixed order.
 *
 * Used to collapse claims that are identical in every respect. Two claims that agree on a value but
 * came from different sources have DIFFERENT identities and both survive, because corroboration
 * across sources is evidence and collapsing it would destroy the only thing that made it evidence.
 */
export function enrichmentClaimIdentity(claim: EnrichmentClaim): string {
  return [
    claim.prospectRef,
    claim.attribute,
    claim.valueKind,
    claim.value,
    claim.source.kind,
    claim.source.sourceRef ?? '',
    claim.observedAt,
    claim.evidenceQuality,
  ].join(' ');
}
