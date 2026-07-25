/**
 * Content-free RAG provisioning observability (QFJ-P04.05, ADR-0053).
 *
 * The boundary emits closed-reason events carrying only safe ids, the mode, the backend kind, a
 * reason, and the (always zero) counters. An event NEVER carries content, a prompt/message, a subject
 * reference, a topic, a document, PII, a secret, or a token. The hook is injected; the default no-op.
 */
import type { RagBackendKind, RagProvisioningMode, RagReason } from './vocabularies.js';

/** The kind of provisioning event. */
export type RagEventType = 'rag-provisioner-created' | 'rag-no-op';

/** One safe, content-free provisioning event. */
export interface RagEvent {
  readonly type: RagEventType;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly mode: RagProvisioningMode;
  readonly backendKind: RagBackendKind;
  readonly reason: RagReason;
  readonly retrievalCount: 0;
  readonly embeddingCount: 0;
  readonly vectorQueryCount: 0;
  readonly augmentedCharacterCount: 0;
}

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
