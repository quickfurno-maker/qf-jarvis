/**
 * AVG-8 — the Aarohi COMMERCIAL TRUTH and PACKAGE ENGINE offline domain (ADR-0125).
 *
 * The overlay sentence this file exists to satisfy, in full:
 *
 * > Packages, entitlements and pricing presented during acquisition, sourced from Core. The engine
 * > selects and explains what Core already holds; it does not invent, adjust, discount or interpret
 * > price. Commercial facts are reference data, not values a model is allowed to improvise.
 *
 * ### "Reference data, not values a model is allowed to improvise"
 *
 * AVG-7 established that a commercial question stops at `REQUEST_CORE_COMMERCIAL_CONTEXT`, because a
 * system asked for a price it does not have will invent one. This file is the other half: it carries
 * the facts Core already holds, and it carries them EXACTLY. Every number here was copied. None was
 * computed, rounded, compared, combined or explained.
 *
 * The word "engine" is the dangerous one in the roadmap sentence, so it is worth being precise about
 * what this engine does: it looks a package up by identifier, or it lists what Core marked available.
 * That is the whole of it. There is no cheapest, no best value, no most suitable, no recommended —
 * because every one of those is Aarohi forming a commercial opinion, and commercial opinions are
 * Core's. A ranking dressed as a convenience is still a ranking.
 *
 * ### The read surface, and why this file does not reach behind it
 *
 * QuickFurno's `packages` table has nine columns. Its available-package READ service exposes seven,
 * and deliberately omits `created_at` and `price_per_lead`. This contract mirrors the SEVEN — the
 * contract Core actually offers — rather than the table underneath it.
 *
 * `price_per_lead` is the instructive omission. It exists in the database, it is trivially derivable
 * from `total_price / lead_count`, and it is exactly the kind of number a sales conversation reaches
 * for. It is absent here twice over: not read, and not calculated. A downstream stage that wants a
 * per-lead figure must get it from Core, because the moment Aarohi divides two Core numbers together
 * the result is an Aarohi number being presented as a Core one.
 *
 * ### Two prices, and no opinion about their relationship
 *
 * Core exposes `total_price` and `display_price` and this file preserves both, separately, exactly.
 * It does not decide which is the real one, does not subtract them, and does not name the difference.
 * Calling that difference a discount would be inventing a promotion Core never authorised; calling it
 * an error would be second-guessing Core's data. Both are copied and both are shown.
 *
 * ### A snapshot is not permission, and not a standing offer
 *
 * Nothing here creates an order, a payment, a package assignment, a credit grant or an activation.
 * Those are AVG-9's, AVG-10's, and Core's. A prospect saying "I want that package" produces, here,
 * exactly nothing.
 *
 * Pure domain only: no runtime, persistence, model call, prompt, retrieval, network, Supabase,
 * QuickFurno import, provider, transport or execution.
 */
import { z } from 'zod';

import { evaluateAarohiSalesTurn, parseAarohiSalesTurnPlan } from './avg7-sales-brain.js';
import type { AarohiSalesTurnPlan } from './avg7-sales-brain.js';

/** Version of the complete AVG-8 offline commercial-truth contract in this package. */
export const AAROHI_AVG8_CONTRACT_VERSION = 1 as const;
export type AarohiAvg8ContractVersion = typeof AAROHI_AVG8_CONTRACT_VERSION;

/**
 * Where a commercial catalog observation came from, stated unflatteringly.
 *
 * Injected, offline, and asserted by whoever called this function. It is NOT an authenticated read
 * of production Core: this package holds no Supabase client, no service-role key, no HTTP client and
 * no import of the QuickFurno marketplace. The posture says so out loud so that a snapshot cannot be
 * mistaken, later, for a live commercial fact — and `snapshotSourceAuthenticated: false` says it
 * again on every brief.
 */
export const AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE =
  'INJECTED_OFFLINE_CORE_COMMERCIAL_CATALOG_OBSERVATION' as const;
export type AarohiCommercialSourcePosture = typeof AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE;

/** A catalog is a review surface, not a warehouse. Finite, and small enough to read. */
export const MAX_COMMERCIAL_PACKAGES = 64;

// ---------------------------------------------------------------------------
// Reference roles, restated from AVG-7's owner-review correction.
//
// The distinction AVG-7 was corrected into is the same one here: a reference INHERITED from a
// certified upstream artifact keeps the grammar that artifact's owner certified, and only the
// references THIS stage introduces get the local contact screen. A Core package id is an upstream
// identifier — a UUID today, and whatever Core decides tomorrow — and narrowing it would mean a
// package Core lists cannot be quoted by Aarohi.
// ---------------------------------------------------------------------------

