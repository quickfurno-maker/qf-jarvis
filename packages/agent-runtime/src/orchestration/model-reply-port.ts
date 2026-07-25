/**
 * Injected, provider-neutral ports the orchestrator composes (QFJ-M2, ADR-0055 §E, §F).
 *
 * These are INTERFACES only — the runtime holds no provider, model, database, or transport. A model
 * reply port drafts a structured reply (compatible with model-gateway concepts) and makes no live
 * call in this slice; a conversation-context port supplies the revision-bound context (read twice for
 * the double gate); a knowledge port performs EXACT bounded QFJ-P04.03 retrieval only (no free-text/
 * semantic/RAG). All three are I/O-capable boundaries, so each returns a `Promise` (ADR-0058 §1). The
 * only concrete implementations are the deterministic fakes under `./testing`.
 */
import type {
  KnowledgeCitation,
  ModelReleaseRef,
  OrchestrationContext,
  ReplyPlan,
} from './contracts.js';
import type { OrchestrationReason } from './vocabularies.js';
import type { RuntimeDataClass } from '../contracts/vocabularies.js';

/**
 * Supplies the current revision-bound conversation context. Awaited at start and again before Core
 * (the double gate); may perform a database-backed read (ADR-0058 §1).
 */
export interface ConversationContextPort {
  read(): Promise<OrchestrationContext>;
}

/**
 * Drafts a structured reply from a plan. It resolves to a CANDIDATE draft the orchestrator then
 * validates (a raw body / header / chain-of-thought field makes it invalid). Provider-neutral; awaited
 * (a live binding performs provider I/O); no transport callback, no business authority (ADR-0058 §1).
 */
export interface ModelReplyPort {
  readonly release: ModelReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly capabilityProfileRef: string;
  readonly evaluationRef?: string;
  draftReply(plan: ReplyPlan): Promise<unknown>;
}

/** A bounded, exact knowledge retrieval request (no free-text query). */
export interface KnowledgeRetrievalRequest {
  readonly conversationId: string;
  readonly topics: readonly string[];
  readonly dataClass: RuntimeDataClass;
}

/** The result of an exact knowledge retrieval: exact citations, or a fail-closed reason. */
export type KnowledgeRetrievalResult =
  | { readonly ok: true; readonly citations: readonly KnowledgeCitation[] }
  | { readonly ok: false; readonly reason: OrchestrationReason };

/**
 * Performs EXACT bounded QFJ-P04.03 retrieval only. RAG stays disabled; no semantic/vector query.
 * Awaited (a live binding reads a knowledge store) (ADR-0058 §1).
 */
export interface KnowledgePort {
  retrieve(request: KnowledgeRetrievalRequest): Promise<KnowledgeRetrievalResult>;
}
