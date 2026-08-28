/**
 * AVG-10 — the Aarohi PAYMENT, ACTIVATION and ANISHA HANDOFF offline domain (ADR-0127).
 *
 * The overlay sentence this file exists to satisfy, in full:
 *
 * > Payment follow-up during acquisition, and the moment the relationship changes hands. Payment and
 * > activation authority are Core's alone. On Core's authoritative ACTIVE confirmation, Aarohi's
 * > acquisition mandate ends and Anisha becomes the vendor relationship owner.
 *
 * ### PAYMENT IS NOT ACTIVATION, and that is a shape rather than a rule
 *
 * The sentence describes two things, and the whole of this file is the insistence that they stay
 * two. A payment fact — even an authoritative one — is not an activation fact, and the failure this
 * stage is designed against is the single most natural inference in the domain: *they paid, so they
 * are live.*
 *
 * So the separation is structural. What this file produces is a payment-follow-up BRIEF with no
 * `authority` field, no `active` flag, no attestation reference and no acquisition case. It cannot be
 * passed to `completeCoreActiveHandoff` because it is not an attestation and does not parse as one,
 * and there is no function anywhere that turns one into the other. Ownership still moves only where
 * it moved before this file existed.
 *
 * ### What this file deliberately does NOT contain
 *
 * There is no handoff function here. `completeCoreActiveHandoff` in `active-handoff.ts` remains the
 * ONLY public route into `HANDED_OFF_TO_ANISHA`, it is unchanged by this stage, and this module does
 * not import it, wrap it, compose it or name it. A wrapper would have added surface and no authority,
 * and the one thing a second entrance to a terminal state can never be is safer than one.
 *
 * ### Core owns a payment WRITE path and exposes no prospect-facing payment READ
 *
 * The audit behind this contract is recorded in full in ADR-0127. In short: every per-party payment
 * or activation read QuickFurno offers is keyed by a Core VENDOR ID, which Aarohi structurally does
 * not hold — a prospect is explicitly not a vendor. The order lifecycle columns are unconstrained
 * free text whose only writer sets them to `not_started` and `not_activated`, over a payment provider
 * the same row records as `not_connected`. And Core's vendor status vocabulary contains no ACTIVE at
 * all.
 *
 * So nothing is mirrored. There is no `PAYMENT_PENDING`, `PAYMENT_COMPLETED`, `PAYMENT_FAILED`,
 * `ACTIVATION_READY` or `ACTIVATION_PENDING` in this file, because inventing a payment lifecycle
 * Core does not own would be exactly the failure AVG-9 refused to commit about registration. What is
 * carried instead is a closed AVAILABILITY token and an OPAQUE reference to Core's own material.
 *
 * ### Only PAYMENT_OR_ACTIVATION, and the strategy alone does not say that
 *
 * AVG-7 routes `REGISTRATION_PROCESS` and `PAYMENT_OR_ACTIVATION` to the same
 * `REQUEST_CORE_PROCESS_CONTEXT`. AVG-9 refuses the second; this file refuses the first. Both check
 * the re-derived INTENT, because the shared strategy is a door two stages hold from opposite sides.
 *
 * Pure domain only: no runtime, persistence, model call, prompt, retrieval, network, Supabase,
 * QuickFurno import, payment provider, transport or execution.
 */
import { z } from 'zod';

import { evaluateAarohiSalesTurn, parseAarohiSalesTurnPlan } from './avg7-sales-brain.js';
import type { AarohiSalesTurnPlan, AarohiSalesTurnRefusal } from './avg7-sales-brain.js';
import type { AcquisitionRefusalReason } from './existing-vendor-gate.js';

/** Version of the complete AVG-10 offline payment-and-handoff contract in this package. */
export const AAROHI_AVG10_CONTRACT_VERSION = 1 as const;
export type AarohiAvg10ContractVersion = typeof AAROHI_AVG10_CONTRACT_VERSION;

/**
 * Where a payment-follow-up observation came from, stated unflatteringly.
 *
 * Injected, offline, and asserted by whoever called this function. It is NOT an authenticated read
 * of production Core, not a provider reconciliation, not a receipt, and not evidence that anybody
 * paid or was activated: this package holds no Supabase client, no service-role key, no HTTP client,
 * no payment provider and no import of the QuickFurno marketplace.
 * `paymentContextSourceAuthenticated: false` says it again on every brief.
 */
export const AAROHI_AVG10_PAYMENT_SOURCE_POSTURE = 'INJECTED_OFFLINE_CORE_PAYMENT_CONTEXT' as const;
export type AarohiPaymentSourcePosture = typeof AAROHI_AVG10_PAYMENT_SOURCE_POSTURE;

