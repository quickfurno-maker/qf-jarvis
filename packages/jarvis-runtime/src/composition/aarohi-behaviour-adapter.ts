/**
 * The Aarohi behaviour adapter (JF-4C, ADR-0150).
 *
 * The third and last place where a business agent meets the generic pipeline. It implements
 * `agent-runtime`'s `BehaviourDecisionPort` by reading the injected acquisition input port, calling
 * `evaluateAarohiSalesTurn` ONCE, and translating the resulting strategy into an M2 proposal kind — the
 * exact shape of the Riya and Anisha adapters, in the exact layer, for the exact reason: this is the
 * only place allowed to know both sides.
 *
 * ### No new brain was written, and that is the point
 *
 * `evaluateAarohiSalesTurn` already IS Aarohi's turn-level decision. It binds an injected reading to
 * the CURRENT inbound message of a certified AVG-5 conversation, refuses a stale reading once a newer
 * turn exists, checks the causal chain as semantic UTC instants, re-runs the AVG-1 existing-vendor gate
 * so only `NOT_REGISTERED` proceeds, and derives one of six closed strategies through a deterministic
 * total policy the caller cannot influence.
 *
 * So there is no `decideAarohiTurn` here, no second acquisition-case model, no scoring, no discovery,
 * no commercial reasoning and no state machine. This file reads one port, calls one existing evaluator,
 * and maps a closed vocabulary onto another closed vocabulary. If it grew a business rule, that rule
 * would be a second answer to a question AVG-7 already answers.
 *
 * ### Model eligibility comes from the domain, not from this file
 *
 * `brief.futureModelDraftEligible` is AVG-7's own answer to whether a draft may be attempted for this
 * turn. The map below carries the proposal KIND; eligibility is read from the brief and then ANDed with
 * it. Deciding eligibility here would put a sales-ethics judgement in the composition root.
 *
 * It calls no model and no provider: a model-eligible decision enters the same generic M4 path Riya and
 * Anisha use, through the QF Model Gateway, at most once. It creates no proposal — the authoritative
 * path builds exactly one. It sends nothing, transitions no acquisition case, and reaches no handoff.
 *
 * ### Failure is a throw, and the orchestrator fails closed
 *
 * Exactly as the Anisha adapter: a contradictory input rejects, the orchestrator skips the model
 * entirely and refuses. Repairing an acquisition input would be worse than refusing it, because the
 * thing being repaired is evidence about a real person's registration status.
 */
import type {
  BehaviourDecision,
  BehaviourDecisionPort,
  BehaviourDecisionRequest,
} from '@qf-jarvis/agent-runtime';
import { evaluateAarohiSalesTurn } from '@qf-jarvis/aarohi-agent';
import type { AarohiSalesStrategy } from '@qf-jarvis/aarohi-agent';

import type {
  AuthoritativeConversationStatePort,
  ConversationStateKey,
} from '../contracts/authoritative-state.js';
import type { AarohiAcquisitionBehaviourInputPort } from '../contracts/aarohi-acquisition-behaviour-input.js';

/** The actor and party this adapter serves. Exclusive, exactly as Riya's and Anisha's are. */
const AAROHI_ACTOR = 'AAROHI' as const;
const AAROHI_SUPPORTED_PARTY = 'PROSPECT' as const;

/** Opaque reference grammar — identical to the merged provenance/proposal grammar. */
const OPAQUE_REFERENCE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * AVG-7 strategy -> M2 proposal kind and whether a model draft may be attempted at all.
 *
 * Total and closed over `AAROHI_SALES_STRATEGIES`. No new M2 kind was needed.
 *
 * The two REPLY_BRIEF strategies map to `REPLY`, for the reason ADR-0068 established for Riya and
 * ADR-0071 restated for Anisha: the authoritative reply chain carries agent-facing text only under
 * `REPLY`, so any other kind would discard the brief's own purpose. `PREPARE_CLARIFYING_REPLY_BRIEF`
 * keeps its clarifying meaning in `structuredIntent` rather than in `REQUEST_CLARIFICATION`.
 *
 * The two REQUEST_CORE_*_CONTEXT strategies map to `NO_ACTION` with no model, and this is the most
 * consequential line in the file. AVG-8 and AVG-9 exist precisely because a commercial or
 * registration/payment question must stop at Core reference data — no price, package, discount,
 * registration step, payment or activation claim may originate in Aarohi. A `REPLY` here would invite a
 * model to answer the question Core has not answered yet. `NO_ACTION` is the truthful outcome: this
 * turn produces no client-facing text, and `structuredIntent` records which Core context is required.
 *
 * `REQUEST_CORE_CONTACT_POLICY_REVIEW` and `REQUEST_HUMAN_REVIEW` map to `ESCALATE_TO_HUMAN`, the
 * existing Core-review escalation category. Neither executes a handoff, notifies anyone, or changes an
 * assignment: it produces one proposal and nothing else.
 */
const OUTCOME_BY_STRATEGY: Readonly<
  Record<
    AarohiSalesStrategy,
    { readonly kind: BehaviourDecision['proposalKind']; readonly modelPermitted: boolean }
  >
