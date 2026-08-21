/**
 * ONE deterministic customer-care turn decision.
 *
 * ### What this package IS
 *
 * A behaviour kernel. It takes closed structured signals and returns a frozen decision. It invokes
 * nothing: no model, no transport, no persistence, no external action, no prompt rendering. The
 * caller decides what to do with the decision, and every gate that could remove the model is
 * evaluated here rather than there.
 *
 * ### Fixed to ANISHA / CLIENT / CUSTOMER_CARE
 *
 * The mirror image of the vendor package's `ANISHA`/`VENDOR` fix, and it matters for the same
 * reason. The actor is shared — both Anishas speak as `ANISHA`, one persona family — but the party
 * type is fixed to `CLIENT` and a VENDOR turn arriving here is a scope violation, refused before
 * any model is reached. Vendor work belongs to the sibling package.
 *
 * `CLIENT` alone does not identify this agent, because Riya serves `CLIENT` too. The discriminator
 * is the SERVICE LINE, and a sales turn is not refused but REFERRED — someone can help, and
 * declining a client who reached the wrong agent would be a worse outcome than routing them.
 *
 * ### Precedence is the safety property
 *
 * Gates run in a fixed order, and every branch that removes the model runs before every branch that
 * keeps it: envelope validity, then scope, then takeover, then pause, then intent. A turn that is
 * simultaneously paused and a complaint is paused. Reordering these is a behaviour change, and the
 * specs assert the order rather than trusting it.
 */
import type { RuntimeActor, RuntimePartyType, RuntimeReason } from '@qf-jarvis/agent-runtime';
import { z } from 'zod';

import { parseCareContext } from '../contracts/care-context.js';
import type { CareContext } from '../contracts/care-context.js';
import {
  ANISHA_CARE_BEHAVIOUR_VERSION,
  ANISHA_CARE_SERVICE_LINE,
  classifyCareIntent,
  careSignalsSchema,
} from '../contracts/care-intent.js';
import type {
  AnishaCareBehaviourVersion,
  CareIntent,
  CareServiceLine,
  CareSignals,
} from '../contracts/care-intent.js';
import { isCareModelEligibleDisposition } from '../contracts/care-outcome.js';
import type { CareDisposition } from '../contracts/care-outcome.js';
import type { CareEscalationReason } from '../contracts/escalation.js';

/** The actor this package speaks as. Fixed, never a parameter. Shared with the vendor sibling. */
export const ANISHA_CARE_ACTOR = 'ANISHA' as const satisfies RuntimeActor;
/** The party type this package may serve. Fixed, never a parameter. */
export const ANISHA_CARE_SUPPORTED_PARTY = 'CLIENT' as const satisfies RuntimePartyType;

/** A bounded, versioned, opaque prompt reference. Resolved elsewhere; never rendered here. */
const PROMPT_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export interface CareTurnInput {
  readonly partyType: RuntimePartyType;
  /** The actor that currently owns the conversation, when one is assigned. */
  readonly currentActor?: RuntimeActor;
  readonly signals: CareSignals;
  readonly context?: CareContext;
  /** Opaque, versioned. Never prompt text. */
  readonly promptRef: string;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
}

/** A frozen decision. It carries no instruction that could be executed. */
export interface CareTurnDecision {
  readonly behaviourVersion: AnishaCareBehaviourVersion;
  readonly actor: typeof ANISHA_CARE_ACTOR;
  readonly serviceLine: CareServiceLine;
  readonly intent: CareIntent;
  readonly disposition: CareDisposition;
  readonly context: CareContext | undefined;
  /**
   * Why this turn needs a person, when it does.
   *
   * Present ONLY on `REQUEST_CARE_ESCALATION`, and absent otherwise — an escalation reason attached
   * to a turn that is not escalating would be read by an operator as one that is.
   */
  readonly escalationReason?: CareEscalationReason;
  /**
   * Whether the model boundary MAY be invoked for this turn.
   *
   * An eligibility decision, not a budget enforcer: it cannot enforce process-wide at-most-one
   * invocation, which belongs to the pipeline. What this package guarantees is narrower and
   * structural — it invokes nothing itself, and it returns `false` on every pause, takeover,
   * scope-violation, escalation, referral and refusal path.
   */
  readonly modelReplyEligible: boolean;
  /** A closed runtime reason. Reused from agent-runtime — this package invents no reason codes. */
  readonly reason: RuntimeReason;
  readonly promptRef: string;
}

