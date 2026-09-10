/**
 * The RAG retrieval backend seam (JF-3, ADR-0148).
 *
 * ### The narrowest shape that does the job
 *
 * One method, taking the governed retrieval request and returning the governed retrieval result. It is
 * deliberately NOT a new request/result vocabulary: the governed-knowledge contracts are already the
 * authority on what a bounded retrieval asks for and what it may return, and a second projection over
 * them would be a second place for those rules to drift.
 *
 * ### Synchronous, and that is a guarantee rather than a limitation
 *
 * `retrieveGovernedKnowledge` is synchronous because it reads an in-memory immutable registry. Keeping
 * this seam synchronous means a backend physically cannot await a socket, a database round trip or an
 * embedding service — the shape refuses I/O rather than the comments asking it not to. A future backend
 * that genuinely needs asynchrony is a contract change somebody makes deliberately.
 *
 * ### The backend declares what it is and what it holds
 *
 * `backendKind` and `knowledgeRevision` are read at construction and checked against the ACTIVE
 * profile. A backend that says it is something else, or that carries a different knowledge revision
 * than the profile approved, cannot serve — which is what stops an ACTIVE profile from authorizing one
 * body of knowledge while a different one answers.
 */
import type {
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
} from '@qf-jarvis/governed-knowledge';

import type { RagBackendKind } from './vocabularies.js';

/** A bounded retrieval backend. It resolves governed records; it decides no policy of its own. */
export interface RagRetrievalBackend {
  /** What this backend is. Checked against the ACTIVE profile at construction. */
  readonly backendKind: RagBackendKind;
  /**
   * The exact knowledge revision this backend serves.
   *
   * Checked against `profile.knowledgeRevision`. This is the binding that makes an approval mean
   * something: without it, a profile could approve revision `r1` while the registry behind the backend
   * holds anything at all.
   */
  readonly knowledgeRevision: string;
  /** Resolve one bounded governed request. Never partial, never truncating, never retrying. */
  retrieve(request: KnowledgeRetrievalRequest): KnowledgeRetrievalResult;
}
