/**
 * AVG-6 — the Aarohi omnichannel identity and WhatsApp handoff OFFLINE DOMAIN (ADR-0123).
 *
 * The overlay sentence this file exists to satisfy, in full:
 *
 * > Resolving one prospect across channels, and the transition from Instagram to WhatsApp. Identity
 * > resolution is evidence-based and reviewable; a merge is a recommendation, never a silent rewrite
 * > of who someone is. WhatsApp remains QuickFurno's existing approved infrastructure and is not
 * > activated here.
 *
 * ### "A merge is a recommendation, never a silent rewrite"
 *
 * That clause is the whole file. There is no `mergeIdentities`, no `resolveProspect`, no function
 * anywhere that takes two identities and returns one, and no field that could say a merge happened.
 * What this domain produces is a RECOMMENDATION carrying the exact evidence references it rests on,
 * so a human can go and read the same evidence and disagree.
 *
 * Being wrong about who somebody is has a particular shape of harm: it silently attaches one
 * person's conversation, history and eventual contact to another person's record, and nobody
 * notices until something is sent to the wrong human. A recommendation can be refused. A rewrite
 * cannot be un-noticed.
 *
 * ### Two things called "handoff", and they are not the same thing
 *
 * AVG-6's handoff is a CHANNEL transition: Instagram to WhatsApp. The OTHER handoff — Aarohi's
 * acquisition ownership passing to Anisha — happens only on authoritative Core ACTIVE, through
 * `completeCoreActiveHandoff`, and nothing here calls it, references it or moves an acquisition case
 * at all. The types are named `WhatsAppChannelHandoff*` rather than `Handoff*` so the distinction is
 * visible at every call site rather than in a comment somebody has to find.
 *
 * ### No destination is stored
 *
 * A WhatsApp participant reference is an OPAQUE channel-local handle. It is not a phone number, not
 * an E.164 string, not a `wa.me` link, not a WABA or phone-number id. The character class refuses
 * most of those outright, and a conservative contact-shape screen — the same shapes AVG-2 uses,
 * named by shape rather than by platform — refuses a bare dialable run of digits that the character
 * class alone would admit.
 *
 * Resolving an actual recipient is Core's, at execution time, on the far side of a boundary that
 * does not exist yet. That is why the shared `CommunicationRequestV1` names an opaque Core recipient
 * and carries no number either, and why this file does not import it.
 *
 * ### WhatsApp is already a governed delivery channel, and this changes nothing about that
 *
 * `whatsapp` has been a member of the shared channel vocabulary since long before AVG-6. That
 * membership is not what this file uses: the tokens below are an Aarohi-local IDENTITY and
 * TRANSITION vocabulary, this package imports no shared contract, and nothing here creates a
 * communication request, an approval, an authorization or an intent. Naming the destination channel
 * of a transition is not activating it.
 *
 * Pure domain only: no runtime, persistence, model call, network, provider, transport or execution.
 */
import { z } from 'zod';

import { parseInstagramConversation } from './avg5-instagram-conversation.js';
import {
  coreEligibilityObservationSchema,
  evaluateAcquisitionEligibility,
} from './existing-vendor-gate.js';
import type { AcquisitionRefusalReason, CorePartyStatus } from './existing-vendor-gate.js';

/** Version of the complete AVG-6 offline identity and channel-handoff contract in this package. */
export const AAROHI_AVG6_CONTRACT_VERSION = 1 as const;
export type AarohiAvg6ContractVersion = typeof AAROHI_AVG6_CONTRACT_VERSION;

/**
 * The channels AVG-6 can hold a CHANNEL-LOCAL IDENTITY for.
 *
 * An identity vocabulary, not a delivery vocabulary. Deliberately exactly two: the roadmap names the
 * Instagram-to-WhatsApp transition, and a first proof that quietly generalised to every channel
 * would be proving something nobody reviewed.
 */
export const AAROHI_AVG6_IDENTITY_CHANNELS = ['instagram', 'whatsapp'] as const;
export type AarohiAvg6IdentityChannel = (typeof AAROHI_AVG6_IDENTITY_CHANNELS)[number];

/** The one transition this slice models. Source and target are literals, never parameters. */
export const AAROHI_AVG6_HANDOFF_SOURCE_CHANNEL = 'instagram' as const;
export const AAROHI_AVG6_HANDOFF_TARGET_CHANNEL = 'whatsapp' as const;
export type AarohiAvg6HandoffSourceChannel = typeof AAROHI_AVG6_HANDOFF_SOURCE_CHANNEL;
export type AarohiAvg6HandoffTargetChannel = typeof AAROHI_AVG6_HANDOFF_TARGET_CHANNEL;

/** An evidence bundle is a review surface, not a graph. Finite, and small enough to read. */
export const MAX_IDENTITY_EVIDENCE_CLAIMS = 32;

/**
 * Where an identity evidence claim came from, stated unflatteringly.
 *
 * Injected, offline, and asserted by whoever called this function. It is not provider-authenticated,
 * not Core-verified and not resolved. No field in this file may claim otherwise.
 */
export const IDENTITY_EVIDENCE_SOURCE_POSTURE = 'INJECTED_OFFLINE_IDENTITY_EVIDENCE' as const;
export type IdentityEvidenceSourcePosture = typeof IDENTITY_EVIDENCE_SOURCE_POSTURE;

// ---------------------------------------------------------------------------
// Shared primitives.
//
// Restated here rather than imported from AVG-2 or AVG-5. Reaching into a certified sibling to
// borrow a private regex would widen that file's surface for this file's convenience; instead the
// grammars are restated and specs assert every one of them agrees with its neighbours, so the
// duplication cannot drift without a test failing.
// ---------------------------------------------------------------------------

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/**
 * Shapes a reference may not contain.
 *
 * Named by SHAPE rather than by platform, exactly as AVG-2 names them, so no channel is missed by
 * omission and no platform name has to be maintained here. The screen is conservative by design.
 *
 * The character class above already refuses `@`, `/`, `+` and whitespace, which rules out an
 * address, a link and most written phone numbers. What it does NOT refuse is a bare run of digits,
 * and a bare run of digits is exactly what a phone number is when somebody strips the punctuation.
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

/**
 * An opaque channel-local reference that carries no destination.
 *
 * Both screens apply. Neither alone is enough: the character class admits `919812345678`, and the
 * contact shapes admit `some ref` that the character class refuses.
 */
