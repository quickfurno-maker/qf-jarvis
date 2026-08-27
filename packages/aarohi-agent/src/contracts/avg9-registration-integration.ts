/**
 * AVG-9 — the Aarohi REGISTRATION INTEGRATION offline domain (ADR-0126).
 *
 * The overlay sentence this file exists to satisfy, in full:
 *
 * > Guiding a converted prospect into QuickFurno registration. Registration is performed by Core;
 * > Aarohi assists and observes. No marketplace mutation occurs from this side.
 *
 * ### "Core registers; Aarohi assists and observes"
 *
 * That clause is the file, and the interesting half is the second one. Nothing here registers
 * anybody. There is no builder that takes a prospect and returns a vendor, no field that could hold
 * one, and no reference to the one function in QuickFurno that actually performs a registration —
 * which is a WRITE, takes a business name, a phone number, an email address and a GST number, and is
 * named in the containment scan precisely so this package can never call it.
 *
 * What AVG-9 produces is a BRIEF: an inert record saying that a genuinely unregistered prospect
 * asked about registration, that Core still permits the acquisition path, and that Core-authored
 * registration-process context exists to ground a later governed composition. It carries a reference
 * to that context. It does not carry the context.
 *
 * ### The failure this stage is designed against: a plausible registration process
 *
 * Every marketplace has a signup flow with a shape a capable system can produce on demand — verify a
 * mobile, upload a GST certificate, choose a package, pay, go live. Each step sounds right. None of
 * them is a fact this repository holds.
 *
 * So the constraint that shapes this contract is an absence. QuickFurno Core exposes a registration
 * WRITE (`services/vendorService.ts`) and a registration UI. At the inspected commit it exposes no
 * registration-process READ contract at all: no service, route or API that answers "what does
 * registering involve". AVG-8 could mirror seven fields because Core offered seven fields. AVG-9 has
 * nothing to mirror, and the honest response to nothing is not a plausible five-step wizard.
 *
 * This file therefore carries an OPAQUE reference and a closed availability token, and never a step,
 * a requirement, a document list, an endpoint or a duration. Saying
 * `CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE` and pointing at Core's own material is worth less than a
 * real process description and is worth infinitely more than an invented one.
 *
 * ### Two AVG-7 intents share one strategy, and only one of them belongs here
 *
 * AVG-7 routes both `REGISTRATION_PROCESS` and `PAYMENT_OR_ACTIVATION` to
 * `REQUEST_CORE_PROCESS_CONTEXT`, because both are questions whose answers are Core's. Checking the
 * strategy alone would therefore let a payment-and-activation conversation walk into a registration
 * domain through a door that happens to be shared. Payment and activation are AVG-10's, so the
 * re-derived INTENT is checked as well, and a payment plan is refused by name.
 *
 * ### A carried plan is not a proof, and a past Core status is not a present one
 *
 * The supplied AVG-7 plan is RE-DERIVED through AVG-7's own evaluator over the CURRENT conversation,
 * the CURRENT interpretation and the CURRENT Core observation, and must reproduce the supplied plan
 * value for value — every key of the recomputed artifact, nested structures included. That carries
 * AVG-7's latest-turn binding, its causal chain and the AVG-1 existing-vendor gate across without
 * restating any of them, and it means a prospect Core has since marked `REGISTERED`, `ACTIVE` or
 * `DO_NOT_CONTACT` produces no registration brief however interested the conversation sounds.
 *
 * Pure domain only: no runtime, persistence, model call, prompt, retrieval, network, Supabase,
 * QuickFurno import, provider, transport or execution.
 */
import { z } from 'zod';

import { evaluateAarohiSalesTurn, parseAarohiSalesTurnPlan } from './avg7-sales-brain.js';
import type { AarohiSalesTurnPlan, AarohiSalesTurnRefusal } from './avg7-sales-brain.js';
import type { AcquisitionRefusalReason } from './existing-vendor-gate.js';

/** Version of the complete AVG-9 offline registration-integration contract in this package. */
export const AAROHI_AVG9_CONTRACT_VERSION = 1 as const;
export type AarohiAvg9ContractVersion = typeof AAROHI_AVG9_CONTRACT_VERSION;

