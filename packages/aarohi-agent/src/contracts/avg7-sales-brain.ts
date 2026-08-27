/**
 * AVG-7 — the Aarohi SALES BRAIN offline domain (ADR-0124).
 *
 * The overlay sentence this file exists to satisfy, in full:
 *
 * > The conversation and objection-handling behaviour for acquisition. Bounded by the same
 * > sales-ethics prohibitions as Anisha, and by the rule that the brain proposes and Core disposes —
 * > no commercial commitment originates in the model.
 *
 * ### "The brain proposes and Core disposes"
 *
 * That clause is the file. What this domain produces is a PLAN: a closed strategy token and a
 * bounded reply BRIEF saying what kind of reply would be safe to think about next. It is not a
 * reply. There is no field anywhere in this file that can hold a sentence, and that is deliberate —
 * a string field on a sales artifact is where a price, a guarantee or an invented deadline
 * eventually appears, and no schema can tell those apart from an innocent one once the field exists.
 *
 * ### Why a "sales brain" makes no model call
 *
 * The precedent is already in this repository. `@qf-jarvis/anisha-agent` decides deterministically
 * whether a model boundary may later be used, and calls no model itself; `@qf-jarvis/riya-agent` is
 * the same shape. The governed model waist is `@qf-jarvis/model-gateway` and the governed prompt
 * mechanism is `@qf-jarvis/prompt-registry`, and a future composition will go through both. This
 * file imports neither, depends on neither, and names no provider — because the thing worth proving
 * first is the BEHAVIOUR BOUNDARY that a model would later sit behind. A boundary proved after the
 * model is attached is a boundary proved too late.
 *
 * So the interpretation is INJECTED. It is model-SHAPED — a strict, closed, bounded structure a
 * future gateway response could be parsed into — and it is treated as an untrusted advisory
 * throughout. Nothing here reads message text to produce it.
 *
 * ### What the brain is not allowed to originate
 *
 * No price, package, discount, offer, entitlement or amount — those are AVG-8's, and Core's. No
 * registration, payment or activation claim — those are AVG-9's and AVG-10's, and Core's. No
 * consent, suppression or identity truth — Core's, always. No guarantee of lead volume, revenue or
 * conversion; no invented urgency or scarcity; no unsupported social proof; no hidden material
 * package limitation; no contractual commitment. Every one of those is a `z.literal(false)` on the
 * plan's posture, so the module fails to load if somebody constructs a plan that says otherwise.
 *
 * ### And a rejection outranks everything
 *
 * If the conversation carries a rejection or a contact-privacy concern, the brain stops selling and
 * asks Core to re-decide contact policy — whatever else the same message contained. A commercially
 * interesting message that also says "stop contacting me" is a message that says stop contacting me.
 *
 * Pure domain only: no runtime, persistence, model call, prompt, retrieval, network, provider,
 * transport or execution.
 */
import { z } from 'zod';

import { parseInstagramConversation } from './avg5-instagram-conversation.js';
import {
  coreEligibilityObservationSchema,
  evaluateAcquisitionEligibility,
} from './existing-vendor-gate.js';
import type { AcquisitionRefusalReason, CorePartyStatus } from './existing-vendor-gate.js';

/** Version of the complete AVG-7 offline sales-brain contract in this package. */
export const AAROHI_AVG7_CONTRACT_VERSION = 1 as const;
export type AarohiAvg7ContractVersion = typeof AAROHI_AVG7_CONTRACT_VERSION;

/**
 * Where a sales interpretation came from, stated unflatteringly.
 *
 * Injected, offline, and asserted by whoever called this function. It is not provider-authenticated,
 * not Core-verified, not a business fact, not a consent record, not identity truth, not commercial
 * truth, not payment or registration or activation truth, and not a send authorization. No field in
 * this file may claim otherwise.
 */
export const AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE =
  'INJECTED_OFFLINE_SALES_BRAIN_INTERPRETATION' as const;
export type AarohiSalesInterpretationSourcePosture =
  typeof AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE;

// ---------------------------------------------------------------------------
// Shared primitives, and the two reference ROLES this file distinguishes.
//
// Restated rather than imported from AVG-1, AVG-2 or AVG-5. Reaching into a certified sibling to
// borrow a private regex would widen that file's surface for this file's convenience; the grammars
// are restated and specs assert they still agree, so the duplication cannot drift unnoticed.
//
// ### Why there are two roles and not one grammar
//
// The first AVG-7 head screened EVERY reference with the same contact-safe grammar, and the owner
// review found that this is two mistakes wearing one coat.
//
// AVG-1 and AVG-5 already certify their own opaque identifier grammars, and neither applies a
// contact screen. `919812345678` is a perfectly canonical `instagramMessageRef` — provider-native
// identifiers are frequently numeric — and `www.example.com` is a canonical opaque token too. When
// AVG-7 re-screened those on rebuild, a value the upstream stage OWNS and had already certified came
// back INVALID from the downstream stage. That is a cross-stage incompatibility, and it is a
// downstream package silently narrowing a governed identity grammar it does not own.
//
// The safety argument for screening does not apply to those fields either. An inherited token is an
// IDENTIFIER; treating it as a destination because it happens to be digits is precisely the
// reinterpretation the architecture forbids, and nothing in this repository may dial one.
//
// Meanwhile the two references AVG-7 genuinely introduces — its own artifact identities, supplied
// by a caller and named by nobody upstream — were screened by contact SHAPES alone, so
// `9_1_9_8_1_2_3_4_5_6_7_8` walked through a field whose comment promised it carried no
// destination. That is the separator-drift class AVG-6 corrected, and the fix is the same: count
// digits rather than enumerate separators. Applying it HERE rather than to the inherited fields is
// what keeps the AVG-6 lesson from becoming the AVG-1/AVG-5 incompatibility above.
// ---------------------------------------------------------------------------

