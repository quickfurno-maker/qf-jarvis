/**
 * The Riya behaviour adapter (QFJ-S3-C-B, ADR-0068).
 *
 * The one place where a business agent meets the generic pipeline. It implements `agent-runtime`'s
 * `BehaviourDecisionPort` by reading the injected client-sales input port, calling `decideRiyaTurn`
 * once, and translating the resulting disposition into an M2 proposal kind. It lives HERE, in the
 * composition root, because this is the only layer allowed to know both sides: `agent-runtime` must
 * stay business-neutral, and `riya-agent` must stay runtime-neutral.
 *
 * It creates no proposal — `createRiyaProposal` is deliberately not called, because the authoritative
 * path builds exactly one `OrchestrationProposal` through `createOrchestrationProposal` and a second
 * construction would be a second proposal path. It calls no model, mutates nothing, and returns a
 * plain decision the orchestrator is free to override with its own gates.
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
  RIYA_ACTOR,
  RIYA_SUPPORTED_PARTY,
  createNeedDiscovery,
  decideRiyaTurn,
  isClientSalesSignals,
} from '@qf-jarvis/riya-agent';
import type { NeedDiscovery, RiyaDisposition } from '@qf-jarvis/riya-agent';

import type {
  AuthoritativeConversationStatePort,
  ConversationStateKey,
} from '../contracts/authoritative-state.js';
import type { ClientSalesBehaviourInputPort } from '../contracts/behaviour-input.js';

/** Opaque reference grammar — identical to the merged provenance/proposal grammar. */
const OPAQUE_REFERENCE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Riya disposition -> M2 proposal kind and model eligibility.
 *
 * Total and closed. `FOLLOW_UP` is the kind added by ADR-0068; the other three already existed and are
 * used with their existing meaning, not repurposed.
 */
const OUTCOME_BY_DISPOSITION: Readonly<
  Record<
    RiyaDisposition,
    { readonly kind: BehaviourDecision['proposalKind']; readonly model: boolean }
  >
> = Object.freeze({
  DRAFT_REPLY: { kind: 'REPLY', model: true },
  CONTINUE_DISCOVERY: { kind: 'REPLY', model: true },
  PROPOSE_SALES_FOLLOW_UP: { kind: 'FOLLOW_UP', model: true },
  REQUEST_HUMAN_SALES_CONTACT: { kind: 'ESCALATE_TO_HUMAN', model: false },
  REFUSE: { kind: 'NO_ACTION', model: false },
});

/**
 * Re-validate a discovery snapshot through the riya-agent constructor.
 *
 * The supplier already built it, but re-running the constructor re-checks every bound and the one
 * combination that would be a lie (`SUFFICIENT_FOR_CORE_REVIEW` while fields are still missing). A
 * boundary that trusts its input is not a boundary.
 */
function revalidated(discovery: NeedDiscovery): NeedDiscovery {
  return createNeedDiscovery({
    ...(discovery.serviceInterestRef === undefined
      ? {}
      : { serviceInterestRef: discovery.serviceInterestRef }),
    ...(discovery.locationRef === undefined ? {} : { locationRef: discovery.locationRef }),
    ...(discovery.propertyTypeRef === undefined
      ? {}
      : { propertyTypeRef: discovery.propertyTypeRef }),
    ...(discovery.scopeSummary === undefined ? {} : { scopeSummary: discovery.scopeSummary }),
    ...(discovery.budgetNote === undefined ? {} : { budgetNote: discovery.budgetNote }),
    ...(discovery.timelineNote === undefined ? {} : { timelineNote: discovery.timelineNote }),
    ...(discovery.consultationPreferenceRef === undefined
      ? {}
      : { consultationPreferenceRef: discovery.consultationPreferenceRef }),
    completeness: discovery.completeness,
    missingFields: discovery.missingFields,
  });
}

/**
 * Build the Riya behaviour port.
 *
 * Returns `undefined` from `decide` — meaning "use the legacy default" — for any turn that is not a
 * CLIENT turn assigned to Riya, and for any turn the input port has nothing to say about. Riya is not
 * consulted about vendor work, and the absence of an opinion is not a refusal.
 */