// ---------------------------------------------------------------------------
// Shared primitives, and the two reference ROLES this file distinguishes.
//
// Restated rather than imported from AVG-1, AVG-5, AVG-7, AVG-8 or AVG-9, for the reason ADR-0124
// records: reaching into a certified sibling to borrow a private regex would widen that file's
// surface for this file's convenience. Specs assert the grammars still agree.
//
// The ROLE distinction is the one AVG-7's owner review established and every stage since has
// carried. A reference INHERITED from a certified upstream artifact keeps the grammar its owner
// certified, because a downstream stage may not narrow a grammar it does not own. A reference THIS
// stage introduces gets the local screen, because a field nobody upstream governs is where a
// destination would be smuggled in.
//
// `corePaymentContextRef` NAMES Core material, which makes it look inherited — but no certified
// upstream artifact carries it and a caller invents it into an AVG-10-local observation, so it is
// LOCAL and screened. That is what keeps a payment link out of a payment domain.
// ---------------------------------------------------------------------------

/**
 * The certified upstream opaque identifier grammar, restated exactly.
 *
 * Used for every reference inherited from a certified AVG-7 plan. Deliberately no contact screen:
 * those grammars belong to Core, to AVG-1 and to AVG-5, and re-judging their identity tokens is not
 * AVG-10's to do.
 */
