/**
 * Deterministic orchestration port fakes for tests (QFJ-M2, ADR-0055).
 *
 * The ONLY concrete port implementations, shipped under `./testing`. All synthetic — no real model,
 * Core, provider, knowledge store, key, or token. A recording model port proves the runtime called it
 * (or not); a scripted context port drives the double gate; a scripted Core port returns a chosen
 * outcome; a scripted knowledge port returns exact citations or a refusal.
 */
import type { InboundEnvelope } from '../contracts/inbound-envelope.js';
import type {
  KnowledgeCitation,
  ModelReleaseRef,
  ModelReplyDraft,
  OrchestrationContext,
  ReplyPlan,
} from '../orchestration/contracts.js';
import type {
  ConversationContextPort,
  KnowledgePort,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
  ModelReplyPort,
} from '../orchestration/model-reply-port.js';
import type {
  CoreDecisionPort,
  CoreDecisionRequest,
  CoreDecisionResponse,
} from '../orchestration/core-decision-port.js';
import type { CoreDecisionOutcome } from '../orchestration/vocabularies.js';

const SYNTHETIC_RELEASE: ModelReleaseRef = Object.freeze({
  releaseId: 'rel.fake.1',
  providerId: 'fake',
  modelId: 'fake-model',
  modelVersion: 'v1',
  configDigest: 'abcdef01',
  executionClass: 'HOSTED',
});

/** A synthetic envelope input helper for orchestration tests. */
export function orchestrationEnvelopeFields(): Pick<
  InboundEnvelope,
  | 'runtimeId'
  | 'conversationId'
  | 'messageId'
  | 'tenantId'
  | 'channel'
  | 'partyType'
  | 'direction'
  | 'receivedAt'
  | 'providerMessageRef'
  | 'dataClass'
  | 'subjectRef'
  | 'normalizedText'
> {
  return {
    runtimeId: 'rt.1',
    conversationId: 'conv.1',
    messageId: 'msg.1',
    tenantId: 'tenant.a',
    channel: 'WHATSAPP',
    partyType: 'CLIENT',
    direction: 'INBOUND',
    receivedAt: '2026-07-25T00:00:00Z',
    providerMessageRef: 'ref.opaque.1',
    dataClass: 'HOSTED_ALLOWED',
    subjectRef: undefined,
    normalizedText: 'normalized synthetic inbound',
  };
}

/** A context port that returns each scripted context in turn (last is repeated); records read count. */
export interface RecordingContextPort extends ConversationContextPort {
  readonly reads: () => number;
}
export function scriptedContextPort(
  ...contexts: readonly OrchestrationContext[]
): RecordingContextPort {
  let index = 0;
  const readsCounter = { n: 0 };
  return Object.freeze({
    read(): OrchestrationContext {
      readsCounter.n += 1;
      const value = contexts[Math.min(index, contexts.length - 1)];
      index += 1;
      if (value === undefined) {
        throw new Error('scriptedContextPort: no context supplied');
      }
      return value;
    },
    reads: () => readsCounter.n,
  });
}

/** A model reply port that returns a scripted draft and records invocation. */
export interface RecordingModelReplyPort extends ModelReplyPort {
  readonly invoked: () => number;
}
export function scriptedModelReplyPort(
  config: {
    readonly executionClass?: 'HOSTED' | 'LOCAL';
    readonly evaluationRef?: string;
    readonly draft?: (plan: ReplyPlan) => unknown;
  } = {},
): RecordingModelReplyPort {
  const counter = { n: 0 };
  const release: ModelReleaseRef = Object.freeze({
    ...SYNTHETIC_RELEASE,
    executionClass: config.executionClass ?? 'HOSTED',
  });
  return Object.freeze({
    release,
    promptFamily: 'prompt.family.a',
    promptVersion: 1,
    capabilityProfileRef: 'cap.profile.a',
    ...(config.evaluationRef === undefined ? {} : { evaluationRef: config.evaluationRef }),
    draftReply(plan: ReplyPlan): unknown {
      counter.n += 1;
      if (config.draft !== undefined) {
        return config.draft(plan);
      }
      const draft: ModelReplyDraft = {
        structured: true,
        replyBody: 'synthetic reply body',
        citations: plan.citations.map((c) => ({ knowledgeId: c.knowledgeId, version: c.version })),
        usageTraceId: 'trace.1',
      };
      return draft;
    },
    invoked: () => counter.n,
  });
}

/** A Core decision port that returns a scripted outcome and records invocation. */
export interface RecordingCoreDecisionPort extends CoreDecisionPort {
  readonly invoked: () => number;
}
export function scriptedCoreDecisionPort(outcome: CoreDecisionOutcome): RecordingCoreDecisionPort {
  const counter = { n: 0 };
  return Object.freeze({
    decide(_request: CoreDecisionRequest): CoreDecisionResponse {
      counter.n += 1;
      return { outcome };
    },
    invoked: () => counter.n,
  });
}

/** A knowledge port that returns exact citations or a fail-closed refusal. */
export function scriptedKnowledgePort(
  result:
    | { readonly ok: true; readonly citations: readonly KnowledgeCitation[] }
    | { readonly ok: false },
): KnowledgePort {
  return Object.freeze({
    retrieve(_request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult {
      return result.ok
        ? { ok: true, citations: result.citations }
        : { ok: false, reason: 'orchestration-knowledge-refused' };
    },
  });
}

/** A synthetic exact citation. */
export function syntheticCitation(knowledgeId = 'kb.fact', version = 1): KnowledgeCitation {
  return Object.freeze({ knowledgeId, version, source: 'doc://synthetic', digest: 'abcdef01' });
}