const CHANNEL_LOCAL_REF = OPAQUE_REF.refine((one: string) => !hasContactShape(one));

const UTC_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u;

function isCanonicalUtcInstant(value: string): boolean {
  const parts = UTC_INSTANT_PATTERN.exec(value);
  if (parts === null) return false;

  const year = Number(parts[1] ?? '');
  const month = Number(parts[2] ?? '');
  const day = Number(parts[3] ?? '');
  const hour = Number(parts[4] ?? '');
  const minute = Number(parts[5] ?? '');
  const second = Number(parts[6] ?? '');

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const roundTrip = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

const UTC_INSTANT = z.string().refine(isCanonicalUtcInstant);

/**
 * The UTC instant a canonical timestamp REPRESENTS, in epoch milliseconds.
 *
 * The grammar makes milliseconds optional, so one moment has more than one canonical spelling and
 * lexicographic order is not chronological order across them — the character after the seconds is
 * `.` in one form and `Z` in the other, and `.` sorts first. AVG-5's owner review found exactly that
 * defect; this file is written with the fix rather than the bug.
 */
function canonicalInstantEpochMs(instant: string): number {
  return Date.parse(instant);
}

// ---------------------------------------------------------------------------
// The evidence claim.
// ---------------------------------------------------------------------------

/**
 * What one piece of evidence says about whether two channel-local handles are one party.
 *
 * Two members, and no third. There is no `PROVES_SAME_PARTY`, because nothing available to this
 * domain proves identity — a self-assertion is a claim, an operator's reading is a judgement, and a
 * public reference is a coincidence until something authoritative says otherwise.
 */
export const IDENTITY_EVIDENCE_RELATIONS = [
  'SUPPORTS_SAME_PARTY',
  'CONTRADICTS_SAME_PARTY',
] as const;
export type IdentityEvidenceRelation = (typeof IDENTITY_EVIDENCE_RELATIONS)[number];

/** Where a piece of evidence came from. Closed, and every member is still only evidence. */
export const IDENTITY_EVIDENCE_SOURCE_KINDS = [
  /** The prospect said so themselves, in a bounded observation somebody recorded. */
  'PROSPECT_SELF_ASSERTED',
  /** A human reviewed something and recorded a judgement. A judgement, not a verification. */
  'OPERATOR_REVIEWED',
  /** A public profile or listing appears to reference both. Coincidence is common in public data. */
  'PUBLIC_REFERENCE_CORROBORATION',
  /** Provenance was not recorded. It corroborates nothing, and says so. */
  'UNKNOWN',
] as const;
export type IdentityEvidenceSourceKind = (typeof IDENTITY_EVIDENCE_SOURCE_KINDS)[number];

/** What a source may contribute to a recommendation. */
export const IDENTITY_SOURCE_ROLES = [
  /** May stand as one independent leg of a recommendation. */
  'CORROBORATING',
  /** Counts toward independence, but cannot be the ONLY kind behind a recommendation. */
  'WEAK_CORROBORATING',
  /** Contributes nothing. Present so that unrecorded provenance is visibly worth nothing. */
  'NON_CORROBORATING',
] as const;
export type IdentitySourceRole = (typeof IDENTITY_SOURCE_ROLES)[number];

/**
 * The role of every source kind.
 *
 * TOTAL by type. A new `IdentityEvidenceSourceKind` fails to compile until somebody assigns it a
 * role, which is the point: the failure mode this shape prevents is a source added next year
 * silently inheriting the ability to corroborate an identity link.
 */
export const IDENTITY_SOURCE_ROLE: Readonly<
  Record<IdentityEvidenceSourceKind, IdentitySourceRole>
> = Object.freeze({
  PROSPECT_SELF_ASSERTED: 'CORROBORATING',
  OPERATOR_REVIEWED: 'CORROBORATING',
  // Public data repeats itself. Two listings quoting the same source are one observation wearing two
  // hats, and a shared name proves considerably less than it appears to.
  PUBLIC_REFERENCE_CORROBORATION: 'WEAK_CORROBORATING',
  UNKNOWN: 'NON_CORROBORATING',
});

/**
 * One untrusted observation about whether two channel-local handles belong to one prospect.
 *
 * There is deliberately no field for consent, verification, a phone number, a Core vendor id, a
 * message body or a confidence score. Those are authority, destination, content and arithmetic
 * dressed as judgement; a claim about identity carries none of them.
 */
export interface CrossChannelIdentityEvidenceClaim {
  readonly contractVersion: AarohiAvg6ContractVersion;
  readonly evidenceRef: string;
  readonly prospectRef: string;
  /** CHANNEL-LOCAL. Never a Core vendor id, never a cross-channel identity. */
  readonly instagramParticipantRef: string;
  /** CHANNEL-LOCAL, and never a destination. Screened for contact shapes as well as characters. */
  readonly whatsappParticipantRef: string;
  readonly relation: IdentityEvidenceRelation;
  readonly sourceKind: IdentityEvidenceSourceKind;
  /** Opaque, and screened: an opaque character class alone would still admit a run of digits. */
  readonly sourceRef: string;
  readonly observedAt: string;
  readonly sourcePosture: IdentityEvidenceSourcePosture;
}

/** Canonical schema for a BUILT claim, so the contract says one thing to every reader. */
export const identityEvidenceClaimSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG6_CONTRACT_VERSION),
    evidenceRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    instagramParticipantRef: CHANNEL_LOCAL_REF,
    whatsappParticipantRef: CHANNEL_LOCAL_REF,
    relation: z.enum(IDENTITY_EVIDENCE_RELATIONS),
    sourceKind: z.enum(IDENTITY_EVIDENCE_SOURCE_KINDS),
    sourceRef: CHANNEL_LOCAL_REF,
    observedAt: UTC_INSTANT,
    sourcePosture: z.literal(IDENTITY_EVIDENCE_SOURCE_POSTURE),
  })
  .strict();

