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
import { z } from 'zod';

import type { InboundEnvelope } from '../contracts/inbound-envelope.js';
import type { ConversationPrivacyGate } from '../contracts/privacy-gate.js';
import type { RuntimePolicy } from '../contracts/policy.js';
import { assignAgent } from '../router/assign-agent.js';
import { AI_AGENT_ACTORS } from '../contracts/vocabularies.js';
import type { RuntimeActor } from '../contracts/vocabularies.js';
import { coreDecision, createOrchestrationProposal } from './contracts.js';
import type { KnowledgeCitation, OrchestrationContext, OrchestrationResult } from './contracts.js';
import type { BehaviourDecision, BehaviourDecisionPort } from './behaviour-port.js';
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
import { ORCHESTRATION_PROPOSAL_KINDS } from './vocabularies.js';
import type { CoreDecisionOutcome, OrchestrationReason } from './vocabularies.js';

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
  /** Optional behaviour seam (ADR-0068). Absent -> the legacy eligible/`REPLY` default. */
  readonly behaviourPort?: BehaviourDecisionPort;
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
  readonly behaviourPort: BehaviourDecisionPort | undefined;
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
    behaviourPort: config.behaviourPort,
  });
}

/**
 * The behaviour decision the orchestrator has always implicitly made: reply, and ask a model to draft
 * it. Used verbatim when no behaviour port is configured, so an unwired runtime is byte-identical to
 * the pre-ADR-0068 pipeline.
 */
function legacyBehaviour(taskClass: string): BehaviourDecision {
  return Object.freeze({
    modelReplyEligible: true,
    proposalKind: 'REPLY' as const,
    structuredIntent: Object.freeze({ taskClass, replyKind: 'REPLY' }),
  });
}

/** The exact own keys a behaviour decision may carry. An unknown field is a refusal, not a passenger. */
const BEHAVIOUR_DECISION_KEYS = ['modelReplyEligible', 'proposalKind', 'structuredIntent'] as const;

/** The intent key grammar, identical to the one `createOrchestrationProposal` enforces downstream. */
const INTENT_KEY = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * One bounded intent value.
 *
 * Deliberately narrower than the downstream schema in one respect: a non-finite number is refused
 * here. `z.number()` accepts `Infinity`, and a proposal field that cannot be serialized to a finite
 * value has no business travelling to Core. Being stricter BEFORE the model can only fail closed
 * earlier, never later.
 */
const intentValueSchema = z.union([
  z.boolean(),
  z.number().refine((value) => Number.isFinite(value)),
  z.string().max(1024),
]);

/**
 * A plain, own-keys-only object.
 *
 * Arrays are excluded because their indices (`"0"`, `"1"`, …) satisfy the intent-key grammar, so an
 * array of primitives would otherwise validate as a record and reach the proposal. An inherited
 * enumerable key is excluded because it does not appear in `Object.keys` yet would still be visible
 * to a downstream spread or serializer — validating one view of an object and forwarding another is
 * exactly the gap this check exists to close.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return false;
  }
  const own = new Set(Object.keys(value));
  for (const key in value) {
    if (!own.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * True iff a value is a structurally valid behaviour decision.
 *
 * This runs BEFORE knowledge retrieval and before the sole model call, and it validates the WHOLE
 * decision — including every intent key and value — rather than deferring to
 * `createOrchestrationProposal`. Deferring would mean a malformed decision could still cost a
 * knowledge read and a model invocation before being rejected at the very end, which is precisely
 * the guarantee this stage exists to hold. It does not loosen the downstream schema; it front-runs it.
 */
function isBehaviourDecision(value: unknown): value is BehaviourDecision {
  if (!isPlainRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== BEHAVIOUR_DECISION_KEYS.length ||
    !BEHAVIOUR_DECISION_KEYS.every((key) => keys.includes(key))
  ) {
    return false;
  }
  if (typeof value['modelReplyEligible'] !== 'boolean') {
    return false;
  }
  const kind: unknown = value['proposalKind'];
  if (
    typeof kind !== 'string' ||
    !(ORCHESTRATION_PROPOSAL_KINDS as readonly string[]).includes(kind)
  ) {
    return false;
  }
  const intent: unknown = value['structuredIntent'];
  if (!isPlainRecord(intent)) {
    return false;
  }
  return Object.entries(intent).every(
    ([key, entry]) => INTENT_KEY.test(key) && intentValueSchema.safeParse(entry).success,
  );
}

