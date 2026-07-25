/**
 * The governed-knowledge retrieval result (QFJ-P04.03, ADR-0051).
 *
 * A retrieval either succeeds with a frozen list of records — EACH with an exact citation — or fails
 * closed with a single content-free {@link KnowledgeRetrievalReason}. There is no partial/ambiguous
 * success: a conflict, a missing privacy gate, an over-limit request, or an absent record all return
 * `{ ok: false, reason }`.
 */
import type { KnowledgeCitation } from './citation.js';
import type { KnowledgeRecord } from './knowledge-record.js';
import type { KnowledgeRetrievalReason } from './vocabularies.js';

/** One retrieved record paired with its exact citation. */
export interface RetrievedKnowledge {
  readonly record: KnowledgeRecord;
  readonly citation: KnowledgeCitation;
}

/** The result of a retrieval: a frozen list of cited records, or a single fail-closed reason. */
export type KnowledgeRetrievalResult =
  | { readonly ok: true; readonly records: readonly RetrievedKnowledge[] }
  | { readonly ok: false; readonly reason: KnowledgeRetrievalReason };
