/**
 * The closed vendor-journey intent vocabulary (QFJ-S3-D-A, ADR-0070).
 *
 * Nine values covering what a vendor-journey turn can BE, without encoding anything QuickFurno Core
 * owns. The governed scope covers onboarding, profile completion, activation readiness, package
 * readiness, recharge, retention, upgrade, inactivity recovery and win-back; QFJ-P07 adds complaint
 * intake, routine query resolution, vendor education and lead-response guidance. What is absent is
 * just as deliberate: verification decisions, activation decisions, eligibility, ranking, assignment,
 * packages, wallets, credits, money and lead-quality scoring are Core's, and `agent-model.md` says so
 * in those words. Anisha's role in each is to notice and explain.
 *
 * ### ADR-0085 moved the FRONT EDGE, and this comment used to predate it
 *
 * An earlier revision of this note cited ADR-0006 §1 as giving Anisha "acquisition, qualification"
 * among the above. That was the governance at the time and it is no longer current.
 * [ADR-0085](../../../../docs/decisions/ADR-0085-qfj-p12-aarohi-vendor-growth-and-roadmap-reconciliation.md)
 * moves cold acquisition of genuinely UNREGISTERED prospects to **Aarohi**, and leaves Anisha the
 * REGISTERED / EXISTING vendor relationship and success lifecycle.
 *
 * The ownership boundary is QuickFurno Core's registration truth, not topic or channel: when Core
 * authoritatively confirms ACTIVE, Aarohi stops acquisition selling and relationship ownership moves
 * here.
 *
 * The executable vocabulary below was ALREADY consistent with that split — none of these nine values
 * is cold acquisition of an unregistered prospect — so nothing about behaviour changes with this
 * correction. Only the sentence describing the scope was stale.
 *
 * `LEAD_RESPONSE_GUIDANCE` is kept distinct from `ROUTINE_VENDOR_QUERY` on purpose. Helping a vendor
 * respond well to the leads they already have is Anisha's; judging whether those leads were any good
 * is Kabir's, and ADR-0006 §3 names that exact slide as the failure mode bounded agents exist to
 * prevent. Collapsing the two would make the boundary unenforceable.
 *
 * Classification is DETERMINISTIC and derives from closed structured signals, never from parsing
 * vendor text. There is no confidence score: a probability may never override role, routing or policy.
 */
import { z } from 'zod';

/** The behaviour contract version. Additive future versions get a new literal. */
export const ANISHA_BEHAVIOUR_VERSION = 1 as const;
export type AnishaBehaviourVersion = typeof ANISHA_BEHAVIOUR_VERSION;

export const VENDOR_JOURNEY_INTENTS = [
  /** A real request that is not vendor journey. Anisha refuses rather than reasoning outside scope. */
  'UNSUPPORTED_NON_VENDOR_REQUEST',
  /** Complex, disputed, sensitive, financial, legal, fraud, high-risk or policy-exception (QFJ-P07). */
  'ESCALATION_REQUIRED_MATTER',
  /** The vendor has asked for a person. */
  'HUMAN_VENDOR_SUPPORT_REQUEST',
  /** A complaint has been raised. Anisha intakes and acknowledges; Core resolves. */
  'COMPLAINT_INTAKE',
  /** Package readiness or a recharge CONVERSATION. Never a purchase, a balance or a payment. */
  'PACKAGE_OR_RECHARGE_READINESS',
  /** Onboarding, profile, portfolio or verification GUIDANCE — never a verification decision. */
  'ONBOARDING_OR_PROFILE_GUIDANCE',
  /** How to respond to leads already received. Never a judgement about lead quality (ADR-0006 §3). */
  'LEAD_RESPONSE_GUIDANCE',
  /** Routine query resolution and vendor education. */
  'ROUTINE_VENDOR_QUERY',
  /** Not enough validated context to classify. Ask, never assume. */
  'INSUFFICIENT_CONTEXT',
] as const;
export type VendorJourneyIntent = (typeof VENDOR_JOURNEY_INTENTS)[number];

/** The frozen vocabulary, exposed so a spec can assert it has not grown. */
export const VENDOR_JOURNEY_INTENTS_FROZEN: readonly VendorJourneyIntent[] = Object.freeze([
  ...VENDOR_JOURNEY_INTENTS,
]);

/**
 * The governed money-adjacent band vocabulary.
 *
 * `agent-model.md` and the QuickFurno authority matrix are explicit: money-adjacent signals reach
 * Anisha as **bands, never balances**. A wallet figure copied into a Jarvis contract would be stale
 * the moment it was written, and its mere existence would invite somebody to reason about a real
 * vendor's money from a copy nobody reconciles. "Below the assignment threshold" supports exactly the
 * same conversation and cannot be mistaken for an account statement.
 */
export const PACKAGE_READINESS_BANDS = ['low', 'medium', 'high', 'critical'] as const;
export type PackageReadinessBand = (typeof PACKAGE_READINESS_BANDS)[number];

