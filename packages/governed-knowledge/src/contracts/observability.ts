/**
 * Content-free governed-knowledge observability (QFJ-P04.03, ADR-0051 §M).
 *
 * A retrieval emits closed-reason events carrying ONLY safe identifiers, counts, and a reason code.
 * An event never carries document content, a prompt/message, a subject reference, PII, a secret or
 * token, a raw error body, or model chain-of-thought. The hook is injected; the default is a no-op.
 */
import type {
  KnowledgeAgentScope,
  KnowledgeAuthorityTier,
  KnowledgeDataClass,
  KnowledgeRetrievalReason,
} from './vocabularies.js';

/** One safe, content-free observability event. Every field below is safe to record. */
export interface KnowledgeEvent {
  readonly type: 'knowledge-retrieval';
  readonly reason: KnowledgeRetrievalReason;
  /** The caller's opaque run/request id, echoed for correlation only. */
  readonly requestId: string;
  readonly agentScope: KnowledgeAgentScope;
  /** The topic or record identity this outcome concerns, when applicable. */
  readonly knowledgeId: string | undefined;
  readonly version: number | undefined;
  readonly topic: string | undefined;
  readonly authorityTier: KnowledgeAuthorityTier | undefined;
  readonly classification: KnowledgeDataClass | undefined;
  /** Number of records served (on success) or candidates considered (on a bounded failure). */
  readonly count: number;
}

/** An injected sink for {@link KnowledgeEvent}s. Implementations must not throw. */
export interface KnowledgeObservabilityHook {
  onEvent(event: KnowledgeEvent): void;
}

/** The default no-op hook: governed knowledge emits nothing unless a hook is injected. */
export const NOOP_KNOWLEDGE_OBSERVABILITY: KnowledgeObservabilityHook = Object.freeze({
  onEvent(_event: KnowledgeEvent): void {
    // Intentionally empty.
  },
});
