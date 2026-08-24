/**
 * The ENRICHMENT PROFILE (AVG-2, ADR-0111).
 *
 * ### A review artifact, and only that
 *
 * A profile is the set of untrusted claims gathered about ONE prospect, arranged so a human can read
 * them. It is not a vendor record, not a resolved identity, not a lead, and not a permission. It
 * carries no Core fact, no commercial fact, no consent fact and no destination, because the claims
 * it holds cannot carry those either.
 *
 * ### Agreement is not truth
 *
 * The single most tempting mistake in this slice is to let sources vote. If two directories agree
 * that a business is in Kharadi and one says Viman Nagar, a "resolver" would pick Kharadi and
 * produce something that looks like a fact and is not one. Aarohi has no authority to resolve
 * identity — AVG-6 owns omnichannel identity resolution — so this file deliberately does NOT
 * resolve. It REPORTS.
 *
 * `summariseEnrichmentConsistency` says whether an attribute's claims agree, disagree or are absent,
 * and a disagreement stays visible with every value intact. Nothing overwrites, nothing wins on
 * confidence, and nothing wins on array order.
 *
 * ### Order cannot change an answer
 *
 * Claims are canonically ordered on the way in and the summary sorts everything it groups, so the
 * same evidence in any sequence produces the same profile and the same verdict. A conflict detector
 * whose answer depended on input order would be a coin flip wearing a verdict's name.
 *
 * ### Deduplication collapses only what is identical in every field
 *
 * Two claims from different sources agreeing on a value are two pieces of evidence and both survive.
 * Only a claim repeated with the same attribute, value, source, instant and evidence quality is
 * collapsed — that is a duplicate submission, not corroboration.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage, no mutation of input.
 */
import { z } from 'zod';

import {
  AAROHI_ENRICHMENT_CONTRACT_VERSION,
  ENRICHMENT_ATTRIBUTES,
  enrichmentClaimIdentity,
  enrichmentClaimSchema,
  parseEnrichmentClaim,
} from './enrichment-claim.js';
import type {
  AarohiEnrichmentContractVersion,
  EnrichmentAttribute,
  EnrichmentClaim,
} from './enrichment-claim.js';

/** The most claims one profile may hold. Bounded, like every array in this package. */
export const MAX_ENRICHMENT_PROFILE_CLAIMS = 64;

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/**
 * The enrichment gathered for ONE prospect.
 *
 * Deliberately just a binding and a bounded, ordered claim list. There is no freeform note field:
 * a profile-level text box is precisely where an unbounded, unscreened, authority-shaped assertion
 * would end up, and nothing in AVG-2 needs one.
 */
export interface EnrichmentProfile {
  readonly contractVersion: AarohiEnrichmentContractVersion;
  readonly prospectRef: string;
  readonly claims: readonly EnrichmentClaim[];
}

/** Why a profile was refused. Closed, and content-free. */
export const ENRICHMENT_PROFILE_REFUSALS = [
  /** The prospect reference did not parse. */
  'PROSPECT_REF_INVALID',
  /**
   * A supplied claim is not a canonical AVG-2 claim.
   *
   * Distinct from the mismatch below because they are different mistakes: this one says the object
   * was never a claim, that one says it is a real claim about somebody else.
   */
  'CLAIM_INVALID',
  /** A claim belongs to a different prospect. Never silently repaired, never dropped. */
  'CLAIM_PROSPECT_MISMATCH',
  /** More claims than one profile may hold. */
  'CLAIM_LIMIT_EXCEEDED',
] as const;
export type EnrichmentProfileRefusal = (typeof ENRICHMENT_PROFILE_REFUSALS)[number];

export type EnrichmentProfileResult =
  | { readonly ok: true; readonly profile: EnrichmentProfile }
  | { readonly ok: false; readonly refusal: EnrichmentProfileRefusal };

const ATTRIBUTE_ORDER: Readonly<Record<EnrichmentAttribute, number>> = Object.freeze(
  Object.fromEntries(ENRICHMENT_ATTRIBUTES.map((one, index) => [one, index])) as Record<
    EnrichmentAttribute,
    number
  >,
);