/**
 * The certified upstream opaque identifier grammar, restated exactly.
 *
 * Byte-for-byte the grammar AVG-1's `coreEligibilityObservationSchema` and AVG-5's conversation and
 * observation schemas use. Deliberately NO contact screen: this file consumes artifacts those stages
 * have already certified, and re-judging their identity tokens is not AVG-7's to do.
 */
const UPSTREAM_OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/**
 * Shapes a reference may not contain, named by SHAPE rather than by platform.
 *
 * Applied only to AVG-7's OWN artifact references. The character class already refuses `@`, `/`, `+`
 * and whitespace; what it does not refuse is a bare run of digits, and a bare run of digits is
 * exactly what a phone number is once somebody strips the punctuation.
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
 * The most digits an AVG-7-local artifact reference may contain before it is a destination.
 *
 * Six, because the shortest dialable number anyone would recognise is seven. A COUNT rather than a
 * pattern: the dialable shape above only recognises the separators it was told about, while the
 * opaque character class independently permits `_` and `:`. A separator allowlist has to be right
 * about every character the surrounding grammar permits today AND after the next edit to it; a count
 * does not care what is in between.
 */
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

/**
 * An identity AVG-7 itself introduces: `interpretationRef` and `planRef`.
 *
 * These are the only two references in this file that no upstream stage has certified, and the only
 * two a caller invents. All three screens apply, because a field nobody upstream governs is the one
 * place a destination could be smuggled into an artifact that claims to carry none.
 */
const AVG7_LOCAL_ARTIFACT_REF = UPSTREAM_OPAQUE_REF.refine(
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
 * lexicographic order is not chronological order across them: the character after the seconds is `.`
 * in one form and `Z` in the other, and `.` sorts first. AVG-5 shipped a comparator that compared
 * the strings and had to be corrected; AVG-6 and this file are written with the fix.
 */
function canonicalInstantEpochMs(instant: string): number {
  return Date.parse(instant);
}

// ---------------------------------------------------------------------------
// The closed conversation vocabularies.
// ---------------------------------------------------------------------------

/**
 * What the prospect's latest message appears to be ABOUT.
 *
 * A conversation vocabulary, not an authority vocabulary. There is deliberately no
 * `CONSENT_GRANTED`, `APPROVED_TO_CONTACT`, `VENDOR_ACTIVE`, `PAYMENT_CONFIRMED`,
 * `REGISTRATION_CONFIRMED` or `READY_TO_SEND`: each of those is a business STATE that only Core can
 * hold, and a conversation cannot become one by being read a particular way. Somebody typing "I've
 * already paid" is a thing they typed.
 */
export const AAROHI_SALES_CONVERSATION_INTENTS = [
  /** Asking what QuickFurno is or does. */
  'GENERAL_INFORMATION',
  /** Asking whether it fits their business. */
  'SERVICE_FIT',
  /** Asking about the leads themselves. */
  'LEAD_QUALITY',
  /** Asking about price, packages or terms. AVG-8's territory, and Core's. */
  'COMMERCIAL_TERMS',
  /** Asking how to sign up. AVG-9's territory, and Core's. */
  'REGISTRATION_PROCESS',
  /** Asking about paying or going live. AVG-10's territory, and Core's. */
  'PAYMENT_OR_ACTIVATION',
  /** Declining, or asking not to be contacted. The highest-precedence signal in this file. */
  'REJECTION_OR_STOP',
  /** Nobody could tell. An honest member, and not a synonym for "probably fine". */
  'OTHER_OR_UNCLEAR',
] as const;
export type AarohiSalesConversationIntent = (typeof AAROHI_SALES_CONVERSATION_INTENTS)[number];

/**
 * What kind of concern the message appears to raise.
 *
 * These are CONVERSATIONAL CATEGORIES and nothing more. `PRICE_OR_PACKAGE` does not mean a price
 * exists; `LEAD_QUALITY` does not mean the leads are good or bad; `TRUST_OR_VERIFICATION` does not
 * mean anybody's verification status is known; `PRIVACY_OR_CONTACT` does not mean consent or
 * suppression changed. Each names a thing somebody appeared to be worried about.
 */
export const AAROHI_SALES_OBJECTION_KINDS = [
  'NONE',
  'PRICE_OR_PACKAGE',
  'LEAD_QUALITY',
  'LEAD_VOLUME_OR_ROI',
  'TRUST_OR_VERIFICATION',
  'TIMING_OR_NOT_READY',
  /** A concern about being contacted at all. Read as contact risk, never as a sales objection. */
  'PRIVACY_OR_CONTACT',
  /** A concern nobody categorised. Not "minor" — uncategorised. */
  'OTHER',
] as const;
export type AarohiSalesObjectionKind = (typeof AAROHI_SALES_OBJECTION_KINDS)[number];

/**
 * What the brain may propose doing next. Six members, and none of them is "reply".
 *
 * The two `PREPARE_*` strategies say a bounded brief is safe to hold; the three `REQUEST_CORE_*`
 * strategies say this domain has run out of things it is allowed to know and Core must supply the
 * next fact; `REQUEST_HUMAN_REVIEW` says a person should look. Not one of them produces text, and
 * there is no member that means sent, approved, drafted or answered.
 */
export const AAROHI_SALES_STRATEGIES = [
  'PREPARE_NONCOMMERCIAL_REPLY_BRIEF',
  'PREPARE_CLARIFYING_REPLY_BRIEF',
  'REQUEST_CORE_COMMERCIAL_CONTEXT',
  'REQUEST_CORE_PROCESS_CONTEXT',
  'REQUEST_CORE_CONTACT_POLICY_REVIEW',
  'REQUEST_HUMAN_REVIEW',
] as const;
export type AarohiSalesStrategy = (typeof AAROHI_SALES_STRATEGIES)[number];

// ---------------------------------------------------------------------------
// The interpretation.
// ---------------------------------------------------------------------------

/**
 * One untrusted, model-shaped reading of the CURRENT inbound turn.
 *
 * There is deliberately no field for the message body, a reply, an explanation, a confidence, a
 * price, a package, a discount, a guarantee, a consent flag, a Core identifier or a model
 * identifier. Those are content, arithmetic and authority dressed as understanding, and a reading of
 * a conversation carries none of them. What it carries is two closed categories and the exact
 * message it is a reading OF.
 */
export interface AarohiSalesBrainInterpretation {
  readonly contractVersion: AarohiAvg7ContractVersion;
  readonly interpretationRef: string;
  readonly prospectRef: string;
  readonly instagramConversationRef: string;
  readonly instagramThreadRef: string;
  /** CHANNEL-LOCAL. Never a Core vendor id, never a cross-channel identity. */
  readonly instagramParticipantRef: string;
  /** The exact message this is a reading of. Stamped from the conversation, never accepted. */
  readonly instagramMessageRef: string;
  readonly intent: AarohiSalesConversationIntent;
  readonly objectionKind: AarohiSalesObjectionKind;
  readonly interpretedAt: string;
  readonly sourcePosture: AarohiSalesInterpretationSourcePosture;
}

/** Canonical schema for a BUILT interpretation, so the contract says one thing to every reader. */
export const salesBrainInterpretationSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG7_CONTRACT_VERSION),
    // AVG-7's own artifact identity: contact-safe, digit-counted.
    interpretationRef: AVG7_LOCAL_ARTIFACT_REF,
    // Inherited from certified upstream artifacts. Their grammar is not AVG-7's to narrow.
    prospectRef: UPSTREAM_OPAQUE_REF,
    instagramConversationRef: UPSTREAM_OPAQUE_REF,
    instagramThreadRef: UPSTREAM_OPAQUE_REF,
    instagramParticipantRef: UPSTREAM_OPAQUE_REF,
    instagramMessageRef: UPSTREAM_OPAQUE_REF,
    intent: z.enum(AAROHI_SALES_CONVERSATION_INTENTS),
    objectionKind: z.enum(AAROHI_SALES_OBJECTION_KINDS),
    interpretedAt: UTC_INSTANT,
    sourcePosture: z.literal(AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE),
  })
  .strict();