/** What a caller may state. The posture and the contract version are NOT theirs to choose. */
const identityEvidenceInputSchema = z
  .object({
    evidenceRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    instagramParticipantRef: CHANNEL_LOCAL_REF,
    whatsappParticipantRef: CHANNEL_LOCAL_REF,
    relation: z.enum(IDENTITY_EVIDENCE_RELATIONS),
    sourceKind: z.enum(IDENTITY_EVIDENCE_SOURCE_KINDS),
    sourceRef: CHANNEL_LOCAL_REF,
    observedAt: UTC_INSTANT,
  })
  .strict();

export const IDENTITY_EVIDENCE_REFUSALS = [
  'IDENTITY_EVIDENCE_INVALID',
  'IDENTITY_BINDING_MISMATCH',
  'IDENTITY_EVIDENCE_DUPLICATE',
  'IDENTITY_EVIDENCE_LIMIT_REACHED',
  'IDENTITY_BUNDLE_INVALID',
] as const;
export type IdentityEvidenceRefusal = (typeof IDENTITY_EVIDENCE_REFUSALS)[number];

export type CrossChannelIdentityEvidenceClaimResult =
  | { readonly ok: true; readonly claim: CrossChannelIdentityEvidenceClaim }
  | { readonly ok: false; readonly refusal: IdentityEvidenceRefusal };

/**
 * Build one canonical identity evidence claim, or refuse.
 *
 * The posture is STAMPED rather than accepted — there is no input field for it — so an injected
 * fixture cannot describe itself as provider-authenticated or Core-verified.
 */
export function createCrossChannelIdentityEvidenceClaim(
  value: unknown,
): CrossChannelIdentityEvidenceClaimResult {
  const parsed = identityEvidenceInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'IDENTITY_EVIDENCE_INVALID' as const });
  }

  return Object.freeze({
    ok: true as const,
    claim: Object.freeze({
      contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
      evidenceRef: parsed.data.evidenceRef,
      prospectRef: parsed.data.prospectRef,
      instagramParticipantRef: parsed.data.instagramParticipantRef,
      whatsappParticipantRef: parsed.data.whatsappParticipantRef,
      relation: parsed.data.relation,
      sourceKind: parsed.data.sourceKind,
      sourceRef: parsed.data.sourceRef,
      observedAt: parsed.data.observedAt,
      sourcePosture: IDENTITY_EVIDENCE_SOURCE_POSTURE,
    }),
  });
}

// ---------------------------------------------------------------------------
// The evidence bundle.
// ---------------------------------------------------------------------------

/** The three references every claim in a bundle must agree with. */
interface IdentityBundleBinding {
  readonly prospectRef: string;
  readonly instagramParticipantRef: string;
  readonly whatsappParticipantRef: string;
}

/**
 * THE canonical order of two claims. Total, and the only definition of that order in this file.
 *
 * Ordered by the semantic UTC INSTANT rather than the timestamp string, then by `evidenceRef`. AVG-5
 * shipped a comparator that compared the strings and had to be corrected: the canonical grammar
 * makes milliseconds optional, so `09:00:00Z` and `09:00:00.000Z` are one moment written two ways
 * and `09:00:00.500Z` sorts BEFORE `09:00:00Z` lexicographically. That lesson is applied here
 * up front rather than after a review.
 */
function compareCanonicalClaimOrder(
  left: CrossChannelIdentityEvidenceClaim,
  right: CrossChannelIdentityEvidenceClaim,
): -1 | 0 | 1 {
  const leftMs = canonicalInstantEpochMs(left.observedAt);
  const rightMs = canonicalInstantEpochMs(right.observedAt);
  if (leftMs < rightMs) return -1;
  if (leftMs > rightMs) return 1;
  if (left.evidenceRef < right.evidenceRef) return -1;
  if (left.evidenceRef > right.evidenceRef) return 1;
  return 0;
}

function claimMatchesBinding(
  claim: IdentityBundleBinding,
  binding: IdentityBundleBinding,
): boolean {
  return (
    claim.prospectRef === binding.prospectRef &&
    claim.instagramParticipantRef === binding.instagramParticipantRef &&
    claim.whatsappParticipantRef === binding.whatsappParticipantRef
  );
}

/**
 * Is this whole bundle canonical, and not merely a bag of individually canonical claims?
 *
 * AVG-5's owner review found a builder that checked every aggregate property as it appended while
 * the public schema and parser checked none of them, so a hand-assembled bundle mixing two prospects
 * parsed and came back canonical. The invariant lives in ONE helper here, used by the schema, the
 * parser and the builder, so the same defect cannot be reintroduced by a second definition.
 *
 * Ordering and uniqueness are both asked because neither implies the other: two claims sharing an
 * evidence reference at different instants are still strictly increasing, and two at the same
 * instant with the same reference compare equal.
 */
function bundleAggregateIsCanonical(
  binding: IdentityBundleBinding,
  claims: readonly CrossChannelIdentityEvidenceClaim[],
): boolean {
  if (claims.length > MAX_IDENTITY_EVIDENCE_CLAIMS) {
    return false;
  }

  const seen = new Set<string>();
  let previous: CrossChannelIdentityEvidenceClaim | undefined;
  for (const claim of claims) {
    if (!claimMatchesBinding(claim, binding)) {
      return false;
    }
    if (seen.has(claim.evidenceRef)) {
      return false;
    }
    seen.add(claim.evidenceRef);
    // STRICTLY increasing. An unsorted array is REFUSED rather than quietly reordered: a public
    // canonical parser certifies the value it was shown, and silently repairing a producer's
    // contract violation would hide the fact that a producer is violating it.
    if (previous !== undefined && compareCanonicalClaimOrder(previous, claim) !== -1) {
      return false;
    }
    previous = claim;
  }
  return true;
}