/**
 * The certified upstream opaque identifier grammar, restated exactly.
 *
 * Used for the Core package id and for every reference inherited from an AVG-7 plan. Deliberately no
 * contact screen: those grammars belong to Core, to AVG-1 and to AVG-5, and re-judging their
 * identity tokens is not AVG-8's to do. A UUID and a numeric id both pass, which is the point.
 */
const UPSTREAM_OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** Shapes an AVG-8-local reference may not contain, named by SHAPE rather than by platform. */
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

/** The most digits an AVG-8-local artifact reference may contain before it is a destination. */
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
 * An identity AVG-8 itself introduces: `snapshotRef` and `briefRef`.
 *
 * The only two references here that no upstream stage certified, and the only two a caller invents.
 * All three screens apply, for the reason ADR-0124 records: a field nobody upstream governs is where
 * a destination would be smuggled into an artifact that claims to carry none.
 */
const AVG8_LOCAL_ARTIFACT_REF = UPSTREAM_OPAQUE_REF.refine(
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

/** The UTC instant a canonical timestamp REPRESENTS, in epoch milliseconds. */
function canonicalInstantEpochMs(instant: string): number {
  return Date.parse(instant);
}

// ---------------------------------------------------------------------------
// The Core package option — the READ surface, mirrored.
// ---------------------------------------------------------------------------

/**
 * One package exactly as Core's available-package read service exposes it.
 *
 * Seven fields, in Core's own snake_case, because renaming them would be the first act of
 * interpretation. `display_price` becoming `listPrice` is a claim about what the two prices MEAN,
 * and this file has no such claim to make.
 *
 * What is absent is the substance of the contract: no `price_per_lead` (in the table, not in the read
 * surface, and never calculated here), no `created_at`, no currency, no discount, no savings, no
 * effective or final or sale price, no description, no features, no tier, no rank, no recommendation,
 * no suitability and no eligibility. Every one of those is either a field Core did not expose or a
 * number Aarohi would have had to invent.
 */
export interface CoreCommercialPackageOption {
  /** Core's own package identifier. A UUID today; an upstream grammar either way. */
  readonly id: string;
  readonly name: string;
  /**
   * The package's lead entitlement, as Core records it.
   *
   * A COUNT, and never a promise. It is not guaranteed delivered leads, not guaranteed qualified
   * leads, and not a revenue or conversion forecast — AVG-7 pins all three of those false and this
   * field does not quietly undo them.
   */
  readonly lead_count: number;
  /** Copied exactly. Its relationship to `display_price` is not this file's to interpret. */
  readonly total_price: number;
  /** Copied exactly. Likewise. */
  readonly display_price: number;
  readonly validity_days: number;
  /** Literally `true`: this contract models the AVAILABLE-package read, which filters on it. */
  readonly is_active: true;
}

/**
 * A finite, non-negative count.
 *
 * `nonnegative` rather than `positive`, because whether a zero-lead or zero-day package is sensible
 * is Core's judgement and not this file's. Refusing one here would be a commercial opinion wearing a
 * validation rule.
 */
const CORE_COUNT = z.number().int().nonnegative();

/**
 * A finite, non-negative price.
 *
 * No upper bound, no currency, no scale assumption. Finiteness matters here -- `Infinity` and `NaN`
 * are the two values that would survive arithmetic somebody added later and make nonsense of it
 * silently -- and zod 4's `z.number()` already refuses both, which is why there is no explicit
 * `.finite()`: it is a deprecated no-op in this version. Specs assert both are refused rather than
 * trusting that note.
 */
const CORE_PRICE = z.number().nonnegative();

export const coreCommercialPackageOptionSchema = z
  .object({
    id: UPSTREAM_OPAQUE_REF,
    // Preserved exactly as parsed. No trim, no case fold, no whitespace collapse: a package called
    // ` Starter ` is a package Core named ` Starter `, and normalising it is editing Core's data.
    name: z.string().min(1).max(128),
    lead_count: CORE_COUNT,
    total_price: CORE_PRICE,
    display_price: CORE_PRICE,
    validity_days: CORE_COUNT,
    // Not `z.boolean()`. An inactive package is outside this contract rather than something to
    // filter out quietly — silently dropping a row is how a caller ends up believing a catalog was
    // complete when it was not.
    is_active: z.literal(true),
  })
  .strict();

// ---------------------------------------------------------------------------
// The catalog snapshot.
// ---------------------------------------------------------------------------

/**
 * What Core's available-package read returned, at one instant, as an offline observation.
 *
 * Immutable, bounded, deduplicated by Core package id, and canonically ordered.
 */
export interface CoreCommercialCatalogSnapshot {
  readonly contractVersion: AarohiAvg8ContractVersion;
  readonly snapshotRef: string;
  readonly observedAt: string;
  readonly sourcePosture: AarohiCommercialSourcePosture;
  readonly packages: readonly CoreCommercialPackageOption[];
}

/**
 * THE canonical order of two packages: by Core package id, ascending, and by nothing else.
 *
 * This is SERIALIZATION ORDER and explicitly not ranking. Core's own service orders by `lead_count`;
 * this file deliberately does not, because an order Aarohi chose over a commercial attribute is a
 * recommendation whether or not anybody calls it one — the first row of a price-sorted list is the
 * cheapest package, and something downstream will eventually read it that way.
 *
 * Ordering by identifier is meaningless as a commercial signal, which is exactly why it is safe. A
 * spec asserts the canonical order disagrees with lead-count order and with both price orders.
 */
function compareCanonicalPackageOrder(
  left: CoreCommercialPackageOption,
  right: CoreCommercialPackageOption,
): -1 | 0 | 1 {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Is this whole catalog canonical, and not merely a bag of individually canonical packages?
 *
 * One helper, called by the schema, the parser and the builder, so the invariant cannot acquire a
 * second definition. AVG-5's owner review found exactly that split and AVG-6 shipped with it closed;
 * this file is written the same way.
 */
function catalogAggregateIsCanonical(packages: readonly CoreCommercialPackageOption[]): boolean {
  if (packages.length > MAX_COMMERCIAL_PACKAGES) {
    return false;
  }

  const seen = new Set<string>();
  let previous: CoreCommercialPackageOption | undefined;
  for (const option of packages) {
    if (seen.has(option.id)) {
      // Two rows for one package id are two answers to one question, and nothing here can tell
      // which is current.
      return false;
    }
    seen.add(option.id);
    // STRICTLY increasing. An unsorted array is REFUSED rather than quietly reordered: a public
    // canonical parser certifies the value it was shown.
    if (previous !== undefined && compareCanonicalPackageOrder(previous, option) !== -1) {
      return false;
    }
    previous = option;
  }
  return true;
}

export const coreCommercialCatalogSnapshotSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG8_CONTRACT_VERSION),
    snapshotRef: AVG8_LOCAL_ARTIFACT_REF,
    observedAt: UTC_INSTANT,
    sourcePosture: z.literal(AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE),
    packages: z.array(coreCommercialPackageOptionSchema).max(MAX_COMMERCIAL_PACKAGES),
  })
  .strict()
  .refine(
    (value) => catalogAggregateIsCanonical(value.packages),
    'the packages do not form a canonical catalog aggregate',
  );