/**
 * What a caller may state when building an interpretation.
 *
 * Note what is absent. Not the posture, not the contract version, and not ONE of the five bindings:
 * those are stamped from the canonical conversation, so a caller cannot name a message at all — let
 * alone an older one, an index, a "latest: true" flag or a body hash they computed themselves. The
 * conversation decides what "latest" means, which is the only definition that cannot be argued with.
 */
const interpretationInputSchema = z
  .object({
    interpretationRef: AVG7_LOCAL_ARTIFACT_REF,
    conversation: z.unknown(),
    intent: z.enum(AAROHI_SALES_CONVERSATION_INTENTS),
    objectionKind: z.enum(AAROHI_SALES_OBJECTION_KINDS),
    interpretedAt: UTC_INSTANT,
  })
  .strict();

export const SALES_TURN_REFUSALS = [
  'SALES_INPUT_INVALID',
  'CONVERSATION_INVALID',
  /** A conversation with no inbound turn has no current message to read. */
  'CONVERSATION_HAS_NO_INBOUND_TURN',
  'INTERPRETATION_INVALID',
  /** The interpretation is about another prospect, conversation, thread or participant. */
  'INTERPRETATION_BINDING_MISMATCH',
  /** The interpretation reads a message that is no longer the current one. */
  'INTERPRETATION_NOT_FOR_LATEST_TURN',
  /** The interpretation claims to predate the message it is a reading of. */
  'INTERPRETATION_BEFORE_MESSAGE',
  'CORE_GATE_REFUSED',
  /** The plan claims to predate the interpretation it rests on. */
  'PLAN_BEFORE_INTERPRETATION',
  'PLAN_INVALID',
] as const;
export type AarohiSalesTurnRefusal = (typeof SALES_TURN_REFUSALS)[number];

export type AarohiSalesBrainInterpretationResult =
  | { readonly ok: true; readonly interpretation: AarohiSalesBrainInterpretation }
  | { readonly ok: false; readonly refusal: AarohiSalesTurnRefusal };

/**
 * Re-parse and REBUILD an interpretation from whatever was handed in.
 *
 * Shape only. Whether this reading is about the CURRENT message of a particular conversation is a
 * question about two objects, and this function is shown one — `evaluateAarohiSalesTurn` asks it.
 */
export function parseAarohiSalesBrainInterpretation(
  value: unknown,
): AarohiSalesBrainInterpretation | undefined {
  const parsed = salesBrainInterpretationSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG7_CONTRACT_VERSION,
    interpretationRef: parsed.data.interpretationRef,
    prospectRef: parsed.data.prospectRef,
    instagramConversationRef: parsed.data.instagramConversationRef,
    instagramThreadRef: parsed.data.instagramThreadRef,
    instagramParticipantRef: parsed.data.instagramParticipantRef,
    instagramMessageRef: parsed.data.instagramMessageRef,
    intent: parsed.data.intent,
    objectionKind: parsed.data.objectionKind,
    interpretedAt: parsed.data.interpretedAt,
    sourcePosture: AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE,
  });
}

/**
 * Build one canonical interpretation of a conversation's CURRENT inbound turn, or refuse.
 *
 * The conversation is certified by AVG-5's own public parser, so a forged mixed-prospect snapshot is
 * refused there and the refusal is inherited. The latest turn is the last element of a sequence
 * AVG-5 has already certified as canonically ordered by semantic UTC instant then message reference
 * — which is why this file does not sort anything and does not need to.
 *
 * The posture is STAMPED rather than accepted, so an injected fixture cannot describe itself as
 * provider-authenticated or Core-verified.
 */