const UPSTREAM_OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** Shapes an AVG-10-local reference may not contain, named by SHAPE rather than by platform. */
const CONTACT_SHAPES: readonly RegExp[] = Object.freeze([
  // An address.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u,
  // A fetchable location, with or without a scheme. A pay-here link is the one this stage cares
  // about most, and it is refused by shape rather than by any list of provider names.
  /(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\//u,
  /\bwww\./iu,
  // A dialable run: seven or more digits, however they are spaced.
  /(?:\d[\s().+-]{0,2}){7,}/u,
]);

function hasContactShape(text: string): boolean {
  return CONTACT_SHAPES.some((one) => one.test(text));
}

/** The most digits an AVG-10-local artifact reference may contain before it is a destination. */
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
 * An identity AVG-10 itself introduces: `briefRef`, `paymentContextRef` and `corePaymentContextRef`.
 *
 * The three references here that no upstream stage certified, and the three a caller invents. All
 * three screens apply. The digit count matters more here than anywhere: a long run of digits in a
 * payment domain is a card, an account or a transaction reference, and none of those may enter.
 */
const AVG10_LOCAL_ARTIFACT_REF = UPSTREAM_OPAQUE_REF.refine(
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
 * lexicographic order is not chronological order across them: `09:00:00.500Z` sorts BEFORE
 * `09:00:00Z` as a string while being half a second later.
 */
function canonicalInstantEpochMs(instant: string): number {
  return Date.parse(instant);
}

// ---------------------------------------------------------------------------
// What Core has to say about payment follow-up for this acquisition.
// ---------------------------------------------------------------------------

/**
 * Whether Core-authored payment-follow-up context exists, as a closed token.
 *
 * Three members, and exactly ONE proceeds. Read what is NOT here: no `PAID`, `PENDING`, `FAILED`,
 * `REFUNDED`, `SETTLED`, `ORDER_CREATED`, `ACTIVATION_READY` or `ACTIVATION_PENDING`. Every one of
 * those would be a payment or activation STATE, and this vocabulary is about whether Core has
 * something to say — never about what it says.
 *
 * That restraint is the point rather than a shortcut. QuickFurno's order rows carry
 * `payment_status` and `activation_status` as unconstrained free text, written once to
 * `not_started` and `not_activated` by their only writer, over a provider the same row calls
 * `not_connected`. A vocabulary mirroring that would be a lifecycle Aarohi imagined.
 */
export const CORE_PAYMENT_CONTEXT_AVAILABILITIES = [
  /** Core has authored payment-follow-up context, named by an opaque reference. */
  'CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE',
  /** Core has none to give. A fact, and not something to paper over with a plausible one. */
  'CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE',
  /** Core has not answered. Not the same as "none exists" — a stop, not a gap. */
  'CORE_PAYMENT_CONTEXT_UNKNOWN',
] as const;
export type CorePaymentContextAvailability = (typeof CORE_PAYMENT_CONTEXT_AVAILABILITIES)[number];

/**
 * One offline observation of whether Core holds payment-follow-up context for this acquisition.
 *
 * Note what it does not have, because in a payment domain the absences are the contract. No amount,
 * no currency, no price, no package, no credits, no order id, no transaction id, no provider name,
 * no provider payment reference, no receipt, no method, no paid-at, no activated-at, no status
 * string and no free text. It cannot say somebody paid, because it has no field in which to say it.
 *
 * And it says nothing whatsoever about activation. There is no `active` flag, no `authority` and no
 * attestation reference — those live on AVG-1's `ActivationAttestation`, which is a different type
 * reaching a different function.
 */
export interface CorePaymentFollowupContextBase {
  readonly contractVersion: AarohiAvg10ContractVersion;
  /** AVG-10's own identity for this observation. */
  readonly paymentContextRef: string;
  /** Inherited from the certified AVG-7 plan. */
  readonly prospectRef: string;
  /** The Core lookup this observation belongs with. Inherited, and never re-judged. */
  readonly coreLookupRef: string;
  readonly observedAt: string;
  readonly sourcePosture: AarohiPaymentSourcePosture;
}

/**
 * The observation, as a discriminated union so the reference cannot outlive its own availability.
 *
 * A single optional `corePaymentContextRef` would have permitted an observation that says Core holds
 * no payment context and then names one. AVG-8's query scopes and AVG-9's process context are shaped
 * this way for the same reason.
 */
export type CorePaymentFollowupContext =
  | (CorePaymentFollowupContextBase & {
      readonly availability: 'CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE';
      /**
       * An OPAQUE handle to Core-authored payment-follow-up material.
       *
       * Never read here, never parsed, never interpreted and never followed. It is screened as an
       * AVG-10-local reference, which is what refuses a pay-here link, an address and a long
       * transaction-shaped run of digits.
       */
      readonly corePaymentContextRef: string;
    })
  | (CorePaymentFollowupContextBase & {
      readonly availability: 'CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE';
    })
  | (CorePaymentFollowupContextBase & {
      readonly availability: 'CORE_PAYMENT_CONTEXT_UNKNOWN';
    });

const PAYMENT_CONTEXT_STATED_FIELDS = {
  paymentContextRef: AVG10_LOCAL_ARTIFACT_REF,
  prospectRef: UPSTREAM_OPAQUE_REF,
  coreLookupRef: UPSTREAM_OPAQUE_REF,
  observedAt: UTC_INSTANT,
} as const;

const PAYMENT_CONTEXT_STAMPED_FIELDS = {
  contractVersion: z.literal(AAROHI_AVG10_CONTRACT_VERSION),
  sourcePosture: z.literal(AAROHI_AVG10_PAYMENT_SOURCE_POSTURE),
} as const;

export const corePaymentFollowupContextSchema = z.discriminatedUnion('availability', [
  z
    .object({
      ...PAYMENT_CONTEXT_STAMPED_FIELDS,
      ...PAYMENT_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE'),
      corePaymentContextRef: AVG10_LOCAL_ARTIFACT_REF,
    })
    .strict(),
  z
    .object({
      ...PAYMENT_CONTEXT_STAMPED_FIELDS,
      ...PAYMENT_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE'),
    })
    .strict(),
  z
    .object({
      ...PAYMENT_CONTEXT_STAMPED_FIELDS,
      ...PAYMENT_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_PAYMENT_CONTEXT_UNKNOWN'),
    })
    .strict(),
]);

/** What a caller may state when recording one. Not the version, and not the posture. */
const paymentContextInputSchema = z.discriminatedUnion('availability', [
  z
    .object({
      ...PAYMENT_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE'),
      corePaymentContextRef: AVG10_LOCAL_ARTIFACT_REF,
    })
    .strict(),
  z
    .object({
      ...PAYMENT_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE'),
    })
    .strict(),
  z
    .object({
      ...PAYMENT_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_PAYMENT_CONTEXT_UNKNOWN'),
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/**
 * Why a payment-follow-up brief may not be prepared. Closed, content-free, and never prose.
 *
 * The two strategy refusals are separate because the boundaries are separate. A commercial plan
 * arriving here crossed AVG-8's boundary; a REGISTRATION_PROCESS plan crossed AVG-9's — and that one
 * shares AVG-7's process-context strategy with this stage, which is exactly why it needs its own
 * name rather than a shrug.
 */
export const PAYMENT_FOLLOWUP_REFUSALS = [
  'PAYMENT_INPUT_INVALID',
  /** The supplied AVG-7 plan is malformed. A shape failure. */
  'SALES_PLAN_INVALID',
  /** The CURRENT evidence yields no plan at all. Carries AVG-7's own refusal. */
  'SALES_PLAN_NOT_REDERIVABLE',
  /** The CURRENT evidence yields a plan, and it is not the one that was handed in. */
  'SALES_PLAN_POLICY_MISMATCH',
  /** An honestly re-derived plan that did not ask for Core process context at all. */
  'SALES_PLAN_NOT_CORE_PROCESS_CONTEXT',
  /** An honestly re-derived process-context plan about registration. AVG-9's. */
  'SALES_PLAN_NOT_PAYMENT_OR_ACTIVATION',
  'PAYMENT_CONTEXT_INVALID',
  /** The observation describes a different prospect, or a different Core lookup. */
  'PAYMENT_CONTEXT_BINDING_MISMATCH',
  /** Core holds no payment-follow-up context. There is no fallback and no substitute. */
  'CORE_PAYMENT_CONTEXT_NOT_AVAILABLE',
  /** Nobody established whether Core holds any. A stop, not a gap. */
  'CORE_PAYMENT_CONTEXT_UNRESOLVED',
  /** The observation predates the plan that asked for it. */
  'PAYMENT_CONTEXT_STALE_FOR_PLAN',
  'PAYMENT_BRIEF_BEFORE_PAYMENT_CONTEXT',
  'PAYMENT_BRIEF_INVALID',
] as const;
export type AarohiPaymentFollowupRefusal = (typeof PAYMENT_FOLLOWUP_REFUSALS)[number];

export type CorePaymentFollowupContextResult =
  | { readonly ok: true; readonly paymentContext: CorePaymentFollowupContext }
  | { readonly ok: false; readonly refusal: AarohiPaymentFollowupRefusal };

/**
 * Re-parse and REBUILD a payment-context observation from whatever was handed in.
 *
 * A declared TypeScript type is erased before any of this runs, so trusting one would be trusting
 * the caller. The version and the posture are re-stamped rather than copied, so a value that arrived
 * describing itself as a reconciled live payment read comes back describing itself as an injected
 * offline observation, or does not come back.
 */
export function parseCorePaymentFollowupContext(
  value: unknown,
): CorePaymentFollowupContext | undefined {
  const parsed = corePaymentFollowupContextSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const base = {
    contractVersion: AAROHI_AVG10_CONTRACT_VERSION,
    paymentContextRef: parsed.data.paymentContextRef,
    prospectRef: parsed.data.prospectRef,
    coreLookupRef: parsed.data.coreLookupRef,
    observedAt: parsed.data.observedAt,
    sourcePosture: AAROHI_AVG10_PAYMENT_SOURCE_POSTURE,
  } as const;

  if (parsed.data.availability === 'CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE') {
    return Object.freeze({
      ...base,
      availability: parsed.data.availability,
      corePaymentContextRef: parsed.data.corePaymentContextRef,
    });
  }
  return Object.freeze({ ...base, availability: parsed.data.availability });
}

/**
 * Record one offline observation of Core's payment-follow-up availability.
 *
 * The posture and the contract version are STAMPED rather than accepted, so an injected fixture
 * cannot describe itself as an authenticated production read. The result is produced by the public
 * parser above, so a value this builder returns is by construction a value that parser accepts.
 */
export function createCorePaymentFollowupContext(value: unknown): CorePaymentFollowupContextResult {
  const parsed = paymentContextInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'PAYMENT_INPUT_INVALID' as const });
  }

  const stamped = {
    ...parsed.data,
    contractVersion: AAROHI_AVG10_CONTRACT_VERSION,
    sourcePosture: AAROHI_AVG10_PAYMENT_SOURCE_POSTURE,
  };

  const paymentContext = parseCorePaymentFollowupContext(stamped);
  if (paymentContext === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'PAYMENT_CONTEXT_INVALID' as const });
  }
  return Object.freeze({ ok: true as const, paymentContext });
}

// ---------------------------------------------------------------------------
// The posture.
// ---------------------------------------------------------------------------

/**
 * The authority ceiling, as literals a machine can check rather than prose somebody must remember.
 *
 * The four payment fields are four different claims and are kept apart on purpose.
 * `paymentMutated` says Core's payment state is where it was. `paymentConfirmedByAarohi` says nobody
 * here decided a payment succeeded. `paymentLifecycleInvented` says no payment states were imagined
 * that Core does not own. `packageOrderCreated` says no order exists because of this.
 *
 * The three activation fields likewise. `activationMutated` says Core's activation state is
 * untouched; `activationInferred` says nothing here concluded ACTIVE from anything, least of all
 * from a payment; `vendorActivated` says no party went live because of this. The inference guard is
 * the one worth reading twice, because it is the single most natural mistake in this domain.
 */
export interface AarohiPaymentFollowupPosture {
  readonly assistanceContextOnly: true;
  /** This is an injected offline observation. It is not a live authenticated read of Core. */
  readonly paymentContextSourceAuthenticated: false;

  readonly paymentMutated: false;
  readonly paymentConfirmedByAarohi: false;
  readonly paymentLifecycleInvented: false;
  readonly packageOrderCreated: false;
  readonly creditsMutated: false;

  readonly activationMutated: false;
  readonly activationInferred: false;
  readonly vendorActivated: false;
  readonly anishaHandoffExecuted: false;

  readonly registrationMutated: false;
  readonly acquisitionCaseMutated: false;
  readonly marketplaceMutated: false;

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

  readonly productionMutation: false;
  readonly businessEffect: false;

  /** Whether anybody paid is Core's to say, and Core has not said it here. */
  readonly requiresCorePaymentTruth: true;
  /**
   * Whether anybody is ACTIVE is Core's to say, separately.
   *
   * Pinned alongside `requiresCorePaymentTruth` rather than folded into it, because the two are the
   * distinction this stage exists to hold: an authoritative payment fact would still not be an
   * activation fact, and only a Core ACTIVE attestation reaching `completeCoreActiveHandoff` ends
   * Aarohi's mandate.
   */
  readonly requiresCoreActivationTruth: true;
  /** A Core status is a moment, not a standing permission. Core re-decides at execution time. */
  readonly requiresCoreStatusRevalidationBeforeFutureOutboundUse: true;
}

export const aarohiPaymentFollowupPostureSchema = z
  .object({
    assistanceContextOnly: z.literal(true),
    paymentContextSourceAuthenticated: z.literal(false),

    paymentMutated: z.literal(false),
    paymentConfirmedByAarohi: z.literal(false),
    paymentLifecycleInvented: z.literal(false),
    packageOrderCreated: z.literal(false),
    creditsMutated: z.literal(false),

    activationMutated: z.literal(false),
    activationInferred: z.literal(false),
    vendorActivated: z.literal(false),
    anishaHandoffExecuted: z.literal(false),

    registrationMutated: z.literal(false),
    acquisitionCaseMutated: z.literal(false),
    marketplaceMutated: z.literal(false),

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

    productionMutation: z.literal(false),
    businessEffect: z.literal(false),

    requiresCorePaymentTruth: z.literal(true),
    requiresCoreActivationTruth: z.literal(true),
    requiresCoreStatusRevalidationBeforeFutureOutboundUse: z.literal(true),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const AAROHI_PAYMENT_FOLLOWUP_POSTURE: AarohiPaymentFollowupPosture = Object.freeze(
  aarohiPaymentFollowupPostureSchema.parse({
    assistanceContextOnly: true,
    paymentContextSourceAuthenticated: false,

    paymentMutated: false,
    paymentConfirmedByAarohi: false,
    paymentLifecycleInvented: false,
    packageOrderCreated: false,
    creditsMutated: false,

    activationMutated: false,
    activationInferred: false,
    vendorActivated: false,
    anishaHandoffExecuted: false,

    registrationMutated: false,
    acquisitionCaseMutated: false,
    marketplaceMutated: false,

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

    productionMutation: false,
    businessEffect: false,

    requiresCorePaymentTruth: true,
    requiresCoreActivationTruth: true,
    requiresCoreStatusRevalidationBeforeFutureOutboundUse: true,
  }),
);

// ---------------------------------------------------------------------------
// The payment-follow-up BRIEF. Never a payment, and never an attestation.
// ---------------------------------------------------------------------------

/**
 * The single positive thing a payment-follow-up brief may say.
 *
 * Deliberately long, and deliberately containing FUTURE and GOVERNED. `PAYMENT_DUE`,
 * `AWAITING_PAYMENT`, `READY_TO_ACTIVATE` and `PAYMENT_CONFIRMED` are all things this repository
 * cannot make true, and a token is read by people who will not read the file it came from.
 */
export const CORE_PAYMENT_FOLLOWUP_OUTCOME =
  'CORE_PAYMENT_FOLLOWUP_CONTEXT_READY_FOR_FUTURE_GOVERNED_ASSISTANCE' as const;
export type CorePaymentFollowupOutcome = typeof CORE_PAYMENT_FOLLOWUP_OUTCOME;

/**
 * Closed, structured bindings — and no money, no state and no sentence anywhere.
 *
 * There is no `amountDue`, no `paymentStatus`, no `paidAt`, no `orderRef`, no `transactionRef`, no
 * `provider`, no `method`, no `explanation`, `summary`, `instructions`, `reminder`, `pitch`, `body`,
 * `message` or `replyText`.
 *
 * And — the field absence that carries the most weight — there is no `authority`, no `active`, no
 * `coreAttestationRef` and no acquisition case. This artifact is not an `ActivationAttestation`, does
 * not parse as one, and cannot reach `completeCoreActiveHandoff`. A brief is not payment, and it is
 * emphatically not activation.
 */
export interface AarohiPaymentFollowupBrief {
  readonly contractVersion: AarohiAvg10ContractVersion;
  readonly briefRef: string;
  readonly prospectRef: string;
  readonly salesPlanRef: string;
  readonly interpretationRef: string;
  /** The Core lookup the CURRENT gate ran under. Named so a later stage knows what to revalidate. */
  readonly coreLookupRef: string;
  readonly paymentContextRef: string;
  /** Opaque. Carried, never followed, and never turned into an amount or a state. */
  readonly corePaymentContextRef: string;
  readonly paymentContextObservedAt: string;
  readonly preparedAt: string;
  readonly outcome: CorePaymentFollowupOutcome;
  readonly posture: AarohiPaymentFollowupPosture;
}

export const aarohiPaymentFollowupBriefSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG10_CONTRACT_VERSION),
    // AVG-10's own artifact identities.
    briefRef: AVG10_LOCAL_ARTIFACT_REF,
    paymentContextRef: AVG10_LOCAL_ARTIFACT_REF,
    corePaymentContextRef: AVG10_LOCAL_ARTIFACT_REF,
    // Inherited from the certified AVG-7 plan.
    prospectRef: UPSTREAM_OPAQUE_REF,
    salesPlanRef: UPSTREAM_OPAQUE_REF,
    interpretationRef: UPSTREAM_OPAQUE_REF,
    coreLookupRef: UPSTREAM_OPAQUE_REF,
    paymentContextObservedAt: UTC_INSTANT,
    preparedAt: UTC_INSTANT,
    outcome: z.literal(CORE_PAYMENT_FOLLOWUP_OUTCOME),
    posture: aarohiPaymentFollowupPostureSchema,
  })
  .strict()
  .refine(
    (value) =>
      canonicalInstantEpochMs(value.preparedAt) >=
      canonicalInstantEpochMs(value.paymentContextObservedAt),
    'the brief claims to predate the payment-context observation it rests on',
  );