/**
 * A bounded, immutable bundle of evidence about ONE pair of channel-local handles.
 *
 * It is not an identity graph. There is no edge to a third channel, no transitive closure and no
 * table this could grow into: a bundle answers one question about one pair, and a durable identity
 * store is a governed decision nobody has taken.
 */
export interface CrossChannelIdentityEvidenceBundle {
  readonly contractVersion: AarohiAvg6ContractVersion;
  readonly prospectRef: string;
  readonly instagramParticipantRef: string;
  readonly whatsappParticipantRef: string;
  readonly claims: readonly CrossChannelIdentityEvidenceClaim[];
}

export const identityEvidenceBundleSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG6_CONTRACT_VERSION),
    prospectRef: OPAQUE_REF,
    instagramParticipantRef: CHANNEL_LOCAL_REF,
    whatsappParticipantRef: CHANNEL_LOCAL_REF,
    claims: z.array(identityEvidenceClaimSchema).max(MAX_IDENTITY_EVIDENCE_CLAIMS),
  })
  .strict()
  .refine(
    (value) => bundleAggregateIsCanonical(value, value.claims),
    'the evidence claims do not form a canonical aggregate for this binding',
  );

export type CrossChannelIdentityEvidenceBundleResult =
  | { readonly ok: true; readonly bundle: CrossChannelIdentityEvidenceBundle }
  | { readonly ok: false; readonly refusal: IdentityEvidenceRefusal };

const bundleInputSchema = z
  .object({
    prospectRef: OPAQUE_REF,
    instagramParticipantRef: CHANNEL_LOCAL_REF,
    whatsappParticipantRef: CHANNEL_LOCAL_REF,
  })
  .strict();

/**
 * Re-parse and REBUILD a bundle from whatever was handed in.
 *
 * A declared TypeScript type is erased before any of this runs, so trusting one would be trusting
 * the caller. The schema certifies the whole AGGREGATE, so this returns `undefined` for a bundle
 * whose claims belong to another prospect or another pair of handles, whose evidence references
 * repeat, or whose claims are not in canonical order. Rebuilding happens only after that, because
 * rebuilding a value that failed its own contract would be laundering it.
 */
export function parseCrossChannelIdentityEvidenceBundle(
  value: unknown,
): CrossChannelIdentityEvidenceBundle | undefined {
  const parsed = identityEvidenceBundleSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const claims = parsed.data.claims.map((claim) => Object.freeze({ ...claim }));
  return Object.freeze({
    contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
    prospectRef: parsed.data.prospectRef,
    instagramParticipantRef: parsed.data.instagramParticipantRef,
    whatsappParticipantRef: parsed.data.whatsappParticipantRef,
    claims: Object.freeze(claims),
  });
}

/** Open an empty bundle. There is no way to seed one with claims nobody parsed. */
export function createCrossChannelIdentityEvidenceBundle(
  value: unknown,
): CrossChannelIdentityEvidenceBundleResult {
  const parsed = bundleInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'IDENTITY_BUNDLE_INVALID' as const });
  }

  return Object.freeze({
    ok: true as const,
    bundle: Object.freeze({
      contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
      prospectRef: parsed.data.prospectRef,
      instagramParticipantRef: parsed.data.instagramParticipantRef,
      whatsappParticipantRef: parsed.data.whatsappParticipantRef,
      claims: Object.freeze([] as readonly CrossChannelIdentityEvidenceClaim[]),
    }),
  });
}

/**
 * Append one canonical claim, returning a NEW bundle.
 *
 * Every binding is re-checked. A claim about another prospect or another pair of handles is refused
 * rather than absorbed: evidence about a different question is not weak evidence about this one, it
 * is none. A repeated evidence reference is refused because counting one observation twice is how a
 * single weak signal comes to look like independent corroboration.
 */
export function appendCrossChannelIdentityEvidence(
  bundleValue: unknown,
  claimValue: unknown,
): CrossChannelIdentityEvidenceBundleResult {
  const bundle = parseCrossChannelIdentityEvidenceBundle(bundleValue);
  if (bundle === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'IDENTITY_BUNDLE_INVALID' as const });
  }

  const parsed = identityEvidenceClaimSchema.safeParse(claimValue);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'IDENTITY_EVIDENCE_INVALID' as const });
  }
  const claim = parsed.data;

  if (!claimMatchesBinding(claim, bundle)) {
    return Object.freeze({ ok: false as const, refusal: 'IDENTITY_BINDING_MISMATCH' as const });
  }

  if (bundle.claims.some((one) => one.evidenceRef === claim.evidenceRef)) {
    return Object.freeze({ ok: false as const, refusal: 'IDENTITY_EVIDENCE_DUPLICATE' as const });
  }

  if (bundle.claims.length >= MAX_IDENTITY_EVIDENCE_CLAIMS) {
    return Object.freeze({
      ok: false as const,
      refusal: 'IDENTITY_EVIDENCE_LIMIT_REACHED' as const,
    });
  }

  // Sorted with the SAME comparator the aggregate check validates against, so what the builder
  // produces is by construction what the parser will accept.
  const claims = [...bundle.claims, Object.freeze({ ...claim })].sort(compareCanonicalClaimOrder);

  return Object.freeze({
    ok: true as const,
    bundle: Object.freeze({ ...bundle, claims: Object.freeze(claims) }),
  });
}

// ---------------------------------------------------------------------------
// The link RECOMMENDATION. Never a merge.
// ---------------------------------------------------------------------------

/**
 * What AVG-6 may conclude about two channel-local handles.
 *
 * `LINK_RECOMMENDED` means: the evidence is sufficient under the deterministic policy below to
 * recommend that these two handles be REVIEWED as one prospect.
 *
 * It does not mean Core accepted a link, that any record was merged, that a number was verified,
 * that contact is consented, that WhatsApp may be used, or that anything is authorized. There is no
 * outcome that means any of those, and no field anywhere that could be set to say so.
 */
export const IDENTITY_LINK_OUTCOMES = ['LINK_RECOMMENDED', 'REVIEW_REQUIRED'] as const;
export type IdentityLinkOutcome = (typeof IDENTITY_LINK_OUTCOMES)[number];