export function createAarohiSalesBrainInterpretation(
  value: unknown,
): AarohiSalesBrainInterpretationResult {
  const parsed = interpretationInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'SALES_INPUT_INVALID' as const });
  }

  const conversation = parseInstagramConversation(parsed.data.conversation);
  if (conversation === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'CONVERSATION_INVALID' as const });
  }

  const latest = conversation.inboundTurns[conversation.inboundTurns.length - 1];
  if (latest === undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'CONVERSATION_HAS_NO_INBOUND_TURN' as const,
    });
  }

  // A reading cannot have happened before the thing it is a reading of. Both instants are
  // caller-asserted canonical UTC and no clock is read here, so this compares two stated facts —
  // as SEMANTIC instants, never as spellings.
  if (
    canonicalInstantEpochMs(parsed.data.interpretedAt) < canonicalInstantEpochMs(latest.observedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'INTERPRETATION_BEFORE_MESSAGE' as const,
    });
  }

  const interpretation = {
    contractVersion: AAROHI_AVG7_CONTRACT_VERSION,
    interpretationRef: parsed.data.interpretationRef,
    prospectRef: conversation.prospectRef,
    instagramConversationRef: conversation.instagramConversationRef,
    instagramThreadRef: conversation.instagramThreadRef,
    instagramParticipantRef: conversation.instagramParticipantRef,
    instagramMessageRef: latest.instagramMessageRef,
    intent: parsed.data.intent,
    objectionKind: parsed.data.objectionKind,
    interpretedAt: parsed.data.interpretedAt,
    sourcePosture: AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE,
  };

  // Parsed before it is returned. The schema is the contract, and a contract nothing ever runs is a
  // paragraph.
  if (!salesBrainInterpretationSchema.safeParse(interpretation).success) {
    return Object.freeze({ ok: false as const, refusal: 'INTERPRETATION_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, interpretation: Object.freeze(interpretation) });
}

// ---------------------------------------------------------------------------
// The deterministic policy.
// ---------------------------------------------------------------------------

/**
 * What a conversational signal MEANS for what may safely happen next.
 *
 * Both vocabularies are mapped into this one small set so precedence can be stated once rather than
 * as a nest of cases over sixty-four pairs.
 */
type SalesSignalClass =
  /** Somebody may be asking not to be contacted. Outranks everything. */
  | 'CONTACT_RISK'
  /** The answer would be a commercial fact, which this domain does not have. */
  | 'COMMERCIAL'
  /** The answer would be a registration, payment or activation fact. Also not this domain's. */
  | 'CORE_PROCESS'
  /** A concern nobody categorised. */
  | 'UNCATEGORISED'
  /** Nobody could tell what was being asked. */
  | 'UNCLEAR'
  /** An ordinary acquisition question this domain may hold a brief about. */
  | 'ORDINARY';

/**
 * The class of every intent.
 *
 * TOTAL by type. A new `AarohiSalesConversationIntent` fails to compile until somebody classifies
 * it, which is the point: the failure mode this shape prevents is an intent added next year
 * silently inheriting `ORDINARY` and becoming draftable without anybody deciding that.
 */
const SALES_INTENT_CLASS: Readonly<Record<AarohiSalesConversationIntent, SalesSignalClass>> =
  Object.freeze({
    GENERAL_INFORMATION: 'ORDINARY',
    SERVICE_FIT: 'ORDINARY',
    LEAD_QUALITY: 'ORDINARY',
    COMMERCIAL_TERMS: 'COMMERCIAL',
    REGISTRATION_PROCESS: 'CORE_PROCESS',
    PAYMENT_OR_ACTIVATION: 'CORE_PROCESS',
    REJECTION_OR_STOP: 'CONTACT_RISK',
    OTHER_OR_UNCLEAR: 'UNCLEAR',
  });

/** The class of every objection kind. Total for the same reason, and read the same way. */
const SALES_OBJECTION_CLASS: Readonly<Record<AarohiSalesObjectionKind, SalesSignalClass>> =
  Object.freeze({
    NONE: 'ORDINARY',
    PRICE_OR_PACKAGE: 'COMMERCIAL',
    LEAD_QUALITY: 'ORDINARY',
    LEAD_VOLUME_OR_ROI: 'ORDINARY',
    TRUST_OR_VERIFICATION: 'ORDINARY',
    TIMING_OR_NOT_READY: 'ORDINARY',
    PRIVACY_OR_CONTACT: 'CONTACT_RISK',
    OTHER: 'UNCATEGORISED',
  });

/**
 * THE strategy for a pair of signals. Total, deterministic, and the only definition in this file.
 *
 * Precedence, and why each step sits where it does:
 *
 * 1. **Contact risk, from EITHER signal.** A message that is commercially interesting and also asks
 *    not to be contacted is a message asking not to be contacted. Letting the commercial branch win
 *    a mixed signal is how a system ends up selling to somebody who said stop, so the check reads
 *    both vocabularies and runs first. It cannot be outvoted by interest, priority, score or any
 *    amount of identity evidence, because none of those is an argument about consent.
 * 2. **Commercial, from either signal.** The honest answer needs a price, a package or a term, and
 *    this domain has none: they are Core's, surfaced later by AVG-8. Guessing one is exactly the
 *    failure the roadmap sentence forbids.
 * 3. **Core process.** Registration, payment and activation are AVG-9's and AVG-10's, and Core's.
 * 4. **An uncategorised objection.** Somebody is worried and nobody knows what about. A person
 *    should read it before this system decides anything else is safe.
 * 5. **An unclear intent.** Nobody could tell what was asked, so the safe next move is to ask —
 *    which is a clarifying brief, not an answer.
 * 6. **Ordinary.** A bounded non-commercial brief.
 *
 * There is no model here, no score, no confidence and no threshold to tune.
 */
function salesStrategyFor(
  intent: AarohiSalesConversationIntent,
  objectionKind: AarohiSalesObjectionKind,
): AarohiSalesStrategy {
  const intentClass = SALES_INTENT_CLASS[intent];
  const objectionClass = SALES_OBJECTION_CLASS[objectionKind];

  if (intentClass === 'CONTACT_RISK' || objectionClass === 'CONTACT_RISK') {
    return 'REQUEST_CORE_CONTACT_POLICY_REVIEW';
  }
  if (intentClass === 'COMMERCIAL' || objectionClass === 'COMMERCIAL') {
    return 'REQUEST_CORE_COMMERCIAL_CONTEXT';
  }
  if (intentClass === 'CORE_PROCESS' || objectionClass === 'CORE_PROCESS') {
    return 'REQUEST_CORE_PROCESS_CONTEXT';
  }
  if (intentClass === 'UNCATEGORISED' || objectionClass === 'UNCATEGORISED') {
    return 'REQUEST_HUMAN_REVIEW';
  }
  if (intentClass === 'UNCLEAR' || objectionClass === 'UNCLEAR') {
    return 'PREPARE_CLARIFYING_REPLY_BRIEF';
  }
  return 'PREPARE_NONCOMMERCIAL_REPLY_BRIEF';
}

// ---------------------------------------------------------------------------
// The reply BRIEF. Never a reply.
// ---------------------------------------------------------------------------

/**
 * What a strategy OBLIGES, as booleans a machine can check.
 *
 * `futureModelDraftEligible` is the one worth reading twice. It means exactly: a later governed
 * composition MAY ask QF Model Gateway for a draft. It does not mean a model was called, a prompt
 * was resolved, a reply exists, a reply is safe, a reply is approved, or a send is allowed. It is
 * false for every strategy that is waiting on a fact Core has not supplied, because a model asked to
 * answer a question whose facts are missing will supply them — plausibly, fluently, and from nowhere.
 */
export interface AarohiSalesReplyBrief {
  readonly strategy: AarohiSalesStrategy;
  readonly intent: AarohiSalesConversationIntent;
  readonly objectionKind: AarohiSalesObjectionKind;
  readonly requiresClarification: boolean;
  readonly requiresCoreCommercialContext: boolean;
  readonly requiresCoreProcessContext: boolean;
  readonly requiresCoreContactPolicyRevalidation: boolean;
  readonly requiresCoreConsentRevalidation: boolean;
  readonly requiresHumanReview: boolean;
  readonly stopSalesPendingCoreReview: boolean;
  readonly futureModelDraftEligible: boolean;
}

type SalesStrategyObligations = Omit<
  AarohiSalesReplyBrief,
  'strategy' | 'intent' | 'objectionKind'
>;

/**
 * THE obligations of every strategy. Total, frozen, and the single definition.
 *
 * The builder reads this map and the public schema validates against the same one, so there is no
 * second opinion for a hand-built brief to satisfy. AVG-5's owner review found a builder checking an
 * invariant the parser did not; this file has one invariant with two callers.
 */
const SALES_STRATEGY_OBLIGATIONS: Readonly<Record<AarohiSalesStrategy, SalesStrategyObligations>> =
  Object.freeze({
    PREPARE_NONCOMMERCIAL_REPLY_BRIEF: Object.freeze({
      requiresClarification: false,
      requiresCoreCommercialContext: false,
      requiresCoreProcessContext: false,
      requiresCoreContactPolicyRevalidation: false,
      requiresCoreConsentRevalidation: false,
      requiresHumanReview: false,
      stopSalesPendingCoreReview: false,
      futureModelDraftEligible: true,
    }),
    PREPARE_CLARIFYING_REPLY_BRIEF: Object.freeze({
      requiresClarification: true,
      requiresCoreCommercialContext: false,
      requiresCoreProcessContext: false,
      requiresCoreContactPolicyRevalidation: false,
      requiresCoreConsentRevalidation: false,
      requiresHumanReview: false,
      stopSalesPendingCoreReview: false,
      futureModelDraftEligible: true,
    }),
    REQUEST_CORE_COMMERCIAL_CONTEXT: Object.freeze({
      requiresClarification: false,
      requiresCoreCommercialContext: true,
      requiresCoreProcessContext: false,
      requiresCoreContactPolicyRevalidation: false,
      requiresCoreConsentRevalidation: false,
      requiresHumanReview: false,
      stopSalesPendingCoreReview: false,
      // No price exists here to draft from, and a draft is where an invented one would appear.
      futureModelDraftEligible: false,
    }),
    REQUEST_CORE_PROCESS_CONTEXT: Object.freeze({
      requiresClarification: false,
      requiresCoreCommercialContext: false,
      requiresCoreProcessContext: true,
      requiresCoreContactPolicyRevalidation: false,
      requiresCoreConsentRevalidation: false,
      requiresHumanReview: false,
      stopSalesPendingCoreReview: false,
      futureModelDraftEligible: false,
    }),
    REQUEST_CORE_CONTACT_POLICY_REVIEW: Object.freeze({
      requiresClarification: false,
      requiresCoreCommercialContext: false,
      requiresCoreProcessContext: false,
      requiresCoreContactPolicyRevalidation: true,
      requiresCoreConsentRevalidation: true,
      requiresHumanReview: false,
      // The local fail-safe. It does not claim the prospect opted out — it refuses to keep selling
      // until Core, which owns consent and suppression, has decided again.
      stopSalesPendingCoreReview: true,
      futureModelDraftEligible: false,
    }),
    REQUEST_HUMAN_REVIEW: Object.freeze({
      requiresClarification: false,
      requiresCoreCommercialContext: false,
      requiresCoreProcessContext: false,
      requiresCoreContactPolicyRevalidation: false,
      requiresCoreConsentRevalidation: false,
      requiresHumanReview: true,
      stopSalesPendingCoreReview: false,
      futureModelDraftEligible: false,
    }),
  });

const salesStrategyObligationsShape = {
  requiresClarification: z.boolean(),
  requiresCoreCommercialContext: z.boolean(),
  requiresCoreProcessContext: z.boolean(),
  requiresCoreContactPolicyRevalidation: z.boolean(),
  requiresCoreConsentRevalidation: z.boolean(),
  requiresHumanReview: z.boolean(),
  stopSalesPendingCoreReview: z.boolean(),
  futureModelDraftEligible: z.boolean(),
} as const;

const OBLIGATION_KEYS = Object.freeze(
  Object.keys(
    SALES_STRATEGY_OBLIGATIONS.REQUEST_HUMAN_REVIEW,
  ) as readonly (keyof SalesStrategyObligations)[],
);

function briefMatchesPolicy(brief: AarohiSalesReplyBrief): boolean {
  // The strategy must be the one the deterministic policy produces for these two signals. A
  // hand-built brief claiming a non-commercial reply for a message read as a rejection is refused
  // here, at the public boundary, rather than only inside a builder somebody could route around.
  if (brief.strategy !== salesStrategyFor(brief.intent, brief.objectionKind)) {
    return false;
  }
  const obligations = SALES_STRATEGY_OBLIGATIONS[brief.strategy];
  return OBLIGATION_KEYS.every((key) => brief[key] === obligations[key]);
}

export const salesReplyBriefSchema = z
  .object({
    strategy: z.enum(AAROHI_SALES_STRATEGIES),
    intent: z.enum(AAROHI_SALES_CONVERSATION_INTENTS),
    objectionKind: z.enum(AAROHI_SALES_OBJECTION_KINDS),
    ...salesStrategyObligationsShape,
  })
  .strict()
  .refine(briefMatchesPolicy, 'the reply brief does not match the deterministic sales policy');

// ---------------------------------------------------------------------------
// The sales-ethics posture.
// ---------------------------------------------------------------------------

/**
 * The prohibitions, as literals a machine can check rather than prose somebody has to remember.
 *
 * These are the same sales-ethics bounds Anisha works under, written down where a schema can enforce
 * them. Every one of them is a thing a fluent system would otherwise do by accident: a guarantee
 * because it sounds reassuring, a deadline because it moves a deal, a price because somebody asked.
 * A plan that could hold `true` for any of these is a plan worth lying with, so the schema pins each
 * one and the module fails to load if somebody constructs a posture that does not.
 */
export interface AarohiSalesBrainPosture {
  readonly planOnly: true;

  readonly commercialCommitmentCreated: false;
  readonly commercialTruthOriginatedByBrain: false;
  readonly priceOriginatedByBrain: false;
  readonly discountOriginatedByBrain: false;
  readonly guaranteeLeadVolume: false;
  readonly guaranteeRevenue: false;
  readonly guaranteeConversion: false;
  readonly inventedUrgency: false;
  readonly inventedScarcity: false;
  readonly unsupportedSocialProof: false;
  /**
   * The brain did not hide a material package limitation.
   *
   * The canonical ceiling lists this alongside the guarantees and the invented urgency, and the
   * first AVG-7 head machine-represented every prohibition except this one. It is an ETHICS
   * declaration, not a commercial data field: it does not mean AVG-7 knows what the limitations are,
   * may describe a package, or holds commercial context. It cannot, and a commercial question is
   * still `REQUEST_CORE_COMMERCIAL_CONTEXT` with no draft eligibility until AVG-8 supplies
   * Core-sourced truth. What it says is that nothing here selected which parts of an offer to leave
   * out — which is the form this particular dishonesty takes, and the one a fluent drafter reaches
   * for when the limitation is the inconvenient half of the answer.
   */
  readonly materialPackageLimitationHidden: false;
  readonly contractualCommitmentCreated: false;

  readonly consentEstablished: false;
  readonly suppressionMutated: false;
  readonly identityMutated: false;
  readonly registrationMutated: false;
  readonly paymentMutated: false;
  readonly activationMutated: false;
  readonly acquisitionCaseMutated: false;
  readonly anishaHandoffExecuted: false;

  readonly communicationRequestCreated: false;
  readonly approvalRequestCreated: false;
  readonly approvalDecisionCreated: false;
  readonly communicationAuthorizationCreated: false;
  readonly executionIntentCreated: false;

  readonly modelCallExecuted: false;
  readonly promptResolved: false;
  readonly retrievalExecuted: false;
  readonly n8nExecutionRequested: false;
  readonly providerSendRequested: false;
  readonly channelSendRequested: false;
  readonly sent: false;
  readonly delivered: false;

  readonly productionMutation: false;
  readonly businessEffect: false;
}

export const salesBrainPostureSchema = z
  .object({
    planOnly: z.literal(true),

    commercialCommitmentCreated: z.literal(false),
    commercialTruthOriginatedByBrain: z.literal(false),
    priceOriginatedByBrain: z.literal(false),
    discountOriginatedByBrain: z.literal(false),
    guaranteeLeadVolume: z.literal(false),
    guaranteeRevenue: z.literal(false),
    guaranteeConversion: z.literal(false),
    inventedUrgency: z.literal(false),
    inventedScarcity: z.literal(false),
    unsupportedSocialProof: z.literal(false),
    materialPackageLimitationHidden: z.literal(false),
    contractualCommitmentCreated: z.literal(false),

    consentEstablished: z.literal(false),
    suppressionMutated: z.literal(false),
    identityMutated: z.literal(false),
    registrationMutated: z.literal(false),
    paymentMutated: z.literal(false),
    activationMutated: z.literal(false),
    acquisitionCaseMutated: z.literal(false),
    anishaHandoffExecuted: z.literal(false),

    communicationRequestCreated: z.literal(false),
    approvalRequestCreated: z.literal(false),
    approvalDecisionCreated: z.literal(false),
    communicationAuthorizationCreated: z.literal(false),
    executionIntentCreated: z.literal(false),

    modelCallExecuted: z.literal(false),
    promptResolved: z.literal(false),
    retrievalExecuted: z.literal(false),
    n8nExecutionRequested: z.literal(false),
    providerSendRequested: z.literal(false),
    channelSendRequested: z.literal(false),
    sent: z.literal(false),
    delivered: z.literal(false),

    productionMutation: z.literal(false),
    businessEffect: z.literal(false),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const AAROHI_SALES_BRAIN_POSTURE: AarohiSalesBrainPosture = Object.freeze(
  salesBrainPostureSchema.parse({
    planOnly: true,

    commercialCommitmentCreated: false,
    commercialTruthOriginatedByBrain: false,
    priceOriginatedByBrain: false,
    discountOriginatedByBrain: false,
    guaranteeLeadVolume: false,
    guaranteeRevenue: false,
    guaranteeConversion: false,
    inventedUrgency: false,
    inventedScarcity: false,
    unsupportedSocialProof: false,
    materialPackageLimitationHidden: false,
    contractualCommitmentCreated: false,

    consentEstablished: false,
    suppressionMutated: false,
    identityMutated: false,
    registrationMutated: false,
    paymentMutated: false,
    activationMutated: false,
    acquisitionCaseMutated: false,
    anishaHandoffExecuted: false,

    communicationRequestCreated: false,
    approvalRequestCreated: false,
    approvalDecisionCreated: false,
    communicationAuthorizationCreated: false,
    executionIntentCreated: false,

    modelCallExecuted: false,
    promptResolved: false,
    retrievalExecuted: false,
    n8nExecutionRequested: false,
    providerSendRequested: false,
    channelSendRequested: false,
    sent: false,
    delivered: false,

    productionMutation: false,
    businessEffect: false,
  }),
);

// ---------------------------------------------------------------------------
// The turn plan.
// ---------------------------------------------------------------------------

/**
 * An inert plan for the next conversational move.
 *
 * It carries no message body, no template, no price, no package, no prompt text and no model
 * identifier — because there is nothing here that could compose one honestly and nowhere for one to
 * go. What it carries is the identity of a conversation, the identity of the reading it rests on,
 * the Core status observed when it was planned, and a closed brief.
 *
 * `coreStatus` is HISTORY. It is not a permission and does not become one by being written down.
 */
export interface AarohiSalesTurnPlan {
  readonly contractVersion: AarohiAvg7ContractVersion;
  readonly planRef: string;
  readonly prospectRef: string;
  readonly instagramConversationRef: string;
  readonly instagramThreadRef: string;
  readonly instagramParticipantRef: string;
  readonly instagramMessageRef: string;
  readonly interpretationRef: string;
  /** The Core status OBSERVED when this plan was made. Narrowed to the one that proceeds. */
  readonly coreStatus: Extract<CorePartyStatus, 'NOT_REGISTERED'>;
  readonly coreLookupRef: string;
  readonly plannedAt: string;
  readonly brief: AarohiSalesReplyBrief;
  readonly posture: AarohiSalesBrainPosture;
}

export const salesTurnPlanSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG7_CONTRACT_VERSION),
    // AVG-7's own artifact identities.
    planRef: AVG7_LOCAL_ARTIFACT_REF,
    interpretationRef: AVG7_LOCAL_ARTIFACT_REF,
    // Inherited: AVG-5's conversation bindings and AVG-1's Core lookup token.
    prospectRef: UPSTREAM_OPAQUE_REF,
    instagramConversationRef: UPSTREAM_OPAQUE_REF,
    instagramThreadRef: UPSTREAM_OPAQUE_REF,
    instagramParticipantRef: UPSTREAM_OPAQUE_REF,
    instagramMessageRef: UPSTREAM_OPAQUE_REF,
    coreStatus: z.literal('NOT_REGISTERED'),
    coreLookupRef: UPSTREAM_OPAQUE_REF,
    plannedAt: UTC_INSTANT,
    brief: salesReplyBriefSchema,
    posture: salesBrainPostureSchema,
  })
  .strict();

/** Re-parse and REBUILD a plan. Detaches the brief and posture from whatever the caller holds. */
export function parseAarohiSalesTurnPlan(value: unknown): AarohiSalesTurnPlan | undefined {
  const parsed = salesTurnPlanSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG7_CONTRACT_VERSION,
    planRef: parsed.data.planRef,
    prospectRef: parsed.data.prospectRef,
    instagramConversationRef: parsed.data.instagramConversationRef,
    instagramThreadRef: parsed.data.instagramThreadRef,
    instagramParticipantRef: parsed.data.instagramParticipantRef,
    instagramMessageRef: parsed.data.instagramMessageRef,
    interpretationRef: parsed.data.interpretationRef,
    coreStatus: parsed.data.coreStatus,
    coreLookupRef: parsed.data.coreLookupRef,
    plannedAt: parsed.data.plannedAt,
    brief: Object.freeze({ ...parsed.data.brief }),
    posture: AAROHI_SALES_BRAIN_POSTURE,
  });
}

