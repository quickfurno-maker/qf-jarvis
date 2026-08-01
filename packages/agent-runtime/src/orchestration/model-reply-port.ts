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
import type { RuntimeActor, RuntimeDataClass } from '../contracts/vocabularies.js';

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
  readonly capabilityProfileRef: string;
  /**
   * The legacy single prompt identity.
   *
   * Optional since QFJ-S3-I-B (ADR-0073): a port that implements `selectPromptIdentity` configures a
   * prompt per agent scope instead, because one global prompt identity cannot serve both Riya and
   * Anisha once definitions are scope-bound. A port supplies one shape or the other, never both.
   */
  readonly promptFamily?: string;
  readonly promptVersion?: number;
  readonly evaluationRef?: string;
  /**
   * Select the configured prompt identity for an already-assigned actor (ADR-0073).
   *
   * This is prompt CONFIGURATION lookup, not assignment. M1's `assignAgent` remains the sole
   * assignment authority; the actor arriving here has already been decided, and this call only asks
   * which prompt the deployment configured for it. Returning `undefined` means "no prompt configured
   * for this scope", which fails the turn closed — there is deliberately no fallback to another
   * scope's prompt, because answering a vendor with a client prompt is the failure being prevented.
   *
   * Synchronous and pure: a selector that performed I/O could observe state between the gates.
   */
  selectPromptIdentity?(request: ModelPromptSelectionRequest): ModelPromptIdentity | undefined;
  draftReply(plan: ReplyPlan): Promise<unknown>;
}

/** The exact prompt identity a deployment configured for one agent scope. Content lives in M4. */
export interface ModelPromptIdentity {
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly evaluationRef?: string;
}

/** What the orchestrator tells a port about the turn. Already-assigned actor, nothing else. */
export interface ModelPromptSelectionRequest {
  readonly assignedActor: RuntimeActor;
  readonly taskClass: string;
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