> = Object.freeze({
  PREPARE_NONCOMMERCIAL_REPLY_BRIEF: { kind: 'REPLY', modelPermitted: true },
  PREPARE_CLARIFYING_REPLY_BRIEF: { kind: 'REPLY', modelPermitted: true },
  REQUEST_CORE_COMMERCIAL_CONTEXT: { kind: 'NO_ACTION', modelPermitted: false },
  REQUEST_CORE_PROCESS_CONTEXT: { kind: 'NO_ACTION', modelPermitted: false },
  REQUEST_CORE_CONTACT_POLICY_REVIEW: { kind: 'ESCALATE_TO_HUMAN', modelPermitted: false },
  REQUEST_HUMAN_REVIEW: { kind: 'ESCALATE_TO_HUMAN', modelPermitted: false },
});

/**
 * Build the Aarohi behaviour port.
 *
 * Returns `undefined` from `decide` — "use the legacy default" — for any turn that is not a `PROSPECT`
 * turn assigned to `AAROHI`, and for any turn the input port has nothing to say about. Aarohi is not
 * consulted about client or vendor work, and the absence of an opinion is not a refusal.
 */
export function aarohiBehaviourPort(
  input: AarohiAcquisitionBehaviourInputPort,
  state: AuthoritativeConversationStatePort,
  /** The ONE tenant-scoped key this turn is bound to (QFJ-P08-B1, ADR-0076). */
  key: ConversationStateKey,
  taskClass: string,
): BehaviourDecisionPort {
  return Object.freeze({
    async decide(request: BehaviourDecisionRequest): Promise<BehaviourDecision | undefined> {
      // The role precheck happens before ANY read: a client or vendor turn must not cost an
      // acquisition-input call, and must not cost a Core observation read either.
      if (request.partyType !== AAROHI_SUPPORTED_PARTY || request.assignedActor !== AAROHI_ACTOR) {
        return undefined;
      }

      const supplied = await input.read({
        // The tenant comes from the ONE key derived from the validated envelope -- never from the
        // supplied artifacts, and never from what the state source returned (ADR-0076).
        tenantId: key.tenantId,
        conversationId: request.conversationId,
        revision: request.revision,
      });
      if (supplied === undefined) {
        return undefined;
      }
      for (const reference of [supplied.planRef, supplied.promptRef]) {
        if (typeof reference !== 'string' || !OPAQUE_REFERENCE.test(reference)) {
          // The rejected reference is deliberately absent from the message.
          throw new Error('invalid-behaviour-aarohi-ref');
        }
      }

      // Conversation control comes from the ONE authoritative source, never from the input port.
      if (request.conversationId !== key.conversationId) {
        throw new Error('invalid-behaviour-conversation');
      }
      const control = await state.read(key);
      // A source that answered correctly at the first gate could still answer with another tenant's
      // state here, and that state would reach the behaviour decision.
      if (control.tenantId !== key.tenantId || control.conversationId !== key.conversationId) {
        throw new Error('invalid-behaviour-state');
      }
      // Control is re-checked here, at the last moment before a decision, exactly as it is for the
      // other two agents. The first gate already refused a paused or human-owned turn; this catches a
      // state that changed underneath one.
      if (control.humanTakeover || control.aiPaused) {
        return undefined;
      }

      // ONE call, to Aarohi's OWN evaluator. Every artifact is re-parsed and every binding re-proved
      // inside it -- the conversation, the latest-turn binding, the causal chain, and the CURRENT
      // AVG-1 Core gate. Nothing below re-implements any of that.
      const outcome = evaluateAarohiSalesTurn({
        planRef: supplied.planRef,
        conversation: supplied.conversation,
        interpretation: supplied.interpretation,
        coreObservation: supplied.coreObservation,
        plannedAt: supplied.plannedAt,
      });

      if (!outcome.ok) {
        // AVG-7 refused: a stale reading, a broken causal chain, a malformed artifact, or a Core gate
        // that no longer admits this prospect. Fail closed. The refusal token is Aarohi's own closed
        // vocabulary and names no party, message or Core detail, but it is still not surfaced here --
        // the orchestrator's refusal reason is the runtime's to choose.
        throw new Error('aarohi-turn-refused');
      }

      const brief = outcome.plan.brief;
      const mapped = OUTCOME_BY_STRATEGY[brief.strategy];

      return Object.freeze({
        // Both halves must permit it. The map says whether this STRATEGY could ever carry a draft; the
        // brief says whether THIS turn may. Neither alone is the answer.
        modelReplyEligible: mapped.modelPermitted && brief.futureModelDraftEligible,
        proposalKind: mapped.kind,
        // Content-free, and every value is a closed token, a boolean or the opaque plan reference.
        // No message, no reply, no price, no package, no Core identifier and no prospect reference.
        structuredIntent: Object.freeze({
          agent: AAROHI_ACTOR,
          taskClass,
          strategy: brief.strategy,
          intent: brief.intent,
          objectionKind: brief.objectionKind,
          requiresClarification: brief.requiresClarification,
          requiresCoreCommercialContext: brief.requiresCoreCommercialContext,
          requiresCoreProcessContext: brief.requiresCoreProcessContext,
          requiresCoreContactPolicyRevalidation: brief.requiresCoreContactPolicyRevalidation,
          requiresCoreConsentRevalidation: brief.requiresCoreConsentRevalidation,
          requiresHumanReview: brief.requiresHumanReview,
          stopSalesPendingCoreReview: brief.stopSalesPendingCoreReview,
          planRef: outcome.plan.planRef,
          promptRef: supplied.promptRef,
        }),
      });
    },
  });
}