export type AarohiSalesTurnPlanResult =
  | { readonly ok: true; readonly plan: AarohiSalesTurnPlan }
  | {
      readonly ok: false;
      readonly refusal: Exclude<AarohiSalesTurnRefusal, 'CORE_GATE_REFUSED'>;
    }
  | {
      readonly ok: false;
      readonly refusal: 'CORE_GATE_REFUSED';
      readonly coreReason: AcquisitionRefusalReason;
    };

/**
 * What a caller may state when planning a turn.
 *
 * Note what is absent: no body, no message, no reply, no template, no strategy, no outcome, no
 * price, no package, no confidence and no model identifier. The strategy is DERIVED — there is no
 * field through which a caller could state one, which is what makes the precedence below the only
 * way a strategy can be reached.
 */
const salesTurnInputSchema = z
  .object({
    planRef: AVG7_LOCAL_ARTIFACT_REF,
    conversation: z.unknown(),
    interpretation: z.unknown(),
    coreObservation: z.unknown(),
    plannedAt: UTC_INSTANT,
  })
  .strict();

/**
 * Decide, deterministically, what may safely happen next in one acquisition conversation.
 *
 * ### The interpretation must be a reading of the CURRENT message
 *
 * A reading of an older turn is not a weaker reading of this one; it is a reading of something else.
 * Conversations move — somebody asks about fit, and then says stop — and a system that replays the
 * first reading after the second message has arrived will answer a question nobody is asking any
 * more, in a conversation that has since turned. So the interpretation must bind all four
 * conversation references AND the exact message reference of the latest inbound turn. Appending a
 * newer turn makes an existing interpretation stale by construction, which is the correct behaviour
 * and is asserted as such.
 *
 * ### Conversational reading is not acquisition permission
 *
 * Those are separate questions with separate authorities, and this function asks both. The CURRENT
 * Core observation is re-run through the AVG-1 gate every time and only `NOT_REGISTERED` proceeds. A
 * prospect who has since become `DO_NOT_CONTACT`, `REGISTERED` or `ACTIVE` yields no plan however
 * interested the conversation sounds — and interest is not an input to the gate in the first place.
 *
 * ### And nothing here is an action
 *
 * No message is composed, no draft is created, no workspace is touched, no acquisition case is read
 * or moved, no communication request, approval, authorization or execution intent is created, no
 * model is called, no prompt is resolved, nothing is retrieved and nothing is sent.
 */