/** Why the policy concluded what it did. Closed machine codes; never free text, never a score. */
export const IDENTITY_LINK_REASON_CODES = [
  'SUFFICIENT_INDEPENDENT_SUPPORT',
  'INSUFFICIENT_EVIDENCE',
  'CONFLICTING_EVIDENCE',
  'NON_CORROBORATING_EVIDENCE_ONLY',
  'IDENTITY_BUNDLE_INVALID',
] as const;
export type IdentityLinkReasonCode = (typeof IDENTITY_LINK_REASON_CODES)[number];

/**
 * The negative facts a recommendation states as literals.
 *
 * A recommendation that could hold `true` for any of these would be a recommendation worth lying
 * with, so the schema pins each one and the module fails to load if somebody constructs one that
 * does not.
 */
export interface IdentityLinkPosture {
  readonly recommendationOnly: true;
  readonly identityMerged: false;
  readonly coreIdentityMutated: false;
  readonly identityVerified: false;
  readonly consentEstablished: false;
  readonly communicationAuthorized: false;
}

export const identityLinkPostureSchema = z
  .object({
    recommendationOnly: z.literal(true),
    identityMerged: z.literal(false),
    coreIdentityMutated: z.literal(false),
    identityVerified: z.literal(false),
    consentEstablished: z.literal(false),
    communicationAuthorized: z.literal(false),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const IDENTITY_LINK_POSTURE: IdentityLinkPosture = Object.freeze(
  identityLinkPostureSchema.parse({
    recommendationOnly: true,
    identityMerged: false,
    coreIdentityMutated: false,
    identityVerified: false,
    consentEstablished: false,
    communicationAuthorized: false,
  }),
);

/**
 * A reviewable recommendation about two channel-local handles.
 *
 * The evidence references are carried so a human can go and read the same evidence and disagree.
 * There is no natural-language explanation, no hidden score and no confidence number: a probability
 * that looked high is not a reason to attach one person's conversation to another person's record.
 */
export interface CrossChannelIdentityLinkRecommendation {
  readonly contractVersion: AarohiAvg6ContractVersion;
  readonly recommendationRef: string;
  readonly prospectRef: string;
  readonly instagramParticipantRef: string;
  readonly whatsappParticipantRef: string;
  readonly outcome: IdentityLinkOutcome;
  readonly reasonCode: IdentityLinkReasonCode;
  readonly supportingEvidenceRefs: readonly string[];
  readonly contradictingEvidenceRefs: readonly string[];
  readonly createdAt: string;
  readonly posture: IdentityLinkPosture;
}

const SORTED_UNIQUE_REFS = z
  .array(OPAQUE_REF)
  .max(MAX_IDENTITY_EVIDENCE_CLAIMS)
  .refine((refs: readonly string[]) => new Set(refs).size === refs.length)
  .refine((refs: readonly string[]) =>
    refs.every((one, index) => index === 0 || (refs[index - 1] ?? '') < one),
  );

export const identityLinkRecommendationSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG6_CONTRACT_VERSION),
    recommendationRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    instagramParticipantRef: CHANNEL_LOCAL_REF,
    whatsappParticipantRef: CHANNEL_LOCAL_REF,
    outcome: z.enum(IDENTITY_LINK_OUTCOMES),
    reasonCode: z.enum(IDENTITY_LINK_REASON_CODES),
    supportingEvidenceRefs: SORTED_UNIQUE_REFS,
    contradictingEvidenceRefs: SORTED_UNIQUE_REFS,
    createdAt: UTC_INSTANT,
    posture: identityLinkPostureSchema,
  })
  .strict()
  .refine(
    // A positive recommendation names exactly one reason, and a contradiction is never one of them.
    (value) =>
      value.outcome === 'LINK_RECOMMENDED'
        ? value.reasonCode === 'SUFFICIENT_INDEPENDENT_SUPPORT' &&
          value.contradictingEvidenceRefs.length === 0
        : value.reasonCode !== 'SUFFICIENT_INDEPENDENT_SUPPORT',
    'the recommendation outcome and reason code contradict one another',
  );

/** Re-parse and REBUILD a recommendation. Detaches every array from whatever the caller holds. */
export function parseCrossChannelIdentityLinkRecommendation(
  value: unknown,
): CrossChannelIdentityLinkRecommendation | undefined {
  const parsed = identityLinkRecommendationSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
    recommendationRef: parsed.data.recommendationRef,
    prospectRef: parsed.data.prospectRef,
    instagramParticipantRef: parsed.data.instagramParticipantRef,
    whatsappParticipantRef: parsed.data.whatsappParticipantRef,
    outcome: parsed.data.outcome,
    reasonCode: parsed.data.reasonCode,
    supportingEvidenceRefs: Object.freeze([...parsed.data.supportingEvidenceRefs]),
    contradictingEvidenceRefs: Object.freeze([...parsed.data.contradictingEvidenceRefs]),
    createdAt: parsed.data.createdAt,
    posture: IDENTITY_LINK_POSTURE,
  });
}

/** What a caller may state. Not the outcome, not the reason, not the posture, not the version. */
const identityLinkInputSchema = z
  .object({
    recommendationRef: OPAQUE_REF,
    bundle: z.unknown(),
    createdAt: UTC_INSTANT,
  })
  .strict();

function sortedUnique(refs: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(refs)].sort((left, right) => (left < right ? -1 : 1)));
}

