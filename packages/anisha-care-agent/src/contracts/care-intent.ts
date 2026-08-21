/**
 * The closed CUSTOMER-CARE intent vocabulary.
 *
 * ### Why this is a separate package from `@qf-jarvis/anisha-agent`
 *
 * The existing Anisha package is the VENDOR journey: fixed to `ANISHA`/`VENDOR`, with a vendor
 * intent vocabulary, and it refuses client work before any model is reached. Customer care is a
 * different bounded agent that happens to share the Anisha persona family — a different party type,
 * a different domain authority, a different state, and a different set of things it may not do.
 *
 * Widening the vendor package to cover both would have meant relaxing the `ANISHA`/`VENDOR` fix and
 * the client-refusal guard that make it safe, in a package `jarvis-runtime` already depends on. So
 * the two are siblings that never see each other, exactly as Riya and vendor Anisha are.
 *
 * ### The axis that is NOT party type
 *
 * Party type cannot separate this agent from Riya: both serve `CLIENT`. Riya is CLIENT/SALES and
 * this is CLIENT/CUSTOMER_CARE, so the discriminator is a SERVICE LINE, and it is declared here
 * rather than added to `agent-runtime` — widening a shared vocabulary would put a care concept into
 * Riya's compile surface for no benefit, and routing between the two is orchestration's job, not
 * this package's.
 *
 * ### What is absent, and deliberately
 *
 * Care NOTICES and EXPLAINS. It does not decide. Refunds, credits, cancellations, order state,
 * assignment, vendor performance, money and policy exceptions are QuickFurno Core's — a care agent
 * that could promise a refund would be making a commercial decision no model may make. Every one of
 * those arrives here as an intent to ACKNOWLEDGE or ESCALATE, never to resolve.
 *
 * Classification is DETERMINISTIC and derives from closed structured signals, never from parsing
 * client text. There is no confidence score: a probability may never override role, routing or
 * policy.
 */
import { z } from 'zod';

/** The behaviour contract version. Additive future versions get a new literal. */
export const ANISHA_CARE_BEHAVIOUR_VERSION = 1 as const;
export type AnishaCareBehaviourVersion = typeof ANISHA_CARE_BEHAVIOUR_VERSION;

/**
 * The service line this package serves.
 *
 * Declared as a closed local vocabulary rather than imported: `agent-runtime` has no service-line
 * concept and does not need one to route, because routing is not done here.
 */
export const CARE_SERVICE_LINES = ['CUSTOMER_CARE', 'SALES'] as const;
export type CareServiceLine = (typeof CARE_SERVICE_LINES)[number];

/** The one this package may serve. Fixed, never a parameter. */
export const ANISHA_CARE_SERVICE_LINE: CareServiceLine = 'CUSTOMER_CARE';

export const CARE_INTENTS = [
  /** A real request that is not customer care. Care refuses rather than reasoning outside scope. */
  'UNSUPPORTED_NON_CARE_REQUEST',
  /**
   * A SALES request reaching the care agent.
   *
   * Its own value rather than folded into the one above, because the two need different handling:
   * an out-of-scope request is declined, whereas a sales turn belongs to a sibling agent that
   * exists and can serve it. Collapsing them would lose the fact that someone can help.
   */
  'SALES_REQUEST_NOT_CARE',
  /** Complex, disputed, sensitive, financial, legal, fraud, high-risk or policy-exception. */
  'ESCALATION_REQUIRED_MATTER',
  /** The client has asked for a person. */
  'HUMAN_SUPPORT_REQUEST',
  /** A complaint has been raised. Care intakes and acknowledges; Core resolves. */
  'COMPLAINT_INTAKE',
  /** Where an existing order or project has reached. A STATUS question, never a status decision. */
  'ORDER_OR_PROJECT_STATUS_QUERY',
  /** Scheduling, visit, delivery or installation timing GUIDANCE — never a commitment. */
  'SCHEDULING_OR_DELIVERY_GUIDANCE',
  /** Warranty, aftercare, defect or service-request INTAKE — never an entitlement decision. */
  'WARRANTY_OR_AFTERCARE_INTAKE',
  /**
   * A refund, cancellation or billing matter.
   *
   * Always intake-or-escalate. Care may acknowledge that the request was heard and explain the
   * process; it may never state an outcome, an amount, an eligibility or a date. Those are Core's.
   */
  'REFUND_CANCELLATION_OR_BILLING_MATTER',
  /** A general question answerable from governed knowledge. The ordinary care turn. */
  'ROUTINE_CARE_QUERY',
] as const;
export type CareIntent = (typeof CARE_INTENTS)[number];

