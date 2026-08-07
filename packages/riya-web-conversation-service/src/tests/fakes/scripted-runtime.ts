/**
 * A deterministic stand-in for the composed Jarvis runtime (RWC-P2C; RWC-P2D, ADR-0096).
 *
 * Test support only, excluded from the emitting build. It composes nothing and decides nothing: it
 * answers with whatever a spec scripted, and records how it was reached.
 *
 * The two inbound methods are counted SEPARATELY on purpose. The service must call the
 * content-bearing capability exactly once and must never call ordinary `processInbound` in addition
 * — a single shared counter could not tell "one call" from "one of each", which is precisely the
 * regression (two orchestration runs, two model calls, two Core decisions for one turn) the count
 * exists to catch.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import type {
  CoreAuthorizedReplyJarvisRuntime,
  JarvisCoreAuthorizedReplyV1,
  JarvisRuntimeOutcome,
  JarvisRuntimeResult,
} from '@qf-jarvis/jarvis-runtime';

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
}

/** The recording runtime, exposing BOTH inbound methods plus the mature operator surface. */
export type ScriptedRuntime = CoreAuthorizedReplyJarvisRuntime & {
  invoked(): number;
  ordinaryInvoked(): number;
  lastEnvelope(): InboundEnvelope | undefined;
};

export function scriptedRuntime(
  outcome: JarvisRuntimeOutcome = 'CORE_ACCEPTED',
  over: ScriptedRuntimeOptions = {},
): ScriptedRuntime {
  let calls = 0;
  let ordinaryCalls = 0;
  let seen: InboundEnvelope | undefined;

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
      calls += 1;
      seen = envelope;
      if (over.throws === true) {
        return Promise.reject(new Error('runtime at 10.0.0.1 — password=hunter2'));
      }
      return Promise.resolve({
        runtimeResult: runtimeResultFor(envelope),
        authorizedReply: materialization(),
      });
    },
    applyConversationControlCommand: () => Promise.reject(new Error('not used')),
    readConversationOperationsSnapshot: () => Promise.reject(new Error('not used')),
    invoked: () => calls,
    ordinaryInvoked: () => ordinaryCalls,
    lastEnvelope: () => seen,
  };
}
