/**
 * AVG-11 — the Aarohi ANALYTICS, ADMIN READ and DASHBOARD offline domain (ADR-0128).
 *
 * The overlay sentence this file exists to satisfy, in full:
 *
 * > Funnel analytics, administrative read APIs and the complete Jarvis OS Aarohi surface.
 * > Read-oriented; the Jarvis OS section stays PLANNED until an activating ADR says otherwise.
 *
 * ### A workflow step is not a business outcome, and that is a shape rather than a rule
 *
 * Analytics is where ten stages of carefully separated evidence get flattened into numbers, and a
 * number loses its provenance the instant it is rendered. The failure this file is designed against
 * is one sentence long: *we prepared forty registration briefs, so forty vendors registered.*
 *
 * So the separation is structural in three ways at once.
 *
 * A stage is never named by the caller. `AarohiFunnelStage` is a closed vocabulary, and the stage an
 * artifact counts for is DERIVED from which certified sibling parser accepts it — an AVG-9
 * registration-assistance brief can only ever reach `REGISTRATION_ASSISTANCE_PREPARED`, because
 * there is no input field in which a caller could say otherwise and no stage token spelled
 * `REGISTERED`, `PAID`, `ACTIVE` or `CONVERTED` for it to reach.
 *
 * A count is never separable from its authority. `AAROHI_STAGE_AUTHORITY` is a total map from stage
 * to authority class, so `CORE_ACTIVE_HANDOFF_CONFIRMED` is `CORE_AUTHORITATIVE` by construction and
 * every other stage is `JARVIS_WORKFLOW_DERIVED` by construction. A caller supplies neither.
 *
 * And the one Core-authoritative stage is not counted from an artifact at all. It re-runs
 * {@link completeCoreActiveHandoff} — AVG-1's own canonical function, unchanged, unwrapped and not
 * duplicated — over the acquisition case and Core's attestation, and counts only what that function
 * itself confirms. A caller handing in a case already sitting at `HANDED_OFF_TO_ANISHA` is refused,
 * because the canonical function refuses it; a provider receipt, a model verdict or a conversation
 * claim is refused, because the canonical function refuses those too.
 *
 * ### UNKNOWN is not ZERO, and the unavailable metric has no field to hold a zero in
 *
 * A funnel metric is a discriminated union. The two readable variants carry `distinctProspects`; the
 * unavailable variant carries `expectedAuthority` and a reason and HAS NO COUNT KEY AT ALL. So
 * "Core active data is not connected" cannot become "0 active vendors" through a mapping bug, a
 * default, a `?? 0` or a client that forgot to check a flag — there is nothing there to read.
 *
 * Whether a source was read is declared per authority CLASS, once, by the boundary that did or did
 * not read it. That is the one fact a pure function genuinely cannot derive: an empty array looks
 * identical either way. Supplying evidence of a class declared unobserved is a refusal rather than a
 * silent upgrade, so the declaration cannot drift from what was actually collected.
 *
 * ### No rates, and that is a decision rather than an omission
 *
 * There is no rate, ratio, percentage or conversion field in this file, and no function computes
 * one. A conversion rate needs a numerator and a denominator that are known, compatible and drawn
 * from one cohort; across an authority boundary — a Jarvis-derived numerator over a
 * Core-authoritative denominator, or either over a source nobody read — none of those hold. Counts
 * and availability are the whole safe answer, so they are the whole answer.
 *
 * ### No time, no cohorts, no trend
 *
 * No durable event source exists for any of this evidence, so there is nothing to bucket by hour or
 * week and no honest way to say a stage grew. The report is a static snapshot with one instant of
 * its own, `preparedAt`, which is checked against the evidence it rests on and used for nothing
 * else. There is no window, no `since`, no `until` and no series.
 *
 * ### Aggregate only, and no destination can survive the count
 *
 * The report carries stage tokens, an authority class and integers. It carries no prospect
 * reference, no case, no draft, no conversation, no message, no brief reference, no Core lookup and
 * no package — so no phone number, address, handle, GST, message body, model output or provider
 * payload has anywhere to live. Evidence is read, counted and discarded inside one pure function.
 *
 * Pure domain only: no runtime, persistence, model call, prompt, retrieval, network, Supabase,
 * QuickFurno import, provider, transport, execution, admin write or production activation.
 */
import { z } from 'zod';

import { acquisitionCaseSchema } from './acquisition-case.js';
import type { AcquisitionCase } from './acquisition-case.js';
import { HANDOFF_REFUSAL_REASONS, completeCoreActiveHandoff } from './active-handoff.js';
import type { HandoffRefusalReason } from './active-handoff.js';
import {
  ACQUISITION_REFUSAL_REASONS,
  coreEligibilityObservationSchema,
  evaluateAcquisitionEligibility,
} from './existing-vendor-gate.js';
import { createProspectIdentity } from './prospect-identity.js';
import { parseWorkspaceDraft } from './avg4-outreach-workspace.js';
import { parseInstagramConversation } from './avg5-instagram-conversation.js';
import { parseAarohiCommercialFactsBrief } from './avg8-commercial-truth.js';
import { parseAarohiRegistrationAssistanceBrief } from './avg9-registration-integration.js';
import { parseAarohiPaymentFollowupBrief } from './avg10-payment-activation-handoff.js';

/** Version of the complete AVG-11 offline analytics and read-surface contract in this package. */
export const AAROHI_AVG11_CONTRACT_VERSION = 1 as const;
export type AarohiAvg11ContractVersion = typeof AAROHI_AVG11_CONTRACT_VERSION;

/**
 * Where the evidence behind a report came from, stated unflatteringly.
 *
 * Injected, offline, and asserted by whoever called this function. It is NOT a query against a
 * store, not an authenticated read of production Core, not a warehouse extract and not telemetry:
 * this package holds no Supabase client, no service-role key, no HTTP client and no import of the
 * QuickFurno marketplace. `evidenceSourceAuthenticated: false` says it again on every report.
 */