/** What a caller may state when recording an observation. Not the version, not the posture. */
const catalogInputSchema = z
  .object({
    snapshotRef: AVG8_LOCAL_ARTIFACT_REF,
    observedAt: UTC_INSTANT,
    packages: z.array(coreCommercialPackageOptionSchema).max(MAX_COMMERCIAL_PACKAGES),
  })
  .strict();

export const COMMERCIAL_REFUSALS = [
  'COMMERCIAL_INPUT_INVALID',
  /** The supplied AVG-7 plan is malformed. A shape failure. */
  'SALES_PLAN_INVALID',
  /**
   * The plan parses, and re-running AVG-7's canonical policy over the same conversation,
   * interpretation and CURRENT Core observation does not reproduce it. A provenance failure, kept
   * apart from the two above and the one below because a reviewer wants to tell them apart.
   */
  'SALES_PLAN_POLICY_MISMATCH',
  /** An honestly re-derived plan that did not ask for commercial context. */
  'SALES_PLAN_NOT_COMMERCIAL',
  'COMMERCIAL_CATALOG_INVALID',
  /** The observation predates the plan that asked for it. */
  'COMMERCIAL_CATALOG_STALE_FOR_PLAN',
  /** Core listed nothing available. Not an error, and not something to paper over. */
  'COMMERCIAL_CATALOG_EMPTY',
  /** The requested package id is not in the canonical catalog. There is no second choice. */
  'PACKAGE_NOT_IN_CORE_CATALOG',
  'COMMERCIAL_BRIEF_BEFORE_CATALOG',
  'COMMERCIAL_BRIEF_INVALID',
] as const;
export type AarohiCommercialRefusal = (typeof COMMERCIAL_REFUSALS)[number];

