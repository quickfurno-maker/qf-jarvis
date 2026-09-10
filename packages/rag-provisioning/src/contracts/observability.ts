/**
 * Content-free RAG provisioning observability (QFJ-P04.05, ADR-0053; JF-3, ADR-0148).
 *
 * The boundary emits closed-reason events carrying only safe ids, the mode, the backend kind, a
 * reason, and counters. An event NEVER carries content, a prompt/message, a subject reference, a
 * topic, a document, PII, a secret, or a token. The hook is injected; the default no-op.
 *
 * ### Two event shapes, because one of them can now be non-zero
 *
 * ADR-0053 typed every counter as the literal `0`, which was exactly right for a boundary that could
 * not retrieve. JF-3 makes ACTIVE retrieval real, so a retrieval event carries a real record count and
 * a real character count. Rather than widening the existing event — which would silently drop the
 * type-level proof for the paths that genuinely still do nothing — the type is a union: the no-op
 * events keep their literal zeros, and the retrieval event is its own shape.
 *
 * `embeddingCount` and `vectorQueryCount` stay the literal `0` in BOTH members. That is deliberate and
 * is the guarantee worth keeping at the type level: no path through this boundary, ACTIVE included,
 * can report an embedding or a vector query, because there is no type in which it could be written.
 */
import type { KnowledgeRetrievalReason } from '@qf-jarvis/governed-knowledge';

import type { RagBackendKind, RagProvisioningMode, RagReason } from './vocabularies.js';

/** The kind of provisioning event. */
export type RagEventType = 'rag-provisioner-created' | 'rag-no-op' | 'rag-retrieval';

/** The safe fields every event carries. No content, in any member. */
interface RagEventBase {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly mode: RagProvisioningMode;
  readonly backendKind: RagBackendKind;
  readonly reason: RagReason;
  /** Always the literal zero. This boundary embeds nothing, in any mode. */
  readonly embeddingCount: 0;
  /** Always the literal zero. This boundary queries no vector index, in any mode. */
  readonly vectorQueryCount: 0;
}

/** A provisioner-construction or no-op event. Every counter is exactly zero, as ADR-0053 fixed it. */
export interface RagNoOpEvent extends RagEventBase {
  readonly type: 'rag-provisioner-created' | 'rag-no-op';
  readonly retrievalCount: 0;
  readonly augmentedCharacterCount: 0;
}

/**
 * One ACTIVE retrieval attempt (JF-3).
 *
 * `retrievalCount` is `1` when the backend was actually called and `0` when the attempt was refused
 * before reaching it — a refusal is not a retrieval, and counting it as one would overstate what the
 * boundary did. `knowledgeReason` is the governed authority's own closed reason when it refused.
 */
export interface RagRetrievalEvent extends RagEventBase {
  readonly type: 'rag-retrieval';
  readonly retrievalCount: 0 | 1;
  readonly recordCount: number;
  readonly augmentedCharacterCount: number;
  readonly knowledgeReason: KnowledgeRetrievalReason | undefined;
}

/** One safe, content-free provisioning event. */
export type RagEvent = RagNoOpEvent | RagRetrievalEvent;

/** An injected sink for {@link RagEvent}s. Implementations must not throw. */
export interface RagObservabilityHook {
  onEvent(event: RagEvent): void;
}

/** The default no-op hook: the boundary emits nothing unless a hook is injected. */
export const NOOP_RAG_OBSERVABILITY: RagObservabilityHook = Object.freeze({
  onEvent(_event: RagEvent): void {
    // Intentionally empty.
  },
});
