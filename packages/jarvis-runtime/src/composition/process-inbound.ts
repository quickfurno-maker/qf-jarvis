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
import type {
  ModelReplyPromptBinding,
  ModelReplyStructuredOutputProfile,
} from '@qf-jarvis/model-reply-adapter';

import { anishaBehaviourPort } from './anisha-behaviour-adapter.js';
import { behaviourMux } from './behaviour-mux.js';
import { riyaBehaviourPort } from './riya-behaviour-adapter.js';
import { materializeCoreAuthorizedReply } from './materialize-core-authorized-reply.js';
import type { ConversationStateKey } from '../contracts/authoritative-state.js';
import type { JarvisCoreAuthorizedReplyResult } from '../contracts/core-authorized-reply.js';
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

/**
 * The shared-runtime implementation reference stamped into provenance when none is configured.
 *
 * Bumped again s3ib -> p08b1 because QFJ-P08-B1 materially changes how this composition ADDRESSES
 * authoritative state: every gate now reads a tenant-scoped `(tenantId, conversationId)` key instead
 * of a conversation id alone, which is a different isolation guarantee for every inbound turn.
 * Default provenance should name the implementation that actually ran, not the one that used to. An
 * explicit `config.provenanceRefs.runtimeRef` still overrides it untouched.
 */
const DEFAULT_RUNTIME_REF = 'qfj.jarvis-runtime.p08b1';

/** The default task class, kept in one place so the orchestrator and the behaviour port agree. */
const DEFAULT_TASK_CLASS = 'RESPONSE_GENERATION';

/**
 * The Riya-aware options for ONE internal run (RWC-P4B, ADR-0099).
 *
 * Internal. Supplied only by the Riya-aware public capability, so the ordinary inbound paths keep
 * exactly the prompt, schema and result they always had.
 */
export interface RiyaEvolutionRunOptions {
  readonly profile: ModelReplyStructuredOutputProfile;
  /** The DEDICATED evolution binding. Never the ordinary CLIENT reply prompt. */
  readonly promptBinding: ModelReplyPromptBinding;
  readonly taskClass: string;
}

/** One internal run's full output. The public methods project subsets of this. */
export interface InternalRunResult {
  readonly runtimeResult: JarvisRuntimeResult;
  readonly authorizedReply: JarvisCoreAuthorizedReplyResult['authorizedReply'];
  /** Whatever the Riya profile validated out of the SAME model call, or `undefined`. */
  readonly profileDetail: unknown;
}

/**
 * Compose M1–M4 for one envelope ONCE and report the run twice.
 *
 * This is the single execution primitive behind BOTH public runtime methods. `processInbound` and
 * `processInboundForCoreAuthorizedReply` each call it exactly once and differ only in how much of the
 * same result they hand back — there is no path on which one of them runs the pipeline again, makes a
 * second model call, or takes a second Core decision.
 */