export type CoreCommercialCatalogSnapshotResult =
  | { readonly ok: true; readonly snapshot: CoreCommercialCatalogSnapshot }
  | { readonly ok: false; readonly refusal: AarohiCommercialRefusal };

function frozenPackages(
  packages: readonly CoreCommercialPackageOption[],
): readonly CoreCommercialPackageOption[] {
  return Object.freeze(packages.map((option) => Object.freeze({ ...option })));
}

/**
 * Re-parse and REBUILD a catalog snapshot from whatever was handed in.
 *
 * A declared TypeScript type is erased before any of this runs, so trusting one would be trusting
 * the caller. The schema certifies the whole AGGREGATE, so a snapshot with a repeated package id or
 * out of canonical order is refused rather than rebuilt into something that looks canonical.
 */
export function parseCoreCommercialCatalogSnapshot(
  value: unknown,
): CoreCommercialCatalogSnapshot | undefined {
  const parsed = coreCommercialCatalogSnapshotSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG8_CONTRACT_VERSION,
    snapshotRef: parsed.data.snapshotRef,
    observedAt: parsed.data.observedAt,
    sourcePosture: AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE,
    packages: frozenPackages(parsed.data.packages),
  });
}

/**
 * Record one offline observation of Core's available-package read.
 *
 * The posture and the contract version are STAMPED rather than accepted, so an injected fixture
 * cannot describe itself as an authenticated production read. The packages are sorted into canonical
 * order by the same comparator the aggregate check validates against, so what the builder produces
 * is by construction what the parser will accept.
 */
