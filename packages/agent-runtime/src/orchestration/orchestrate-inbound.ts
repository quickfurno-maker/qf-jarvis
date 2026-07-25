/**
 * The M2 Core decision and reply orchestrator (QFJ-M2, ADR-0055 §C, §I, §M).
 *
 * Deterministic, fail-closed, and PROPOSAL-ONLY. It walks the 15-stage order — validate envelope,
 * read context, enforce takeover/pause/scope/freshness/privacy/data-class, retrieve exact knowledge,
 * plan, invoke the injected model port, validate the draft, DOUBLE-GATE (re-read context before Core),
 * build a `PENDING_CORE_VALIDATION` proposal, obtain the injected Core decision, and return an
 * immutable result. It NEVER calls a model when a gate blocks, NEVER fabricates a Core `ACCEPTED`
 * (a missing port → `CORE_UNAVAILABLE`), and NEVER sends, executes, or persists anything.
 */
import type { InboundEnvelope } from '../contracts/inbound-envelope.js';
import type { ConversationPrivacyGate } from '../contracts/privacy-gate.js';
import type { RuntimePolicy } from '../contracts/policy.js';
import { assignAgent } from '../router/assign-agent.js';
import { AI_AGENT_ACTORS } from '../contracts/vocabularies.js';
import type { RuntimeActor } from '../contracts/vocabularies.js';
import { coreDecision, createOrchestrationProposal } from './contracts.js';
import type { KnowledgeCitation, OrchestrationContext, OrchestrationResult } from './contracts.js';
import { createReplyPlan } from './create-reply-plan.js';
import { validateReplyDraft } from './validate-reply-draft.js';
import type { ConversationContextPort, KnowledgePort, ModelReplyPort } from './model-reply-port.js';
import type { CoreDecisionPort } from './core-decision-port.js';
import type {
  OrchestrationEvent,
  OrchestrationEventType,
  OrchestrationObservabilityHook,
} from './observability.js';
import { NOOP_ORCHESTRATION_OBSERVABILITY } from './observability.js';
import type {
  CoreDecisionOutcome,
  OrchestrationProposalKind,
  OrchestrationReason,
} from './vocabularies.js';

export interface OrchestratorConfig {
  readonly policy: RuntimePolicy;
  readonly contextPort: ConversationContextPort;
  readonly modelReplyPort?: ModelReplyPort;
  readonly coreDecisionPort?: CoreDecisionPort;
  readonly knowledgePort?: KnowledgePort;
  readonly privacyGate?: ConversationPrivacyGate;
  readonly observability?: OrchestrationObservabilityHook;
  readonly taskClass?: string;
  /** When true, a model port without an evaluationRef is refused. */
  readonly requireEvaluationRef?: boolean;
  /** Topics for the optional exact knowledge retrieval. */
  readonly knowledgeTopics?: readonly string[];
}

export interface Orchestrator {
  readonly policy: RuntimePolicy;
  readonly contextPort: ConversationContextPort;
  readonly modelReplyPort: ModelReplyPort | undefined;
  readonly coreDecisionPort: CoreDecisionPort | undefined;
  readonly knowledgePort: KnowledgePort | undefined;
  readonly privacyGate: ConversationPrivacyGate | undefined;
  readonly observability: OrchestrationObservabilityHook;
  readonly taskClass: string;
  readonly requireEvaluationRef: boolean;
  readonly knowledgeTopics: readonly string[];
}

/** Build a frozen orchestrator from injected collaborators. */
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return Object.freeze({
    policy: config.policy,
    contextPort: config.contextPort,
    modelReplyPort: config.modelReplyPort,
    coreDecisionPort: config.coreDecisionPort,
    knowledgePort: config.knowledgePort,
    privacyGate: config.privacyGate,
    observability: config.observability ?? NOOP_ORCHESTRATION_OBSERVABILITY,
    taskClass: config.taskClass ?? 'RESPONSE_GENERATION',
    requireEvaluationRef: config.requireEvaluationRef ?? false,
    knowledgeTopics: Object.freeze([...(config.knowledgeTopics ?? [])]),
  });
}