export async function composeAndProcessInternal(
  config: JarvisRuntimeConfig,
  envelope: InboundEnvelope,
  riya?: RiyaEvolutionRunOptions,
): Promise<InternalRunResult> {
  const hook: JarvisRuntimeObservabilityHook =
    config.observability ?? NOOP_JARVIS_RUNTIME_OBSERVABILITY;
  // The canonical run identifier (ADR-0069), shared with M2/M4 rather than rebuilt here. It replaces
  // the old `conversationId-messageId` concatenation, which could reach 257 characters and had no
  // bound of its own even though every field it fed did.
  const runId = envelope.runtimeId;
  const conversationId = envelope.conversationId;
  // The ONE tenant-scoped key, derived once from the validated envelope (QFJ-P08-B1, ADR-0076) and
  // handed to every projection below. Deriving it per adapter -- or re-deriving the tenant from what
  // the source returned -- would be two scopes for one turn, which is the addressing bug this fixes.
  const stateKey: ConversationStateKey = Object.freeze({
    tenantId: envelope.tenantId,
    conversationId,
  });
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

  /**
   * Captured from the ONE model call, by the wrapper below. Function-scoped on purpose: a
   * module-level capture would let two concurrent runtime calls see one another observations.
   */
  let capturedProfileDetail: unknown;

  /**
   * Every non-accepting exit. There is exactly one place in this function that materializes a body,
   * and exactly one that releases a captured profile detail — this is neither.
   *
   * The detail is deliberately DROPPED here, not forwarded. M4 releases it only after its own gates,
   * but M4 returns before M2's final double gate runs: the authoritative state can change in that
   * window, and the orchestration can then refuse for a stale revision, a takeover, a pause or a
   * cancellation. Forwarding the detail from a refused run would let observations extracted during
   * that window survive a gate the run itself did not pass — and the service would persist them.
   *
   * Independence from the CORE decision (ADR-0099 §12) is a different thing and is unaffected: a
   * Core rejection still arrives on a SUCCESSFUL orchestration, which returns below.
   */
  const withoutReply = (runtimeResult: JarvisRuntimeResult): InternalRunResult =>
    Object.freeze({
      runtimeResult,
      authorizedReply: undefined,
      profileDetail: undefined,
    });

  emit('jarvis-inbound-received', undefined, undefined);

  // Project the ONE authoritative source into every lower reader (no split-brain).
  const contextPort = conversationContextPortFor(source, stateKey);
  const replyStateReader = replyStateReaderFor(source, stateKey, config.policy);
  const coreStateReader = coreStateReaderFor(source, stateKey);
  const privacyGate = privacyGateFor(source, stateKey);

  // M4 model reply adapter (existing gateway stays the only routing authority).
  const modelReplyAdapter =
    riya === undefined
      ? createModelReplyAdapter({
          release: config.release,
          ...(config.promptFamily === undefined ? {} : { promptFamily: config.promptFamily }),
          ...(config.promptVersion === undefined ? {} : { promptVersion: config.promptVersion }),
          ...(config.promptBindings === undefined ? {} : { promptBindings: config.promptBindings }),
          capabilityProfileRef: config.capabilityProfileRef,
          ...(config.evaluationRef === undefined ? {} : { evaluationRef: config.evaluationRef }),
          // Passed straight through: jarvis-runtime never resolves a prompt itself. Resolution
          // belongs to M4, after its own first state gate (ADR-0073).
          ...(config.promptRegistry === undefined ? {} : { promptRegistry: config.promptRegistry }),
          ...(config.evaluationPromptDigest === undefined
            ? {}
            : { evaluationPromptDigest: config.evaluationPromptDigest }),
          stateReader: replyStateReader,
          clock: config.clock,
          ...(config.gatewayInvoker === undefined ? {} : { invoker: config.gatewayInvoker }),
        })
      : // The Riya-aware adapter. It binds the DEDICATED evolution prompt for CLIENT and nothing
        // else -- no legacy prompt fields, and deliberately no other scope, so a missing evolution
        // binding cannot silently borrow the ordinary reply prompt or another agent prompt.
        createModelReplyAdapter({
          release: config.release,
          promptBindings: { CLIENT: riya.promptBinding },
          capabilityProfileRef: config.capabilityProfileRef,
          ...(config.promptRegistry === undefined ? {} : { promptRegistry: config.promptRegistry }),
          stateReader: replyStateReader,
          clock: config.clock,
          structuredOutputProfile: riya.profile,
          ...(config.gatewayInvoker === undefined ? {} : { invoker: config.gatewayInvoker }),
        });

  // The capturing wrapper. `draftReply` delegates to `draftReplyDetailed` ONCE and returns only the
  // M2 draft, so the orchestrator sees exactly what it always saw. Calling both would invoke the
  // gateway twice, which is the one thing this whole design exists to prevent.
  const modelReplyPort =
    riya === undefined
      ? modelReplyAdapter
      : {
          ...modelReplyAdapter,
          async draftReply(plan: Parameters<typeof modelReplyAdapter.draftReply>[0]) {
            const detailed = await modelReplyAdapter.draftReplyDetailed(plan);
            capturedProfileDetail = detailed.profileDetail;
            return detailed.draft;
          },
        };

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
  // The Riya-aware run uses its DEDICATED task class, so the prompt registry resolves the
  // evaluated evolution definition rather than a reply-only one that happens to share the scope.
  const taskClass = riya?.taskClass ?? config.taskClass ?? DEFAULT_TASK_CLASS;
  const behaviourPort = behaviourMux({
    ...(config.behaviourInput === undefined
      ? {}
      : { riya: riyaBehaviourPort(config.behaviourInput, source, stateKey, taskClass) }),
    ...(config.vendorJourneyBehaviourInput === undefined
      ? {}
      : {
          anisha: anishaBehaviourPort(
            config.vendorJourneyBehaviourInput,
            source,
            stateKey,
            taskClass,
          ),
        }),
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
    return withoutReply(res);
  }

  const result = turn.outcome;
  const provenance = turn.provenance;

  if (!result.ok) {
    const res = frozen('REFUSED', { refusalReason: result.reason, provenance });
    emit('jarvis-refused', res.outcome, res);
    return withoutReply(res);
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
  // The ONE materialization point, after the completed run and after the observability emit — the
  // hook is handed `res`, which carries no body, exactly as before.
  return Object.freeze({
    runtimeResult: res,
    authorizedReply: materializeCoreAuthorizedReply(
      outcome,
      result.proposal,
      result.decision.boundRevision,
    ),
    profileDetail: capturedProfileDetail,
  });
}

/**
 * The ordinary detailed run. Projects the internal result to the P2D contract exactly.
 *
 * No Riya options are passed, so the prompt, schema, user message and result shape are the ones this
 * path always had -- and no profile detail can exist to project.
 */
export async function composeAndProcessDetailed(
  config: JarvisRuntimeConfig,
  envelope: InboundEnvelope,
): Promise<JarvisCoreAuthorizedReplyResult> {
  const run = await composeAndProcessInternal(config, envelope);
  return Object.freeze({
    runtimeResult: run.runtimeResult,
    authorizedReply: run.authorizedReply,
  });
}

/**
 * Compose M1–M4 for one envelope and return ONLY the closed, content-free runtime result.
 *
 * The original M5 entry point, unchanged in behaviour and in result shape. It delegates to the one
 * detailed primitive and drops the materialization — it does not re-run anything.
 */
export async function composeAndProcess(
  config: JarvisRuntimeConfig,
  envelope: InboundEnvelope,
): Promise<JarvisRuntimeResult> {
  return (await composeAndProcessDetailed(config, envelope)).runtimeResult;
}