/**
 * Decide, deterministically, whether two channel-local handles are worth reviewing as one prospect.
 *
 * ### The policy, and why it is shaped this way
 *
 * `LINK_RECOMMENDED` requires ALL of:
 *
 * - a canonical bundle;
 * - NO contradicting claim at all;
 * - at least two supporting claims whose source kind corroborates anything;
 * - those claims coming from at least two DISTINCT `sourceRef`s;
 * - at least one of them from a source whose role is `CORROBORATING` rather than merely
 *   `WEAK_CORROBORATING`.
 *
 * Each clause exists because of a specific way a weak signal can look strong. Distinct source
 * references, because the same observation recorded twice is one observation. A non-weak leg,
 * because public data repeats itself and two listings quoting the same directory corroborate
 * nothing. No contradiction, because a single credible denial outweighs any amount of circumstantial
 * agreement when the cost of being wrong is attaching the wrong human's conversation to a record.
 *
 * There is no threshold to tune, no score, no model, and nothing that gets easier as evidence piles
 * up beyond the two independent legs. Everything else is `REVIEW_REQUIRED`, which is not a failure
 * state — it is a person looking, which is the correct outcome for a question this domain cannot
 * settle.
 */
export function evaluateCrossChannelIdentityLink(
  value: unknown,
): CrossChannelIdentityLinkRecommendation | undefined {
  const parsed = identityLinkInputSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  const bundle = parseCrossChannelIdentityEvidenceBundle(parsed.data.bundle);
  if (bundle === undefined) {
    return undefined;
  }

  const contradicting = bundle.claims.filter(
    (claim) => claim.relation === 'CONTRADICTS_SAME_PARTY',
  );
  const supporting = bundle.claims.filter((claim) => claim.relation === 'SUPPORTS_SAME_PARTY');

  const supportingRefs = sortedUnique(supporting.map((claim) => claim.evidenceRef));
  const contradictingRefs = sortedUnique(contradicting.map((claim) => claim.evidenceRef));

  const review = (
    reasonCode: Exclude<IdentityLinkReasonCode, 'SUFFICIENT_INDEPENDENT_SUPPORT'>,
  ): CrossChannelIdentityLinkRecommendation =>
    Object.freeze({
      contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
      recommendationRef: parsed.data.recommendationRef,
      prospectRef: bundle.prospectRef,
      instagramParticipantRef: bundle.instagramParticipantRef,
      whatsappParticipantRef: bundle.whatsappParticipantRef,
      outcome: 'REVIEW_REQUIRED' as const,
      reasonCode,
      supportingEvidenceRefs: supportingRefs,
      contradictingEvidenceRefs: contradictingRefs,
      createdAt: parsed.data.createdAt,
      posture: IDENTITY_LINK_POSTURE,
    });

  // A denial is read before anything else. It does not get outvoted by volume.
  if (contradicting.length > 0) {
    return review('CONFLICTING_EVIDENCE');
  }

  const corroborating = supporting.filter(
    (claim) => IDENTITY_SOURCE_ROLE[claim.sourceKind] !== 'NON_CORROBORATING',
  );
  if (corroborating.length === 0) {
    return review(
      supporting.length === 0 ? 'INSUFFICIENT_EVIDENCE' : 'NON_CORROBORATING_EVIDENCE_ONLY',
    );
  }

  // INDEPENDENCE is counted by source reference, not by claim. Two rows quoting one source are one
  // observation with two evidence references.
  const independentSources = new Set(corroborating.map((claim) => claim.sourceRef));
  if (independentSources.size < 2) {
    return review('INSUFFICIENT_EVIDENCE');
  }

  // At least one leg must be more than a public coincidence.
  if (!corroborating.some((claim) => IDENTITY_SOURCE_ROLE[claim.sourceKind] === 'CORROBORATING')) {
    return review('NON_CORROBORATING_EVIDENCE_ONLY');
  }

  return Object.freeze({
    contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
    recommendationRef: parsed.data.recommendationRef,
    prospectRef: bundle.prospectRef,
    instagramParticipantRef: bundle.instagramParticipantRef,
    whatsappParticipantRef: bundle.whatsappParticipantRef,
    outcome: 'LINK_RECOMMENDED' as const,
    reasonCode: 'SUFFICIENT_INDEPENDENT_SUPPORT' as const,
    supportingEvidenceRefs: supportingRefs,
    contradictingEvidenceRefs: contradictingRefs,
    createdAt: parsed.data.createdAt,
    posture: IDENTITY_LINK_POSTURE,
  });
}

// ---------------------------------------------------------------------------
// The WhatsApp CHANNEL handoff candidate.
// ---------------------------------------------------------------------------

/**
 * The single positive thing a channel-handoff candidate may say.
 *
 * Deliberately long, and deliberately containing FUTURE and REVIEW. `READY_TO_SEND`,
 * `WHATSAPP_CONNECTED`, `IDENTITY_RESOLVED`, `MERGED`, `AUTHORIZED` and `PROVIDER_READY` are all
 * things this repository cannot make true, and a token is read by people who will not read the file
 * it came from.
 */
export const WHATSAPP_CHANNEL_HANDOFF_OUTCOME =
  'READY_FOR_FUTURE_CORE_WHATSAPP_HANDOFF_REVIEW' as const;
export type WhatsAppChannelHandoffOutcome = typeof WHATSAPP_CHANNEL_HANDOFF_OUTCOME;

/**
 * The negative facts, stated as literals a machine can check.
 *
 * The three `requires*` fields are the load-bearing ones. A prepared candidate names no recipient,
 * carries no consent and rests on an eligibility observation that will be stale by the time anything
 * could act on it — so each of those is written down as an obligation on whoever eventually does.
 *
 * `acquisitionCaseMutated` and `anishaHandoffExecuted` are here because the word "handoff" means two
 * different things in this system, and only one of them is what this candidate is about.
 */
export interface WhatsAppChannelHandoffPosture {
  readonly candidateOnly: true;
  readonly identityRecommendationOnly: true;
  readonly identityMergeExecuted: false;
  readonly coreIdentityMutated: false;
  readonly requiresCoreRecipientResolution: true;
  readonly requiresCoreConsentRevalidation: true;
  readonly requiresCoreExecutionTimeEligibilityRevalidation: true;
  readonly recipientResolvedByCore: false;
  readonly consentEstablished: false;
  readonly communicationRequestCreated: false;
  readonly approvalRequestCreated: false;
  readonly approvalDecisionCreated: false;
  readonly communicationAuthorizationCreated: false;
  readonly executionIntentCreated: false;
  readonly n8nExecutionRequested: false;
  readonly providerSendRequested: false;
  readonly whatsappSendRequested: false;
  readonly sent: false;
  readonly delivered: false;
  readonly acquisitionCaseMutated: false;
  readonly anishaHandoffExecuted: false;
  readonly productionMutation: false;
  readonly businessEffect: false;
}