/** Canonical order: attribute vocabulary order first, then the total claim identity. */
function compareClaims(a: EnrichmentClaim, b: EnrichmentClaim): number {
  const byAttribute = ATTRIBUTE_ORDER[a.attribute] - ATTRIBUTE_ORDER[b.attribute];
  if (byAttribute !== 0) {
    return byAttribute;
  }
  const left = enrichmentClaimIdentity(a);
  const right = enrichmentClaimIdentity(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Assemble a frozen profile, or refuse.
 *
 * A claim for another prospect is a refusal rather than a filtered-out row: dropping it would let a
 * caller submit a mixed batch and receive a profile that looked complete while silently holding less
 * than was handed in.
 */
export function createEnrichmentProfile(
  prospectRef: unknown,
  claims: readonly unknown[],
): EnrichmentProfileResult {
  const parsedRef = OPAQUE_REF.safeParse(prospectRef);
  if (!parsedRef.success) {
    return Object.freeze({ ok: false as const, refusal: 'PROSPECT_REF_INVALID' as const });
  }
  if (claims.length > MAX_ENRICHMENT_PROFILE_CLAIMS) {
    return Object.freeze({ ok: false as const, refusal: 'CLAIM_LIMIT_EXCEEDED' as const });
  }

  // RE-PARSE every claim rather than trusting the declared type. TypeScript is erased at runtime and
  // says nothing about what actually arrives, so a plain object that merely LOOKS like a claim --
  // carrying a contact-bearing label, a forged `valueKind`, a missing contract version or a
  // destination under a presence attribute -- would otherwise walk straight into a profile.
  //
  // Parsing also REBUILDS: the claims kept below share no object identity with the caller's, so a
  // later mutation of an original claim or its source cannot reach into an assembled profile.
  const validated: EnrichmentClaim[] = [];
  for (const candidate of claims) {
    const claim = parseEnrichmentClaim(candidate);
    if (claim === undefined) {
      return Object.freeze({ ok: false as const, refusal: 'CLAIM_INVALID' as const });
    }
    if (claim.prospectRef !== parsedRef.data) {
      return Object.freeze({ ok: false as const, refusal: 'CLAIM_PROSPECT_MISMATCH' as const });
    }
    validated.push(claim);
  }

  // Collapse only claims identical in EVERY field. Same value from a different source survives.
  const seen = new Set<string>();
  const unique: EnrichmentClaim[] = [];
  for (const claim of validated) {
    const identity = enrichmentClaimIdentity(claim);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    unique.push(claim);
  }
  // Sorted on a copy; the caller's array is never reordered.
  unique.sort(compareClaims);

  return Object.freeze({
    ok: true as const,
    profile: Object.freeze({
      contractVersion: AAROHI_ENRICHMENT_CONTRACT_VERSION,
      prospectRef: parsedRef.data,
      claims: Object.freeze(unique),
    }),
  });
}

/**
 * The CANONICAL public schema for a BUILT `EnrichmentProfile`.
 *
 * This is the boundary that stops a forged object being treated as review material. Before it
 * existed, the review gate asked only "is this an object with a string `prospectRef` and an array
 * called `claims`?" — which `{ prospectRef: 'x', claims: [] }` satisfies, and so does the same shape
 * carrying claims that were never canonical.
 *
 * Every part is proved: the contract version literal, the reference, the array bound, each claim
 * against the canonical claim schema, and the binding that every claim names THIS prospect.
 */
export const enrichmentProfileSchema = z
  .object({
    contractVersion: z.literal(AAROHI_ENRICHMENT_CONTRACT_VERSION),
    prospectRef: OPAQUE_REF,
    claims: z.array(enrichmentClaimSchema).max(MAX_ENRICHMENT_PROFILE_CLAIMS),
  })
  .strict()
  .refine((profile) => profile.claims.every((one) => one.prospectRef === profile.prospectRef));

/**
 * Re-parse an ALREADY-BUILT profile and return a fresh frozen copy, or `undefined`.
 *
 * Claims are rebuilt through {@link parseEnrichmentClaim}, so the returned profile shares no object
 * identity with the input at any level. Ordering is left exactly as parsed: a canonical profile is
 * already canonically ordered, and re-sorting here would hide a caller who had reordered one.
 */
export function parseEnrichmentProfile(value: unknown): EnrichmentProfile | undefined {
  const parsed = enrichmentProfileSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const claims: EnrichmentClaim[] = [];
  for (const candidate of parsed.data.claims) {
    const claim = parseEnrichmentClaim(candidate);
    if (claim === undefined) {
      return undefined;
    }
    claims.push(claim);
  }
  return Object.freeze({
    contractVersion: AAROHI_ENRICHMENT_CONTRACT_VERSION,
    prospectRef: parsed.data.prospectRef,
    claims: Object.freeze(claims),
  });
}

/** What the evidence for one attribute amounts to. Never a resolved value. */
export const ENRICHMENT_CONSISTENCY_VERDICTS = [
  /** Claims exist and every one carries the same value. Agreement, not proof. */
  'CONSISTENT',
  /** Two or more distinct values. Both are kept; neither is chosen. */
  'CONFLICTING',
  /** No claim was made about this attribute. */
  'INSUFFICIENT',
] as const;
export type EnrichmentConsistencyVerdict = (typeof ENRICHMENT_CONSISTENCY_VERDICTS)[number];

/**
 * One attribute's evidence.
 *
 * `distinctValues` is sorted and complete: a reviewer looking at a `CONFLICTING` attribute can see
 * exactly what disagrees. `claimCount` is the number of surviving pieces of evidence, so two sources
 * agreeing reads differently from one source repeating itself.
 */
export interface EnrichmentAttributeSummary {
  readonly attribute: EnrichmentAttribute;
  readonly verdict: EnrichmentConsistencyVerdict;
  readonly claimCount: number;
  readonly distinctValues: readonly string[];
}

/**
 * The whole profile's evidence, per attribute and overall.
 *
 * `overall` is `INSUFFICIENT` when nothing was claimed at all, `CONFLICTING` when any attribute
 * disagrees, and `CONSISTENT` otherwise. It is REVIEW MATERIAL: it does not gate anything, and
 * `evaluateEnrichmentReviewReadiness` deliberately never consults it.
 */
export interface EnrichmentConsistencySummary {
  readonly prospectRef: string;
  readonly overall: EnrichmentConsistencyVerdict;
  readonly attributes: readonly EnrichmentAttributeSummary[];
  readonly conflictingAttributes: readonly EnrichmentAttribute[];
}

/**
 * Report what the evidence says, without deciding what is true.
 *
 * Deterministic and order-independent: attributes are walked in vocabulary order and values are
 * sorted, so shuffling the input cannot change a verdict. Evidence quality is not read at all —
 * a `UNVERIFIED_CORROBORATED` claim does not outrank a `UNVERIFIED_SINGLE_SOURCE` one, because
 * outranking is how a conflict would quietly become a fact.
 */
export function summariseEnrichmentConsistency(
  profile: EnrichmentProfile,
): EnrichmentConsistencySummary {
  const attributes: EnrichmentAttributeSummary[] = [];
  const conflicting: EnrichmentAttribute[] = [];
  let anyClaim = false;

  for (const attribute of ENRICHMENT_ATTRIBUTES) {
    const forAttribute = profile.claims.filter((one) => one.attribute === attribute);
    const distinct = [...new Set(forAttribute.map((one) => one.value))].sort();
    const verdict: EnrichmentConsistencyVerdict =
      distinct.length === 0 ? 'INSUFFICIENT' : distinct.length === 1 ? 'CONSISTENT' : 'CONFLICTING';
    if (forAttribute.length > 0) {
      anyClaim = true;
    }
    if (verdict === 'CONFLICTING') {
      conflicting.push(attribute);
    }
    attributes.push(
      Object.freeze({
        attribute,
        verdict,
        claimCount: forAttribute.length,
        distinctValues: Object.freeze(distinct),
      }),
    );
  }

  const overall: EnrichmentConsistencyVerdict = !anyClaim
    ? 'INSUFFICIENT'
    : conflicting.length > 0
      ? 'CONFLICTING'
      : 'CONSISTENT';

  return Object.freeze({
    prospectRef: profile.prospectRef,
    overall,
    attributes: Object.freeze(attributes),
    conflictingAttributes: Object.freeze(conflicting),
  });
}