export function riyaBehaviourPort(
  input: ClientSalesBehaviourInputPort,
  state: AuthoritativeConversationStatePort,
  /** The ONE tenant-scoped key this turn is bound to (QFJ-P08-B1, ADR-0076). */
  key: ConversationStateKey,
  taskClass: string,
): BehaviourDecisionPort {
  return Object.freeze({
    async decide(request: BehaviourDecisionRequest): Promise<BehaviourDecision | undefined> {
      if (request.partyType !== RIYA_SUPPORTED_PARTY || request.assignedActor !== RIYA_ACTOR) {
        return undefined;
      }

      const supplied = await input.read({
        // The tenant comes from the ONE key derived from the validated envelope -- never from the
        // supplied business facts, and never from what the state source returned (ADR-0076).
        tenantId: key.tenantId,
        conversationId: request.conversationId,
        revision: request.revision,
      });
      if (supplied === undefined) {
        return undefined;
      }
      if (!isClientSalesSignals(supplied.signals)) {
        throw new Error('invalid-behaviour-signals');
      }
      if (typeof supplied.promptRef !== 'string' || !OPAQUE_REFERENCE.test(supplied.promptRef)) {
        throw new Error('invalid-behaviour-prompt-ref');
      }
      const discovery =
        supplied.needDiscovery === undefined ? undefined : revalidated(supplied.needDiscovery);

      // Conversation control comes from the ONE authoritative source, never from the input port.
      // The orchestrator is bound to one conversation for the whole turn; a request naming another
      // is a wiring error, not a second conversation to serve.
      if (request.conversationId !== key.conversationId) {
        throw new Error('invalid-behaviour-conversation');
      }
      const control = await state.read(key);
      // This adapter is an authoritative-state reader too, so it honours the same rule as the four
      // general projections: a source that answered correctly at the first gate could still answer
      // with another tenant's state here, and that state would reach the behaviour decision.
      if (control.tenantId !== key.tenantId || control.conversationId !== key.conversationId) {
        throw new Error('invalid-behaviour-state');
      }

      const decision = decideRiyaTurn({
        partyType: request.partyType,
        currentActor: request.assignedActor,
        signals: supplied.signals,
        ...(discovery === undefined ? {} : { needDiscovery: discovery }),
        promptRef: supplied.promptRef,
        humanTakeover: control.humanTakeover,
        aiPaused: control.aiPaused,
      });

      const mapped = OUTCOME_BY_DISPOSITION[decision.disposition];

      // The table above and riya-agent's own eligibility must agree. If they ever drift apart, the
      // mapping has stopped describing the behaviour it claims to translate — refuse, don't pick one.
      if (mapped.model !== decision.modelReplyEligible) {
        throw new Error('invalid-behaviour-eligibility');
      }

      // A follow-up may only be proposed on a snapshot Core can actually review. If the decision and
      // the snapshot disagree, the input was tampered with or built by a drifted implementation —
      // refuse rather than repair.
      if (mapped.kind === 'FOLLOW_UP' && discovery?.completeness !== 'SUFFICIENT_FOR_CORE_REVIEW') {
        throw new Error('invalid-behaviour-follow-up');
      }

      // Bounded, content-free intent. No promptRef, no note, no reference, no free text — a proposal
      // records WHAT was decided, and QuickFurno Core already holds the material it was decided from.
      const structuredIntent: Record<string, string | number | boolean> = {
        taskClass,
        replyKind: mapped.kind,
        behaviourVersion: decision.behaviourVersion,
        salesIntent: decision.intent,
        disposition: decision.disposition,
      };
      if (discovery !== undefined) {
        structuredIntent['discoveryCompleteness'] = discovery.completeness;
      }

      return Object.freeze({
        modelReplyEligible: mapped.model,
        proposalKind: mapped.kind,
        structuredIntent: Object.freeze(structuredIntent),
      });
    },
  });
}