export const AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE =
  'INJECTED_OFFLINE_AAROHI_WORKFLOW_EVIDENCE' as const;
export type AarohiAnalyticsEvidenceSourcePosture = typeof AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE;

// ---------------------------------------------------------------------------
// Shared primitives.
//
// AVG-11 introduces exactly ONE reference of its own -- `reportRef` -- and inherits none, because
// the report is aggregate and names no upstream artifact. So only the LOCAL screen appears here,
// and there is no inherited-reference grammar to restate. The screen itself is restated rather than
// borrowed from a sibling, for the reason ADR-0124 records: reaching into a certified stage to take
// a private regex would widen that file's surface for this file's convenience. A spec asserts the
// grammars still agree.
//
// The certified sibling SCHEMAS below are imported rather than restated, which is the opposite
// choice and the right one for the same reason. A recogniser that re-implemented AVG-9's brief
// shape would be a second definition of what a registration brief is, and the whole safety argument
// here is that there is exactly one.
// ---------------------------------------------------------------------------

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** Shapes an AVG-11-local reference may not contain, named by SHAPE rather than by platform. */
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

/** The most digits an AVG-11-local artifact reference may contain before it is a destination. */
const MAX_NON_DESTINATION_DIGITS = 6;

function hasTooManyDestinationDigits(text: string): boolean {
  let digits = 0;
  for (const character of text) {
    if (character >= '0' && character <= '9') {
      digits += 1;
      if (digits > MAX_NON_DESTINATION_DIGITS) return true;
    }
  }
  return false;
}

/** The one identity AVG-11 itself introduces. Both screens apply. */
const AVG11_LOCAL_ARTIFACT_REF = OPAQUE_REF.refine(
  (one: string) => !hasContactShape(one) && !hasTooManyDestinationDigits(one),
);

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
 * lexicographic order is not chronological order across them. No clock is read.
 */