/**
 * Where a registration-process observation came from, stated unflatteringly.
 *
 * Injected, offline, and asserted by whoever called this function. It is NOT an authenticated read
 * of production Core, not a live registration lookup, and not evidence that anybody is registered:
 * this package holds no Supabase client, no service-role key, no HTTP client and no import of the
 * QuickFurno marketplace. `processContextSourceAuthenticated: false` says it again on every brief.
 */
export const AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE =
  'INJECTED_OFFLINE_CORE_REGISTRATION_PROCESS_CONTEXT' as const;
export type AarohiRegistrationProcessSourcePosture =
  typeof AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE;

// ---------------------------------------------------------------------------
// Shared primitives, and the two reference ROLES this file distinguishes.
//
// Restated rather than imported from AVG-1, AVG-5, AVG-7 or AVG-8, for the reason ADR-0124 records:
// reaching into a certified sibling to borrow a private regex would widen that file's surface for
// this file's convenience. Specs assert the grammars still agree, so the duplication cannot drift.
//
// The ROLE distinction is the one AVG-7's owner review established and AVG-8 carried forward. A
// reference INHERITED from a certified upstream artifact keeps the grammar its owner certified,
// because a downstream stage may not narrow a grammar it does not own and a provider-native
// identifier is frequently a bare run of digits. A reference THIS stage introduces gets the local
// screen, because a field nobody upstream governs is where a destination would be smuggled in.
//
// AVG-9 makes one judgement AVG-8 did not have to make. `coreRegistrationProcessRef` NAMES Core
// material, which makes it look inherited — but no certified upstream artifact carries it, and a
// caller invents it into an AVG-9-local observation. It is therefore LOCAL, and screened. That is
// what refuses a signup URL: the opaque character class already refuses a scheme and a slash, and
// the contact screen refuses the bare-host spelling that would otherwise survive it.
// ---------------------------------------------------------------------------

/**
 * The certified upstream opaque identifier grammar, restated exactly.
 *
 * Used for every reference inherited from a certified AVG-7 plan. Deliberately no contact screen:
 * those grammars belong to Core, to AVG-1 and to AVG-5, and re-judging their identity tokens is not
 * AVG-9's to do.
 */
const UPSTREAM_OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** Shapes an AVG-9-local reference may not contain, named by SHAPE rather than by platform. */
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

/** The most digits an AVG-9-local artifact reference may contain before it is a destination. */
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
 * An identity AVG-9 itself introduces: `briefRef`, `processContextRef` and
 * `coreRegistrationProcessRef`.
 *
 * The three references here that no upstream stage certified, and the three a caller invents. All
 * three screens apply.
 */
