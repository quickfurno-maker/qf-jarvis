/**
 * Injected, provider-neutral ports the orchestrator composes (QFJ-M2, ADR-0055 §E, §F).
 *
 * These are INTERFACES only — the runtime holds no provider, model, database, or transport. A model
 * reply port drafts a structured reply (compatible with model-gateway concepts) and makes no live
 * call in this slice; a conversation-context port supplies the revision-bound context (read twice for
 * the double gate); a knowledge port performs EXACT bounded QFJ-P04.03 retrieval only (no free-text/
 * semantic/RAG). The only concrete implementations are the deterministic fakes under `./testing`.
 */
import type {
  KnowledgeCitation,
  ModelReleaseRef,
  OrchestrationContext,
  ReplyPlan,
} from './contracts.js';
import type { OrchestrationReason } from './vocabularies.js';
import type { RuntimeDataClass } from '../contracts/vocabularies.js';

/** Supplies the current revision-bound conversation context. Read at start and again before Core. */
export interface ConversationContextPort {
  read(): OrchestrationContext;
}

/**
 * Drafts a structured reply from a plan. It returns a CANDIDATE draft the orchestrator then validates
 * (a raw body / header / chain-of-thought field makes it invalid). Provider-neutral; no live call, no
 * transport callback, no business authority.
 */
export interface ModelReplyPort {
  readonly release: ModelReleaseRef;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly capabilityProfileRef: string;
  readonly evaluationRef?: string;
  draftReply(plan: ReplyPlan): unknown;
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

/** Performs EXACT bounded QFJ-P04.03 retrieval only. RAG stays disabled; no semantic/vector query. */
export interface KnowledgePort {
  retrieve(request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult;
}