const turnInputSchema = z
  .object({
    partyType: z.string(),
    currentActor: z.string().optional(),
    signals: careSignalsSchema,
    context: z.unknown().optional(),
    promptRef: PROMPT_REF,
    humanTakeover: z.boolean(),
    aiPaused: z.boolean(),
  })
  .strict();

/** Build a frozen decision. One construction site, so no field can be set on only some paths. */
function decision(args: {
  readonly intent: CareIntent;
  readonly disposition: CareDisposition;
  readonly context: CareContext | undefined;
  readonly reason: RuntimeReason;
  readonly promptRef: string;
  readonly escalationReason?: CareEscalationReason;
}): CareTurnDecision {
  return Object.freeze({
    behaviourVersion: ANISHA_CARE_BEHAVIOUR_VERSION,
    actor: ANISHA_CARE_ACTOR,
    serviceLine: ANISHA_CARE_SERVICE_LINE,
    intent: args.intent,
    disposition: args.disposition,
    context: args.context,
    ...(args.escalationReason === undefined ? {} : { escalationReason: args.escalationReason }),
    // DERIVED from the disposition, never passed in. A caller cannot hand this function a
    // disposition that reaches no model and an eligibility of `true`.
    modelReplyEligible: isCareModelEligibleDisposition(args.disposition),
    reason: args.reason,
    promptRef: args.promptRef,
  });
}

/**
 * Why an escalating turn needs a person.
 *
 * Ordered by precedence for the same reason the intent classifier is: a matter that is both a
 * repeat escalation and a commercial decision is reported as the repeat, because that is the fact
 * an operator needs first.
 */
function escalationReasonFor(
  intent: CareIntent,
  context: CareContext | undefined,
): CareEscalationReason {
  if (context?.previouslyEscalated === true) {
    return 'REPEAT_ESCALATION';
  }
  if (intent === 'HUMAN_SUPPORT_REQUEST') {
    return 'CLIENT_REQUESTED_HUMAN';
  }
  if (intent === 'REFUND_CANCELLATION_OR_BILLING_MATTER') {
    return 'COMMERCIAL_DECISION_REQUIRED';
  }
  if (intent === 'COMPLAINT_INTAKE') {
    return 'COMPLAINT_REQUIRES_OWNER';
  }
  if (context?.ageBand === 'OVERDUE') {
    return 'MATTER_OVERDUE';
  }
  return 'SENSITIVE_OR_DISPUTED_MATTER';
}

/**
 * Decide ONE care turn.
 *
 * Total: every path returns a frozen decision, and the intent switch is exhaustive over the closed
 * vocabulary with no default branch — a new intent fails to compile until somebody decides what it
 * does, which is the point.
 */