export function createCoreCommercialCatalogSnapshot(
  value: unknown,
): CoreCommercialCatalogSnapshotResult {
  const parsed = catalogInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'COMMERCIAL_INPUT_INVALID' as const });
  }

  const packages = [...parsed.data.packages].sort(compareCanonicalPackageOrder);
  if (!catalogAggregateIsCanonical(packages)) {
    // Sorting cannot repair a duplicate id or an over-long list, and neither can this function.
    return Object.freeze({ ok: false as const, refusal: 'COMMERCIAL_CATALOG_INVALID' as const });
  }

  const snapshot = {
    contractVersion: AAROHI_AVG8_CONTRACT_VERSION,
    snapshotRef: parsed.data.snapshotRef,
    observedAt: parsed.data.observedAt,
    sourcePosture: AAROHI_AVG8_COMMERCIAL_SOURCE_POSTURE,
    packages: frozenPackages(packages),
  };

  if (!coreCommercialCatalogSnapshotSchema.safeParse(snapshot).success) {
    return Object.freeze({ ok: false as const, refusal: 'COMMERCIAL_CATALOG_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, snapshot: Object.freeze(snapshot) });
}

// ---------------------------------------------------------------------------
// The query scope.
// ---------------------------------------------------------------------------

/**
 * What a caller may ask for. Two members, and neither of them is a preference.
 *
 * `AVAILABLE_PACKAGE_CATALOG` is "everything Core listed"; `EXACT_PACKAGE` is "this identifier".
 * There is no `CHEAPEST`, `BEST_VALUE`, `MOST_SUITABLE`, `RECOMMENDED` or `WITHIN_BUDGET`, and no
 * input field for a budget, a desired lead count or an optimisation target — because a function
 * that takes a preference and returns a package is a recommendation engine, and Core did not
 * authorise Aarohi to run one.
 */
export const AAROHI_AVG8_COMMERCIAL_SCOPES = [
  'AVAILABLE_PACKAGE_CATALOG',
  'EXACT_PACKAGE',
] as const;
export type AarohiCommercialScope = (typeof AAROHI_AVG8_COMMERCIAL_SCOPES)[number];

/**
 * The query, as a discriminated union so the two scopes cannot borrow each other's fields.
 *
 * Catalog scope has no `requestedPackageRef` to give, and exact scope cannot omit it. A single
 * optional field would have let a caller ask for "the catalog, but this one really" and left the
 * meaning to whoever read the code next.
 */
const commercialQuerySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('AVAILABLE_PACKAGE_CATALOG') }).strict(),
  z
    .object({
      scope: z.literal('EXACT_PACKAGE'),
      requestedPackageRef: UPSTREAM_OPAQUE_REF,
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// The posture.
// ---------------------------------------------------------------------------

/**
 * The authority ceiling, as literals a machine can check rather than prose somebody must remember.
 *
 * Read `priceInterpreted` and `derivedPriceCalculated` together: the first says no meaning was
 * assigned to the relationship between two Core numbers, the second says no third number was made
 * out of them. Those are different failures — one is an opinion, the other is arithmetic — and a
 * commercial domain can commit either without committing the other.
 */
export interface AarohiCommercialFactsPosture {
  readonly referenceFactsOnly: true;
  /** This is an injected offline observation. It is not a live authenticated read of Core. */
  readonly snapshotSourceAuthenticated: false;

  readonly packageRecommended: false;
  readonly bestPackageClaimed: false;
  readonly packageRanked: false;
  readonly packageEligibilityGranted: false;

  readonly commercialTruthMutated: false;
  readonly commercialCommitmentCreated: false;
  readonly priceAdjusted: false;
  readonly priceInterpreted: false;
  readonly derivedPriceCalculated: false;
  readonly discountCreated: false;
  readonly savingsCalculated: false;
  readonly currencyInvented: false;
  readonly offerCreated: false;
  /** Carried forward from AVG-7's ceiling: all seven read-surface facts are present, or none is. */
  readonly materialPackageLimitationHidden: false;

  readonly registrationMutated: false;
  readonly paymentMutated: false;
  readonly packageOrderCreated: false;
  readonly packageAssigned: false;
  readonly creditsMutated: false;
  readonly activationMutated: false;
  readonly acquisitionCaseMutated: false;
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
   * The facts a future governed composition would need are present.
   *
   * It does NOT mean a model was called, a prompt resolved, a reply exists, a price was interpreted,
   * a reply was approved or a send was authorized. AVG-7's plan keeps
   * `futureModelDraftEligible: false` and is not rewritten by this file — the plan recorded that
   * facts were MISSING at the time it was made, which stays true.
   */
  readonly commercialFactsReadyForFutureGovernedDraft: true;
  /** A snapshot is an observation, not a standing offer. Prices move; this one was a moment. */
  readonly requiresCoreCommercialRevalidationBeforeFutureOutboundUse: true;
}

export const aarohiCommercialFactsPostureSchema = z
  .object({
    referenceFactsOnly: z.literal(true),
    snapshotSourceAuthenticated: z.literal(false),

    packageRecommended: z.literal(false),
    bestPackageClaimed: z.literal(false),
    packageRanked: z.literal(false),
    packageEligibilityGranted: z.literal(false),

    commercialTruthMutated: z.literal(false),
    commercialCommitmentCreated: z.literal(false),
    priceAdjusted: z.literal(false),
    priceInterpreted: z.literal(false),
    derivedPriceCalculated: z.literal(false),
    discountCreated: z.literal(false),
    savingsCalculated: z.literal(false),
    currencyInvented: z.literal(false),
    offerCreated: z.literal(false),
    materialPackageLimitationHidden: z.literal(false),

    registrationMutated: z.literal(false),
    paymentMutated: z.literal(false),
    packageOrderCreated: z.literal(false),
    packageAssigned: z.literal(false),
    creditsMutated: z.literal(false),
    activationMutated: z.literal(false),
    acquisitionCaseMutated: z.literal(false),
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

    commercialFactsReadyForFutureGovernedDraft: z.literal(true),
    requiresCoreCommercialRevalidationBeforeFutureOutboundUse: z.literal(true),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const AAROHI_COMMERCIAL_FACTS_POSTURE: AarohiCommercialFactsPosture = Object.freeze(
  aarohiCommercialFactsPostureSchema.parse({
    referenceFactsOnly: true,
    snapshotSourceAuthenticated: false,

    packageRecommended: false,
    bestPackageClaimed: false,
    packageRanked: false,
    packageEligibilityGranted: false,

    commercialTruthMutated: false,
    commercialCommitmentCreated: false,
    priceAdjusted: false,
    priceInterpreted: false,
    derivedPriceCalculated: false,
    discountCreated: false,
    savingsCalculated: false,
    currencyInvented: false,
    offerCreated: false,
    materialPackageLimitationHidden: false,

    registrationMutated: false,
    paymentMutated: false,
    packageOrderCreated: false,
    packageAssigned: false,
    creditsMutated: false,
    activationMutated: false,
    acquisitionCaseMutated: false,
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

    commercialFactsReadyForFutureGovernedDraft: true,
    requiresCoreCommercialRevalidationBeforeFutureOutboundUse: true,
  }),
);

// ---------------------------------------------------------------------------
// The commercial FACT BRIEF.
// ---------------------------------------------------------------------------

/**
 * The single positive thing a commercial brief may say.
 *
 * Deliberately long, and deliberately containing FUTURE and GOVERNED. `PRICE_READY`, `QUOTE_READY`
 * and `OFFER_PREPARED` are all things this repository cannot make true, and a token is read by
 * people who will not read the file it came from.
 */
export const CORE_COMMERCIAL_FACTS_OUTCOME =
  'CORE_COMMERCIAL_FACTS_READY_FOR_FUTURE_GOVERNED_DRAFT' as const;
export type CoreCommercialFactsOutcome = typeof CORE_COMMERCIAL_FACTS_OUTCOME;

/**
 * Closed, structured commercial facts — and no sentence anywhere.
 *
 * There is no `explanation`, `summary`, `pitch`, `salesCopy`, `recommendationReason` or `body`. The
 * roadmap says the engine "selects and explains", and the explaining belongs to a later governed
 * composition working from these facts; what AVG-8 provides is the thing that composition must be
 * grounded in. A prose field here would be the un-grounded half arriving first.
 */
export interface AarohiCommercialFactsBrief {
  readonly contractVersion: AarohiAvg8ContractVersion;
  readonly briefRef: string;
  readonly prospectRef: string;
  readonly salesPlanRef: string;
  readonly interpretationRef: string;
  readonly catalogSnapshotRef: string;
  readonly catalogObservedAt: string;
  readonly scope: AarohiCommercialScope;
  readonly packages: readonly CoreCommercialPackageOption[];
  readonly preparedAt: string;
  readonly outcome: CoreCommercialFactsOutcome;
  readonly posture: AarohiCommercialFactsPosture;
}

export const aarohiCommercialFactsBriefSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG8_CONTRACT_VERSION),
    // AVG-8's own artifact identities.
    briefRef: AVG8_LOCAL_ARTIFACT_REF,
    catalogSnapshotRef: AVG8_LOCAL_ARTIFACT_REF,
    // Inherited from the certified AVG-7 plan.
    prospectRef: UPSTREAM_OPAQUE_REF,
    salesPlanRef: UPSTREAM_OPAQUE_REF,
    interpretationRef: UPSTREAM_OPAQUE_REF,
    catalogObservedAt: UTC_INSTANT,
    scope: z.enum(AAROHI_AVG8_COMMERCIAL_SCOPES),
    packages: z.array(coreCommercialPackageOptionSchema).min(1).max(MAX_COMMERCIAL_PACKAGES),
    preparedAt: UTC_INSTANT,
    outcome: z.literal(CORE_COMMERCIAL_FACTS_OUTCOME),
    posture: aarohiCommercialFactsPostureSchema,
  })
  .strict()
  .refine(
    (value) => catalogAggregateIsCanonical(value.packages),
    'the brief packages do not form a canonical aggregate',
  )
  .refine(
    // An exact-package brief carries exactly the one package that was asked for.
    (value) => value.scope !== 'EXACT_PACKAGE' || value.packages.length === 1,
    'an exact-package brief must carry exactly one package',
  )
  .refine(
    (value) =>
      canonicalInstantEpochMs(value.preparedAt) >= canonicalInstantEpochMs(value.catalogObservedAt),
    'the brief claims to predate the catalog observation it rests on',
  );

/** Re-parse and REBUILD a brief. Detaches every package from whatever the caller holds. */
export function parseAarohiCommercialFactsBrief(
  value: unknown,
): AarohiCommercialFactsBrief | undefined {
  const parsed = aarohiCommercialFactsBriefSchema.safeParse(value);
  if (!parsed.success) return undefined;

  return Object.freeze({
    contractVersion: AAROHI_AVG8_CONTRACT_VERSION,
    briefRef: parsed.data.briefRef,
    prospectRef: parsed.data.prospectRef,
    salesPlanRef: parsed.data.salesPlanRef,
    interpretationRef: parsed.data.interpretationRef,
    catalogSnapshotRef: parsed.data.catalogSnapshotRef,
    catalogObservedAt: parsed.data.catalogObservedAt,
    scope: parsed.data.scope,
    packages: frozenPackages(parsed.data.packages),
    preparedAt: parsed.data.preparedAt,
    outcome: CORE_COMMERCIAL_FACTS_OUTCOME,
    posture: AAROHI_COMMERCIAL_FACTS_POSTURE,
  });
}

export type AarohiCommercialFactsBriefResult =
  | { readonly ok: true; readonly brief: AarohiCommercialFactsBrief }
  | { readonly ok: false; readonly refusal: AarohiCommercialRefusal };

/**
 * What a caller may state when preparing a brief.
 *
 * Note what is absent: no price, no package name, no lead count, no validity, no currency, no
 * discount, no budget, no optimisation target and no outcome. The only thing a caller chooses is
 * WHICH facts to carry — the catalog, or one identifier — and every value comes from the canonical
 * snapshot.
 */
const commercialBriefInputSchema = z
  .object({
    briefRef: AVG8_LOCAL_ARTIFACT_REF,
    conversation: z.unknown(),
    interpretation: z.unknown(),
    coreObservation: z.unknown(),
    salesPlan: z.unknown(),
    commercialCatalog: z.unknown(),
    query: commercialQuerySchema,
    preparedAt: UTC_INSTANT,
  })
  .strict();

// ---------------------------------------------------------------------------
// The AVG-7 plan must be RE-DERIVED, not believed.
// ---------------------------------------------------------------------------

function sameStampedValue<T>(left: T, right: T): boolean {
  return left === right;
}

/**
 * Are these two plans the same plan, field for field?
 *
 * Value equality, never object identity: the whole point is to compare something a caller handed in
 * against something this file recomputed, so they are necessarily different objects. The nested
 * brief and posture are compared by walking the recomputed object's own keys, so a field added to
 * AVG-7 later is compared without anybody remembering to add it here.
 */
function sameNestedRecord(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => sameStampedValue(left[key], right[key]));
}