export const whatsappChannelHandoffPostureSchema = z
  .object({
    candidateOnly: z.literal(true),
    identityRecommendationOnly: z.literal(true),
    identityMergeExecuted: z.literal(false),
    coreIdentityMutated: z.literal(false),
    requiresCoreRecipientResolution: z.literal(true),
    requiresCoreConsentRevalidation: z.literal(true),
    requiresCoreExecutionTimeEligibilityRevalidation: z.literal(true),
    recipientResolvedByCore: z.literal(false),
    consentEstablished: z.literal(false),
    communicationRequestCreated: z.literal(false),
    approvalRequestCreated: z.literal(false),
    approvalDecisionCreated: z.literal(false),
    communicationAuthorizationCreated: z.literal(false),
    executionIntentCreated: z.literal(false),
    n8nExecutionRequested: z.literal(false),
    providerSendRequested: z.literal(false),
    whatsappSendRequested: z.literal(false),
    sent: z.literal(false),
    delivered: z.literal(false),
    acquisitionCaseMutated: z.literal(false),
    anishaHandoffExecuted: z.literal(false),
    productionMutation: z.literal(false),
    businessEffect: z.literal(false),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const WHATSAPP_CHANNEL_HANDOFF_POSTURE: WhatsAppChannelHandoffPosture = Object.freeze(
  whatsappChannelHandoffPostureSchema.parse({
    candidateOnly: true,
    identityRecommendationOnly: true,
    identityMergeExecuted: false,
    coreIdentityMutated: false,
    requiresCoreRecipientResolution: true,
    requiresCoreConsentRevalidation: true,
    requiresCoreExecutionTimeEligibilityRevalidation: true,
    recipientResolvedByCore: false,
    consentEstablished: false,
    communicationRequestCreated: false,
    approvalRequestCreated: false,
    approvalDecisionCreated: false,
    communicationAuthorizationCreated: false,
    executionIntentCreated: false,
    n8nExecutionRequested: false,
    providerSendRequested: false,
    whatsappSendRequested: false,
    sent: false,
    delivered: false,
    acquisitionCaseMutated: false,
    anishaHandoffExecuted: false,
    productionMutation: false,
    businessEffect: false,
  }),
);

/**
 * An inert CHANNEL-transition candidate.
 *
 * It carries no message body, no template, no phone number, no provider id and no token — because
 * there is nothing here that could compose one honestly and nowhere for one to go. What it carries
 * is the identity of a conversation, the identity of a recommendation, and the Core status observed
 * when it was prepared.
 *
 * `coreStatus` is HISTORY. It is not a permission and does not become one by being written down,
 * which is what the three `requires*` posture fields exist to say out loud.
 */
export interface WhatsAppChannelHandoffCandidate {
  readonly contractVersion: AarohiAvg6ContractVersion;
  readonly candidateRef: string;
  readonly sourceChannel: AarohiAvg6HandoffSourceChannel;
  readonly targetChannel: AarohiAvg6HandoffTargetChannel;
  readonly outcome: WhatsAppChannelHandoffOutcome;
  readonly prospectRef: string;
  readonly instagramConversationRef: string;
  readonly instagramThreadRef: string;
  readonly instagramParticipantRef: string;
  readonly whatsappParticipantRef: string;
  readonly identityRecommendationRef: string;
  /** The Core status OBSERVED when this candidate was prepared. Narrowed to the one that proceeds. */
  readonly coreStatus: Extract<CorePartyStatus, 'NOT_REGISTERED'>;
  readonly coreLookupRef: string;
  readonly preparedAt: string;
  readonly posture: WhatsAppChannelHandoffPosture;
}

export const whatsappChannelHandoffCandidateSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG6_CONTRACT_VERSION),
    candidateRef: OPAQUE_REF,
    sourceChannel: z.literal(AAROHI_AVG6_HANDOFF_SOURCE_CHANNEL),
    targetChannel: z.literal(AAROHI_AVG6_HANDOFF_TARGET_CHANNEL),
    outcome: z.literal(WHATSAPP_CHANNEL_HANDOFF_OUTCOME),
    prospectRef: OPAQUE_REF,
    instagramConversationRef: OPAQUE_REF,
    instagramThreadRef: OPAQUE_REF,
    instagramParticipantRef: CHANNEL_LOCAL_REF,
    whatsappParticipantRef: CHANNEL_LOCAL_REF,
    identityRecommendationRef: OPAQUE_REF,
    coreStatus: z.literal('NOT_REGISTERED'),
    coreLookupRef: OPAQUE_REF,
    preparedAt: UTC_INSTANT,
    posture: whatsappChannelHandoffPostureSchema,
  })
  .strict();

export const WHATSAPP_CHANNEL_HANDOFF_REFUSALS = [
  'HANDOFF_INPUT_INVALID',
  'INSTAGRAM_CONVERSATION_INVALID',
  'IDENTITY_RECOMMENDATION_INVALID',
  'IDENTITY_LINK_NOT_RECOMMENDED',
  'IDENTITY_BINDING_MISMATCH',
  'CORE_GATE_REFUSED',
  /** The candidate claims to predate the identity recommendation it rests on. */
  'PREPARED_BEFORE_RECOMMENDATION',
  'HANDOFF_CANDIDATE_INVALID',
] as const;
export type WhatsAppChannelHandoffRefusal = (typeof WHATSAPP_CHANNEL_HANDOFF_REFUSALS)[number];

export type WhatsAppChannelHandoffCandidateResult =
  | { readonly ok: true; readonly candidate: WhatsAppChannelHandoffCandidate }
  | {
      readonly ok: false;
      readonly refusal: Exclude<WhatsAppChannelHandoffRefusal, 'CORE_GATE_REFUSED'>;
    }
  | {
      readonly ok: false;
      readonly refusal: 'CORE_GATE_REFUSED';
      readonly coreReason: AcquisitionRefusalReason;
    };

