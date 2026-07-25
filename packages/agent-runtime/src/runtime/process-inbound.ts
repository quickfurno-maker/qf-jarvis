/**
 * The authority-first inbound decision (QFJ-M1, ADR-0054 §C, §E, §G, §I).
 *
 * Deterministic and fail-closed. It validates the envelope against the conversation, runs the privacy
 * gate BEFORE any model/knowledge interface, assigns the agent, and produces PROPOSALS ONLY — an
 * assignment proposal plus either a reply proposal (when AI is eligible) or an escalation proposal
 * (on human takeover / AI pause / HUMAN_ONLY / an unserviceable data class). It NEVER calls the
 * injected model interface (no live model call in this slice) and executes/sends nothing.
 */
import type { AgentRuntime } from './create-agent-runtime.js';
import type { ConversationContext } from '../contracts/conversation-context.js';
import type { InboundEnvelope } from '../contracts/inbound-envelope.js';
import { createProposal } from '../contracts/proposals.js';
import type { RuntimeProposal } from '../contracts/proposals.js';
import type { RuntimeEvent, RuntimeEventType } from '../contracts/observability.js';
import { AI_AGENT_ACTORS } from '../contracts/vocabularies.js';
import type { RuntimeActor, RuntimeReason } from '../contracts/vocabularies.js';
import { assignAgent } from '../router/assign-agent.js';

/** The result of processing an inbound envelope: proposals only, or a fail-closed reason. */
export type RuntimeDecision =
  | {
      readonly ok: true;
      readonly assignedActor: RuntimeActor;
      readonly aiEligible: boolean;
      readonly reason: RuntimeReason;
      readonly proposals: readonly RuntimeProposal[];
    }
  | { readonly ok: false; readonly reason: RuntimeReason };

/** Whether an eligible AI reply can be drafted, and the reason when it cannot. */
interface Eligibility {
  readonly aiEligible: boolean;
  readonly reason: RuntimeReason;
}

function replyEligibility(
  runtime: AgentRuntime,
  context: ConversationContext,
  assignedActor: RuntimeActor,
): Eligibility {
  if (context.humanTakeover) {
    return { aiEligible: false, reason: 'runtime-human-takeover' };
  }
  if (context.aiPaused) {
    return { aiEligible: false, reason: 'runtime-ai-paused' };
  }
  if (context.dataClass === 'HUMAN_ONLY') {
    return { aiEligible: false, reason: 'runtime-human-only' };
  }
  if (!AI_AGENT_ACTORS.has(assignedActor)) {
    return { aiEligible: false, reason: 'runtime-escalation-required' };
  }
  // LOCAL_ONLY content requires a LOCAL model interface; a hosted-only (or absent) interface cannot serve it.
  if (context.dataClass === 'LOCAL_ONLY' && runtime.modelInterface?.executionClass !== 'LOCAL') {
    return { aiEligible: false, reason: 'runtime-data-class-unserviceable' };
  }
  return { aiEligible: true, reason: 'runtime-assigned' };
}

/** Process one inbound envelope for a conversation. Deterministic, fail-closed, proposal-only. */
export function processInbound(
  runtime: AgentRuntime,
  context: ConversationContext,
  envelope: InboundEnvelope,
): RuntimeDecision {
  const hook = runtime.observability;
  const emit = (
    type: RuntimeEventType,
    reason: RuntimeReason,
    extra: Partial<Pick<RuntimeEvent, 'actor' | 'proposalKind'>> = {},
  ): void => {
    hook.onEvent(
      Object.freeze({
        type,
        runtimeId: envelope.runtimeId,
        conversationId: context.conversationId,
        actor: extra.actor,
        partyType: context.partyType,
        state: context.state,
        proposalKind: extra.proposalKind,
        reason,
      }),
    );
  };

  // 1. The envelope must belong to this conversation/tenant/party.
  if (
    envelope.conversationId !== context.conversationId ||
    envelope.tenantId !== context.tenantId ||
    envelope.partyType !== context.partyType
  ) {
    emit('runtime-envelope-refused', 'runtime-envelope-invalid');
    return { ok: false, reason: 'runtime-envelope-invalid' };
  }
  emit('runtime-envelope-accepted', 'runtime-assigned');

  // 2. Privacy gate — BEFORE any model/knowledge interface.
  if (context.subjectRef !== undefined) {
    if (runtime.privacyGate === undefined) {
      emit('runtime-proposal-refused', 'runtime-privacy-gate-missing');
      return { ok: false, reason: 'runtime-privacy-gate-missing' };
    }
    if (runtime.privacyGate.subjectStatus(context.subjectRef) !== 'clear') {
      emit('runtime-proposal-refused', 'runtime-subject-blocked');
      return { ok: false, reason: 'runtime-subject-blocked' };
    }
  }

  // 3. Deterministic assignment.
  const assignedActor = assignAgent(context.partyType, context.humanTakeover, runtime.policy);
  emit('runtime-agent-assigned', 'runtime-assigned', { actor: assignedActor });

  const base = `${context.conversationId}-${envelope.messageId}`;
  const proposals: RuntimeProposal[] = [
    createProposal({
      proposalId: `${base}-assign`,
      proposalVersion: 1,
      kind: 'AGENT_ASSIGNMENT',
      actor: assignedActor,
      partyType: context.partyType,
      conversationId: context.conversationId,
    }),
  ];
  emit('runtime-proposal-created', 'runtime-assigned', {
    actor: assignedActor,
    proposalKind: 'AGENT_ASSIGNMENT',
  });

  // 4. Reply eligibility — human takeover / AI pause / data class checked BEFORE any model call.
  const { aiEligible, reason } = replyEligibility(runtime, context, assignedActor);
  if (aiEligible) {
    proposals.push(
      createProposal({
        proposalId: `${base}-reply`,
        proposalVersion: 1,
        kind: 'REPLY',
        actor: assignedActor,
        partyType: context.partyType,
        conversationId: context.conversationId,
      }),
    );
    emit('runtime-proposal-created', 'runtime-assigned', {
      actor: assignedActor,
      proposalKind: 'REPLY',
    });
  } else {
    // Escalate to coordination — a proposal only, never an executed handoff.
    proposals.push(
      createProposal({
        proposalId: `${base}-escalate`,
        proposalVersion: 1,
        kind: 'ESCALATION',
        actor: 'JARVIS',
        partyType: context.partyType,
        conversationId: context.conversationId,
      }),
    );
    if (reason === 'runtime-ai-paused') {
      emit('runtime-ai-paused', reason, { actor: assignedActor });
    }
    emit('runtime-escalation-required', reason, {
      actor: 'JARVIS',
      proposalKind: 'ESCALATION',
    });
  }

  return { ok: true, assignedActor, aiEligible, reason, proposals: Object.freeze(proposals) };
}