/** Re-parse and REBUILD a brief. Detaches it from whatever the caller holds. */
export function parseAarohiPaymentFollowupBrief(
  value: unknown,
): AarohiPaymentFollowupBrief | undefined {
  const parsed = aarohiPaymentFollowupBriefSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG10_CONTRACT_VERSION,
    briefRef: parsed.data.briefRef,
    prospectRef: parsed.data.prospectRef,
    salesPlanRef: parsed.data.salesPlanRef,
    interpretationRef: parsed.data.interpretationRef,
    coreLookupRef: parsed.data.coreLookupRef,
    paymentContextRef: parsed.data.paymentContextRef,
    corePaymentContextRef: parsed.data.corePaymentContextRef,
    paymentContextObservedAt: parsed.data.paymentContextObservedAt,
    preparedAt: parsed.data.preparedAt,
    outcome: CORE_PAYMENT_FOLLOWUP_OUTCOME,
    posture: AAROHI_PAYMENT_FOLLOWUP_POSTURE,
  });
}

/**
 * The result, with AVG-7's and AVG-1's own refusals surfaced rather than flattened.
 *
 * The shape ADR-0126 introduced, kept for the same reason: an interpretation that has gone stale and
 * a prospect Core has since suppressed are both "the plan does not reproduce", and they are not
 * remotely the same governance event.
 */