function canonicalInstantEpochMs(instant: string): number {
  return Date.parse(instant);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// The funnel VOCABULARY, and the authority that belongs to each stage.
// ---------------------------------------------------------------------------

/**
 * The acquisition funnel, derived from certified contracts and from nothing else.
 *
 * Every member below is backed by an artifact some earlier stage certifies, and every stage a
 * marketing funnel would want and this repository cannot prove is absent. Read what is NOT here:
 * no `REGISTERED`, `PAID`, `ACTIVE`, `CONVERTED`, `WON`, `CHURNED`, `CONTACTED`, `DELIVERED`,
 * `REPLIED`, `QUALIFIED` or `AWAITING_CORE_ACTIVATION`.
 *
 * `CONTACTED` deserves its own note, because it is the one a reader will look for. Nothing in this
 * repository can send, so nothing can be contacted; AVG-4 prepares a DRAFT and AVG-5 observes an
 * INBOUND message, and those are the two facts, stated as themselves.
 *
 * The order is the funnel order and is fixed. It is serialization, and provably not a ranking.
 */
export const AAROHI_FUNNEL_STAGES = [
  /** A certified AVG-1 prospect identity exists. Not a vendor, and not a lead Core knows about. */
  'PROSPECT_IDENTIFIED',
  /** A Core observation was run through the AVG-1 gate. Says nothing about what the gate answered. */
  'ELIGIBILITY_EVALUATED',
  /** The AVG-1 gate itself returned eligible for cold acquisition. Re-derived, never asserted. */
  'ELIGIBLE_NET_NEW',
  /** A certified AVG-4 outreach draft exists. A draft is not an approval and not a send. */
  'OUTREACH_WORKSPACE_PREPARED',
  /** A certified AVG-5 conversation exists. Inbound observations only; Aarohi said nothing. */
  'CONVERSATION_OBSERVED',
  /** A certified AVG-8 commercial-facts brief exists. Core reference data, never a quote or offer. */
  'COMMERCIAL_CONTEXT_PREPARED',
  /** A certified AVG-9 registration-assistance brief exists. ASSISTANCE PREPARED, never REGISTERED. */
  'REGISTRATION_ASSISTANCE_PREPARED',
  /** A certified AVG-10 payment-follow-up brief exists. ASSISTANCE PREPARED, never PAID, never ACTIVE. */
  'PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED',
  /** QuickFurno Core attested ACTIVE and AVG-1's own handoff confirmed it. The only terminal truth. */
  'CORE_ACTIVE_HANDOFF_CONFIRMED',
] as const;
export type AarohiFunnelStage = (typeof AAROHI_FUNNEL_STAGES)[number];

/**
 * Who is entitled to be believed about one number — the closed distinction ADR-0128 turns on.
 *
 * Deliberately NOT the same concept as Jarvis OS's `SectionAvailability` (can this whole panel be
 * read?) or a snapshot's `Provenance` (where did this payload come from?). Those describe a
 * TRANSPORT; this describes AUTHORITY over a single figure, and collapsing the three into one
 * generic status is how "not connected" starts rendering as "none".
 */
export const AAROHI_METRIC_AUTHORITIES = [
  /**
   * Counted from Jarvis-side artifacts certified by this package.
   *
   * True about Aarohi's own work and about nothing else. A brief was prepared; a draft was written;
   * an inbound message was observed. None of it is a QuickFurno business outcome and none of it may
   * be read as one.
   */
  'JARVIS_WORKFLOW_DERIVED',
  /**
   * Established by canonical QuickFurno Core evidence, re-derived through AVG-1's own function.
   *
   * The only class a business outcome may ever carry.
   */
  'CORE_AUTHORITATIVE',
  /** No source for this metric was read. NOT zero — and this variant has no count field at all. */
  'AUTHORITY_UNAVAILABLE',
] as const;
export type AarohiMetricAuthority = (typeof AAROHI_METRIC_AUTHORITIES)[number];

/** The two classes a READABLE metric may carry. `AUTHORITY_UNAVAILABLE` is the absence of one. */
export type AarohiResolvedMetricAuthority = Exclude<AarohiMetricAuthority, 'AUTHORITY_UNAVAILABLE'>;

/**
 * Stage to authority, TOTAL over the vocabulary.
 *
 * A stage added without an entry does not compile, so a new stage cannot arrive with its authority
 * left to a default — and the one entry that says `CORE_AUTHORITATIVE` is visible on a single line
 * instead of being spread across a builder.
 */
export const AAROHI_STAGE_AUTHORITY: Readonly<
  Record<AarohiFunnelStage, AarohiResolvedMetricAuthority>
> = Object.freeze({
  PROSPECT_IDENTIFIED: 'JARVIS_WORKFLOW_DERIVED',
  ELIGIBILITY_EVALUATED: 'JARVIS_WORKFLOW_DERIVED',
  ELIGIBLE_NET_NEW: 'JARVIS_WORKFLOW_DERIVED',
  OUTREACH_WORKSPACE_PREPARED: 'JARVIS_WORKFLOW_DERIVED',
  CONVERSATION_OBSERVED: 'JARVIS_WORKFLOW_DERIVED',
  COMMERCIAL_CONTEXT_PREPARED: 'JARVIS_WORKFLOW_DERIVED',
  REGISTRATION_ASSISTANCE_PREPARED: 'JARVIS_WORKFLOW_DERIVED',
  PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED: 'JARVIS_WORKFLOW_DERIVED',
  CORE_ACTIVE_HANDOFF_CONFIRMED: 'CORE_AUTHORITATIVE',
});

/**
 * Why a metric carries no number.
 *
 * One member, because there is exactly one honest reason in an offline domain: nobody read the
 * source. A richer vocabulary here would be diagnosis, and diagnosis belongs to whichever boundary
 * failed to read — not to a report that never attempted a read in the first place.
 */
export const AAROHI_METRIC_UNAVAILABLE_REASONS = ['EVIDENCE_SOURCE_NOT_OBSERVED'] as const;
export type AarohiMetricUnavailableReason = (typeof AAROHI_METRIC_UNAVAILABLE_REASONS)[number];

/** Whether the boundary that called this function actually read a class of evidence. */
export const AAROHI_EVIDENCE_SOURCE_STATES = ['OBSERVED', 'NOT_OBSERVED'] as const;
export type AarohiEvidenceSourceState = (typeof AAROHI_EVIDENCE_SOURCE_STATES)[number];

/**
 * What the calling boundary read, declared per authority CLASS.
 *
 * The distinction between `OBSERVED` with nothing found and `NOT_OBSERVED` is the entire
 * unknown-is-not-zero property. `OBSERVED` with no evidence is a genuine zero and is reported as
 * one; `NOT_OBSERVED` produces a metric with no number in it at all.
 */
export interface AarohiEvidenceSources {
  readonly jarvisWorkflow: AarohiEvidenceSourceState;
  readonly coreAuthoritative: AarohiEvidenceSourceState;
}

export const aarohiEvidenceSourcesSchema = z
  .object({
    jarvisWorkflow: z.enum(AAROHI_EVIDENCE_SOURCE_STATES),
    coreAuthoritative: z.enum(AAROHI_EVIDENCE_SOURCE_STATES),
  })
  .strict();

// ---------------------------------------------------------------------------
// The evidence KINDS, and the certified parser that recognises each one.
// ---------------------------------------------------------------------------

/**
 * The artifacts AVG-11 can count, as a closed vocabulary.
 *
 * A caller never supplies one of these tokens. The kind is DERIVED by handing each submitted value
 * to the certified sibling parsers and seeing which — exactly one — certifies it. That is what makes
 * the stage un-choosable: for a payment brief to be counted as a registration it would have to parse
 * as an AVG-9 brief, and the strict schemas do not overlap.
 */
export const AAROHI_ANALYTICS_EVIDENCE_KINDS = [
  'PROSPECT_IDENTITY',
  'CORE_ELIGIBILITY_OBSERVATION',
  'OUTREACH_WORKSPACE_DRAFT',
  'INSTAGRAM_CONVERSATION_SNAPSHOT',
  'COMMERCIAL_FACTS_BRIEF',
  'REGISTRATION_ASSISTANCE_BRIEF',
  'PAYMENT_FOLLOWUP_BRIEF',
  'CORE_ACTIVE_HANDOFF_EVIDENCE',
] as const;
export type AarohiAnalyticsEvidenceKind = (typeof AAROHI_ANALYTICS_EVIDENCE_KINDS)[number];

/** The most evidence items one report may consider. A report is not a data export. */
export const MAX_AAROHI_ANALYTICS_EVIDENCE = 500;

/**
 * The ONE composite evidence shape, and the only place a caller supplies two artifacts at once.
 *
 * Both halves are `unknown` and both are judged by {@link completeCoreActiveHandoff}. AVG-11 adds no
 * check of its own here on purpose: a second, similar-looking rule beside the canonical one is how
 * two definitions of "handed off" come to exist.
 */
export interface CoreActiveHandoffEvidence {
  readonly acquisitionCase: unknown;
  readonly activationAttestation: unknown;
}

/**
 * Exactly two keys, both present. An exact key set rather than a subset check, so a payload carrying
 * an attestation plus something else is unrecognised rather than quietly half-read.
 */
function isCoreActiveHandoffEvidenceShape(value: unknown): value is CoreActiveHandoffEvidence {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    Object.hasOwn(value, 'acquisitionCase') &&
    Object.hasOwn(value, 'activationAttestation')
  );
}

/**
 * The acquisition case as `completeCoreActiveHandoff` itself accepts it.
 *
 * Mirrors the canonical function's own extension exactly — the base schema plus the closed optional
 * refusal reason — so a case AVG-1 would judge reaches AVG-1 to be judged, rather than being turned
 * away here on a shape technicality and reported under the wrong refusal.
 */
const handoffCaseSchema = acquisitionCaseSchema.extend({
  refusalReason: z.enum(ACQUISITION_REFUSAL_REASONS).optional(),
});

