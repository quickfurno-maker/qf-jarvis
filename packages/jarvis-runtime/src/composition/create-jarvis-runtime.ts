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
import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { InboundEnvelope, InboundEnvelopeInput } from '@qf-jarvis/agent-runtime';
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationModelProfile } from '@qf-jarvis/riya-model-interaction';
import {
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  parseRiyaModelProfileDetail,
} from '@qf-jarvis/riya-model-interaction';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

import type { JarvisCoreAuthorizedReplyResult } from '../contracts/core-authorized-reply.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import { assertMandatoryDependencies } from './validate-composition.js';
import { composeAndProcessDetailed, composeAndProcessInternal } from './process-inbound.js';
import type {
  JarvisRiyaConversationEvolutionInput,
  JarvisRiyaConversationEvolutionResult,
} from '../contracts/riya-conversation-evolution.js';
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
       * every runtime path normalizes to a fail-closed `JarvisRuntimeResult`. A new method that
       * threw would make one inbound path behave unlike the other two, and a caller that already
       * handles a REFUSED result would suddenly need a try/catch for the same class of problem.
       */
      const refused = (runId = '', conversationId = ''): JarvisRiyaConversationEvolutionResult =>
        Object.freeze({
          runtimeResult: Object.freeze({
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
          }),
          authorizedReply: undefined,
          observationBatch: undefined,
        });

      // Typed `unknown` at the boundary. The declared parameter promises an envelope and a state,
      // but this is a package boundary: an untyped caller, or one that built the input from JSON,
      // can hand over anything -- including an array, which `typeof` reports as an object.
      const supplied: unknown = input;
      if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
        return refused();
      }
      const candidate = supplied as {
        readonly envelope?: unknown;
        readonly continuity?: unknown;
        readonly availabilitySnapshot?: unknown;
      };
      const envelopeValue = candidate.envelope;
      const continuityValue = candidate.continuity;
      if (
        typeof envelopeValue !== 'object' ||
        envelopeValue === null ||
        Array.isArray(envelopeValue) ||
        typeof continuityValue !== 'object' ||
        continuityValue === null
      ) {
        return refused();
      }

      /**
       * Re-prove the ENVELOPE through its own canonical constructor, exactly as the continuity is
       * re-proved below.
       *
       * The other two inbound methods receive an envelope a caller already built through this same
       * constructor. This one is reached with a hand-assembled input object, so "it is a non-null
       * object" is not enough: `{ envelope: {} }` would otherwise be cast to `InboundEnvelope`, and
       * every field read off it — including the `runId` and `conversationId` this method's own
       * refusal reports as strings — would be `undefined` at runtime.
       *
       * `createInboundEnvelope`'s schema is `.strict()`, so an extra key, a malformed identifier, an
       * unknown channel/party/direction, a non-canonical instant and oversized text are all refused
       * HERE, before the gateway. The schema is not restated and no regex is copied.
       */
      let envelope: InboundEnvelope;
      try {
        envelope = createInboundEnvelope(envelopeValue as InboundEnvelopeInput);
      } catch {
        // Nothing from the malformed value is echoed back. Until canonicalization succeeds there is
        // no identity worth reporting, so the refusal carries the content-free empty placeholders —
        // which are still STRINGS, as the public result type promises.
        return refused();
      }
      const continuity = continuityValue as RiyaConversationContinuityStateV1;

      /**
       * Re-prove the Core AVAILABILITY SNAPSHOT, exactly as the envelope and the continuity are.
       *
       * This value crossed a boundary from a system this repository does not compile, through a port
       * with no implementation here. Its declared type is a claim about a shape, not evidence of one,
       * and the whole point of the slice is that Riya may only name refs Core actually listed --
       * which is worth nothing if the list itself was never proved.
       *
       * The parser owns duplicate refusal, reference integrity, canonical ordering, the size bound
       * and the freeze. Nothing is restated here.
       */
      let availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
      try {
        availabilitySnapshot = parseCoreServiceAvailabilitySnapshotV1(
          candidate.availabilitySnapshot,
        );
      } catch {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      // Re-prove the continuity through its OWN canonical constructor. A hand-assembled state, or a
      // half-applied row a store returned, must not become the context one model call reasons from.
      let current;
      try {
        current = createRiyaConversationContinuityState({
          version: 1,
          tenantId: continuity.tenantId,
          conversationId: continuity.conversationId,
          continuityRevision: continuity.continuityRevision,
          phase: continuity.phase,
          discovery: {
            ...(continuity.discovery.serviceInterestRef === undefined
              ? {}
              : { serviceInterestRef: continuity.discovery.serviceInterestRef }),
            ...(continuity.discovery.locationRef === undefined
              ? {}
              : { locationRef: continuity.discovery.locationRef }),
            ...(continuity.discovery.propertyTypeRef === undefined
              ? {}
              : { propertyTypeRef: continuity.discovery.propertyTypeRef }),
            ...(continuity.discovery.scopeSummary === undefined
              ? {}
              : { scopeSummary: continuity.discovery.scopeSummary }),
            ...(continuity.discovery.budgetNote === undefined
              ? {}
              : { budgetNote: continuity.discovery.budgetNote }),
            ...(continuity.discovery.timelineNote === undefined
              ? {}
              : { timelineNote: continuity.discovery.timelineNote }),
            ...(continuity.discovery.consultationPreferenceRef === undefined
              ? {}
              : { consultationPreferenceRef: continuity.discovery.consultationPreferenceRef }),
            completeness: continuity.discovery.completeness,
            ...(continuity.discovery.missingFields.length === 0
              ? {}
              : { missingFields: [...continuity.discovery.missingFields] }),
          },
          fieldProvenance: continuity.fieldProvenance,
          summaryConfirmed: continuity.summaryConfirmed,
          ...(continuity.completionEvidenceRef === undefined
            ? {}
            : { completionEvidenceRef: continuity.completionEvidenceRef }),
        });
      } catch {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      // The state and the envelope must be about the SAME conversation. A mismatch is a wiring
      // error, not two conversations to serve, and it is never normalized.
      if (
        current.tenantId !== envelope.tenantId ||
        current.conversationId !== envelope.conversationId
      ) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }
      // RWC-P4A owns INTRO..SUMMARY. CONTACT/CONSENT/COMPLETE are RWC-P6's, and a model call about
      // one of them would be this slice reasoning past its ceiling.
      if (
        current.phase === 'CONTACT' ||
        current.phase === 'CONSENT' ||
        current.phase === 'COMPLETE'
      ) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      // No evaluated evolution prompt, no Riya-aware model call. No fallback to the ordinary CLIENT
      // reply prompt, and none to any other scope.
      const binding = config.riyaConversationEvolutionPromptBinding;
      if (binding?.evaluationRef === undefined || binding.evaluationPromptDigest === undefined) {
        return refused(envelope.runtimeId, envelope.conversationId);
      }

      const run = await composeAndProcessInternal(config, envelope, {
        profile: createRiyaConversationModelProfile({ current, availabilitySnapshot }),
        promptBinding: binding,
        taskClass: RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
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