/**
 * What a caller may state when preparing a candidate.
 *
 * Note what is absent: no message, no body, no template, no phone number, no target participant of
 * its own — the WhatsApp handle comes from the recommendation, and the Instagram identity comes from
 * the conversation. There is also no field for the channels, the outcome, the posture, the Core
 * status or the contract version.
 */
const handoffInputSchema = z
  .object({
    candidateRef: OPAQUE_REF,
    conversation: z.unknown(),
    recommendation: z.unknown(),
    coreObservation: z.unknown(),
    preparedAt: UTC_INSTANT,
  })
  .strict();

/**
 * Prepare an inert Instagram-to-WhatsApp channel handoff candidate.
 *
 * ### Identity evidence is not acquisition permission
 *
 * Those are separate questions with separate authorities, and this function asks both. A positive
 * identity recommendation says two handles are probably one person; the Core gate says whether
 * Aarohi may be approaching that person at all. Any amount of the first buys none of the second, so
 * the CURRENT Core observation is re-run through the AVG-1 gate every time and only `NOT_REGISTERED`
 * proceeds. A prospect who has since become `DO_NOT_CONTACT`, `REGISTERED` or `ACTIVE` yields no
 * candidate however well-evidenced the identity link is.
 *
 * ### And this is not the OTHER handoff
 *
 * No acquisition case is read, transitioned or referenced. `completeCoreActiveHandoff` is not called
 * and is not imported. Aarohi's ownership does not move here; a conversation's channel might, later,
 * if Core resolves a recipient and revalidates consent on the far side of a boundary that does not
 * exist yet.
 */
export function prepareWhatsAppChannelHandoffCandidate(
  value: unknown,
): WhatsAppChannelHandoffCandidateResult {
  const parsed = handoffInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'HANDOFF_INPUT_INVALID' as const });
  }

  // The canonical AVG-5 parser, which certifies the whole conversation aggregate. A forged snapshot
  // mixing two prospects' turns is refused there, and inherited here.
  const conversation = parseInstagramConversation(parsed.data.conversation);
  if (conversation === undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'INSTAGRAM_CONVERSATION_INVALID' as const,
    });
  }

  const recommendation = parseCrossChannelIdentityLinkRecommendation(parsed.data.recommendation);
  if (recommendation === undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'IDENTITY_RECOMMENDATION_INVALID' as const,
    });
  }

  if (recommendation.outcome !== 'LINK_RECOMMENDED') {
    // `REVIEW_REQUIRED` is a person looking, not a slower yes.
    return Object.freeze({
      ok: false as const,
      refusal: 'IDENTITY_LINK_NOT_RECOMMENDED' as const,
    });
  }

  // The recommendation must be about the conversation in hand. A recommendation about somebody else
  // is not weak evidence about this prospect; it is a different question entirely.
  if (
    recommendation.prospectRef !== conversation.prospectRef ||
    recommendation.instagramParticipantRef !== conversation.instagramParticipantRef
  ) {
    return Object.freeze({ ok: false as const, refusal: 'IDENTITY_BINDING_MISMATCH' as const });
  }

  // THE CURRENT CORE GATE, delegated to AVG-1 and not restated. The status map lives in one place.
  const core = evaluateAcquisitionEligibility(
    conversation.prospectRef,
    parsed.data.coreObservation,
  );
  if (!core.eligible) {
    return Object.freeze({
      ok: false as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      coreReason: core.reason,
    });
  }
  if (core.status !== 'NOT_REGISTERED') {
    // Unreachable through the canonical gate, which admits exactly one status. Fail closed anyway:
    // "unreachable" is a claim about today's call graph, and this is a claim about the candidate.
    return Object.freeze({ ok: false as const, refusal: 'HANDOFF_CANDIDATE_INVALID' as const });
  }

  // A candidate cannot truthfully have been prepared before the recommendation it rests on existed.
  // Both instants are caller-asserted canonical UTC and no clock is read here, so this is a
  // consistency check between two stated facts. Equality passes: preparing a candidate in the same
  // instant the recommendation was made is coherent.
  if (
    canonicalInstantEpochMs(parsed.data.preparedAt) <
    canonicalInstantEpochMs(recommendation.createdAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'PREPARED_BEFORE_RECOMMENDATION' as const,
    });
  }

  const observation = coreEligibilityObservationSchema.safeParse(parsed.data.coreObservation);
  if (!observation.success) {
    return Object.freeze({
      ok: false as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      coreReason: 'OBSERVATION_INVALID' as const,
    });
  }

  const candidate = {
    contractVersion: AAROHI_AVG6_CONTRACT_VERSION,
    candidateRef: parsed.data.candidateRef,
    sourceChannel: AAROHI_AVG6_HANDOFF_SOURCE_CHANNEL,
    targetChannel: AAROHI_AVG6_HANDOFF_TARGET_CHANNEL,
    outcome: WHATSAPP_CHANNEL_HANDOFF_OUTCOME,
    prospectRef: conversation.prospectRef,
    instagramConversationRef: conversation.instagramConversationRef,
    instagramThreadRef: conversation.instagramThreadRef,
    instagramParticipantRef: conversation.instagramParticipantRef,
    whatsappParticipantRef: recommendation.whatsappParticipantRef,
    identityRecommendationRef: recommendation.recommendationRef,
    coreStatus: core.status,
    coreLookupRef: observation.data.coreLookupRef,
    preparedAt: parsed.data.preparedAt,
    posture: WHATSAPP_CHANNEL_HANDOFF_POSTURE,
  };

  // Parsed before it is returned. The schema is the contract, and a contract nothing ever runs is a
  // paragraph.
  if (!whatsappChannelHandoffCandidateSchema.safeParse(candidate).success) {
    return Object.freeze({ ok: false as const, refusal: 'HANDOFF_CANDIDATE_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, candidate: Object.freeze(candidate) });
}
