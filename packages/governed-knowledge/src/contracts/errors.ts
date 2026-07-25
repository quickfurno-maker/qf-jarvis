/**
 * The closed error vocabulary for governed-knowledge CONSTRUCTION and REGISTRY invariants
 * (QFJ-P04.03, ADR-0051). Retrieval OUTCOMES use {@link KnowledgeRetrievalReason} instead; these
 * codes are raised only when building a record or a registry from invalid/conflicting input.
 *
 * An error message is a fixed, repository-owned string chosen from the code — never caller content,
 * never record content, never a subject reference, secret, or raw validator text.
 */
export const KNOWLEDGE_ERROR_CODES = [
  'invalid-record',
  'invalid-request',
  'duplicate-record',
  'conflicting-record',
  'overlapping-active',
  'supersession-missing',
  'supersession-not-newer',
  'supersession-cycle',
  'invalid-lifecycle-transition',
] as const;
export type KnowledgeErrorCode = (typeof KNOWLEDGE_ERROR_CODES)[number];

const KNOWLEDGE_ERROR_MESSAGES: Readonly<Record<KnowledgeErrorCode, string>> = Object.freeze({
  'invalid-record': 'A governed-knowledge record is invalid.',
  'invalid-request': 'A governed-knowledge retrieval request is invalid.',
  'duplicate-record': 'A duplicate knowledge id/version was supplied.',
  'conflicting-record': 'A knowledge id/version was supplied with a conflicting content digest.',
  'overlapping-active': 'Two active records overlap for one topic at one authority tier.',
  'supersession-missing': 'A supersededBy reference resolves to no known record.',
  'supersession-not-newer': 'A supersededBy reference does not resolve to a newer record.',
  'supersession-cycle': 'A supersededBy chain forms a cycle.',
  'invalid-lifecycle-transition': 'A lifecycle transition is not permitted.',
});

/**
 * A bounded, content-free governed-knowledge construction error. It exposes only a closed `code` and
 * a fixed message; it never carries caller content, record content, a subject reference, or a secret.
 */
export class GovernedKnowledgeError extends Error {
  public readonly code: KnowledgeErrorCode;

  public constructor(code: KnowledgeErrorCode) {
    super(KNOWLEDGE_ERROR_MESSAGES[code]);
    this.name = 'GovernedKnowledgeError';
    this.code = code;
    Object.freeze(this);
  }
}