const AVG9_LOCAL_ARTIFACT_REF = UPSTREAM_OPAQUE_REF.refine(
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
 * `09:00:00Z` as a string while being half a second later. AVG-5 shipped a comparator that compared
 * the strings and had to be corrected; every stage since is written with the fix.
 */
function canonicalInstantEpochMs(instant: string): number {
  return Date.parse(instant);
}

// ---------------------------------------------------------------------------
// What Core has to say about its own registration process.
// ---------------------------------------------------------------------------

/**
 * Whether Core-authored registration-process context exists, as a closed token.
 *
 * Three members, and exactly ONE of them proceeds. The vocabulary is deliberately about AVAILABILITY
 * rather than about content: it says whether Core has authored something, never what that something
 * says. There is no `STEPS_KNOWN`, `REQUIREMENTS_KNOWN` or `SIGNUP_READY` member, because each of
 * those would be a claim about a workflow this repository has never read.
 *
 * The last two are different facts and are kept apart on purpose. `UNAVAILABLE` is Core answering
 * that it has no published process context; `UNKNOWN` is nobody having asked, or nobody having
 * replied. Both refuse — but a reviewer wants to know which, and the AVG-1 gate makes the same
 * distinction for the same reason.
 */
export const CORE_REGISTRATION_PROCESS_AVAILABILITIES = [
  /** Core has authored registration-process context, named by an opaque reference. */
  'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
  /** Core has none to give. A fact, and not something to paper over with a plausible one. */
  'CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE',
  /** Core has not answered. Not the same as "none exists" — a stop, not a gap. */
  'CORE_PROCESS_CONTEXT_UNKNOWN',
] as const;
export type CoreRegistrationProcessAvailability =
  (typeof CORE_REGISTRATION_PROCESS_AVAILABILITIES)[number];

/**
 * One offline observation of whether Core holds registration-process context for this acquisition.
 *
 * Note what it does not have. No steps, no ordered stages, no requirement list, no document list, no
 * verification or KYC flag, no duration, no endpoint, no form, no field list and no free text. The
 * only thing it can say about Core's process is that Core has one and where Core keeps it.
 *
 * It is bound to a prospect and to the Core lookup the gate ran under, so an observation recorded
 * for one acquisition cannot be re-used to decorate another.
 */
export interface CoreRegistrationProcessContextBase {
  readonly contractVersion: AarohiAvg9ContractVersion;
  /** AVG-9's own identity for this observation. */
  readonly processContextRef: string;
  /** Inherited from the certified AVG-7 plan. */
  readonly prospectRef: string;
  /** The Core lookup this observation belongs with. Inherited, and never re-judged. */
  readonly coreLookupRef: string;
  readonly observedAt: string;
  readonly sourcePosture: AarohiRegistrationProcessSourcePosture;
}

/**
 * The observation, as a discriminated union so the reference cannot outlive its own availability.
 *
 * A single optional `coreRegistrationProcessRef` would have permitted an observation that says Core
 * has no process context and then names one — and left the meaning to whoever read the code next.
 * AVG-8's query scopes are shaped this way for the same reason.
 */
export type CoreRegistrationProcessContext =
  | (CoreRegistrationProcessContextBase & {
      readonly availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE';
      /**
       * An OPAQUE handle to Core-authored registration material.
       *
       * Never read here, never parsed, never interpreted and never followed. It is screened as an
       * AVG-9-local reference, which is what refuses a signup URL, an address and a dialable run.
       */
      readonly coreRegistrationProcessRef: string;
    })
  | (CoreRegistrationProcessContextBase & {
      readonly availability: 'CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE';
    })
  | (CoreRegistrationProcessContextBase & {
      readonly availability: 'CORE_PROCESS_CONTEXT_UNKNOWN';
    });

const PROCESS_CONTEXT_STATED_FIELDS = {
  processContextRef: AVG9_LOCAL_ARTIFACT_REF,
  prospectRef: UPSTREAM_OPAQUE_REF,
  coreLookupRef: UPSTREAM_OPAQUE_REF,
  observedAt: UTC_INSTANT,
} as const;

const PROCESS_CONTEXT_STAMPED_FIELDS = {
  contractVersion: z.literal(AAROHI_AVG9_CONTRACT_VERSION),
  sourcePosture: z.literal(AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE),
} as const;

export const coreRegistrationProcessContextSchema = z.discriminatedUnion('availability', [
  z
    .object({
      ...PROCESS_CONTEXT_STAMPED_FIELDS,
      ...PROCESS_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE'),
      coreRegistrationProcessRef: AVG9_LOCAL_ARTIFACT_REF,
    })
    .strict(),
  z
    .object({
      ...PROCESS_CONTEXT_STAMPED_FIELDS,
      ...PROCESS_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE'),
    })
    .strict(),
  z
    .object({
      ...PROCESS_CONTEXT_STAMPED_FIELDS,
      ...PROCESS_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_PROCESS_CONTEXT_UNKNOWN'),
    })
    .strict(),
]);

/** What a caller may state when recording one. Not the version, and not the posture. */
const processContextInputSchema = z.discriminatedUnion('availability', [
  z
    .object({
      ...PROCESS_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE'),
      coreRegistrationProcessRef: AVG9_LOCAL_ARTIFACT_REF,
    })
    .strict(),
  z
    .object({
      ...PROCESS_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE'),
    })
    .strict(),
  z
    .object({
      ...PROCESS_CONTEXT_STATED_FIELDS,
      availability: z.literal('CORE_PROCESS_CONTEXT_UNKNOWN'),
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/**
 * Why a registration-assistance brief may not be prepared. Closed, content-free, and never prose.
 *
 * The three plan refusals are deliberately separate, because they are three different accusations.
 * `SALES_PLAN_INVALID` says the artifact is malformed. `SALES_PLAN_NOT_REDERIVABLE` says it is
 * well-formed and the CURRENT evidence does not support making it at all — and it carries AVG-7's
 * own refusal so a reviewer can tell a stale interpretation from a refused Core gate.
 * `SALES_PLAN_POLICY_MISMATCH` says the evidence supports SOME plan and not this one.
 *
 * The two strategy refusals are separate for the same reason. A commercial plan arriving here is the
 * AVG-8 boundary being crossed; a payment-or-activation plan arriving here is the AVG-10 boundary
 * being crossed, and those share AVG-7's process-context strategy.
 */
export const REGISTRATION_ASSISTANCE_REFUSALS = [
  'REGISTRATION_INPUT_INVALID',
  /** The supplied AVG-7 plan is malformed. A shape failure. */
  'SALES_PLAN_INVALID',
  /** The CURRENT evidence yields no plan at all. Carries AVG-7's own refusal. */
  'SALES_PLAN_NOT_REDERIVABLE',
  /** The CURRENT evidence yields a plan, and it is not the one that was handed in. */
  'SALES_PLAN_POLICY_MISMATCH',
  /** An honestly re-derived plan that did not ask for Core process context at all. */
  'SALES_PLAN_NOT_CORE_PROCESS_CONTEXT',
  /** An honestly re-derived process-context plan about payment or activation. AVG-10's. */
  'SALES_PLAN_NOT_REGISTRATION_PROCESS',
  'REGISTRATION_PROCESS_CONTEXT_INVALID',
  /** The observation describes a different prospect, or a different Core lookup. */
  'REGISTRATION_PROCESS_CONTEXT_BINDING_MISMATCH',
  /** Core holds no registration-process context. There is no fallback and no substitute. */
  'CORE_REGISTRATION_PROCESS_CONTEXT_NOT_AVAILABLE',
  /** Nobody established whether Core holds any. A stop, not a gap. */
  'CORE_REGISTRATION_PROCESS_CONTEXT_UNRESOLVED',
  /** The observation predates the plan that asked for it. */
  'REGISTRATION_PROCESS_CONTEXT_STALE_FOR_PLAN',
  'REGISTRATION_BRIEF_BEFORE_PROCESS_CONTEXT',
  'REGISTRATION_BRIEF_INVALID',
] as const;
export type AarohiRegistrationAssistanceRefusal = (typeof REGISTRATION_ASSISTANCE_REFUSALS)[number];

export type CoreRegistrationProcessContextResult =
  | { readonly ok: true; readonly processContext: CoreRegistrationProcessContext }
  | { readonly ok: false; readonly refusal: AarohiRegistrationAssistanceRefusal };

/**
 * Re-parse and REBUILD a process-context observation from whatever was handed in.
 *
 * A declared TypeScript type is erased before any of this runs, so trusting one would be trusting
 * the caller. The version and the posture are re-stamped rather than copied, so a value that arrived
 * describing itself as an authenticated live Core read comes back describing itself as an injected
 * offline observation, or does not come back.
 */
export function parseCoreRegistrationProcessContext(
  value: unknown,
): CoreRegistrationProcessContext | undefined {
  const parsed = coreRegistrationProcessContextSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const base = {
    contractVersion: AAROHI_AVG9_CONTRACT_VERSION,
    processContextRef: parsed.data.processContextRef,
    prospectRef: parsed.data.prospectRef,
    coreLookupRef: parsed.data.coreLookupRef,
    observedAt: parsed.data.observedAt,
    sourcePosture: AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE,
  } as const;

  if (parsed.data.availability === 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE') {
    return Object.freeze({
      ...base,
      availability: parsed.data.availability,
      coreRegistrationProcessRef: parsed.data.coreRegistrationProcessRef,
    });
  }
  return Object.freeze({ ...base, availability: parsed.data.availability });
}

/**
 * Record one offline observation of Core's registration-process availability.
 *
 * The posture and the contract version are STAMPED rather than accepted, so an injected fixture
 * cannot describe itself as an authenticated production read. The result is produced by the public
 * parser above, so a value this builder returns is by construction a value that parser accepts.
 */
export function createCoreRegistrationProcessContext(
  value: unknown,
): CoreRegistrationProcessContextResult {
  const parsed = processContextInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'REGISTRATION_INPUT_INVALID' as const });
  }

  const stamped = {
    ...parsed.data,
    contractVersion: AAROHI_AVG9_CONTRACT_VERSION,
    sourcePosture: AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE,
  };

  const processContext = parseCoreRegistrationProcessContext(stamped);
  if (processContext === undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'REGISTRATION_PROCESS_CONTEXT_INVALID' as const,
    });
  }
  return Object.freeze({ ok: true as const, processContext });
}

