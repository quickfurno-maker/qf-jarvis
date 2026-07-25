/**
 * The separate audit lookup (QFJ-P04.03, ADR-0051 §C, §L).
 *
 * A retired or historical record remains explainable: it can be looked up by EXACT id/version and
 * cited. This path is deliberately DISTINCT from `retrieveGovernedKnowledge` — it returns a citation
 * and the lifecycle state, never content, and its result type can never be mistaken for a current
 * retrieval. It applies no permission/privacy gate because it exposes no content.
 */
import { buildCitation } from '../contracts/citation.js';
import type { KnowledgeCitation } from '../contracts/citation.js';
import type { KnowledgeLifecycleState } from '../contracts/vocabularies.js';
import type { GovernedKnowledgeRegistry } from '../registry/governed-knowledge-registry.js';

/** A content-free audit citation for one exact historical record. */
export interface KnowledgeAuditCitation {
  readonly kind: 'audit-citation';
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly citation: KnowledgeCitation;
}

/** Look up an exact record for audit; returns a citation (never content) or `undefined`. */
export function auditLookup(
  registry: GovernedKnowledgeRegistry,
  knowledgeId: string,
  version: number,
): KnowledgeAuditCitation | undefined {
  const record = registry.resolveExact(knowledgeId, version);
  if (record === undefined) {
    return undefined;
  }
  return Object.freeze({
    kind: 'audit-citation',
    lifecycleState: record.lifecycleState,
    citation: buildCitation(record),
  });
}