/**
 * One recognised evidence item, as this module holds it internally.
 *
 * Never returned and never exported. In particular `certifiedProspectRef` and `evidenceRef` exist
 * only to make counting and conflict detection possible; they are discarded when the function
 * returns, because the report is aggregate and no reference of any kind survives into it.
 */
interface RecognisedEvidence {
  readonly kind: AarohiAnalyticsEvidenceKind;
  readonly authority: AarohiResolvedMetricAuthority;
  readonly stages: readonly AarohiFunnelStage[];
  readonly certifiedProspectRef: string;
  readonly evidenceRef: string;
  /** The artifact's own instant, where its owner certifies one. Absent where none exists. */
  readonly certifiedAt?: string | undefined;
  /** Present only for handoff evidence, and only when AVG-1's own function refused it. */
  readonly handoffRefusal?: HandoffRefusalReason | undefined;
}

type Recogniser = (value: unknown) => RecognisedEvidence | undefined;

/**
 * The recognisers.
 *
 * Their order decides nothing. A value recognised by more than one is REFUSED rather than resolved
 * by precedence, because two certified parsers accepting one payload is a governance defect and
 * picking a winner would hide it.
 */
const RECOGNISERS: readonly Recogniser[] = Object.freeze<readonly Recogniser[]>([
  // AVG-1 prospect identity. Re-BUILT through its owner's builder rather than shape-matched, so a
  // plain object that merely looks like an identity is not counted as one.
  (value) => {
    const identity = createProspectIdentity(value);
    if (identity === undefined) return undefined;
    return {
      kind: 'PROSPECT_IDENTITY',
      authority: 'JARVIS_WORKFLOW_DERIVED',
      stages: Object.freeze<AarohiFunnelStage[]>(['PROSPECT_IDENTIFIED']),
      certifiedProspectRef: identity.prospectRef,
      evidenceRef: identity.prospectRef,
      certifiedAt: undefined,
      handoffRefusal: undefined,
    };
  },

  // AVG-1 Core eligibility observation. The VERDICT is re-derived through the AVG-1 gate under the
  // observation's OWN prospect, so an observation can never be credited to another party and a
  // caller cannot assert an eligibility the gate would refuse.
  (value) => {
    const shape = coreEligibilityObservationSchema.safeParse(value);
    if (!shape.success) return undefined;
    const verdict = evaluateAcquisitionEligibility(shape.data.prospectRef, value);
    const stages: AarohiFunnelStage[] = ['ELIGIBILITY_EVALUATED'];
    if (verdict.eligible) stages.push('ELIGIBLE_NET_NEW');
    return {
      kind: 'CORE_ELIGIBILITY_OBSERVATION',
      authority: 'JARVIS_WORKFLOW_DERIVED',
      stages: Object.freeze(stages),
      certifiedProspectRef: shape.data.prospectRef,
      evidenceRef: shape.data.coreLookupRef,
      certifiedAt: undefined,
      handoffRefusal: undefined,
    };
  },

  // AVG-4 outreach draft. Its BODY is read by AVG-4's parser, never by this module, and is discarded
  // with the certified draft the moment this recogniser returns.
  (value) => {
    const draft = parseWorkspaceDraft(value);
    if (draft === undefined) return undefined;
    return {
      kind: 'OUTREACH_WORKSPACE_DRAFT',
      authority: 'JARVIS_WORKFLOW_DERIVED',
      stages: Object.freeze<AarohiFunnelStage[]>(['OUTREACH_WORKSPACE_PREPARED']),
      certifiedProspectRef: draft.prospectRef,
      evidenceRef: draft.draftRef,
      certifiedAt: draft.changedAt,
      handoffRefusal: undefined,
    };
  },

  // AVG-5 conversation snapshot. Its instant is the LATEST inbound turn it carries, because that is
  // the newest fact the snapshot attests to. Message bodies are discarded with it.
  (value) => {
    const conversation = parseInstagramConversation(value);
    if (conversation === undefined) return undefined;
    const latest = conversation.inboundTurns.reduce<string | undefined>(
      (newest, turn) =>
        newest === undefined ||
        canonicalInstantEpochMs(turn.observedAt) > canonicalInstantEpochMs(newest)
          ? turn.observedAt
          : newest,
      undefined,
    );
    return {
      kind: 'INSTAGRAM_CONVERSATION_SNAPSHOT',
      authority: 'JARVIS_WORKFLOW_DERIVED',
      stages: Object.freeze<AarohiFunnelStage[]>(['CONVERSATION_OBSERVED']),
      certifiedProspectRef: conversation.prospectRef,
      evidenceRef: conversation.instagramConversationRef,
      certifiedAt: latest,
      handoffRefusal: undefined,
    };
  },

  // AVG-8 commercial-facts brief. Core reference data was prepared; nothing was quoted or offered.
  (value) => {
    const brief = parseAarohiCommercialFactsBrief(value);
    if (brief === undefined) return undefined;
    return {
      kind: 'COMMERCIAL_FACTS_BRIEF',
      authority: 'JARVIS_WORKFLOW_DERIVED',
      stages: Object.freeze<AarohiFunnelStage[]>(['COMMERCIAL_CONTEXT_PREPARED']),
      certifiedProspectRef: brief.prospectRef,
      evidenceRef: brief.briefRef,
      certifiedAt: brief.preparedAt,
      handoffRefusal: undefined,
    };
  },

  // AVG-9 registration-assistance brief. ASSISTANCE PREPARED. Never REGISTERED.
  (value) => {
    const brief = parseAarohiRegistrationAssistanceBrief(value);
    if (brief === undefined) return undefined;
    return {
      kind: 'REGISTRATION_ASSISTANCE_BRIEF',
      authority: 'JARVIS_WORKFLOW_DERIVED',
      stages: Object.freeze<AarohiFunnelStage[]>(['REGISTRATION_ASSISTANCE_PREPARED']),
      certifiedProspectRef: brief.prospectRef,
      evidenceRef: brief.briefRef,
      certifiedAt: brief.preparedAt,
      handoffRefusal: undefined,
    };
  },

  // AVG-10 payment-follow-up brief. ASSISTANCE PREPARED. Never PAID, and emphatically never ACTIVE.
  (value) => {
    const brief = parseAarohiPaymentFollowupBrief(value);
    if (brief === undefined) return undefined;
    return {
      kind: 'PAYMENT_FOLLOWUP_BRIEF',
      authority: 'JARVIS_WORKFLOW_DERIVED',
      stages: Object.freeze<AarohiFunnelStage[]>(['PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED']),
      certifiedProspectRef: brief.prospectRef,
      evidenceRef: brief.briefRef,
      certifiedAt: brief.preparedAt,
      handoffRefusal: undefined,
    };
  },

  // The one CORE_AUTHORITATIVE kind. AVG-1's own function decides and this module reads only whether
  // it said yes: the case it returns is used for identity and discarded, nothing is transitioned,
  // and the case handed in is never mutated. There is no second route into `HANDED_OFF_TO_ANISHA`.
  (value) => {
    if (!isCoreActiveHandoffEvidenceShape(value)) return undefined;

    const shaped = handoffCaseSchema.safeParse(value.acquisitionCase);
    if (!shaped.success) {
      return {
        kind: 'CORE_ACTIVE_HANDOFF_EVIDENCE',
        authority: 'CORE_AUTHORITATIVE',
        stages: Object.freeze<AarohiFunnelStage[]>([]),
        certifiedProspectRef: '',
        evidenceRef: '',
        certifiedAt: undefined,
        handoffRefusal: 'CASE_INVALID',
      };
    }

    const current: AcquisitionCase = shaped.data;
    const outcome = completeCoreActiveHandoff(current, value.activationAttestation);
    if (!outcome.ok) {
      return {
        kind: 'CORE_ACTIVE_HANDOFF_EVIDENCE',
        authority: 'CORE_AUTHORITATIVE',
        stages: Object.freeze<AarohiFunnelStage[]>([]),
        certifiedProspectRef: current.prospectRef,
        evidenceRef: current.caseRef,
        certifiedAt: undefined,
        handoffRefusal: outcome.reason,
      };
    }
    return {
      kind: 'CORE_ACTIVE_HANDOFF_EVIDENCE',
      authority: 'CORE_AUTHORITATIVE',
      stages: Object.freeze<AarohiFunnelStage[]>(['CORE_ACTIVE_HANDOFF_CONFIRMED']),
      certifiedProspectRef: outcome.next.prospectRef,
      evidenceRef: outcome.next.caseRef,
      certifiedAt: undefined,
      handoffRefusal: undefined,
    };
  },
]);