export type AarohiPaymentFollowupBriefResult =
  | { readonly ok: true; readonly brief: AarohiPaymentFollowupBrief }
  | {
      readonly ok: false;
      readonly refusal: Exclude<AarohiPaymentFollowupRefusal, 'SALES_PLAN_NOT_REDERIVABLE'>;
    }
  | {
      readonly ok: false;
      readonly refusal: 'SALES_PLAN_NOT_REDERIVABLE';
      readonly salesRefusal: Exclude<AarohiSalesTurnRefusal, 'CORE_GATE_REFUSED'>;
    }
  | {
      readonly ok: false;
      readonly refusal: 'SALES_PLAN_NOT_REDERIVABLE';
      readonly salesRefusal: 'CORE_GATE_REFUSED';
      /** AVG-1's own reason: an existing relationship, a suppression, or unresolved truth. */
      readonly coreReason: AcquisitionRefusalReason;
    };

/**
 * What a caller may state when preparing a brief.
 *
 * Seven fields, and note what is absent: no amount, no package, no order, no transaction, no
 * provider, no status, no attestation, no case, no authority, no outcome, no posture and no text.
 * The only thing a caller supplies is EVIDENCE — the artifacts this function re-derives or parses —
 * and its own two instants.
 */
const paymentBriefInputSchema = z
  .object({
    briefRef: AVG10_LOCAL_ARTIFACT_REF,
    conversation: z.unknown(),
    interpretation: z.unknown(),
    coreObservation: z.unknown(),
    salesPlan: z.unknown(),
    paymentContext: z.unknown(),
    preparedAt: UTC_INSTANT,
  })
  .strict();

