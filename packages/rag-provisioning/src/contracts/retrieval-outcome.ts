/**
 * The bounded ACTIVE retrieval outcome (JF-3, ADR-0148).
 *
 * ### Fail-closed, and never partial
 *
 * An outcome is either a success carrying governed records — each already paired with its exact
 * citation by the authority — or a refusal carrying a single closed reason and NO records. There is no
 * third shape: no partial success, no "best effort", no empty-success that a caller could mistake for
 * "nothing applies" when the truth was "the request was refused".
 *
 * That distinction is the whole reason this is a discriminated union rather than a record list: a
 * caller that receives `ok: false` knows it has no grounding and must say so.
 *
 * The governed authority makes that easy to get right. It refuses a WHOLE retrieval whose selector
 * resolves to nothing (`knowledge-not-found`) rather than returning an empty success, so a served
 * outcome always carries at least one cited record. An empty `records` list is therefore not the
 * "nothing matched" case — it is not a case at all. Collapsing "refused" and "found nothing" into one
 * shape is how a system starts answering confidently from nothing, and this contract cannot express
 * it.
 *
 * ### It reports what happened, not what it wishes had happened
 *
 * Counters are measured: `retrievalCount` is `1` only when the backend was actually called,
 * `augmentedCharacterCount` is the real character total of the returned content, and the embedding and
 * vector counters are the literal `0` because nothing in this boundary can produce another value.
 *
 * ### Why the governed reason is carried alongside, not translated
 *
 * When the authority refuses, `reason` is `rag-retrieval-refused` and `knowledgeReason` is the
 * authority's own closed code — `knowledge-expired`, `knowledge-privacy-gate-missing`,
 * `knowledge-conflict`, and so on. Mapping those into a RAG-local vocabulary would create a second,
 * lossier account of a decision this package did not make. Both codes are closed vocabularies and
 * neither can carry content.
 */
import type { KnowledgeRetrievalReason, RetrievedKnowledge } from '@qf-jarvis/governed-knowledge';

import type { RagProvisioningMode, RagReason } from './vocabularies.js';

/** The measured counters of one retrieval attempt. */
export interface RagRetrievalCounters {
  /** `1` when the backend was called, `0` when the attempt was refused before reaching it. */
  readonly retrievalCount: 0 | 1;
  /** Always the literal zero: nothing here embeds. */
  readonly embeddingCount: 0;
  /** Always the literal zero: nothing here queries a vector index. */
  readonly vectorQueryCount: 0;
  /** The real character total of returned governed content. Zero on every refusal. */
  readonly augmentedCharacterCount: number;
}

/** The identity fields every outcome carries, refusal included. */
interface RagRetrievalOutcomeBase {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly mode: RagProvisioningMode;
  /** The revision that served, or `undefined` when nothing served. */
  readonly knowledgeRevision: string | undefined;
  readonly counters: RagRetrievalCounters;
}

/**
 * A served retrieval.
 *
 * `records` always carries at least one cited record: the authority refuses rather than serving an
 * empty result. The type does not narrow to a non-empty list, because that is the authority's
 * guarantee to make and restating it here as a type would be this package asserting a rule it does
 * not own.
 */
export interface RagRetrievalServed extends RagRetrievalOutcomeBase {
  readonly ok: true;
  readonly reason: 'rag-active';
  readonly knowledgeRevision: string;
  readonly records: readonly RetrievedKnowledge[];
}

/** A refused retrieval. It carries no records, ever. */
export interface RagRetrievalRefused extends RagRetrievalOutcomeBase {
  readonly ok: false;
  readonly reason: RagReason;
  /** The governed authority's own reason, when the refusal came from the authority. */
  readonly knowledgeReason: KnowledgeRetrievalReason | undefined;
}

/** The bounded outcome of one ACTIVE retrieval attempt. */
export type RagRetrievalOutcome = RagRetrievalServed | RagRetrievalRefused;
