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
import type {
  AgentTurnResult,
  CoreDecisionOutcome,
  InboundEnvelope,
} from '@qf-jarvis/agent-runtime';
import { createOrchestrator, runAgentTurn } from '@qf-jarvis/agent-runtime';
import { createCoreDecisionAdapter } from '@qf-jarvis/core-decision-adapter';
import { createModelReplyAdapter } from '@qf-jarvis/model-reply-adapter';

import { anishaBehaviourPort } from './anisha-behaviour-adapter.js';
import { behaviourMux } from './behaviour-mux.js';
import { riyaBehaviourPort } from './riya-behaviour-adapter.js';
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

const CORE_OUTCOME_MAP: Readonly<Record<CoreDecisionOutcome, JarvisRuntimeOutcome>> = Object.freeze(
  {
    ACCEPTED: 'CORE_ACCEPTED',
    REJECTED: 'CORE_REJECTED',
    HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
    RETRY_LATER: 'RETRY_LATER',
    STALE_REVISION: 'STALE_REVISION',
    CORE_UNAVAILABLE: 'CORE_UNAVAILABLE',
  },
);

/** The shared-runtime implementation reference stamped into provenance when none is configured. */
/**
 * The shared-runtime implementation reference stamped into provenance when none is configured.
 *
 * Bumped s3cb -> s3db because S3-D-B materially changes what this composition IS: a second bounded
 * business-agent bridge behind a deterministic selector. Default provenance should name the
 * implementation that actually ran, not the one that used to. An explicit
 * `config.provenanceRefs.runtimeRef` still overrides it untouched.
 */
const DEFAULT_RUNTIME_REF = 'qfj.jarvis-runtime.s3db';

/** The default task class, kept in one place so the orchestrator and the behaviour port agree. */
const DEFAULT_TASK_CLASS = 'RESPONSE_GENERATION';

/** Compose M1–M4 for one envelope and return the closed, frozen runtime result. */
export async function composeAndProcess(
  config: JarvisRuntimeConfig,
  envelope: InboundEnvelope,
): Promise<JarvisRuntimeResult> {
  const hook: JarvisRuntimeObservabilityHook =
    config.observability ?? NOOP_JARVIS_RUNTIME_OBSERVABILITY;
  // The canonical run identifier (ADR-0069), shared with M2/M4 rather than rebuilt here. It replaces
  // the old `conversationId-messageId` concatenation, which could reach 257 characters and had no
  // bound of its own even though every field it fed did.
  const runId = envelope.runtimeId;
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
    fields: Partial<
      Omit<JarvisRuntimeResult, 'outcome' | 'runId' | 'conversationId' | 'coreConsulted'>
    >,
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
      provenance: fields.provenance,
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

  // The behaviour seam — at most ONE port reaches the orchestrator. Each agent adapter is built only
  // when its own input port is injected, and a deterministic mux selects exactly one of them per turn
  // from the actor/party pair the merged router decided. With neither configured the mux is absent
  // and the orchestrator uses its legacy eligible/`REPLY` default, unchanged.
  const taskClass = config.taskClass ?? DEFAULT_TASK_CLASS;
  const behaviourPort = behaviourMux({
    ...(config.behaviourInput === undefined
      ? {}
      : { riya: riyaBehaviourPort(config.behaviourInput, source, taskClass) }),
    ...(config.vendorJourneyBehaviourInput === undefined
      ? {}
      : { anisha: anishaBehaviourPort(config.vendorJourneyBehaviourInput, source, taskClass) }),
  });

  // M2 orchestrator — the existing double-gated processing order over the injected ports.
  const orch = createOrchestrator({
    policy: config.policy,
    contextPort,
    modelReplyPort,
    ...(coreDecisionPort === undefined ? {} : { coreDecisionPort }),
    privacyGate,
    ...(config.knowledgePort === undefined ? {} : { knowledgePort: config.knowledgePort }),
    taskClass,
    ...(config.knowledgeTopics === undefined ? {} : { knowledgeTopics: config.knowledgeTopics }),
    ...(config.requireEvaluationRef === undefined
      ? {}
      : { requireEvaluationRef: config.requireEvaluationRef }),
    ...(behaviourPort === undefined ? {} : { behaviourPort }),
  });

  emit('jarvis-composition-started', undefined, undefined);

  // ONE agent turn: `runAgentTurn` delegates to `orchestrateInbound` exactly once and stamps the
  // provenance sibling. The orchestrator is never invoked separately — one turn, one pipeline.
  const refs = config.provenanceRefs;
  let turn: AgentTurnResult;
  try {
    turn = await runAgentTurn(orch, {
      envelope,
      provenance: {
        runtimeRef: refs?.runtimeRef ?? DEFAULT_RUNTIME_REF,
        policyRef: refs?.policyRef ?? config.policy.policyRevision,
        ...(refs?.promptRef === undefined ? {} : { promptRef: refs.promptRef }),
        ...(refs?.modelRef === undefined ? {} : { modelRef: refs.modelRef }),
        ...(refs?.providerRef === undefined ? {} : { providerRef: refs.providerRef }),
        releaseRef: refs?.releaseRef ?? config.release.releaseId,
        configRef: refs?.configRef ?? config.release.configDigest,
        // `envelope.messageId`, and deliberately none of the others. Since ADR-0069 the canonical
        // `runId` IS `envelope.runtimeId` — it no longer concatenates anything — but it remains a
        // different identity from the audit correlation, and collapsing the two would make one
        // contract's change silently rewrite the other's meaning. `config.correlationId` is a third
        // identity again: it belongs to the M3 Core adapter and stays there.
        correlationId: refs?.correlationId ?? envelope.messageId,
        occurredAt: config.clock(),
      },
    });
  } catch {
    // A rejected turn — including a provenance record that could not be built from unsafe references
    // — fails closed with no raw error, no retry, no second run, and no fabricated provenance.
    const res = frozen('REFUSED', { refusalReason: 'orchestration-invariant' });
    emit('jarvis-refused', res.outcome, res);
    return res;
  }

  const result = turn.outcome;
  const provenance = turn.provenance;

  if (!result.ok) {
    const res = frozen('REFUSED', { refusalReason: result.reason, provenance });
    emit('jarvis-refused', res.outcome, res);
    return res;
  }

  // A valid proposal + decision. A proposal with no reply body was produced without a model draft.
  const modelDrafted = result.proposal.replyBody !== undefined;
  const outcome: JarvisRuntimeOutcome = coreConsulted
    ? CORE_OUTCOME_MAP[result.decision.outcome]
    : // Core deferred: a drafted reply is MODEL_DRAFTED, a no-model proposal is NO_ACTION — the value
      // ADR-0059 reserved for exactly this case rather than a new outcome.
      modelDrafted
      ? 'MODEL_DRAFTED'
      : 'NO_ACTION';
  const res = frozen(outcome, {
    boundRevision: result.decision.boundRevision,
    assignedActor: result.assignedActor,
    proposalId: result.proposal.proposalId,
    modelDrafted,
    provenance,
  });
  emit('jarvis-completed', res.outcome, res);
  return res;
}