/** The first/second gate: the first content-free reason a context blocks the AI reply path, or null. */
function gateReason(
  orch: Orchestrator,
  context: OrchestrationContext,
  assignedActor: RuntimeActor,
): OrchestrationReason | null {
  if (context.cancelled) {
    return 'orchestration-cancelled';
  }
  if (context.humanTakeover) {
    return 'orchestration-human-takeover';
  }
  if (context.aiPaused) {
    return 'orchestration-ai-paused';
  }
  if (!AI_AGENT_ACTORS.has(assignedActor)) {
    return 'orchestration-human-takeover';
  }
  if (context.subjectRef !== undefined) {
    if (orch.privacyGate === undefined) {
      return 'orchestration-privacy-gate-missing';
    }
    if (orch.privacyGate.subjectStatus(context.subjectRef) !== 'clear') {
      return 'orchestration-subject-blocked';
    }
  }
  if (context.dataClass === 'HUMAN_ONLY') {
    return 'orchestration-human-only';
  }
  if (
    context.dataClass === 'LOCAL_ONLY' &&
    orch.modelReplyPort !== undefined &&
    orch.modelReplyPort.release.executionClass !== 'LOCAL'
  ) {
    return 'orchestration-data-class-unserviceable';
  }
  return null;
}

/** Orchestrate one inbound envelope end to end. Deterministic, fail-closed, proposal-only. */
export function orchestrateInbound(
  orch: Orchestrator,
  envelope: InboundEnvelope,
): OrchestrationResult {
  const hook = orch.observability;
  const runId = `${envelope.conversationId}-${envelope.messageId}`;

  const emit = (
    type: OrchestrationEventType,
    reason: OrchestrationReason,
    extra: Partial<
      Pick<OrchestrationEvent, 'actor' | 'dataClass' | 'proposalKind' | 'coreOutcome'>
    > = {},
    partyType = envelope.partyType,
  ): void => {
    hook.onEvent(
      Object.freeze({
        type,
        runId,
        conversationId: envelope.conversationId,
        actor: extra.actor,
        partyType,
        dataClass: extra.dataClass,
        proposalKind: extra.proposalKind,
        coreOutcome: extra.coreOutcome,
        reason,
      }),
    );
  };
  const refuse = (reason: OrchestrationReason): OrchestrationResult => {
    emit('orchestration-refused', reason);
    return { ok: false, reason };
  };

  emit('orchestration-started', 'orchestration-completed');

  // 1–2. Read the revision-bound context and confirm the envelope belongs to it.
  const ctx1 = orch.contextPort.read();
  if (
    envelope.conversationId !== ctx1.conversationId ||
    envelope.tenantId !== ctx1.tenantId ||
    envelope.partyType !== ctx1.partyType
  ) {
    return refuse('orchestration-envelope-invalid');
  }

  const assignedActor = assignAgent(ctx1.partyType, ctx1.humanTakeover, orch.policy);

  // 3–7. First gate — before any knowledge/model access.
  const block1 = gateReason(orch, ctx1, assignedActor);
  if (block1 !== null) {
    emit('model-invocation-skipped', block1, { actor: assignedActor, dataClass: ctx1.dataClass });
    return refuse(block1);
  }

  // 8. Exact knowledge retrieval (only when a port is configured); fail closed on refusal.
  let citations: KnowledgeCitation[] = [];
  if (orch.knowledgePort !== undefined) {
    const kres = orch.knowledgePort.retrieve({
      conversationId: ctx1.conversationId,
      topics: orch.knowledgeTopics,
      dataClass: ctx1.dataClass,
    });
    if (!kres.ok) {
      return refuse('orchestration-knowledge-refused');
    }
    citations = kres.citations.map((c) => ({ ...c }));
  }

  // 9–10. Model plan + injected model reply port (no live call here).
  if (orch.modelReplyPort === undefined) {
    emit('model-invocation-skipped', 'orchestration-model-unavailable', { actor: assignedActor });
    return refuse('orchestration-model-unavailable');
  }
  if (orch.requireEvaluationRef && orch.modelReplyPort.evaluationRef === undefined) {
    return refuse('orchestration-evaluation-mismatch');
  }
  const plan = createReplyPlan({
    context: ctx1,
    envelope,
    assignedActor,
    modelPort: orch.modelReplyPort,
    policyRevision: orch.policy.policyRevision,
    taskClass: orch.taskClass,
    citations,
  });
  emit('model-plan-created', 'orchestration-completed', {
    actor: assignedActor,
    dataClass: ctx1.dataClass,
  });
  const candidate = orch.modelReplyPort.draftReply(plan);

  // 11. Validate the draft (fabricated/versionless citation or raw body/CoT → refuse).
  const validated = validateReplyDraft(candidate, plan);
  if (!validated.ok) {
    return refuse('orchestration-draft-invalid');
  }

  // Double gate — re-read context; any state change after drafting prevents Core acceptance.
  const ctx2 = orch.contextPort.read();
  if (ctx2.cancelled) {
    return refuse('orchestration-cancelled');
  }
  if (ctx2.revision !== ctx1.revision || ctx2.partyType !== ctx1.partyType) {
    return refuse('orchestration-stale-revision');
  }
  const block2 = gateReason(
    orch,
    ctx2,
    assignAgent(ctx2.partyType, ctx2.humanTakeover, orch.policy),
  );
  if (block2 !== null) {
    return refuse(block2);
  }

  // 12. Proposal — PENDING_CORE_VALIDATION.
  const kind: OrchestrationProposalKind = 'REPLY';
  const proposal = createOrchestrationProposal({
    proposalId: `${runId}-reply`,
    proposalVersion: 1,
    conversationId: ctx1.conversationId,
    expectedRevision: ctx1.revision,
    assignedActor,
    partyType: ctx1.partyType,
    kind,
    structuredIntent: { taskClass: orch.taskClass, replyKind: kind },
    citations,
    replyBody: validated.draft.replyBody,
  });
  emit('proposal-created', 'orchestration-completed', { actor: assignedActor, proposalKind: kind });

  // 13. QuickFurno Core decision — a missing port fails closed to CORE_UNAVAILABLE (never fabricated).
  let outcome: CoreDecisionOutcome;
  if (orch.coreDecisionPort === undefined) {
    outcome = 'CORE_UNAVAILABLE';
  } else {
    emit('core-decision-requested', 'orchestration-completed', {
      actor: assignedActor,
      proposalKind: kind,
    });
    outcome = orch.coreDecisionPort.decide({
      proposalId: proposal.proposalId,
      proposalVersion: proposal.proposalVersion,
      conversationId: proposal.conversationId,
      expectedRevision: proposal.expectedRevision,
      assignedActor,
      partyType: ctx1.partyType,
      proposalKind: kind,
      structuredIntent: proposal.structuredIntent,
      policyRevision: orch.policy.policyRevision,
      evaluationRef: orch.modelReplyPort.evaluationRef,
      citations,
      proposedReplyBody: validated.draft.replyBody,
    }).outcome;
  }
  const decision = coreDecision(outcome, ctx1.conversationId, proposal.proposalId, ctx1.revision);
  emit('core-decision-received', 'orchestration-completed', {
    actor: assignedActor,
    coreOutcome: outcome,
  });
  emit('orchestration-completed', 'orchestration-completed', {
    actor: assignedActor,
    coreOutcome: outcome,
  });

  // 14–15. Immutable result. No transport, no side effect.
  return { ok: true, assignedActor, proposal, decision };
}
