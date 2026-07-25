/**
 * The frozen citation attached to every returned governed-knowledge record (QFJ-P04.03, ADR-0051).
 *
 * A citation names exactly what a claim rested on: the knowledge id and version, the source and its
 * revision, the authority tier, the effective window, and the content digest. There is no result
 * without a citation, and a retired historical lookup still cites exact id/version.
 */
import type { KnowledgeRecord } from './knowledge-record.js';
import type { KnowledgeAuthorityTier } from './vocabularies.js';

/** The immutable provenance a returned record is cited by. */
export interface KnowledgeCitation {
  readonly knowledgeId: string;
  readonly version: number;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly authorityTier: KnowledgeAuthorityTier;
  readonly effectiveFrom: string;
  readonly expiresAt: string | undefined;
  readonly contentDigest: string;
}

/** Build the frozen citation for a record. */
export function buildCitation(record: KnowledgeRecord): KnowledgeCitation {
  return Object.freeze({
    knowledgeId: record.knowledgeId,
    version: record.version,
    sourceRef: record.sourceRef,
    sourceRevision: record.sourceRevision,
    authorityTier: record.authorityTier,
    effectiveFrom: record.effectiveFrom,
    expiresAt: record.expiresAt,
    contentDigest: record.contentDigest,
  });
}