// ---------------------------------------------------------------------------
// The refusal vocabulary.
// ---------------------------------------------------------------------------

/** Why a funnel report may not be produced. Closed, content-free, and never free text. */
export const AAROHI_ANALYTICS_REFUSALS = [
  /** The report envelope did not parse. */
  'REPORT_INPUT_INVALID',
  /** More evidence than one report may consider. A report is not a data export. */
  'EVIDENCE_LIMIT_EXCEEDED',
  /** A submitted value is certified by no sibling stage. Fail closed; never counted as "other". */
  'EVIDENCE_UNRECOGNISED',
  /** A submitted value is certified by more than one sibling. A defect, not a tie to break. */
  'EVIDENCE_AMBIGUOUS',
  /** Evidence arrived for an authority class the caller declared it had not read. */
  'EVIDENCE_SUPPLIED_FOR_UNOBSERVED_SOURCE',
  /** AVG-1's own handoff function refused. Its reason is surfaced rather than flattened. */
  'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED',
  /** One evidence identity was presented for two different prospects. */
  'EVIDENCE_IDENTITY_CONFLICT',
  /** The report claims to predate evidence it counts. */
  'REPORT_PREDATES_EVIDENCE',
] as const;
export type AarohiAnalyticsRefusal = (typeof AAROHI_ANALYTICS_REFUSALS)[number];

// ---------------------------------------------------------------------------
// The posture. Every non-effect a literal falsehood rather than a sentence.
// ---------------------------------------------------------------------------

/**
 * What producing a report did NOT do.
 *
 * `unknownReportedAsZero: false` is the field this stage exists for, and it is not merely a claim:
 * the unavailable metric variant has no count key, so there is no zero available to report.
 */
export interface AarohiAnalyticsPosture {
  readonly readOnlyAnalytics: true;
  readonly evidenceSourceAuthenticated: false;

  readonly unknownReportedAsZero: false;
  readonly conversionRateCalculated: false;
  readonly revenueReported: false;
  readonly businessOutcomeClaimed: false;

  readonly registrationConfirmed: false;
  readonly paymentConfirmed: false;
  readonly activationConfirmed: false;
  readonly vendorActivated: false;
  readonly anishaHandoffExecuted: false;

  readonly acquisitionCaseMutated: false;
  readonly registrationMutated: false;
  readonly paymentMutated: false;
  readonly activationMutated: false;
  readonly marketplaceMutated: false;
  readonly packageOrderCreated: false;
  readonly creditsMutated: false;

  readonly modelCallExecuted: false;
  readonly promptResolved: false;
  readonly retrievalExecuted: false;

  readonly communicationRequestCreated: false;
  readonly approvalRequestCreated: false;
  readonly approvalDecisionCreated: false;
  readonly communicationAuthorizationCreated: false;
  readonly executionIntentCreated: false;

  readonly n8nExecutionRequested: false;
  readonly providerSendRequested: false;
  readonly channelSendRequested: false;
  readonly sent: false;
  readonly delivered: false;

  readonly persisted: false;
  readonly adminWriteExposed: false;
  readonly productionMutation: false;
  readonly businessEffect: false;

  readonly requiresCoreAuthorityForAnyBusinessOutcome: true;
  readonly requiresActivatingAdrBeforeRuntimeUse: true;
}