function sameSalesTurnPlan(left: AarohiSalesTurnPlan, right: AarohiSalesTurnPlan): boolean {
  return (
    sameStampedValue(left.contractVersion, right.contractVersion) &&
    left.planRef === right.planRef &&
    left.prospectRef === right.prospectRef &&
    left.instagramConversationRef === right.instagramConversationRef &&
    left.instagramThreadRef === right.instagramThreadRef &&
    left.instagramParticipantRef === right.instagramParticipantRef &&
    left.instagramMessageRef === right.instagramMessageRef &&
    left.interpretationRef === right.interpretationRef &&
    sameStampedValue(left.coreStatus, right.coreStatus) &&
    left.coreLookupRef === right.coreLookupRef &&
    left.plannedAt === right.plannedAt &&
    sameNestedRecord(
      left.brief as unknown as Readonly<Record<string, unknown>>,
      right.brief as unknown as Readonly<Record<string, unknown>>,
    ) &&
    sameNestedRecord(
      left.posture as unknown as Readonly<Record<string, unknown>>,
      right.posture as unknown as Readonly<Record<string, unknown>>,
    )
  );
}

/**
 * Prepare a closed brief of Core commercial facts, or refuse.
 *
 * ### The plan is re-derived, because a parsed artifact is not a policy proof
 *
 * This is AVG-6's owner-review lesson, applied at the next boundary that would have repeated it.
 * A caller could hand-write a plan that parses, says `REQUEST_CORE_COMMERCIAL_CONTEXT`, and rests on
 * nothing — so the plan is not believed. AVG-7's own public evaluator is re-run over the supplied
 * conversation, interpretation and CURRENT Core observation, seeded with the plan's own reference and
 * instant so the only thing that can differ is what the canonical policy concludes. The result must
 * reproduce the supplied plan EXACTLY, nested brief and posture included.
 *
 * Re-derivation carries three of AVG-7's guarantees across for free, which is why it is worth more
 * than a strategy check: the interpretation must still be a reading of the CURRENT turn, the causal
 * chain must still hold, and the CURRENT Core gate must still admit exactly `NOT_REGISTERED`. A
 * prospect who has since become `DO_NOT_CONTACT` cannot be quoted a price, and that falls out of the
 * re-derivation rather than being asserted separately here.
 *
 * ### And the facts must be no older than the request
 *
 * AVG-7 said Core commercial context was REQUIRED. A catalog observed before that was said is not an
 * answer to it — it is a catalog that happened to be lying around, and treating it as standing
 * commercial permission is how a stale price reaches a live conversation.
 */
