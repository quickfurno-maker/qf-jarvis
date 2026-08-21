/**
 * `@qf-jarvis/anisha-care-agent` — the CUSTOMER-CARE half of the Anisha persona family.
 *
 * ### Two bounded agents, one persona
 *
 * `@qf-jarvis/anisha-agent` is the VENDOR journey and stays exactly that. This package is CLIENT /
 * CUSTOMER_CARE. They share the Anisha name and the `ANISHA` runtime actor; they share nothing else
 * — separate domain authority, separate contracts, separate state, separate tests. They are
 * siblings that never import each other, exactly as Riya and vendor Anisha are.
 *
 * Party type alone cannot tell this agent from Riya, because both serve `CLIENT`. Riya is
 * CLIENT/SALES and this is CLIENT/CUSTOMER_CARE, so the discriminator is a SERVICE LINE declared
 * locally rather than added to the shared runtime vocabulary.
 *
 * ### What it reuses rather than rebuilds
 *
 * `@qf-jarvis/agent-runtime` for the actor, party-type and reason vocabularies. Nothing else is
 * created: no model gateway, no event backbone, no memory engine, no provider abstraction, no
 * conversation runtime. Those exist and are composed elsewhere.
 *
 * ### What it cannot do
 *
 * It invokes no model, renders no prompt, opens no transport, persists nothing and takes no
 * external action. It NOTICES and EXPLAINS: refunds, credits, cancellations, order state,
 * assignment, vendor performance, money and policy exceptions are QuickFurno Core's, and every one
 * of them arrives here as something to acknowledge or escalate, never to resolve.
 */

export {
  ANISHA_CARE_BEHAVIOUR_VERSION,
  ANISHA_CARE_SERVICE_LINE,
  CARE_INTENTS,
  CARE_INTENTS_FROZEN,
  CARE_SERVICE_LINES,
  careSignalsSchema,
  classifyCareIntent,
} from './contracts/care-intent.js';
export type {
  AnishaCareBehaviourVersion,
  CareIntent,
  CareServiceLine,
  CareSignals,
} from './contracts/care-intent.js';

export {
  CARE_AGE_BANDS,
  CARE_ENGAGEMENT_STAGES,
  CARE_VALUE_BANDS,
  careContextSchema,
  parseCareContext,
} from './contracts/care-context.js';
export type {
  CareAgeBand,
  CareContext,
  CareEngagementStage,
  CareValueBand,
} from './contracts/care-context.js';

export {
  CARE_DISPOSITIONS,
  CARE_DISPOSITIONS_FROZEN,
  CARE_MODEL_ELIGIBLE_DISPOSITIONS,
  isCareModelEligibleDisposition,
} from './contracts/care-outcome.js';
export type { CareDisposition } from './contracts/care-outcome.js';

export {
  CARE_ESCALATION_REASONS,
  CARE_ESCALATION_REASONS_FROZEN,
} from './contracts/escalation.js';
export type { CareEscalationReason } from './contracts/escalation.js';

export {
  ANISHA_CARE_ACTOR,
  ANISHA_CARE_SUPPORTED_PARTY,
  decideCareTurn,
} from './behaviour/decide-care-turn.js';
export type { CareTurnDecision, CareTurnInput } from './behaviour/decide-care-turn.js';
