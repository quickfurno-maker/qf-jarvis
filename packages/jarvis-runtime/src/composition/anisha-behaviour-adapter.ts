/**
 * The Anisha behaviour adapter (QFJ-S3-D-B, ADR-0071).
 *
 * The vendor twin of the Riya adapter, and the only other place where a business agent meets the
 * generic pipeline. It implements `agent-runtime`'s `BehaviourDecisionPort` by reading the injected
 * vendor-journey input port, calling `decideAnishaTurn` once, and translating the resulting
 * disposition into an M2 proposal kind. It lives HERE, in the composition root, because this is the
 * only layer allowed to know both sides: `agent-runtime` must stay business-neutral, and
 * `anisha-agent` must stay runtime-neutral.
 *
 * It creates no proposal — the authoritative path builds exactly one `OrchestrationProposal` through
 * `createOrchestrationProposal`, and a second construction would be a second proposal path. It calls
 * no model, mutates nothing, assigns nobody, and changes no conversation control.
 *
 * Every failure is fail-closed by THROWING: the orchestrator catches a rejected behaviour port, skips
 * the model entirely, and refuses. Repairing a contradictory input would be worse than refusing it.
 */
import type {
  BehaviourDecision,
  BehaviourDecisionPort,
  BehaviourDecisionRequest,
} from '@qf-jarvis/agent-runtime';
import {
  ANISHA_ACTOR,
  ANISHA_SUPPORTED_PARTY,
  decideAnishaTurn,
  isVendorJourneySignals,
} from '@qf-jarvis/anisha-agent';
import type { AnishaDisposition } from '@qf-jarvis/anisha-agent';

import type { AuthoritativeConversationStatePort } from '../contracts/authoritative-state.js';
import type { VendorJourneyBehaviourInputPort } from '../contracts/vendor-journey-behaviour-input.js';

/** Opaque reference grammar — identical to the merged provenance/proposal grammar. */
const OPAQUE_REFERENCE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Anisha disposition -> M2 proposal kind and model eligibility.
 *
 * Total and closed. No new M2 kind was needed: `FOLLOW_UP` already exists from ADR-0068, and the
 * other three are used with their existing meaning rather than repurposed.
 *
 * `CONTINUE_CLARIFICATION` maps to `REPLY`, not `REQUEST_CLARIFICATION`, for the reason ADR-0068
 * established for Riya: the authoritative reply chain can carry vendor-facing text only under
 * `REPLY` (`STRUCTURED_REPLY_KINDS` forbids a body elsewhere and the M4 adapter builds a draft only
 * for `REPLY`), so the other kind would discard the clarifying question itself. The clarification
 * meaning survives in `structuredIntent`.
 *
 * `REQUEST_VENDOR_ESCALATION` maps to `ESCALATE_TO_HUMAN` because that is the existing Core-review
 * escalation category — the M2 vocabulary has no Jarvis-coordination kind. The mapping produces one
 * `PENDING_CORE_VALIDATION` proposal and nothing else: it executes no handoff, sends nothing to
 * anyone, bypasses no coordinator, changes no assignment and persists nothing. Who ultimately acts
 * stays outside this composition, which is exactly why ADR-0070 kept the disposition target-neutral.
 */
const OUTCOME_BY_DISPOSITION: Readonly<
  Record<
    AnishaDisposition,
    { readonly kind: BehaviourDecision['proposalKind']; readonly model: boolean }
  >
> = Object.freeze({
  DRAFT_REPLY: { kind: 'REPLY', model: true },
  CONTINUE_CLARIFICATION: { kind: 'REPLY', model: true },
  PROPOSE_VENDOR_FOLLOW_UP: { kind: 'FOLLOW_UP', model: true },
  REQUEST_VENDOR_ESCALATION: { kind: 'ESCALATE_TO_HUMAN', model: false },
  REFUSE: { kind: 'NO_ACTION', model: false },
});

/**
 * Build the Anisha behaviour port.
 *
 * Returns `undefined` from `decide` — meaning "use the legacy default" — for any turn that is not a
 * VENDOR turn assigned to Anisha, and for any turn the input port has nothing to say about. Anisha is
 * not consulted about client work, and the absence of an opinion is not a refusal.
 */
export function anishaBehaviourPort(
  input: VendorJourneyBehaviourInputPort,
  state: AuthoritativeConversationStatePort,
  taskClass: string,
): BehaviourDecisionPort {
  return Object.freeze({
    async decide(request: BehaviourDecisionRequest): Promise<BehaviourDecision | undefined> {
      // The role precheck happens before ANY read: a client turn must not cost a vendor-input call.
      if (request.partyType !== ANISHA_SUPPORTED_PARTY || request.assignedActor !== ANISHA_ACTOR) {
        return undefined;
      }

      const supplied = await input.read({
        conversationId: request.conversationId,
        revision: request.revision,
      });
      if (supplied === undefined) {
        return undefined;
      }
      if (!isVendorJourneySignals(supplied.signals)) {
        throw new Error('invalid-behaviour-signals');
      }
      if (typeof supplied.promptRef !== 'string' || !OPAQUE_REFERENCE.test(supplied.promptRef)) {
        // The rejected reference is deliberately absent from the message.
        throw new Error('invalid-behaviour-prompt-ref');
      }

      // Conversation control comes from the ONE authoritative source, never from the input port.
      const control = await state.read(request.conversationId);

      const decision = decideAnishaTurn({
        partyType: request.partyType,
        currentActor: request.assignedActor,
        signals: supplied.signals,
        ...(supplied.context === undefined ? {} : { context: supplied.context }),
        promptRef: supplied.promptRef,
        humanTakeover: control.humanTakeover,
        aiPaused: control.aiPaused,
      });

      // The CANONICAL context — the frozen record `decideAnishaTurn` re-derived (S3-D-A, d1d25c5).
      // Everything below reads this and never `supplied.context`; reading the supplier's object again
      // would reintroduce exactly the boundary hole that correction closed.
      const canonicalContext = decision.context;
      const mapped = OUTCOME_BY_DISPOSITION[decision.disposition];

      // The table above and anisha-agent's own eligibility must agree. If they ever drift apart, the
      // mapping has stopped describing the behaviour it claims to translate — refuse, don't pick one.
      if (mapped.model !== decision.modelReplyEligible) {
        throw new Error('invalid-behaviour-eligibility');
      }

      // A follow-up may only be proposed on a snapshot Core can actually review.
      if (
        mapped.kind === 'FOLLOW_UP' &&
        canonicalContext?.completeness !== 'SUFFICIENT_FOR_CORE_REVIEW'
      ) {
        throw new Error('invalid-behaviour-follow-up');
      }

      // Bounded, content-free intent. No promptRef, no band, no reference, no missing-field list — a
      // proposal records WHAT was decided, and QuickFurno Core already holds the material it was
      // decided from. Copying a readiness band here would put money-adjacent data on a proposal for
      // no decision-making reason, which ADR-0070 §4 exists to prevent.
      const structuredIntent: Record<string, string | number | boolean> = {
        taskClass,
        replyKind: mapped.kind,
        behaviourVersion: decision.behaviourVersion,
        vendorJourneyIntent: decision.intent,
        disposition: decision.disposition,
      };
      if (canonicalContext !== undefined) {
        structuredIntent['contextCompleteness'] = canonicalContext.completeness;
      }

      return Object.freeze({
        modelReplyEligible: mapped.model,
        proposalKind: mapped.kind,
        structuredIntent: Object.freeze(structuredIntent),
      });
    },
  });
}