export const PACKAGE_READINESS_BANDS_FROZEN: readonly PackageReadinessBand[] = Object.freeze([
  ...PACKAGE_READINESS_BANDS,
]);

/**
 * The closed structured signals a classification may consider.
 *
 * Every field is a boolean, a bounded count, or the governed band. There is no free text, so no
 * vendor content can enter the classifier, and the rule below is fully reviewable.
 */
export interface VendorJourneySignals {
  /** The conversation already has prior vendor-journey turns. */
  readonly hasPriorVendorContext: boolean;
  /** The vendor explicitly asked for a human. */
  readonly requestedHumanAssistance: boolean;
  /** A complaint was raised this turn. */
  readonly raisedComplaint: boolean;
  /** The vendor asked about package readiness or a recharge. */
  readonly askedAboutPackageOrRecharge: boolean;
  /** The vendor asked about onboarding, profile, portfolio or verification guidance. */
  readonly askedAboutOnboardingOrProfile: boolean;
  /** The vendor asked how to respond to leads they already hold. */
  readonly askedAboutLeadResponse: boolean;
  /** A routine vendor question or an education request. */
  readonly askedRoutineQuestion: boolean;
  /** Complex/disputed/sensitive/financial/legal/fraud/high-risk/policy-exception (QFJ-P07). */
  readonly matterRequiresEscalation: boolean;
  /** The request is recognisably outside the vendor journey. */
  readonly outOfVendorScope: boolean;
  /** How many context fields are still unknown. Bounded; not a score. */
  readonly missingContextFieldCount: number;
  /** The governed money-adjacent BAND. Never a balance, price, credit count or payment status. */
  readonly packageReadinessBand?: PackageReadinessBand;
}

const signalsSchema = z
  .object({
    hasPriorVendorContext: z.boolean(),
    requestedHumanAssistance: z.boolean(),
    raisedComplaint: z.boolean(),
    askedAboutPackageOrRecharge: z.boolean(),
    askedAboutOnboardingOrProfile: z.boolean(),
    askedAboutLeadResponse: z.boolean(),
    askedRoutineQuestion: z.boolean(),
    matterRequiresEscalation: z.boolean(),
    outOfVendorScope: z.boolean(),
    missingContextFieldCount: z.int().min(0).max(32),
    packageReadinessBand: z.enum(PACKAGE_READINESS_BANDS).optional(),
  })
  .strict();

/**
 * True iff `value` is a structurally valid signal set.
 *
 * Beyond the schema there is one relevance rule: a readiness band may only accompany a turn that is
 * actually about the package, or a vendor already in an ongoing journey. A band arriving on an
 * unrelated turn is money-adjacent data with no reason to be there, and the cheapest way to keep it
 * out is to refuse it rather than ignore it.
 */
export function isVendorJourneySignals(value: unknown): value is VendorJourneySignals {
  const parsed = signalsSchema.safeParse(value);
  if (!parsed.success) {
    return false;
  }
  if (parsed.data.packageReadinessBand === undefined) {
    return true;
  }
  return parsed.data.askedAboutPackageOrRecharge || parsed.data.hasPriorVendorContext;
}

/**
 * Classify a vendor-journey turn from closed signals.
 *
 * Ordered by SAFETY, not by likelihood. Out-of-scope, escalation-required and human requests win over
 * every commercial reading, because mis-serving one of those is worse than missing a commercial cue:
 * an agent that talks past "this is a legal dispute" or "I want to speak to someone" is the failure
 * this ordering exists to prevent.
 *
 * `hasPriorVendorContext` never manufactures an intent on its own, and `missingContextFieldCount`
 * never overrides an explicit signal — a count is not a reason to change what the vendor asked for.
 */
export function classifyVendorJourneyIntent(signals: VendorJourneySignals): VendorJourneyIntent {
  if (signals.outOfVendorScope) {
    return 'UNSUPPORTED_NON_VENDOR_REQUEST';
  }
  if (signals.matterRequiresEscalation) {
    return 'ESCALATION_REQUIRED_MATTER';
  }
  if (signals.requestedHumanAssistance) {
    return 'HUMAN_VENDOR_SUPPORT_REQUEST';
  }
  if (signals.raisedComplaint) {
    return 'COMPLAINT_INTAKE';
  }
  if (signals.askedAboutPackageOrRecharge) {
    return 'PACKAGE_OR_RECHARGE_READINESS';
  }
  if (signals.askedAboutOnboardingOrProfile) {
    return 'ONBOARDING_OR_PROFILE_GUIDANCE';
  }
  if (signals.askedAboutLeadResponse) {
    return 'LEAD_RESPONSE_GUIDANCE';
  }
  if (signals.askedRoutineQuestion) {
    return 'ROUTINE_VENDOR_QUERY';
  }
  // Nothing recognisable was asked: ask rather than assume.
  return 'INSUFFICIENT_CONTEXT';
}
