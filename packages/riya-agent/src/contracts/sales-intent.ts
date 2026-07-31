/**
 * The closed client-sales intent vocabulary (QFJ-S3-C, ADR-0067).
 *
 * Eight values, chosen to cover what a client-sales turn can BE without encoding what QuickFurno
 * SELLS. Service categories, cities, property types and price bands are deliberately absent: they
 * belong to QuickFurno Core, they change on a business cadence rather than a release cadence, and
 * baking them into an agent enum would create a second catalogue that silently drifts from the real
 * one.
 *
 * Classification is DETERMINISTIC and derives from closed structured signals, never from parsing
 * client text. Natural-language interpretation stays with the model behind the merged
 * `ModelReplyPort`; this module decides what KIND of turn is in front of Riya, which is a policy
 * question and therefore has to be reviewable rather than hidden in a prompt.
 *
 * There is no confidence score. A probability may never override role, routing or policy — authority
 * comes from validated context and from QuickFurno Core, and a number that looked high is not a
 * reason to act.
 */
import { z } from 'zod';

/** The behaviour contract version. Additive future versions get a new literal. */
export const RIYA_BEHAVIOUR_VERSION = 1 as const;
export type RiyaBehaviourVersion = typeof RIYA_BEHAVIOUR_VERSION;

export const CLIENT_SALES_INTENTS = [
  /** A first approach: the client is exploring whether QuickFurno serves their situation at all. */
  'INITIAL_SERVICE_DISCOVERY',
  /** The client is describing what they need; discovery is in progress. */
  'REQUIREMENT_DISCOVERY',
  /** The client has asked for a quotation, an estimate, or a consultation. */
  'QUOTE_OR_CONSULTATION_INTEREST',
  /** A continuation of an existing sales conversation. */
  'SALES_FOLLOW_UP',
  /** Clarifying whether the project is ready to proceed — site, timing, decision-making. */
  'PROJECT_READINESS_CLARIFICATION',
  /** The client has asked for a person. */
  'HUMAN_SALES_ASSISTANCE_REQUEST',
  /** A real request that is not client sales. Riya refuses it rather than guessing. */
  'UNSUPPORTED_NON_SALES_REQUEST',
  /** Not enough validated context to classify. Discovery, never assumption. */
  'INSUFFICIENT_CONTEXT',
] as const;
export type ClientSalesIntent = (typeof CLIENT_SALES_INTENTS)[number];

/** The frozen vocabulary, exposed so a spec can assert it has not grown. */
export const CLIENT_SALES_INTENTS_FROZEN: readonly ClientSalesIntent[] = Object.freeze([
  ...CLIENT_SALES_INTENTS,
]);

/**
 * The closed structured signals a classification may consider.
 *
 * Every field is a boolean or a bounded count. There is no free text, so no client content can enter
 * the classifier, and the rule below is fully reviewable.
 */
export interface ClientSalesSignals {
  /** The conversation already has prior sales turns. */
  readonly hasPriorSalesContext: boolean;
  /** The client explicitly asked for a human. */
  readonly requestedHumanAssistance: boolean;
  /** The client asked for a quote, estimate or consultation. */
  readonly requestedQuoteOrConsultation: boolean;
  /** The client supplied at least one requirement detail this turn. */
  readonly providedRequirementDetail: boolean;
  /** The client asked about timing, site readiness or decision process. */
  readonly askedAboutReadiness: boolean;
  /** The request is recognisably outside client sales. */
  readonly outOfSalesScope: boolean;
  /** How many discovery fields are still unknown. Bounded; not a score. */
  readonly missingDiscoveryFieldCount: number;
}

const signalsSchema = z
  .object({
    hasPriorSalesContext: z.boolean(),
    requestedHumanAssistance: z.boolean(),
    requestedQuoteOrConsultation: z.boolean(),
    providedRequirementDetail: z.boolean(),
    askedAboutReadiness: z.boolean(),
    outOfSalesScope: z.boolean(),
    missingDiscoveryFieldCount: z.int().min(0).max(32),
  })
  .strict();

/** True iff `value` is a structurally valid signal set. */
export function isClientSalesSignals(value: unknown): value is ClientSalesSignals {
  return signalsSchema.safeParse(value).success;
}

/**
 * Classify a client-sales turn from closed signals.
 *
 * Ordered by SAFETY, not by likelihood. Out-of-scope and human requests win over every commercial
 * reading, because mis-serving one of those is worse than missing a sales cue: an agent that talks
 * past "I want to speak to someone" is the failure mode this ordering exists to prevent.
 */
export function classifyClientSalesIntent(signals: ClientSalesSignals): ClientSalesIntent {
  if (signals.outOfSalesScope) {
    return 'UNSUPPORTED_NON_SALES_REQUEST';
  }
  if (signals.requestedHumanAssistance) {
    return 'HUMAN_SALES_ASSISTANCE_REQUEST';
  }
  if (signals.requestedQuoteOrConsultation) {
    return 'QUOTE_OR_CONSULTATION_INTEREST';
  }
  if (signals.askedAboutReadiness) {
    return 'PROJECT_READINESS_CLARIFICATION';
  }
  if (signals.providedRequirementDetail) {
    return 'REQUIREMENT_DISCOVERY';
  }
  if (signals.hasPriorSalesContext) {
    return 'SALES_FOLLOW_UP';
  }
  // Nothing said, nothing known: ask rather than assume.
  return signals.missingDiscoveryFieldCount > 0
    ? 'INSUFFICIENT_CONTEXT'
    : 'INITIAL_SERVICE_DISCOVERY';
}