// ---------------------------------------------------------------------------
// The posture.
// ---------------------------------------------------------------------------

/**
 * The authority ceiling, as literals a machine can check rather than prose somebody must remember.
 *
 * Read the first four `false` fields together, because they are four different ways of claiming an
 * authority this package does not have. `registrationProcessInvented` says no workflow originated
 * here. `registrationConfirmed` says nobody was told a registration happened. `vendorRecordCreated`
 * says no vendor exists because of this. `registrationMutated` says Core's registration state is
 * exactly where it was. A domain can commit any one of those without committing the others, and
 * three of the four would be committed silently.
 *
 * `marketplaceMutated` is the overlay's own sentence — "no marketplace mutation occurs from this
 * side" — written where a schema can enforce it.
 */
export interface AarohiRegistrationAssistancePosture {
  readonly assistanceContextOnly: true;
  /** This is an injected offline observation. It is not a live authenticated read of Core. */
  readonly processContextSourceAuthenticated: false;

  readonly registrationProcessInvented: false;
  readonly registrationConfirmed: false;
  readonly vendorRecordCreated: false;
  readonly registrationMutated: false;

  readonly marketplaceMutated: false;
  readonly acquisitionCaseMutated: false;
  readonly paymentMutated: false;
  readonly activationMutated: false;
  readonly anishaHandoffExecuted: false;

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