export function prepareAarohiCommercialFactsBrief(
  value: unknown,
): AarohiCommercialFactsBriefResult {
  const parsed = commercialBriefInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'COMMERCIAL_INPUT_INVALID' as const });
  }

  const suppliedPlan = parseAarohiSalesTurnPlan(parsed.data.salesPlan);
  if (suppliedPlan === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'SALES_PLAN_INVALID' as const });
  }

  // THE POLICY, RE-RUN. Seeded with the supplied plan's own reference and instant.
  const reDerived = evaluateAarohiSalesTurn({
    planRef: suppliedPlan.planRef,
    conversation: parsed.data.conversation,
    interpretation: parsed.data.interpretation,
    coreObservation: parsed.data.coreObservation,
    plannedAt: suppliedPlan.plannedAt,
  });
  if (!reDerived.ok || !sameSalesTurnPlan(reDerived.plan, suppliedPlan)) {
    return Object.freeze({ ok: false as const, refusal: 'SALES_PLAN_POLICY_MISMATCH' as const });
  }

  // The RE-DERIVED strategy is read, not the supplied one. They are proven identical by this point,
  // and reading the derived value is the honest way to say which of the two is authoritative.
  if (reDerived.plan.brief.strategy !== 'REQUEST_CORE_COMMERCIAL_CONTEXT') {
    return Object.freeze({ ok: false as const, refusal: 'SALES_PLAN_NOT_COMMERCIAL' as const });
  }

  const catalog = parseCoreCommercialCatalogSnapshot(parsed.data.commercialCatalog);
  if (catalog === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'COMMERCIAL_CATALOG_INVALID' as const });
  }

  // Semantic instants, never spellings. `09:00:00.500Z` sorts before `09:00:00Z` as a string while
  // being half a second later, and `09:00:00Z` and `09:00:00.000Z` are one moment written twice.
  if (
    canonicalInstantEpochMs(catalog.observedAt) < canonicalInstantEpochMs(reDerived.plan.plannedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'COMMERCIAL_CATALOG_STALE_FOR_PLAN' as const,
    });
  }

  if (
    canonicalInstantEpochMs(parsed.data.preparedAt) < canonicalInstantEpochMs(catalog.observedAt)
  ) {
    return Object.freeze({
      ok: false as const,
      refusal: 'COMMERCIAL_BRIEF_BEFORE_CATALOG' as const,
    });
  }

  if (catalog.packages.length === 0) {
    // Core listed nothing available. That is a fact, and it is not a brief of facts to present.
    return Object.freeze({ ok: false as const, refusal: 'COMMERCIAL_CATALOG_EMPTY' as const });
  }

  // SELECTION, and the whole of it. An identifier lookup or the entire list — never a choice.
  const query = parsed.data.query;
  let selected: readonly CoreCommercialPackageOption[];
  if (query.scope === 'EXACT_PACKAGE') {
    const found = catalog.packages.find((option) => option.id === query.requestedPackageRef);
    if (found === undefined) {
      // No fallback. Not the first, not the cheapest, not the nearest. A package Core does not list
      // is a package that does not exist, and answering with a different one is answering a question
      // nobody asked.
      return Object.freeze({ ok: false as const, refusal: 'PACKAGE_NOT_IN_CORE_CATALOG' as const });
    }
    selected = [found];
  } else {
    selected = catalog.packages;
  }

  const brief = {
    contractVersion: AAROHI_AVG8_CONTRACT_VERSION,
    briefRef: parsed.data.briefRef,
    prospectRef: reDerived.plan.prospectRef,
    salesPlanRef: reDerived.plan.planRef,
    interpretationRef: reDerived.plan.interpretationRef,
    catalogSnapshotRef: catalog.snapshotRef,
    catalogObservedAt: catalog.observedAt,
    scope: query.scope,
    // Copied whole. Every one of the seven fields, exactly as Core recorded it.
    packages: frozenPackages(selected),
    preparedAt: parsed.data.preparedAt,
    outcome: CORE_COMMERCIAL_FACTS_OUTCOME,
    posture: AAROHI_COMMERCIAL_FACTS_POSTURE,
  };

  // Parsed before it is returned, against the same schema a caller's hand-built brief would face.
  if (!aarohiCommercialFactsBriefSchema.safeParse(brief).success) {
    return Object.freeze({ ok: false as const, refusal: 'COMMERCIAL_BRIEF_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, brief: Object.freeze(brief) });
}
