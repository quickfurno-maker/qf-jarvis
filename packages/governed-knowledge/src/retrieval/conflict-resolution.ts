/**
 * Deterministic conflict resolution for a topic (QFJ-P04.03, ADR-0051 §K).
 *
 * Given the records already found ELIGIBLE for one topic, pick the single current record: the highest
 * permitted source-authority tier must contain exactly one record. Zero eligible → not found; two or
 * more at the top tier → a fail-closed conflict. A lower tier can never override a higher one.
 */
import { authorityRank } from '../contracts/vocabularies.js';
import type { KnowledgeRecord } from '../contracts/knowledge-record.js';

export type TopicResolution =
  | { readonly kind: 'one'; readonly record: KnowledgeRecord }
  | { readonly kind: 'none' }
  | { readonly kind: 'conflict' };

/** Resolve the single current record among the eligible records for one topic. */
export function resolveTopic(eligible: readonly KnowledgeRecord[]): TopicResolution {
  if (eligible.length === 0) {
    return { kind: 'none' };
  }
  let bestRank = Number.POSITIVE_INFINITY;
  for (const record of eligible) {
    const rank = authorityRank(record.authorityTier);
    if (rank < bestRank) {
      bestRank = rank;
    }
  }
  const top = eligible.filter((r) => authorityRank(r.authorityTier) === bestRank);
  if (top.length > 1) {
    return { kind: 'conflict' };
  }
  const [only] = top;
  return only === undefined ? { kind: 'none' } : { kind: 'one', record: only };
}