  /**
   * Registration is executed by QuickFurno Core, and only by Core.
   *
   * Pinned `true` rather than described, so a brief cannot be read as the registration itself. A
   * brief is not registration permission, not registration confirmation, not a vendor record, not a
   * Core mutation command and not an execution intent.
   */
  readonly requiresCoreRegistrationExecution: true;
  /**
   * The Core process context a brief points at is present, not understood.
   *
   * It does NOT mean a model was called, a prompt resolved, guidance exists, a reply is safe or a
   * send is allowed. AVG-7's plan keeps `futureModelDraftEligible: false` and is not rewritten by
   * this file — the plan recorded that facts were MISSING when it was made, which stays true.
   */
  readonly registrationProcessContextReadyForFutureGovernedAssistance: true;
  /** A Core status is a moment, not a standing permission. Core re-decides at execution time. */
  readonly requiresCoreStatusRevalidationBeforeFutureOutboundUse: true;
}

export const aarohiRegistrationAssistancePostureSchema = z
  .object({
    assistanceContextOnly: z.literal(true),
    processContextSourceAuthenticated: z.literal(false),

    registrationProcessInvented: z.literal(false),
    registrationConfirmed: z.literal(false),
    vendorRecordCreated: z.literal(false),
    registrationMutated: z.literal(false),

    marketplaceMutated: z.literal(false),
    acquisitionCaseMutated: z.literal(false),
    paymentMutated: z.literal(false),
    activationMutated: z.literal(false),
    anishaHandoffExecuted: z.literal(false),

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

    requiresCoreRegistrationExecution: z.literal(true),
    registrationProcessContextReadyForFutureGovernedAssistance: z.literal(true),
    requiresCoreStatusRevalidationBeforeFutureOutboundUse: z.literal(true),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const AAROHI_REGISTRATION_ASSISTANCE_POSTURE: AarohiRegistrationAssistancePosture =
  Object.freeze(
    aarohiRegistrationAssistancePostureSchema.parse({
      assistanceContextOnly: true,
      processContextSourceAuthenticated: false,

      registrationProcessInvented: false,
      registrationConfirmed: false,
      vendorRecordCreated: false,
      registrationMutated: false,

      marketplaceMutated: false,
      acquisitionCaseMutated: false,
      paymentMutated: false,
      activationMutated: false,
      anishaHandoffExecuted: false,

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

      requiresCoreRegistrationExecution: true,
      registrationProcessContextReadyForFutureGovernedAssistance: true,
      requiresCoreStatusRevalidationBeforeFutureOutboundUse: true,
    }),
  );

// ---------------------------------------------------------------------------
// The registration-assistance BRIEF. Never an action.
// ---------------------------------------------------------------------------

/**
 * The single positive thing a registration-assistance brief may say.
 *
 * Deliberately long, and deliberately containing FUTURE and GOVERNED. `REGISTRATION_READY`,
 * `SIGNUP_PREPARED` and `REGISTRATION_IN_PROGRESS` are all things this repository cannot make true,
 * and a token is read by people who will not read the file it came from.
 */
export const CORE_REGISTRATION_ASSISTANCE_OUTCOME =
  'CORE_REGISTRATION_PROCESS_CONTEXT_READY_FOR_FUTURE_GOVERNED_ASSISTANCE' as const;
export type CoreRegistrationAssistanceOutcome = typeof CORE_REGISTRATION_ASSISTANCE_OUTCOME;

/**
 * Closed, structured bindings — and no sentence anywhere.
 *
 * There is no `explanation`, `summary`, `instructions`, `guidance`, `registrationScript`,
 * `signupScript`, `pitch`, `salesCopy`, `body`, `message` or `replyText`. The roadmap says Aarohi
 * "guides" a prospect into registration, and the guiding belongs to a later governed composition
 * working from Core's own material; what AVG-9 provides is the thing that composition must be
 * grounded in and the proof it was allowed to exist at all. A prose field here would be the
 * un-grounded half arriving first — and in a registration conversation the un-grounded half is a
 * five-step signup process nobody at QuickFurno wrote.
 */
export interface AarohiRegistrationAssistanceBrief {
  readonly contractVersion: AarohiAvg9ContractVersion;
  readonly briefRef: string;
  readonly prospectRef: string;
  readonly salesPlanRef: string;
  readonly interpretationRef: string;
  /** The Core lookup the CURRENT gate ran under. Named so a later stage knows what to revalidate. */
  readonly coreLookupRef: string;
  readonly processContextRef: string;
  /** Opaque. Carried, never followed, and never turned into a step. */
  readonly coreRegistrationProcessRef: string;
  readonly processContextObservedAt: string;
  readonly preparedAt: string;
  readonly outcome: CoreRegistrationAssistanceOutcome;
  readonly posture: AarohiRegistrationAssistancePosture;
}

export const aarohiRegistrationAssistanceBriefSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG9_CONTRACT_VERSION),
    // AVG-9's own artifact identities.
    briefRef: AVG9_LOCAL_ARTIFACT_REF,
    processContextRef: AVG9_LOCAL_ARTIFACT_REF,
    coreRegistrationProcessRef: AVG9_LOCAL_ARTIFACT_REF,
    // Inherited from the certified AVG-7 plan.
    prospectRef: UPSTREAM_OPAQUE_REF,
    salesPlanRef: UPSTREAM_OPAQUE_REF,
    interpretationRef: UPSTREAM_OPAQUE_REF,
    coreLookupRef: UPSTREAM_OPAQUE_REF,
    processContextObservedAt: UTC_INSTANT,
    preparedAt: UTC_INSTANT,
    outcome: z.literal(CORE_REGISTRATION_ASSISTANCE_OUTCOME),
    posture: aarohiRegistrationAssistancePostureSchema,
  })
  .strict()
  .refine(
    (value) =>
      canonicalInstantEpochMs(value.preparedAt) >=
      canonicalInstantEpochMs(value.processContextObservedAt),
    'the brief claims to predate the process-context observation it rests on',
  );