export const CARE_INTENTS_FROZEN: readonly CareIntent[] = Object.freeze([...CARE_INTENTS]);

/**
 * The closed STRUCTURED signals a care intent is derived from.
 *
 * Booleans and closed tokens only. There is deliberately no free-text field: a classifier that read
 * client prose would be a model call wearing a function's clothes, and this package makes none.
 */
export interface CareSignals {
  /** The client explicitly asked for a human. */
  readonly humanRequested?: boolean;
  /** A complaint was registered upstream for this conversation. */
  readonly complaintRaised?: boolean;
  /** Upstream classified this as disputed, sensitive, legal, fraud or policy-exception. */
  readonly escalationRequired?: boolean;
  /** The turn concerns refund, cancellation or billing. */
  readonly refundCancellationOrBilling?: boolean;
  /** The turn concerns warranty, defect or aftercare. */
  readonly warrantyOrAftercare?: boolean;
  /** The turn concerns scheduling, delivery or installation timing. */
  readonly schedulingOrDelivery?: boolean;
  /** The turn asks where an existing order or project has reached. */
  readonly orderOrProjectStatus?: boolean;
  /** Upstream identified this as a NEW sales enquiry rather than care on existing business. */
  readonly salesEnquiry?: boolean;
  /** The turn is not customer care at all. */
  readonly outOfScope?: boolean;
}

export const careSignalsSchema = z
  .object({
    humanRequested: z.boolean().optional(),
    complaintRaised: z.boolean().optional(),
    escalationRequired: z.boolean().optional(),
    refundCancellationOrBilling: z.boolean().optional(),
    warrantyOrAftercare: z.boolean().optional(),
    schedulingOrDelivery: z.boolean().optional(),
    orderOrProjectStatus: z.boolean().optional(),
    salesEnquiry: z.boolean().optional(),
    outOfScope: z.boolean().optional(),
  })
  .strict();

/**
 * Classify ONE care turn from closed signals.
 *
 * The order is a PRECEDENCE and it is the safety property of this function. Every branch that
 * removes the model or hands the turn to a person is evaluated before every branch that keeps it —
 * so a turn that is simultaneously a complaint and a scheduling question is a complaint, and a turn
 * that is both escalation-required and a refund is an escalation.
 *
 * Total by construction: the final branch is unconditional, so there is no input for which this
 * returns nothing.
 */
export function classifyCareIntent(signals: CareSignals): CareIntent {
  // Out of scope first: if this is not care at all, nothing below it is meaningful.
  if (signals.outOfScope === true) {
    return 'UNSUPPORTED_NON_CARE_REQUEST';
  }
  // Then the human paths, before any content branch. A person asked for is a person given.
  if (signals.escalationRequired === true) {
    return 'ESCALATION_REQUIRED_MATTER';
  }
  if (signals.humanRequested === true) {
    return 'HUMAN_SUPPORT_REQUEST';
  }
  if (signals.complaintRaised === true) {
    return 'COMPLAINT_INTAKE';
  }
  // A sales turn belongs to the sibling agent. Checked before the care content branches so a sales
  // enquiry mentioning delivery is not quietly served here.
  if (signals.salesEnquiry === true) {
    return 'SALES_REQUEST_NOT_CARE';
  }
  // Money-adjacent before the rest: it is the branch with the most to lose from being mishandled.
  if (signals.refundCancellationOrBilling === true) {
    return 'REFUND_CANCELLATION_OR_BILLING_MATTER';
  }
  if (signals.warrantyOrAftercare === true) {
    return 'WARRANTY_OR_AFTERCARE_INTAKE';
  }
  if (signals.schedulingOrDelivery === true) {
    return 'SCHEDULING_OR_DELIVERY_GUIDANCE';
  }
  if (signals.orderOrProjectStatus === true) {
    return 'ORDER_OR_PROJECT_STATUS_QUERY';
  }
  return 'ROUTINE_CARE_QUERY';
}
