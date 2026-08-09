/**
 * The M5 Jarvis runtime composition root (QFJ-M5, ADR-0059 §A, §B, §G; QFJ-P08-A, ADR-0075).
 *
 * `createJarvisRuntime(config)` validates the mandatory injected dependencies (fail closed at
 * construction), then returns a frozen runtime with exactly five programmatic methods:
 *
 * - `processInbound` — the ONE pre-transport inbound composition entry point, composing M1–M4 for one
 *   envelope behind the ONE authoritative state source. Its behaviour is unchanged by ADR-0075;
 * - `processInboundForCoreAuthorizedReply` — the RWC-P2D content-bearing sibling (ADR-0096). The SAME
 *   single composition, reported with the Core-authorized body attached. Separate because
 *   `processInbound`'s result is deliberately content-free and callers may log it whole;
 * - `processInboundForRiyaConversationEvolution` — the RWC-P4B Riya-aware sibling (ADR-0099). The
 *   SAME single composition, whose ONE model call also produces this turn's bounded discovery
 *   observations. Separate for the same reason as above, and it persists nothing;
 * - `applyConversationControlCommand` — the operator control entry point (ADR-0074 semantics, applied
 *   by the authoritative source itself);
 * - `readConversationOperationsSnapshot` — the operator query entry point.
 *
 * All three address state through the SAME `config.authoritativeState` object and, since QFJ-P08-B1
 * (ADR-0076), through the same tenant-scoped `(tenantId, conversationId)` key. That is the point: a
 * separate writable
 * store would let an operator set a takeover on one object while the next inbound turn read another
 * and kept replying. The two operator methods are OPTIONAL capabilities detected on that object, so a
 * read-only source stays valid and existing inbound composition is untouched.
 *
 * Still no send/deliver/execute/persist/authorize/approve/callN8n method, no HTTP route, no
 * authentication, no UI, no database and no global mutable state. `operatorRef` is attribution, not
 * proof of identity — a future operator API must authenticate and authorize before calling in.
 * QuickFurno Core remains the only business authority; model output is a draft only.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import {
  createRiyaConversationModelProfile,
  createRiyaGroundedReplyModelProfile,
} from '@qf-jarvis/riya-model-interaction';
import {
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_REPLY_TASK_CLASS,
  parseRiyaModelProfileDetail,
} from '@qf-jarvis/riya-model-interaction';
import type { JarvisCoreAuthorizedReplyResult } from '../contracts/core-authorized-reply.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import { assertMandatoryDependencies } from './validate-composition.js';
import { composeAndProcessDetailed, composeAndProcessInternal } from './process-inbound.js';
import { provenRiyaRunInput } from './riya-run-input.js';
import type {
  JarvisRiyaConversationEvolutionInput,
  JarvisRiyaConversationEvolutionResult,
} from '../contracts/riya-conversation-evolution.js';
import type {
  JarvisRiyaGroundedReplyInput,
  JarvisRiyaGroundedReplyResult,
} from '../contracts/riya-grounded-reply.js';
import { createRiyaGroundedKnowledgeBridge } from './riya-grounded-knowledge.js';
import {
  applyControlCommandThroughSource,
  type JarvisConversationControlInput,
  type JarvisConversationControlResult,
} from './control-surface.js';
import {
  readOperationsSnapshotThroughSource,
  type ConversationOperationsQueryInput,
  type JarvisConversationOperationsResult,
} from './operations-snapshot.js';

/** The immutable Jarvis runtime: one inbound entry point plus two operator entry points. */
export interface JarvisRuntime {
  processInbound(envelope: InboundEnvelope): Promise<JarvisRuntimeResult>;
  /**
   * Apply one operator control command, TENANT-SCOPED (QFJ-P08-B1, ADR-0076). Takes INPUT, not a
   * pre-built command, so the composition boundary itself validates — untrusted structural input
   * cannot reach the authoritative source having skipped `createConversationControlCommand`.
   */
  applyConversationControlCommand(
    input: JarvisConversationControlInput,
  ): Promise<JarvisConversationControlResult>;
  /** Read one conversation's validated, content-free operations snapshot. A query, not a console. */
  readConversationOperationsSnapshot(
    input: ConversationOperationsQueryInput,
  ): Promise<JarvisConversationOperationsResult>;
}