/** Re-parse and REBUILD a brief. Detaches it from whatever the caller holds. */
export function parseAarohiRegistrationAssistanceBrief(
  value: unknown,
): AarohiRegistrationAssistanceBrief | undefined {
  const parsed = aarohiRegistrationAssistanceBriefSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG9_CONTRACT_VERSION,
    briefRef: parsed.data.briefRef,
    prospectRef: parsed.data.prospectRef,
    salesPlanRef: parsed.data.salesPlanRef,
    interpretationRef: parsed.data.interpretationRef,
    coreLookupRef: parsed.data.coreLookupRef,
    processContextRef: parsed.data.processContextRef,
    coreRegistrationProcessRef: parsed.data.coreRegistrationProcessRef,
    processContextObservedAt: parsed.data.processContextObservedAt,
    preparedAt: parsed.data.preparedAt,
    outcome: CORE_REGISTRATION_ASSISTANCE_OUTCOME,
    posture: AAROHI_REGISTRATION_ASSISTANCE_POSTURE,
  });
}

/**
 * The result, with AVG-7's and AVG-1's own refusals surfaced rather than flattened.
 *
 * AVG-8 collapsed every re-derivation failure into one token, which is defensible and loses
 * something a reviewer wants: an interpretation that has gone stale and a prospect who has become
 * `DO_NOT_CONTACT` are both "the plan does not reproduce", and they are not remotely the same
 * governance event. Carrying the upstream token costs one field and duplicates no logic.
 */
