/**
 * A deterministic stand-in for the composed Jarvis runtime (RWC-P2C; RWC-P2D, ADR-0096;
 * RWC-P4B, ADR-0099).
 *
 * Test support only, excluded from the emitting build. It composes nothing and decides nothing: it
 * answers with whatever a spec scripted, and records how it was reached.
 *
 * The THREE inbound methods are counted SEPARATELY on purpose. The service must call the Riya-aware
 * capability exactly once and must never call either of the other two in addition — a single shared
 * counter could not tell "one call" from "one of each", which is precisely the regression (two
 * orchestration runs, two model calls, two Core decisions and two independent extractions of one
 * sentence) the counts exist to catch.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import type {
  JarvisCoreAuthorizedReplyV1,
  JarvisRiyaConversationEvolutionInput,
  JarvisRuntimeOutcome,
  JarvisRuntimeResult,
  RiyaConversationEvolutionJarvisRuntime,
} from '@qf-jarvis/jarvis-runtime';
import { createRiyaConversationObservationBatch } from '@qf-jarvis/riya-conversation-evolution';
import type {
  RiyaConversationObservationBatchV1,
  RiyaDiscoveryObservationV1,
} from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

/** The sentinel body. Unique enough that finding it anywhere is proof, not coincidence. */
export const SENTINEL_BODY = 'SENTINEL-P2D-9f3a7c1e-authorized-client-text';

/** What a spec may script. */
export interface ScriptedRuntimeOptions {
  readonly refusalReason?: string;
  readonly throws?: boolean;
  /** Replace the materialization outright — used to forge a self-contradicting one. */
  readonly authorizedReply?: JarvisCoreAuthorizedReplyV1;
  /** Force `undefined` even on CORE_ACCEPTED (a no-body or non-text-carrying proposal). */
  readonly suppressReply?: boolean;
  /**
   * What this run observed. Absent means the run produced NO batch — no model ran, or the structured
   * answer failed an M4 gate. Present means the model answered and passed every gate, which is
   * deliberately independent of what Core then decided.
   */
  readonly observations?: readonly RiyaDiscoveryObservationV1[];
  readonly skipProjectDetails?: boolean;
}

/** The recording runtime, exposing ALL THREE inbound methods plus the mature operator surface. */
export type ScriptedRuntime = RiyaConversationEvolutionJarvisRuntime & {
  /** How many times the RWC-P4B capability — the one the service calls — was invoked. */
  invoked(): number;
  /** How many times the RWC-P2D capability was invoked. A turn must leave this at zero. */
  coreAuthorizedInvoked(): number;
  /** How many times ordinary `processInbound` was invoked. A turn must leave this at zero. */
  ordinaryInvoked(): number;
  lastEnvelope(): InboundEnvelope | undefined;
  /** The continuity the service handed in — proof it passes the state it LOADED, not a fresh one. */
  lastContinuity(): RiyaConversationContinuityStateV1 | undefined;
};

export function scriptedRuntime(
  outcome: JarvisRuntimeOutcome = 'CORE_ACCEPTED',
  over: ScriptedRuntimeOptions = {},
): ScriptedRuntime {
  let calls = 0;
  let coreAuthorizedCalls = 0;
  let ordinaryCalls = 0;
  let seen: InboundEnvelope | undefined;
  let seenContinuity: RiyaConversationContinuityStateV1 | undefined;

  const runtimeResultFor = (envelope: InboundEnvelope): JarvisRuntimeResult => ({
    outcome,
    runId: envelope.runtimeId,
    conversationId: envelope.conversationId,
    boundRevision: 1,
    assignedActor: 'RIYA' as const,
    proposalId: 'prop.1',
    modelDrafted: outcome === 'MODEL_DRAFTED' || outcome === 'CORE_ACCEPTED',
    coreConsulted: true,
    refusalReason: over.refusalReason as never,
    provenance: undefined,
  });

  /** Only a Core-accepted run materializes anything — exactly the composition's own rule. */
  const materialization = (): JarvisCoreAuthorizedReplyV1 | undefined => {
    if (over.authorizedReply !== undefined) {
      return over.authorizedReply;
    }
    if (over.suppressReply === true || outcome !== 'CORE_ACCEPTED') {
      return undefined;
    }
    return {
      version: 1,
      proposalId: 'prop.1',
      boundRevision: 1,
      proposalKind: 'REPLY',
      replyBody: SENTINEL_BODY,
    };
  };

  /** Built through the REAL constructor, so a spec can never hand the service a forged batch. */
  const batch = (): RiyaConversationObservationBatchV1 | undefined => {
    if (over.observations === undefined) {
      return undefined;
    }
    return createRiyaConversationObservationBatch({
      version: 1,
      observations: over.observations,
      skipProjectDetails: over.skipProjectDetails ?? false,
    });
  };

  return {
    processInbound(envelope: InboundEnvelope) {
      ordinaryCalls += 1;
      seen = envelope;
      if (over.throws === true) {
        return Promise.reject(new Error('runtime at 10.0.0.1 — password=hunter2'));
      }
      return Promise.resolve(runtimeResultFor(envelope));
    },
    processInboundForCoreAuthorizedReply(envelope: InboundEnvelope) {
      coreAuthorizedCalls += 1;
      seen = envelope;
      if (over.throws === true) {
        return Promise.reject(new Error('runtime at 10.0.0.1 — password=hunter2'));
      }
      return Promise.resolve({
        runtimeResult: runtimeResultFor(envelope),
        authorizedReply: materialization(),
      });
    },
    processInboundForRiyaConversationEvolution(input: JarvisRiyaConversationEvolutionInput) {
      calls += 1;
      seen = input.envelope;
      seenContinuity = input.continuity;
      if (over.throws === true) {
        return Promise.reject(new Error('runtime at 10.0.0.1 — password=hunter2'));
      }
      return Promise.resolve({
        runtimeResult: runtimeResultFor(input.envelope),
        authorizedReply: materialization(),
        observationBatch: batch(),
      });
    },
    applyConversationControlCommand: () => Promise.reject(new Error('not used')),
    readConversationOperationsSnapshot: () => Promise.reject(new Error('not used')),
    invoked: () => calls,
    coreAuthorizedInvoked: () => coreAuthorizedCalls,
    ordinaryInvoked: () => ordinaryCalls,
    lastEnvelope: () => seen,
    lastContinuity: () => seenContinuity,
  };
}