// ---------------------------------------------------------------------------
// The AVG-7 plan must be RE-DERIVED, not believed.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Are these two canonical artifacts the same artifact, value for value, all the way down?
 *
 * Structural rather than enumerated, for the reason ADR-0126 records: a comparison that lists a
 * sibling's fields by hand ignores a governed field added to that sibling later, which is a widening
 * that weakens a safety proof without touching it. This walks the keys of both objects, requires the
 * key SETS to agree in both directions, and compares leaves with `Object.is` so a `NaN` cannot
 * quietly equal nothing.
 *
 * Restated here rather than imported from AVG-9. The two stages share a pattern, not a dependency:
 * making AVG-10's payment boundary import AVG-9's registration module would couple two deliberately
 * separate stages through a utility, and exporting the helper would put an implementation detail on
 * a locked public surface. Both suites prove the behaviour independently.
 */
function sameCanonicalValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((one, index) => sameCanonicalValue(one, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    if (!leftKeys.every((key, index) => key === rightKeys[index])) return false;
    return leftKeys.every((key) => sameCanonicalValue(left[key], right[key]));
  }
  return Object.is(left, right);
}

function sameSalesTurnPlan(left: AarohiSalesTurnPlan, right: AarohiSalesTurnPlan): boolean {
  return sameCanonicalValue(left, right);
}