export type AarohiRegistrationAssistanceBriefResult =
  | { readonly ok: true; readonly brief: AarohiRegistrationAssistanceBrief }
  | {
      readonly ok: false;
      readonly refusal: Exclude<AarohiRegistrationAssistanceRefusal, 'SALES_PLAN_NOT_REDERIVABLE'>;
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
 * Seven fields, and note what is absent: no step, no requirement, no document, no endpoint, no
 * duration, no outcome, no posture and no text. The only thing a caller supplies is EVIDENCE — the
 * artifacts this function re-derives or parses — and its own two instants.
 */
const registrationBriefInputSchema = z
  .object({
    briefRef: AVG9_LOCAL_ARTIFACT_REF,
    conversation: z.unknown(),
    interpretation: z.unknown(),
    coreObservation: z.unknown(),
    salesPlan: z.unknown(),
    registrationProcessContext: z.unknown(),
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
 * Structural rather than enumerated, which is the whole point. AVG-8's comparison lists AVG-7's
 * top-level fields by hand, so a governed field added to the plan next year would be compared by
 * nobody and ignored silently — a widening that weakens a safety proof without touching it. This
 * walks the keys of both objects and requires the key SETS to match in both directions, so a new
 * field is compared the moment it exists and a missing one is a mismatch rather than an omission.
 *
 * Value equality, never object identity: the whole point is to compare something a caller handed in
 * against something this file recomputed, so they are necessarily different objects. `Object.is`
 * rather than `===` so a `NaN` cannot quietly equal nothing, including itself.
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
 * compile until somebody decides what it means, which is the point. The failure mode this shape
 * prevents is a token added next year silently inheriting permission — the same reason AVG-1's
 * status role map is written the way it is.
 */
function absentProcessContextRefusal(
  availability: Exclude<
    CoreRegistrationProcessAvailability,
    'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE'
  >,
): Extract<
  AarohiRegistrationAssistanceRefusal,
  'CORE_REGISTRATION_PROCESS_CONTEXT_NOT_AVAILABLE' | 'CORE_REGISTRATION_PROCESS_CONTEXT_UNRESOLVED'
> {
  switch (availability) {
    case 'CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE':
      return 'CORE_REGISTRATION_PROCESS_CONTEXT_NOT_AVAILABLE';
    case 'CORE_PROCESS_CONTEXT_UNKNOWN':
      return 'CORE_REGISTRATION_PROCESS_CONTEXT_UNRESOLVED';
  }
}

/**
 * Prepare an inert brief of registration assistance, or refuse.
 *
 * ### The plan is re-derived, because a parsed artifact is not a policy proof
 *
 * A caller could hand-write a plan that parses, says `REQUEST_CORE_PROCESS_CONTEXT`, and rests on
 * nothing — so the plan is not believed. AVG-7's own public evaluator is re-run over the supplied
 * conversation, interpretation and CURRENT Core observation, seeded only with the plan's own
 * reference and instant so the only thing that can differ is what the canonical policy concludes.
 * The result must reproduce the supplied plan exactly.
 *
 * That carries three of AVG-7's guarantees across for free, which is why it is worth more than a
 * strategy check: the interpretation must still be a reading of the CURRENT turn, the causal chain
 * message → reading → plan must still hold, and the CURRENT Core gate must still admit exactly
 * `NOT_REGISTERED`. A prospect who has since registered cannot be walked through registering, and
 * that falls out of the re-derivation rather than being asserted twice here — a second copy of the
 * gate would be a second thing to keep correct and a guard that masks its own mutation.
 *
 * ### And the strategy alone is not enough
 *
 * `REQUEST_CORE_PROCESS_CONTEXT` is reachable from two AVG-7 intents. Only `REGISTRATION_PROCESS`
 * belongs here; `PAYMENT_OR_ACTIVATION` is AVG-10's and is refused by name.
 *
 * ### Nothing here is an action
 *
 * No vendor is registered, no marketplace row is written, no acquisition case is opened, read or
 * transitioned, no payment or activation happens, no ownership moves to Anisha, no communication
 * request, approval, authorization or execution intent is created, no model is called, no prompt is
 * resolved, nothing is retrieved and nothing is sent.
 */
export function prepareAarohiRegistrationAssistanceBrief(
  value: unknown,
): AarohiRegistrationAssistanceBriefResult {
  const parsed = registrationBriefInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'REGISTRATION_INPUT_INVALID' as const });
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
  if (reDerived.plan.brief.intent !== 'REGISTRATION_PROCESS') {
    // A payment-or-activation conversation reaching the same strategy. AVG-10 owns it.
    return Object.freeze({
      ok: false as const,
      refusal: 'SALES_PLAN_NOT_REGISTRATION_PROCESS' as const,
    });
  }

  const processContext = parseCoreRegistrationProcessContext(
    parsed.data.registrationProcessContext,
  );
  if (processContext === undefined) {
    return Object.freeze({
      ok: false as const,
      refusal: 'REGISTRATION_PROCESS_CONTEXT_INVALID' as const,
    });
  }

  // An observation about another acquisition is not weak evidence about this one — it is none. The
  // Core lookup is checked alongside the prospect so the whole brief rests on ONE Core moment.
  if (
    processContext.prospectRef !== reDerived.plan.prospectRef ||
    processContext.coreLookupRef !== reDerived.plan.coreLookupRef
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'REGISTRATION_PROCESS_CONTEXT_BINDING_MISMATCH' as const,
    });
  }

  if (processContext.availability !== 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE') {
    // No fallback, no default process, no guess. Core having nothing to say is an answer.
    return Object.freeze({
      ok: false as const,
      refusal: absentProcessContextRefusal(processContext.availability),
    });
  }

  // Semantic instants, never spellings. AVG-7 said Core process context was REQUIRED; an observation
  // made before that was said is not an answer to it.
  if (
    canonicalInstantEpochMs(processContext.observedAt) <
    canonicalInstantEpochMs(reDerived.plan.plannedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'REGISTRATION_PROCESS_CONTEXT_STALE_FOR_PLAN' as const,
    });
  }

  if (
    canonicalInstantEpochMs(parsed.data.preparedAt) <
    canonicalInstantEpochMs(processContext.observedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'REGISTRATION_BRIEF_BEFORE_PROCESS_CONTEXT' as const,
    });
  }

  const brief = {
    contractVersion: AAROHI_AVG9_CONTRACT_VERSION,
    briefRef: parsed.data.briefRef,
    prospectRef: reDerived.plan.prospectRef,
    salesPlanRef: reDerived.plan.planRef,
    interpretationRef: reDerived.plan.interpretationRef,
    coreLookupRef: reDerived.plan.coreLookupRef,
    processContextRef: processContext.processContextRef,
    coreRegistrationProcessRef: processContext.coreRegistrationProcessRef,
    processContextObservedAt: processContext.observedAt,
    preparedAt: parsed.data.preparedAt,
    outcome: CORE_REGISTRATION_ASSISTANCE_OUTCOME,
    posture: AAROHI_REGISTRATION_ASSISTANCE_POSTURE,
  };

  // Parsed before it is returned, against the same schema a caller's hand-built brief would face.
  if (!aarohiRegistrationAssistanceBriefSchema.safeParse(brief).success) {
    return Object.freeze({ ok: false as const, refusal: 'REGISTRATION_BRIEF_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, brief: Object.freeze(brief) });
}