export function decideCareTurn(input: CareTurnInput): CareTurnDecision {
  const parsed = turnInputSchema.safeParse(input);
  if (!parsed.success) {
    // Fails CLOSED, before anything is classified. Nothing about the invalid input is read or
    // returned — a malformed envelope must not be able to describe itself through a decision.
    return decision({
      intent: 'UNSUPPORTED_NON_CARE_REQUEST',
      disposition: 'REFUSE',
      context: undefined,
      reason: 'runtime-envelope-invalid',
      // The prompt ref may itself be what failed, so a safe literal is used rather than the input.
      promptRef: 'care.prompt.unresolved',
    });
  }

  // Context is parsed through its own strict schema. An unknown key is a refusal, not a drop.
  const context = input.context === undefined ? undefined : parseCareContext(input.context);
  const promptRef = parsed.data.promptRef;

  // SCOPE, before every content gate. A VENDOR turn is the sibling package's, and a turn already
  // owned by another actor is not this one's to answer.
  if (input.partyType !== ANISHA_CARE_SUPPORTED_PARTY) {
    return decision({
      intent: 'UNSUPPORTED_NON_CARE_REQUEST',
      disposition: 'REFUSE',
      context,
      reason: 'runtime-scope-violation',
      promptRef,
    });
  }
  if (input.currentActor !== undefined && input.currentActor !== ANISHA_CARE_ACTOR) {
    return decision({
      intent: 'UNSUPPORTED_NON_CARE_REQUEST',
      disposition: 'REFUSE',
      context,
      reason: 'runtime-scope-violation',
      promptRef,
    });
  }

  // Then the two gates that mean a person is already holding this conversation.
  if (input.humanTakeover) {
    return decision({
      intent: 'HUMAN_SUPPORT_REQUEST',
      disposition: 'REFUSE',
      context,
      reason: 'runtime-human-takeover',
      promptRef,
    });
  }
  if (input.aiPaused) {
    return decision({
      intent: 'UNSUPPORTED_NON_CARE_REQUEST',
      disposition: 'REFUSE',
      context,
      reason: 'runtime-ai-paused',
      promptRef,
    });
  }

  const intent = classifyCareIntent(parsed.data.signals);

  switch (intent) {
    case 'UNSUPPORTED_NON_CARE_REQUEST':
      return decision({
        intent,
        disposition: 'REFUSE',
        context,
        reason: 'runtime-scope-violation',
        promptRef,
      });
    case 'SALES_REQUEST_NOT_CARE':
      // REFERRED, not refused. The client reached the wrong agent, not the wrong company.
      return decision({
        intent,
        disposition: 'REFER_TO_SALES_AGENT',
        context,
        reason: 'runtime-scope-violation',
        promptRef,
      });
    case 'ESCALATION_REQUIRED_MATTER':
    case 'HUMAN_SUPPORT_REQUEST':
    case 'REFUND_CANCELLATION_OR_BILLING_MATTER':
      // Money-adjacent matters escalate rather than acknowledge: care may never state an outcome,
      // an amount, an eligibility or a date, and an acknowledgement that implied one would.
      return decision({
        intent,
        disposition: 'REQUEST_CARE_ESCALATION',
        context,
        reason: 'runtime-escalation-required',
        promptRef,
        escalationReason: escalationReasonFor(intent, context),
      });
    case 'COMPLAINT_INTAKE':
      // A complaint on an already-escalated matter needs an owner, not a second acknowledgement.
      return context?.previouslyEscalated === true
        ? decision({
            intent,
            disposition: 'REQUEST_CARE_ESCALATION',
            context,
            reason: 'runtime-escalation-required',
            promptRef,
            escalationReason: escalationReasonFor(intent, context),
          })
        : decision({
            intent,
            disposition: 'ACKNOWLEDGE_AND_RECORD',
            context,
            reason: 'runtime-assigned',
            promptRef,
          });
    case 'WARRANTY_OR_AFTERCARE_INTAKE':
      return decision({
        intent,
        disposition: 'ACKNOWLEDGE_AND_RECORD',
        context,
        reason: 'runtime-assigned',
        promptRef,
      });
    case 'ORDER_OR_PROJECT_STATUS_QUERY':
    case 'SCHEDULING_OR_DELIVERY_GUIDANCE':
      // Answerable only when this turn was actually told which engagement it concerns. Without a
      // reference, the honest next move is to ask rather than to answer about an unknown order.
      return context?.engagementRef === undefined
        ? decision({
            intent,
            disposition: 'CONTINUE_CLARIFICATION',
            context,
            reason: 'runtime-assigned',
            promptRef,
          })
        : decision({
            intent,
            disposition: 'DRAFT_REPLY',
            context,
            reason: 'runtime-assigned',
            promptRef,
          });
    case 'ROUTINE_CARE_QUERY':
      return decision({
        intent,
        disposition: 'DRAFT_REPLY',
        context,
        reason: 'runtime-assigned',
        promptRef,
      });
  }
}