/**
 * The refusal for an availability that is not the one that proceeds.
 *
 * TOTAL by type over the remaining members, with no default branch: a fourth availability fails to
 * compile until somebody decides what it means. The failure mode this shape prevents is a token
 * added next year silently inheriting permission.
 */
function absentPaymentContextRefusal(
  availability: Exclude<CorePaymentContextAvailability, 'CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE'>,
): Extract<
  AarohiPaymentFollowupRefusal,
  'CORE_PAYMENT_CONTEXT_NOT_AVAILABLE' | 'CORE_PAYMENT_CONTEXT_UNRESOLVED'
> {
  switch (availability) {
    case 'CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE':
      return 'CORE_PAYMENT_CONTEXT_NOT_AVAILABLE';
    case 'CORE_PAYMENT_CONTEXT_UNKNOWN':
      return 'CORE_PAYMENT_CONTEXT_UNRESOLVED';
  }
}

/**
 * Prepare an inert brief of payment-follow-up context, or refuse.
 *
 * ### The plan is re-derived, because a parsed artifact is not a policy proof
 *
 * AVG-7's own public evaluator is re-run over the supplied conversation, interpretation and CURRENT
 * Core observation, seeded only with the plan's own reference and instant, and the result must
 * reproduce the supplied plan exactly. That carries AVG-7's latest-turn binding, its causal chain
 * and the CURRENT AVG-1 existing-vendor gate across without restating any of them.
 *
 * The gate runs ONCE, inside that re-derivation, and its refusal is surfaced rather than re-asserted
 * here — a second copy would be a second thing to keep correct and a guard that masks its own
 * mutation. It is unchanged and unwidened: exactly `NOT_REGISTERED` proceeds, and a payment question
 * from a party Core has since suppressed yields nothing.
 *
 * ### Only PAYMENT_OR_ACTIVATION
 *
 * `REQUEST_CORE_PROCESS_CONTEXT` is reachable from two AVG-7 intents. Only `PAYMENT_OR_ACTIVATION`
 * belongs here; `REGISTRATION_PROCESS` is AVG-9's and is refused by name.
 *
 * ### Nothing here is a payment, and nothing here is an activation
 *
 * No money moves, no order is created, no payment is recorded or confirmed, no credits are granted,
 * no package is assigned, no vendor is activated, no acquisition case is opened, read or
 * transitioned, no ownership moves to Anisha, no communication request, approval, authorization or
 * execution intent is created, no model is called, no prompt is resolved, nothing is retrieved and
 * nothing is sent.
 */
