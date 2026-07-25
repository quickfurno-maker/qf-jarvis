/**
 * The M5 composed inbound flow (QFJ-M5, ADR-0059 §E, §F, §H).
 *
 * One deterministic, fail-closed, async end-to-end run: it projects the ONE authoritative state source
 * into every lower reader, builds the M4 model reply adapter and (when a transport is wired) the M3
 * Core decision adapter, composes them into the M2 orchestrator, awaits the orchestration, and maps the
 * result to a closed, deeply-frozen `JarvisRuntimeResult`. It duplicates NO business rule — assignment,
 * privacy, knowledge, model routing, reply validation, the double gate, and Core validation all run in
 * the lower packages. A rejected Promise anywhere is normalized to a fail-closed REFUSED with no raw
 * error. Nothing is sent, delivered, executed, or persisted.
 */
import type { CoreDecisionOutcome, InboundEnvelope, OrchestrationResult } from '@qf-jarvis/agent-runtime';
import { createOrchestrator, orchestrateInbound } from '@qf-jarvis/agent-runtime';
import { createCoreDecisionAdapter } from '@qf-jarvis/core-decision-adapter';
import { createModelReplyAdapter } from '@qf-jarvis/model-reply-adapter';

import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import type { JarvisRuntimeOutcome } from '../contracts/reasons.js';
import type {
  JarvisRuntimeEventType,
  JarvisRuntimeObservabilityHook,
} from '../contracts/observability.js';
import { NOOP_JARVIS_RUNTIME_OBSERVABILITY } from '../contracts/observability.js';
import {
  conversationContextPortFor,
  coreStateReaderFor,
  privacyGateFor,
  replyStateReaderFor,
} from './state-adapters.js';

const CORE_OUTCOME_MAP: Readonly<Record<CoreDecisionOutcome, JarvisRuntimeOutcome>> = Object.freeze({
  ACCEPTED: 'CORE_ACCEPTED',
  REJECTED: 'CORE_REJECTED',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  RETRY_LATER: 'RETRY_LATER',
  STALE_REVISION: 'STALE_REVISION',
  CORE_UNAVAILABLE: 'CORE_UNAVAILABLE',
});

/** Compose M1–M4 for one envelope and return the closed, frozen runtime result. */
export async function composeAndProcess(
  config: JarvisRuntimeConfig,
  envelope: InboundEnvelope,
): Promise<JarvisRuntimeResult> {
  const hook: JarvisRuntimeObservabilityHook =
    config.observability ?? NOOP_JARVIS_RUNTIME_OBSERVABILITY;
  const runId = `${envelope.conversationId}-${envelope.messageId}`;
  const conversationId = envelope.conversationId;
  const source = config.authoritativeState;
  const coreConsulted = config.coreTransport !== undefined;

  const emit = (
    type: JarvisRuntimeEventType,
    outcome: JarvisRuntimeOutcome | undefined,
    result: JarvisRuntimeResult | undefined,
  ): void => {
    hook.onEvent(
      Object.freeze({
        type,
        runId,
        conversationId,
        partyType: envelope.partyType,
        assignedActor: result?.assignedActor,
        boundRevision: result?.boundRevision,
        outcome,
        reason: result?.refusalReason,
        observedAt: config.clock(),
      }),
    );
  };

  const frozen = (
    outcome: JarvisRuntimeOutcome,
    fields: Partial<Omit<JarvisRuntimeResult, 'outcome' | 'runId' | 'conversationId' | 'coreConsulted'>>,
  ): JarvisRuntimeResult =>
    Object.freeze({
      outcome,
      runId,
      conversationId,
      boundRevision: fields.boundRevision,
      assignedActor: fields.assignedActor,
      proposalId: fields.proposalId,
      modelDrafted: fields.modelDrafted ?? false,
      coreConsulted,
      refusalReason: fields.refusalReason,
    });

  emit('jarvis-inbound-received', undefined, undefined);

  // Project the ONE authoritative source into every lower reader (no split-brain).
  const contextPort = conversationContextPortFor(source, conversationId);
  const replyStateReader = replyStateReaderFor(source, conversationId, config.policy);
  const coreStateReader = coreStateReaderFor(source, conversationId);
  const privacyGate = privacyGateFor(source, conversationId);

  // M4 model reply adapter (existing gateway stays the only routing authority).
  const modelReplyPort = createModelReplyAdapter({
    release: config.release,
    promptFamily: config.promptFamily,
    promptVersion: config.promptVersion,
    capabilityProfileRef: config.capabilityProfileRef,
    ...(config.evaluationRef === undefined ? {} : { evaluationRef: config.evaluationRef }),
    stateReader: replyStateReader,
    clock: config.clock,
    ...(config.gatewayInvoker === undefined ? {} : { invoker: config.gatewayInvoker }),
  });

  // M3 Core decision adapter — only when a transport is wired; otherwise the decision is deferred.
  const coreDecisionPort = coreConsulted
    ? createCoreDecisionAdapter({
        stateReader: coreStateReader,
        clock: config.clock,
        transport: config.coreTransport,
        ...(config.coreProtocol === undefined ? {} : { protocol: config.coreProtocol }),
        ...(config.correlationId === undefined ? {} : { correlationId: config.correlationId }),
      })
    : undefined;

  // M2 orchestrator — the existing double-gated processing order over the injected ports.
  const orch = createOrchestrator({
    policy: config.policy,
    contextPort,
    modelReplyPort,
    ...(coreDecisionPort === undefined ? {} : { coreDecisionPort }),
    privacyGate,
    ...(config.knowledgePort === undefined ? {} : { knowledgePort: config.knowledgePort }),
    ...(config.taskClass === undefined ? {} : { taskClass: config.taskClass }),
    ...(config.knowledgeTopics === undefined ? {} : { knowledgeTopics: config.knowledgeTopics }),
    ...(config.requireEvaluationRef === undefined
      ? {}
      : { requireEvaluationRef: config.requireEvaluationRef }),
  });

  emit('jarvis-composition-started', undefined, undefined);

  // Await the whole flow; a rejected Promise anywhere fails closed with no raw error.
  let result: OrchestrationResult;
  try {
    result = await orchestrateInbound(orch, envelope);
  } catch {
    const res = frozen('REFUSED', { refusalReason: 'orchestration-invariant' });
    emit('jarvis-refused', res.outcome, res);
    return res;
  }

  if (!result.ok) {
    const res = frozen('REFUSED', { refusalReason: result.reason });
    emit('jarvis-refused', res.outcome, res);
    return res;
  }

  // A valid proposal + decision. Map the Core outcome, or MODEL_DRAFTED when Core was deferred.
  const outcome: JarvisRuntimeOutcome = coreConsulted
    ? CORE_OUTCOME_MAP[result.decision.outcome]
    : 'MODEL_DRAFTED';
  const res = frozen(outcome, {
    boundRevision: result.decision.boundRevision,
    assignedActor: result.assignedActor,
    proposalId: result.proposal.proposalId,
    modelDrafted: true,
  });
  emit('jarvis-completed', res.outcome, res);
  return res;
}