/** The first/second gate: the first content-free reason a context blocks the AI reply path, or null. */
async function gateReason(
  orch: Orchestrator,
  context: OrchestrationContext,
  assignedActor: RuntimeActor,
): Promise<OrchestrationReason | null> {
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
    if ((await orch.privacyGate.subjectStatus(context.subjectRef)) !== 'clear') {
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
export async function orchestrateInbound(
  orch: Orchestrator,
  envelope: InboundEnvelope,
): Promise<OrchestrationResult> {
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
  const ctx1 = await orch.contextPort.read();
  if (
    envelope.conversationId !== ctx1.conversationId ||
    envelope.tenantId !== ctx1.tenantId ||
    envelope.partyType !== ctx1.partyType
  ) {
    return refuse('orchestration-envelope-invalid');
  }

  const assignedActor = assignAgent(ctx1.partyType, ctx1.humanTakeover, orch.policy);

  // 3–7. First gate — before any knowledge/model access.
  const block1 = await gateReason(orch, ctx1, assignedActor);
  if (block1 !== null) {
    emit('model-invocation-skipped', block1, { actor: assignedActor, dataClass: ctx1.dataClass });
    return refuse(block1);
  }

  // 7b. Behaviour decision (ADR-0068) — AFTER the complete first gate, so a blocked conversation
  // never reaches a behaviour port, and BEFORE knowledge/model, so an ineligible turn costs nothing.
  let behaviour: BehaviourDecision;
  if (orch.behaviourPort === undefined) {
    behaviour = legacyBehaviour(orch.taskClass);
  } else {
    let decided: BehaviourDecision | undefined;
    try {
      decided = await orch.behaviourPort.decide({
        conversationId: ctx1.conversationId,
        partyType: ctx1.partyType,
        assignedActor,
        revision: ctx1.revision,
      });
    } catch {
      // A rejected behaviour port fails closed with no raw error, exactly like the model and Core.
      emit('model-invocation-skipped', 'orchestration-invariant', { actor: assignedActor });
      return refuse('orchestration-invariant');
    }
    if (decided === undefined) {
      behaviour = legacyBehaviour(orch.taskClass);
    } else if (!isBehaviourDecision(decided)) {
      emit('model-invocation-skipped', 'orchestration-invariant', { actor: assignedActor });
      return refuse('orchestration-invariant');
    } else {
      behaviour = decided;
    }
  }

  // 8. Exact knowledge retrieval — only on the model path, and only when a port is configured.
  let citations: KnowledgeCitation[] = [];
  let replyBody: string | undefined;

  if (behaviour.modelReplyEligible) {
    if (orch.knowledgePort !== undefined) {
      const kres = await orch.knowledgePort.retrieve({
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
    // A rejected model Promise fails closed — it is never an unhandled rejection or a raw error.
    let candidate: unknown;
    try {
      candidate = await orch.modelReplyPort.draftReply(plan);
    } catch {
      return refuse('orchestration-model-unavailable');
    }

    // 11. Validate the draft (fabricated/versionless citation or raw body/CoT → refuse).
    const validated = validateReplyDraft(candidate, plan);
    if (!validated.ok) {
      return refuse('orchestration-draft-invalid');
    }
    replyBody = validated.draft.replyBody;
  } else {
    // Ineligible: no knowledge retrieval, no plan, no invocation, no draft to validate. The proposal
    // below carries no reply body, and the double gate still runs — a refusal is not a shortcut.
    emit('model-invocation-skipped', 'orchestration-completed', {
      actor: assignedActor,
      dataClass: ctx1.dataClass,
    });
  }

  // Double gate — re-read context; any state change after drafting prevents Core acceptance.
  const ctx2 = await orch.contextPort.read();
  if (ctx2.cancelled) {
    return refuse('orchestration-cancelled');
  }
  if (ctx2.revision !== ctx1.revision || ctx2.partyType !== ctx1.partyType) {
    return refuse('orchestration-stale-revision');
  }
  const block2 = await gateReason(
    orch,
    ctx2,
    assignAgent(ctx2.partyType, ctx2.humanTakeover, orch.policy),
  );
  if (block2 !== null) {
    return refuse(block2);
  }

  // 12. Proposal — PENDING_CORE_VALIDATION. Kind and intent come from the behaviour decision; every
  // other field, and the authority status, remain owned by the merged contract.
  const kind = behaviour.proposalKind;
  const proposal = createOrchestrationProposal({
    proposalId: `${runId}-reply`,
    proposalVersion: 1,
    conversationId: ctx1.conversationId,
    expectedRevision: ctx1.revision,
    assignedActor,
    partyType: ctx1.partyType,
    kind,
    structuredIntent: behaviour.structuredIntent,
    citations,
    replyBody,
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
    // A rejected Core Promise fails closed to CORE_UNAVAILABLE — never fabricated, never a raw error.
    try {
      const coreResponse = await orch.coreDecisionPort.decide({
        proposalId: proposal.proposalId,
        proposalVersion: proposal.proposalVersion,
        conversationId: proposal.conversationId,
        expectedRevision: proposal.expectedRevision,
        assignedActor,
        partyType: ctx1.partyType,
        proposalKind: kind,
        structuredIntent: proposal.structuredIntent,
        policyRevision: orch.policy.policyRevision,
        evaluationRef: orch.modelReplyPort?.evaluationRef,
        citations,
        proposedReplyBody: replyBody,
      });
      outcome = coreResponse.outcome;
    } catch {
      outcome = 'CORE_UNAVAILABLE';
    }
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