export const aarohiAnalyticsPostureSchema = z
  .object({
    readOnlyAnalytics: z.literal(true),
    evidenceSourceAuthenticated: z.literal(false),

    unknownReportedAsZero: z.literal(false),
    conversionRateCalculated: z.literal(false),
    revenueReported: z.literal(false),
    businessOutcomeClaimed: z.literal(false),

    registrationConfirmed: z.literal(false),
    paymentConfirmed: z.literal(false),
    activationConfirmed: z.literal(false),
    vendorActivated: z.literal(false),
    anishaHandoffExecuted: z.literal(false),

    acquisitionCaseMutated: z.literal(false),
    registrationMutated: z.literal(false),
    paymentMutated: z.literal(false),
    activationMutated: z.literal(false),
    marketplaceMutated: z.literal(false),
    packageOrderCreated: z.literal(false),
    creditsMutated: z.literal(false),

    modelCallExecuted: z.literal(false),
    promptResolved: z.literal(false),
    retrievalExecuted: z.literal(false),

    communicationRequestCreated: z.literal(false),
    approvalRequestCreated: z.literal(false),
    approvalDecisionCreated: z.literal(false),
    communicationAuthorizationCreated: z.literal(false),
    executionIntentCreated: z.literal(false),

    n8nExecutionRequested: z.literal(false),
    providerSendRequested: z.literal(false),
    channelSendRequested: z.literal(false),
    sent: z.literal(false),
    delivered: z.literal(false),

    persisted: z.literal(false),
    adminWriteExposed: z.literal(false),
    productionMutation: z.literal(false),
    businessEffect: z.literal(false),

    requiresCoreAuthorityForAnyBusinessOutcome: z.literal(true),
    requiresActivatingAdrBeforeRuntimeUse: z.literal(true),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const AAROHI_ANALYTICS_POSTURE: AarohiAnalyticsPosture = Object.freeze(
  aarohiAnalyticsPostureSchema.parse({
    readOnlyAnalytics: true,
    evidenceSourceAuthenticated: false,

    unknownReportedAsZero: false,
    conversionRateCalculated: false,
    revenueReported: false,
    businessOutcomeClaimed: false,

    registrationConfirmed: false,
    paymentConfirmed: false,
    activationConfirmed: false,
    vendorActivated: false,
    anishaHandoffExecuted: false,

    acquisitionCaseMutated: false,
    registrationMutated: false,
    paymentMutated: false,
    activationMutated: false,
    marketplaceMutated: false,
    packageOrderCreated: false,
    creditsMutated: false,

    modelCallExecuted: false,
    promptResolved: false,
    retrievalExecuted: false,

    communicationRequestCreated: false,
    approvalRequestCreated: false,
    approvalDecisionCreated: false,
    communicationAuthorizationCreated: false,
    executionIntentCreated: false,

    n8nExecutionRequested: false,
    providerSendRequested: false,
    channelSendRequested: false,
    sent: false,
    delivered: false,

    persisted: false,
    adminWriteExposed: false,
    productionMutation: false,
    businessEffect: false,

    requiresCoreAuthorityForAnyBusinessOutcome: true,
    requiresActivatingAdrBeforeRuntimeUse: true,
  }),
);

// ---------------------------------------------------------------------------
// The METRIC, and the reason an unavailable one cannot be read as zero.
// ---------------------------------------------------------------------------

/**
 * One funnel metric.
 *
 * A discriminated union on `authority`, and the discrimination is the safety property. The readable
 * variants carry `distinctProspects`; the unavailable variant has NO count key, so there is nothing
 * for a mapper, a default or a client to read as zero. `expectedAuthority` says which class WOULD
 * have owned the number, which is what a surface needs to explain a gap without inventing one.
 */
export type AarohiFunnelMetric =
  | {
      readonly stage: AarohiFunnelStage;
      readonly authority: AarohiResolvedMetricAuthority;
      /**
       * How many DISTINCT prospects have at least one certifying artifact for this stage.
       *
       * Distinct prospects rather than artifacts, which is what makes duplicate evidence
       * structurally non-inflating: two copies of one brief, or two different briefs for one
       * prospect, are one prospect either way.
       */
      readonly distinctProspects: number;
    }
  | {
      readonly stage: AarohiFunnelStage;
      readonly authority: 'AUTHORITY_UNAVAILABLE';
      readonly expectedAuthority: AarohiResolvedMetricAuthority;
      readonly unavailableReason: AarohiMetricUnavailableReason;
    };

export const aarohiFunnelMetricSchema = z.discriminatedUnion('authority', [
  z
    .object({
      stage: z.enum(AAROHI_FUNNEL_STAGES),
      authority: z.literal('JARVIS_WORKFLOW_DERIVED'),
      distinctProspects: z.number().int().min(0).max(MAX_AAROHI_ANALYTICS_EVIDENCE),
    })
    .strict(),
  z
    .object({
      stage: z.enum(AAROHI_FUNNEL_STAGES),
      authority: z.literal('CORE_AUTHORITATIVE'),
      distinctProspects: z.number().int().min(0).max(MAX_AAROHI_ANALYTICS_EVIDENCE),
    })
    .strict(),
  z
    .object({
      stage: z.enum(AAROHI_FUNNEL_STAGES),
      authority: z.literal('AUTHORITY_UNAVAILABLE'),
      expectedAuthority: z.enum(['JARVIS_WORKFLOW_DERIVED', 'CORE_AUTHORITATIVE']),
      unavailableReason: z.enum(AAROHI_METRIC_UNAVAILABLE_REASONS),
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// The REPORT.
// ---------------------------------------------------------------------------

/**
 * The single positive thing a funnel report may say.
 *
 * Deliberately long, and deliberately naming a READ SURFACE rather than a result. `FUNNEL_READY`,
 * `ANALYTICS_AVAILABLE` or `CONVERSION_MEASURED` would each be read by somebody who never opens
 * this file.
 */
export const AAROHI_ACQUISITION_FUNNEL_OUTCOME =
  'AAROHI_ACQUISITION_FUNNEL_READY_FOR_GOVERNED_READ_SURFACE' as const;
export type AarohiAcquisitionFunnelOutcome = typeof AAROHI_ACQUISITION_FUNNEL_OUTCOME;

/**
 * An aggregate acquisition funnel report.
 *
 * Note what is absent, because the absences are the data-minimization proof: no prospect reference,
 * no case, no draft, no conversation, no message, no brief reference, no Core lookup, no package, no
 * amount, no name, no handle, no destination — and no rate, ratio, percentage, trend or series.
 * What remains is nine stage tokens, an authority class each, and integers where a number is
 * genuinely known.
 */
export interface AarohiAcquisitionFunnelReport {
  readonly contractVersion: AarohiAvg11ContractVersion;
  readonly reportRef: string;
  readonly preparedAt: string;
  readonly sourcePosture: AarohiAnalyticsEvidenceSourcePosture;
  readonly evidenceSources: AarohiEvidenceSources;
  /** Exactly one metric per stage, in `AAROHI_FUNNEL_STAGES` order. Always all nine. */
  readonly metrics: readonly AarohiFunnelMetric[];
  readonly outcome: AarohiAcquisitionFunnelOutcome;
  readonly posture: AarohiAnalyticsPosture;
}

export const aarohiAcquisitionFunnelReportSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG11_CONTRACT_VERSION),
    reportRef: AVG11_LOCAL_ARTIFACT_REF,
    preparedAt: UTC_INSTANT,
    sourcePosture: z.literal(AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE),
    evidenceSources: aarohiEvidenceSourcesSchema,
    metrics: z.array(aarohiFunnelMetricSchema).length(AAROHI_FUNNEL_STAGES.length),
    outcome: z.literal(AAROHI_ACQUISITION_FUNNEL_OUTCOME),
    posture: aarohiAnalyticsPostureSchema,
  })
  .strict()
  .refine(
    (value) => value.metrics.every((metric, index) => metric.stage === AAROHI_FUNNEL_STAGES[index]),
    'metrics must carry every stage exactly once, in the canonical funnel order',
  )
  .refine(
    (value) =>
      value.metrics.every(
        (metric) =>
          metric.authority === 'AUTHORITY_UNAVAILABLE' ||
          metric.authority === AAROHI_STAGE_AUTHORITY[metric.stage],
      ),
    'a metric may not claim an authority its stage does not own',
  )
  .refine(
    (value) =>
      value.metrics.every(
        (metric) =>
          metric.authority !== 'AUTHORITY_UNAVAILABLE' ||
          metric.expectedAuthority === AAROHI_STAGE_AUTHORITY[metric.stage],
      ),
    'an unavailable metric must name the authority its stage actually owns',
  );

/** Re-parse and REBUILD a report. Detaches it from whatever the caller holds. */
export function parseAarohiAcquisitionFunnelReport(
  value: unknown,
): AarohiAcquisitionFunnelReport | undefined {
  const parsed = aarohiAcquisitionFunnelReportSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG11_CONTRACT_VERSION,
    reportRef: parsed.data.reportRef,
    preparedAt: parsed.data.preparedAt,
    sourcePosture: AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE,
    evidenceSources: Object.freeze({ ...parsed.data.evidenceSources }),
    metrics: Object.freeze(parsed.data.metrics.map((metric) => Object.freeze({ ...metric }))),
    outcome: AAROHI_ACQUISITION_FUNNEL_OUTCOME,
    posture: AAROHI_ANALYTICS_POSTURE,
  });
}

/** The result, with AVG-1's own handoff refusal surfaced rather than flattened. */
export type AarohiAcquisitionFunnelReportResult =
  | { readonly ok: true; readonly report: AarohiAcquisitionFunnelReport }
  | {
      readonly ok: false;
      readonly refusal: Exclude<AarohiAnalyticsRefusal, 'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED'>;
    }
  | {
      readonly ok: false;
      readonly refusal: 'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED';
      /** AVG-1's own reason: a wrong authority, an unconfirmed activation, or a case off-boundary. */
      readonly handoffRefusal: HandoffRefusalReason;
    };

/**
 * What a caller may state when building a report.
 *
 * Four fields, and note what is absent: no stage, no metric id, no authority, no provenance, no
 * count, no outcome, no posture, no rate, no window, no cohort and no text. The only things a caller
 * supplies are its own identity and instant, what it actually read, and the EVIDENCE itself.
 */
const funnelReportInputSchema = z
  .object({
    reportRef: AVG11_LOCAL_ARTIFACT_REF,
    preparedAt: UTC_INSTANT,
    evidenceSources: aarohiEvidenceSourcesSchema,
    evidence: z.array(z.unknown()),
  })
  .strict();

/**
 * Build an aggregate acquisition funnel report, or refuse.
 *
 * ### The checks run in a FIXED order over the WHOLE input, never in input order
 *
 * Every check below scans all the evidence before the next one is considered, so shuffling the
 * array cannot change which refusal is returned or what a report contains. Where one check could
 * fire for several items — a handoff refusal, say — the reported reason is chosen by the fixed
 * declaration order of the vocabulary it comes from, never by position.
 *
 * ### It counts prospects, not artifacts
 *
 * A stage's number is the size of the set of distinct prospect references with at least one
 * certifying artifact for it. Submitting one brief twice, or two different briefs for one prospect,
 * cannot inflate anything, because a set has no room for the second copy.
 *
 * ### It executes nothing and transitions nothing
 *
 * Pure over already-supplied values. It reads no clock, opens no connection, persists nothing, and
 * the one canonical function it calls — {@link completeCoreActiveHandoff} — is itself pure: the case
 * it returns is read for an identity and discarded, and the case handed in is never mutated. No
 * acquisition case anywhere ends this call in a different state than it began it.
 */
export function buildAarohiAcquisitionFunnelReport(
  value: unknown,
): AarohiAcquisitionFunnelReportResult {
  const input = funnelReportInputSchema.safeParse(value);
  if (!input.success) {
    return Object.freeze({ ok: false as const, refusal: 'REPORT_INPUT_INVALID' as const });
  }

  const { reportRef, preparedAt, evidenceSources, evidence } = input.data;

  if (evidence.length > MAX_AAROHI_ANALYTICS_EVIDENCE) {
    return Object.freeze({ ok: false as const, refusal: 'EVIDENCE_LIMIT_EXCEEDED' as const });
  }

  // 1. Recognise everything first, so no later check depends on where an item sat in the array.
  const recognitions = evidence.map((item) =>
    RECOGNISERS.map((recognise) => recognise(item)).filter(
      (one): one is RecognisedEvidence => one !== undefined,
    ),
  );

  // 2. Nothing certified it. Fail closed rather than counting it as "other".
  if (recognitions.some((matches) => matches.length === 0)) {
    return Object.freeze({ ok: false as const, refusal: 'EVIDENCE_UNRECOGNISED' as const });
  }

  // 3. Two certified parsers accepted it. A defect, not an ambiguity to resolve by precedence.
  if (recognitions.some((matches) => matches.length > 1)) {
    return Object.freeze({ ok: false as const, refusal: 'EVIDENCE_AMBIGUOUS' as const });
  }

  const recognised: readonly RecognisedEvidence[] = recognitions.flatMap((matches) => {
    const only = matches[0];
    // The two checks above leave exactly one match per item, so this discards nothing in practice.
    // `flatMap` rather than a non-null assertion, which this repository forbids.
    return only === undefined ? [] : [only];
  });

  // 4. A class the caller said it had not read cannot then produce evidence.
  const observed: Readonly<Record<AarohiResolvedMetricAuthority, AarohiEvidenceSourceState>> =
    Object.freeze({
      JARVIS_WORKFLOW_DERIVED: evidenceSources.jarvisWorkflow,
      CORE_AUTHORITATIVE: evidenceSources.coreAuthoritative,
    });
  if (recognised.some((one) => observed[one.authority] === 'NOT_OBSERVED')) {
    return Object.freeze({
      ok: false as const,
      refusal: 'EVIDENCE_SUPPLIED_FOR_UNOBSERVED_SOURCE' as const,
    });
  }

  // 5. AVG-1's handoff refusals, reported by the fixed priority of AVG-1's OWN vocabulary so that
  //    two failing envelopes give the same answer whichever order they arrived in.
  const handoffRefusals = recognised
    .map((one) => one.handoffRefusal)
    .filter((one): one is HandoffRefusalReason => one !== undefined);
  const chosenHandoffRefusal = HANDOFF_REFUSAL_REASONS.find((reason) =>
    handoffRefusals.includes(reason),
  );
  if (chosenHandoffRefusal !== undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED' as const,
      handoffRefusal: chosenHandoffRefusal,
    });
  }

  // 6. One evidence identity cannot belong to two prospects. Scoped per KIND, because a draft and a
  //    conversation that happen to share a reference string are two identities, not one conflict.
  const identityOwner = new Map<string, string>();
  for (const one of recognised) {
    const identity = `${one.kind} ${one.evidenceRef}`;
    const owner = identityOwner.get(identity);
    if (owner === undefined) {
      identityOwner.set(identity, one.certifiedProspectRef);
    } else if (owner !== one.certifiedProspectRef) {
      return Object.freeze({ ok: false as const, refusal: 'EVIDENCE_IDENTITY_CONFLICT' as const });
    }
  }

  // 7. A report cannot predate the evidence it counts.
  const preparedMs = canonicalInstantEpochMs(preparedAt);
  const predatesEvidence = recognised.some(
    (one) => one.certifiedAt !== undefined && canonicalInstantEpochMs(one.certifiedAt) > preparedMs,
  );
  if (predatesEvidence) {
    return Object.freeze({ ok: false as const, refusal: 'REPORT_PREDATES_EVIDENCE' as const });
  }

  // 8. Count DISTINCT prospects per stage. A set, so order cannot matter and duplicates cannot add.
  const prospectsByStage = new Map<AarohiFunnelStage, Set<string>>();
  for (const stage of AAROHI_FUNNEL_STAGES) {
    prospectsByStage.set(stage, new Set<string>());
  }
  for (const one of recognised) {
    for (const stage of one.stages) {
      prospectsByStage.get(stage)?.add(one.certifiedProspectRef);
    }
  }

  const metrics: readonly AarohiFunnelMetric[] = Object.freeze(
    AAROHI_FUNNEL_STAGES.map((stage): AarohiFunnelMetric => {
      const authority = AAROHI_STAGE_AUTHORITY[stage];
      if (observed[authority] === 'NOT_OBSERVED') {
        // No count key exists on this variant. There is nothing here to be read as zero.
        return Object.freeze({
          stage,
          authority: 'AUTHORITY_UNAVAILABLE' as const,
          expectedAuthority: authority,
          unavailableReason: 'EVIDENCE_SOURCE_NOT_OBSERVED' as const,
        });
      }
      return Object.freeze({
        stage,
        authority,
        distinctProspects: prospectsByStage.get(stage)?.size ?? 0,
      });
    }),
  );

  // Validated before it is returned, on every path, so a builder bug fails here rather than
  // downstream in whatever surface believed it.
  const report = parseAarohiAcquisitionFunnelReport({
    contractVersion: AAROHI_AVG11_CONTRACT_VERSION,
    reportRef,
    preparedAt,
    sourcePosture: AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE,
    evidenceSources,
    metrics,
    outcome: AAROHI_ACQUISITION_FUNNEL_OUTCOME,
    posture: AAROHI_ANALYTICS_POSTURE,
  });
  if (report === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'REPORT_INPUT_INVALID' as const });
  }
  return Object.freeze({ ok: true as const, report });
}