export function evaluateAarohiSalesTurn(value: unknown): AarohiSalesTurnPlanResult {
  const parsed = salesTurnInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'SALES_INPUT_INVALID' as const });
  }

  // The canonical AVG-5 parser, which certifies the whole conversation aggregate. A forged snapshot
  // mixing two prospects' turns is refused there, and inherited here.
  const conversation = parseInstagramConversation(parsed.data.conversation);
  if (conversation === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'CONVERSATION_INVALID' as const });
  }

  const latest = conversation.inboundTurns[conversation.inboundTurns.length - 1];
  if (latest === undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'CONVERSATION_HAS_NO_INBOUND_TURN' as const,
    });
  }

  const interpretation = parseAarohiSalesBrainInterpretation(parsed.data.interpretation);
  if (interpretation === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'INTERPRETATION_INVALID' as const });
  }

  // All four conversation bindings, asked separately from the message binding below. A matching
  // message reference alone proves nothing: references are opaque, and two conversations may
  // legitimately use the same local name for different things.
  if (
    interpretation.prospectRef !== conversation.prospectRef ||
    interpretation.instagramConversationRef !== conversation.instagramConversationRef ||
    interpretation.instagramThreadRef !== conversation.instagramThreadRef ||
    interpretation.instagramParticipantRef !== conversation.instagramParticipantRef
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'INTERPRETATION_BINDING_MISMATCH' as const,
    });
  }

  if (interpretation.instagramMessageRef !== latest.instagramMessageRef) {
    return Object.freeze({
      ok: false as const,
      refusal: 'INTERPRETATION_NOT_FOR_LATEST_TURN' as const,
    });
  }

  if (
    canonicalInstantEpochMs(interpretation.interpretedAt) <
    canonicalInstantEpochMs(latest.observedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'INTERPRETATION_BEFORE_MESSAGE' as const,
    });
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
    // "unreachable" is a claim about today's call graph, and this is a claim about the plan.
    return Object.freeze({ ok: false as const, refusal: 'PLAN_INVALID' as const });
  }

  if (
    canonicalInstantEpochMs(parsed.data.plannedAt) <
    canonicalInstantEpochMs(interpretation.interpretedAt)
  ) {
    return Object.freeze({ ok: false as const, refusal: 'PLAN_BEFORE_INTERPRETATION' as const });
  }

  const observation = coreEligibilityObservationSchema.safeParse(parsed.data.coreObservation);
  if (!observation.success) {
    return Object.freeze({
      ok: false as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      coreReason: 'OBSERVATION_INVALID' as const,
    });
  }

  const strategy = salesStrategyFor(interpretation.intent, interpretation.objectionKind);
  const plan = {
    contractVersion: AAROHI_AVG7_CONTRACT_VERSION,
    planRef: parsed.data.planRef,
    prospectRef: conversation.prospectRef,
    instagramConversationRef: conversation.instagramConversationRef,
    instagramThreadRef: conversation.instagramThreadRef,
    instagramParticipantRef: conversation.instagramParticipantRef,
    instagramMessageRef: latest.instagramMessageRef,
    interpretationRef: interpretation.interpretationRef,
    coreStatus: core.status,
    coreLookupRef: observation.data.coreLookupRef,
    plannedAt: parsed.data.plannedAt,
    brief: Object.freeze({
      strategy,
      intent: interpretation.intent,
      objectionKind: interpretation.objectionKind,
      ...SALES_STRATEGY_OBLIGATIONS[strategy],
    }),
    posture: AAROHI_SALES_BRAIN_POSTURE,
  };

  // Parsed before it is returned, against the same schema a caller's hand-built plan would face.
  if (!salesTurnPlanSchema.safeParse(plan).success) {
    return Object.freeze({ ok: false as const, refusal: 'PLAN_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, plan: Object.freeze(plan) });
}