/**
 * The runtime plus the ONE explicit content-bearing capability (RWC-P2D, ADR-0096).
 *
 * A fourth concrete method rather than a fourth field on `JarvisRuntimeResult`. `processInbound`
 * keeps its exact result shape and stays safe to log whole; a caller that needs the Core-authorized
 * text has to name a method that says so. Both methods perform ONE orchestration run each — calling
 * this one is not "processInbound plus extra work", it is the same work reported more fully.
 *
 * It extends `JarvisRuntime`, so every existing consumer typed against the three-method contract
 * keeps working untouched and no second factory exists.
 */
export interface CoreAuthorizedReplyJarvisRuntime extends JarvisRuntime {
  /**
   * Process one inbound envelope and additionally return the Core-authorized body when — and only
   * when — the final M3 decision was `ACCEPTED` for a text-carrying proposal that has one.
   *
   * `CORE_ACCEPTED` is authorization, never delivery. Nothing is sent, rendered or persisted here.
   */
  processInboundForCoreAuthorizedReply(
    envelope: InboundEnvelope,
  ): Promise<JarvisCoreAuthorizedReplyResult>;
}

/**
 * The runtime plus the Riya conversation-evolution capability (RWC-P4B, ADR-0099).
 *
 * A fifth concrete method, additive in exactly the way RWC-P2D's fourth was. It extends the
 * Core-authorized-reply runtime, so every consumer typed against `JarvisRuntime` or
 * `CoreAuthorizedReplyJarvisRuntime` keeps working untouched and there is still one factory.
 *
 * ONE call performs ONE orchestration: one model-gateway invocation, at most one Core decision. It
 * does not call either older method internally — that would be a second run.
 */
export interface RiyaConversationEvolutionJarvisRuntime extends CoreAuthorizedReplyJarvisRuntime {
  /**
   * Process one inbound Riya turn and additionally return the observations the SAME model call
   * produced.
   *
   * Fails closed before the gateway on a non-canonical envelope, a non-canonical continuity, a
   * non-canonical Core availability snapshot, a tenant/conversation mismatch against the envelope, a
   * phase RWC-P4A does not own, or a missing/unevaluated dedicated evolution prompt binding. Nothing
   * is read from Core, sent, persisted or authorized here.
   */
  processInboundForRiyaConversationEvolution(
    input: JarvisRiyaConversationEvolutionInput,
  ): Promise<JarvisRiyaConversationEvolutionResult>;

  /**
   * Answer ONE post-summary Riya text turn from governed knowledge (RWC-P7, ADR-0103).
   *
   * A sixth concrete method, additive exactly as the fourth and fifth were. It owns `CONTACT`,
   * `CONSENT` and `COMPLETE` and refuses every earlier phase; the RWC-P4B method keeps
   * `INTRO`..`SUMMARY` and its refusal of these three is unchanged.
   *
   * One model call, one governed retrieval, and NO state change of any kind: no observations, no
   * phase move, no `summaryConfirmed`, no consent, no completion evidence. A client typing "yes"
   * cannot become an RWC-P6 structured action, because the schema this method uses has nowhere to
   * express one.
   *
   * Fails closed before the gateway on a non-canonical envelope, continuity or availability
   * snapshot, a tenant/conversation mismatch, an `INTRO`..`SUMMARY` phase, absent grounded knowledge
   * configuration, or a missing/unevaluated grounded reply binding.
   */
  processInboundForRiyaGroundedReply(
    input: JarvisRiyaGroundedReplyInput,
  ): Promise<JarvisRiyaGroundedReplyResult>;
}

/**
 * The shared fail-closed runtime result for both Riya-aware methods.
 *
 * Content-free by construction: no identifier from a rejected input, no reason from a lower package,
 * no raw error. Extracted with RWC-P7 so the two methods cannot drift into reporting a refusal
 * differently for the same class of problem.
 */