export function prepareAarohiPaymentFollowupBrief(
  value: unknown,
): AarohiPaymentFollowupBriefResult {
  const parsed = paymentBriefInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'PAYMENT_INPUT_INVALID' as const });
  }

  const suppliedPlan = parseAarohiSalesTurnPlan(parsed.data.salesPlan);
  if (suppliedPlan === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'SALES_PLAN_INVALID' as const });
  }

  // THE POLICY, RE-RUN. Seeded with the supplied plan's own reference and instant, so a difference
  // is a difference of conclusion rather than of naming.
  const reDerived = evaluateAarohiSalesTurn({
    planRef: suppliedPlan.planRef,
    conversation: parsed.data.conversation,
    interpretation: parsed.data.interpretation,
    coreObservation: parsed.data.coreObservation,
    plannedAt: suppliedPlan.plannedAt,
  });
  if (!reDerived.ok) {
    // AVG-7's refusal, and AVG-1's reason underneath it, surfaced rather than flattened.
    if (reDerived.refusal === 'CORE_GATE_REFUSED') {
      return Object.freeze({
        ok: false as const,
        refusal: 'SALES_PLAN_NOT_REDERIVABLE' as const,
        salesRefusal: 'CORE_GATE_REFUSED' as const,
        coreReason: reDerived.coreReason,
      });
    }
    return Object.freeze({
      ok: false as const,
      refusal: 'SALES_PLAN_NOT_REDERIVABLE' as const,
      salesRefusal: reDerived.refusal,
    });
  }
  if (!sameSalesTurnPlan(reDerived.plan, suppliedPlan)) {
    return Object.freeze({ ok: false as const, refusal: 'SALES_PLAN_POLICY_MISMATCH' as const });
  }

  // The RE-DERIVED brief is read, not the supplied one. They are proven identical by this point, and
  // reading the derived value is the honest way to say which of the two is authoritative.
  if (reDerived.plan.brief.strategy !== 'REQUEST_CORE_PROCESS_CONTEXT') {
    return Object.freeze({
      ok: false as const,
      refusal: 'SALES_PLAN_NOT_CORE_PROCESS_CONTEXT' as const,
    });
  }
  if (reDerived.plan.brief.intent !== 'PAYMENT_OR_ACTIVATION') {
    // A registration conversation reaching the same strategy. AVG-9 owns it.
    return Object.freeze({
      ok: false as const,
      refusal: 'SALES_PLAN_NOT_PAYMENT_OR_ACTIVATION' as const,
    });
  }

  const paymentContext = parseCorePaymentFollowupContext(parsed.data.paymentContext);
  if (paymentContext === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'PAYMENT_CONTEXT_INVALID' as const });
  }

  // An observation about another acquisition is not weak evidence about this one — it is none. The
  // Core lookup is checked alongside the prospect so the whole brief rests on ONE Core moment.
  if (
    paymentContext.prospectRef !== reDerived.plan.prospectRef ||
    paymentContext.coreLookupRef !== reDerived.plan.coreLookupRef
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'PAYMENT_CONTEXT_BINDING_MISMATCH' as const,
    });
  }

  if (paymentContext.availability !== 'CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE') {
    // No fallback, no default, no guess. Core having nothing to say is an answer.
    return Object.freeze({
      ok: false as const,
      refusal: absentPaymentContextRefusal(paymentContext.availability),
    });
  }

  // Semantic instants, never spellings. AVG-7 said Core process context was REQUIRED; an observation
  // made before that was said is not an answer to it.
  if (
    canonicalInstantEpochMs(paymentContext.observedAt) <
    canonicalInstantEpochMs(reDerived.plan.plannedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'PAYMENT_CONTEXT_STALE_FOR_PLAN' as const,
    });
  }

  if (
    canonicalInstantEpochMs(parsed.data.preparedAt) <
    canonicalInstantEpochMs(paymentContext.observedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'PAYMENT_BRIEF_BEFORE_PAYMENT_CONTEXT' as const,
    });
  }

  const brief = {
    contractVersion: AAROHI_AVG10_CONTRACT_VERSION,
    briefRef: parsed.data.briefRef,
    prospectRef: reDerived.plan.prospectRef,
    salesPlanRef: reDerived.plan.planRef,
    interpretationRef: reDerived.plan.interpretationRef,
    coreLookupRef: reDerived.plan.coreLookupRef,
    paymentContextRef: paymentContext.paymentContextRef,
    corePaymentContextRef: paymentContext.corePaymentContextRef,
    paymentContextObservedAt: paymentContext.observedAt,
    preparedAt: parsed.data.preparedAt,
    outcome: CORE_PAYMENT_FOLLOWUP_OUTCOME,
    posture: AAROHI_PAYMENT_FOLLOWUP_POSTURE,
  };

  // Parsed before it is returned, against the same schema a caller's hand-built brief would face.
  if (!aarohiPaymentFollowupBriefSchema.safeParse(brief).success) {
    return Object.freeze({ ok: false as const, refusal: 'PAYMENT_BRIEF_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, brief: Object.freeze(brief) });
}
