/**
 * Deterministic gateway + state fakes for tests (QFJ-M4, ADR-0057).
 *
 * The ONLY concrete gateway-invoker/state implementations, shipped under `./testing`. All synthetic —
 * no real gateway, provider, network, key, or token. Every I/O-capable boundary is asynchronous
 * (ADR-0058 §4): a scripted invoker echoes the request's bound provenance with a chosen structured
 * reply; raw/text/mismatched/refusing/rejecting variants drive the fail-closed paths; a scripted state
 * reader drives the pre/post-gateway gate.
 */
import type { ModelRequest, ModelResponse } from '@qf-jarvis/model-gateway';

import type { ReplyState, ReplyStateReader } from '../contracts/state.js';
import type { StructuredReply } from '../contracts/reply-schema.js';
import type {
  ModelGatewayInvocation,
  ModelGatewayInvoker,
} from '../gateway/model-gateway-invoker.js';

interface Recording {
  readonly invoked: () => number;
}

/** Provenance overrides for the mismatched-provenance variant. */
export interface ProvenanceOverride {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly promptId?: string;
  readonly promptVersion?: string;
  /** Forge a digest that disagrees with the request, to prove the adapter refuses it (ADR-0073). */
  readonly promptDigest?: string;
  readonly runId?: string;
}

function buildResponse(
  request: ModelRequest,
  structuredResult: unknown,
  over: ProvenanceOverride,
): ModelResponse {
  const md = request.metadata;
  return {
    runId: over.runId ?? request.runId,
    resultMode: 'STRUCTURED',
    structuredResult,
    provenance: {
      runId: over.runId ?? request.runId,
      purpose: request.purpose,
      providerId: over.providerId ?? String(md['providerId']),
      modelId: over.modelId ?? String(md['modelId']),
      modelVersion: over.modelVersion ?? String(md['modelVersion']),
      promptId: over.promptId ?? request.promptId,
      promptVersion: over.promptVersion ?? request.promptVersion,
      // Echoed from the request, exactly as the real gateway does. The override exists so a spec can
      // forge a mismatch and prove the adapter refuses it.
      promptDigest: over.promptDigest ?? request.promptDigest,
      mode: 'ACTIVE',
      usedFallback: false,
      attempts: 1,
    },
    usage: { outputTokens: 42, inputTokens: 10, totalTokens: 52 },
    latencyMs: 5,
    finishStatus: 'completed',
  };
}

/** A gateway invoker that echoes the request's bound provenance with the scripted reply. */
export function scriptedGatewayInvoker(reply: StructuredReply): ModelGatewayInvoker & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    invoke(request: ModelRequest): Promise<ModelGatewayInvocation> {
      counter.n += 1;
      return Promise.resolve({ ok: true, response: buildResponse(request, reply, {}) });
    },
    invoked: () => counter.n,
  });
}

/** A gateway invoker that returns an arbitrary (possibly malformed) structured result. */
export function rawStructuredGatewayInvoker(
  structuredResult: unknown,
): ModelGatewayInvoker & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    invoke(request: ModelRequest): Promise<ModelGatewayInvocation> {
      counter.n += 1;
      return Promise.resolve({ ok: true, response: buildResponse(request, structuredResult, {}) });
    },
    invoked: () => counter.n,
  });
}

/** A gateway invoker that returns a TEXT-mode response (not structured). */
export function textModeGatewayInvoker(): ModelGatewayInvoker & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    invoke(request: ModelRequest): Promise<ModelGatewayInvocation> {
      counter.n += 1;
      const response: ModelResponse = {
        runId: request.runId,
        resultMode: 'TEXT',
        textResult: 'plain text',
        provenance: {
          runId: request.runId,
          purpose: request.purpose,
          providerId: String(request.metadata['providerId']),
          modelId: String(request.metadata['modelId']),
          modelVersion: String(request.metadata['modelVersion']),
          promptDigest: request.promptDigest,
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          mode: 'ACTIVE',
          usedFallback: false,
          attempts: 1,
        },
        usage: {},
        latencyMs: 3,
        finishStatus: 'completed',
      };
      return Promise.resolve({ ok: true, response });
    },
    invoked: () => counter.n,
  });
}

/** A gateway invoker that echoes a MISMATCHED provenance with the scripted reply. */
export function mismatchedProvenanceGatewayInvoker(
  reply: StructuredReply,
  over: ProvenanceOverride = { providerId: 'wrong.provider' },
): ModelGatewayInvoker & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    invoke(request: ModelRequest): Promise<ModelGatewayInvocation> {
      counter.n += 1;
      return Promise.resolve({ ok: true, response: buildResponse(request, reply, over) });
    },
    invoked: () => counter.n,
  });
}

/** A gateway invoker that refuses (transient or permanent) with no response. */
export function refusingGatewayInvoker(transient: boolean): ModelGatewayInvoker & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    invoke(_request: ModelRequest): Promise<ModelGatewayInvocation> {
      counter.n += 1;
      return Promise.resolve({ ok: false, transient });
    },
    invoked: () => counter.n,
  });
}

/** A gateway invoker that rejects (simulating an unexpected fault). */
export function throwingGatewayInvoker(): ModelGatewayInvoker & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    invoke(_request: ModelRequest): Promise<ModelGatewayInvocation> {
      counter.n += 1;
      return Promise.reject(new Error('synthetic gateway fault (raw error must not escape)'));
    },
    invoked: () => counter.n,
  });
}

/** A clear synthetic reply state; override any field for a specific test. */
export function clearReplyState(over: Partial<ReplyState> = {}): ReplyState {
  return Object.freeze({
    revision: 1,
    partyType: 'CLIENT',
    assignedActor: 'RIYA',
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    ...over,
  });
}

/** A state reader that returns each scripted state in turn (last repeated); records read count. */
export interface RecordingReplyStateReader extends ReplyStateReader {
  readonly reads: () => number;
}
export function scriptedReplyStateReader(
  ...states: readonly ReplyState[]
): RecordingReplyStateReader {
  let index = 0;
  const counter = { n: 0 };
  return Object.freeze({
    read(): Promise<ReplyState> {
      counter.n += 1;
      const value = states[Math.min(index, states.length - 1)] ?? clearReplyState();
      index += 1;
      return Promise.resolve(value);
    },
    reads: () => counter.n,
  });
}

/** A fixed canonical-instant clock. */
export function fixedClock(instant = '2026-07-25T00:00:00Z'): () => string {
  return () => instant;
}