function refusedRuntimeResult(
  config: JarvisRuntimeConfig,
  runId: string,
  conversationId: string,
): JarvisRuntimeResult {
  return Object.freeze({
    outcome: 'REFUSED' as const,
    runId,
    conversationId,
    boundRevision: undefined,
    assignedActor: undefined,
    proposalId: undefined,
    modelDrafted: false,
    coreConsulted: config.coreTransport !== undefined,
    refusalReason: 'orchestration-invariant' as const,
    provenance: undefined,
  });
}

/** Build a frozen Jarvis runtime from injected collaborators. Missing mandatory deps fail closed. */
export function createJarvisRuntime(
  config: JarvisRuntimeConfig,
): RiyaConversationEvolutionJarvisRuntime {
  assertMandatoryDependencies(config);
  return Object.freeze({
    async processInbound(envelope: InboundEnvelope): Promise<JarvisRuntimeResult> {
      // ONE run, then drop the materialization. Not a second pipeline, and not a call to the
      // content-bearing method that then discards what it returned.
      return (await composeAndProcessDetailed(config, envelope)).runtimeResult;
    },
    processInboundForCoreAuthorizedReply(
      envelope: InboundEnvelope,
    ): Promise<JarvisCoreAuthorizedReplyResult> {
      // The SAME primitive, called once. `processInbound` is never invoked in addition.
      return composeAndProcessDetailed(config, envelope);
    },
    async processInboundForRiyaConversationEvolution(
      input: JarvisRiyaConversationEvolutionInput,
    ): Promise<JarvisRiyaConversationEvolutionResult> {
      /**
       * Fail CLOSED as a refused run, not as a thrown error.
       *
       * This package's taxonomy says the only error it throws is a construction-time wiring error;
       * every runtime path normalizes to a fail-closed `JarvisRuntimeResult`. A method that threw
       * would make one inbound path behave unlike the others, and a caller that already handles a
       * REFUSED result would suddenly need a try/catch for the same class of problem.
       */
      const refused = (runId = '', conversationId = ''): JarvisRiyaConversationEvolutionResult =>
        Object.freeze({
          runtimeResult: refusedRuntimeResult(config, runId, conversationId),
          authorizedReply: undefined,
          observationBatch: undefined,
        });

      const proven = provenRiyaRunInput(input);
      if (!proven.ok) {
        return refused(proven.runId, proven.conversationId);
      }
      const { envelope, current, availabilitySnapshot } = proven;

      // RWC-P4A owns INTRO..SUMMARY. CONTACT/CONSENT/COMPLETE are RWC-P6's, and a model call about
      // one of them would be this slice reasoning past its ceiling. RWC-P7 does NOT widen this: the
      // post-summary text turn is a separate method with a reply-only schema.
      if (
        current.phase === 'CONTACT' ||
        current.phase === 'CONSENT' ||
        current.phase === 'COMPLETE'
      ) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      // GROUNDED or not, decided by CONFIGURATION alone -- never by the client's message.
      const grounded = config.riyaGroundedKnowledge;

      // No evaluated prompt, no Riya-aware model call. No fallback in EITHER direction: an ungrounded
      // deployment may not borrow the grounded prompt, and a grounded one may not fall back to the
      // ungrounded prompt that was evaluated before knowledge records existed.
      const binding =
        grounded === undefined
          ? config.riyaConversationEvolutionPromptBinding
          : config.riyaGroundedConversationEvolutionPromptBinding;
      if (binding?.evaluationRef === undefined || binding.evaluationPromptDigest === undefined) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      // ONE bridge for THIS run. A module-level or config-level port would let two concurrent
      // conversations capture into the same slot.
      const bridge =
        grounded === undefined
          ? undefined
          : createRiyaGroundedKnowledgeBridge({
              envelope,
              registry: grounded.registry,
              topics: grounded.topics,
              ...(grounded.observability === undefined
                ? {}
                : { observability: grounded.observability }),
            });

      const run = await composeAndProcessInternal(config, envelope, {
        profile: createRiyaConversationModelProfile({
          current,
          availabilitySnapshot,
          // A READER, not a value. M2 calls the knowledge port before M4 builds the request, so the
          // capture does not exist yet at this line -- and passing a snapshot of `undefined` would
          // silently produce an ungrounded turn on a grounded deployment.
          ...(bridge === undefined ? {} : { groundedKnowledgeSource: () => bridge.readCaptured() }),
        }),
        promptBinding: binding,
        taskClass:
          grounded === undefined
            ? RIYA_CONVERSATION_EVOLUTION_TASK_CLASS
            : RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
        ...(bridge === undefined || grounded === undefined
          ? {}
          : { knowledgePort: bridge.knowledgePort, knowledgeTopics: grounded.topics }),
      });

      // The generic seam types the detail as `unknown` on purpose; the package that produced it owns
      // the guard, so nothing is blindly cast here.
      const detail = parseRiyaModelProfileDetail(run.profileDetail);
      return Object.freeze({
        runtimeResult: run.runtimeResult,
        authorizedReply: run.authorizedReply,
        observationBatch: detail?.observationBatch,
      });
    },
    async processInboundForRiyaGroundedReply(
      input: JarvisRiyaGroundedReplyInput,
    ): Promise<JarvisRiyaGroundedReplyResult> {
      const refused = (runId = '', conversationId = ''): JarvisRiyaGroundedReplyResult =>
        Object.freeze({
          runtimeResult: refusedRuntimeResult(config, runId, conversationId),
          authorizedReply: undefined,
        });

      const proven = provenRiyaRunInput(input);
      if (!proven.ok) {
        return refused(proven.runId, proven.conversationId);
      }
      const { envelope, current, availabilitySnapshot } = proven;

      // The MIRROR of the P4B ceiling. This method owns CONTACT/CONSENT/COMPLETE and nothing else:
      // an INTRO..SUMMARY turn served here would skip the observation extraction the discovery
      // phases exist for, and the conversation would stop learning while still appearing to work.
      if (
        current.phase !== 'CONTACT' &&
        current.phase !== 'CONSENT' &&
        current.phase !== 'COMPLETE'
      ) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      // Grounded configuration is REQUIRED here, unlike the pre-summary path. Past SUMMARY there is
      // no discovery left to do, so a text turn with nothing to ground against has nothing to say
      // that this repository is willing to source from a model's general knowledge.
      const grounded = config.riyaGroundedKnowledge;
      if (grounded === undefined) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }
      const binding = config.riyaGroundedReplyPromptBinding;
      if (binding?.evaluationRef === undefined || binding.evaluationPromptDigest === undefined) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      const bridge = createRiyaGroundedKnowledgeBridge({
        envelope,
        registry: grounded.registry,
        topics: grounded.topics,
        ...(grounded.observability === undefined ? {} : { observability: grounded.observability }),
      });

      const run = await composeAndProcessInternal(config, envelope, {
        profile: createRiyaGroundedReplyModelProfile({
          current,
          availabilitySnapshot,
          groundedKnowledgeSource: () => bridge.readCaptured(),
        }),
        promptBinding: binding,
        taskClass: RIYA_GROUNDED_REPLY_TASK_CLASS,
        knowledgePort: bridge.knowledgePort,
        knowledgeTopics: grounded.topics,
      });

      // No observation batch, no detail, no continuity change. The reply-only schema has nowhere to
      // put one, and this method has nothing to write with.
      return Object.freeze({
        runtimeResult: run.runtimeResult,
        authorizedReply: run.authorizedReply,
      });
    },
    applyConversationControlCommand(
      input: JarvisConversationControlInput,
    ): Promise<JarvisConversationControlResult> {
      return applyControlCommandThroughSource(config, input);
    },
    readConversationOperationsSnapshot(
      input: ConversationOperationsQueryInput,
    ): Promise<JarvisConversationOperationsResult> {
      return readOperationsSnapshotThroughSource(config, input);
    },
  });
}
