import type { KnowledgeCandidateBuildPort } from '../knowledge-freshness/create-knowledge-freshness-coordinator.js';
import type { QuickFurnoKnowledgeApproval } from './quickfurno-production-corpus.js';
import {
  createApprovedQuickFurnoKnowledgeSourceManifest,
  deriveQuickFurnoKnowledgeReleaseRevision,
} from './quickfurno-production-corpus.js';

export interface QuickFurnoKnowledgeCandidateResult {
  readonly revision: string;
  readonly sourceDocumentsRead: number;
  readonly stageBatches: number;
  readonly chunksStaged: number;
  readonly documentsPublished: number;
}

/**
 * Build exactly one QuickFurno candidate release through an injected inactive-only builder.
 *
 * The function derives the release identity from the owner-approved source manifest and refuses any
 * builder that reports activation. Candidate construction therefore cannot silently become rollout.
 */
export async function buildQuickFurnoKnowledgeCandidate(input: {
  readonly approval: QuickFurnoKnowledgeApproval;
  readonly builder: KnowledgeCandidateBuildPort;
}): Promise<QuickFurnoKnowledgeCandidateResult> {
  const manifest = createApprovedQuickFurnoKnowledgeSourceManifest(input.approval);
  const revision = deriveQuickFurnoKnowledgeReleaseRevision(manifest);

  const built = await input.builder.build({
    revision,
    documents: Object.freeze(manifest.sources.map((source) => source.document)),
  });
  if (built.revision !== revision || built.activated) {
    throw new Error('quickfurno-knowledge-candidate-authority-violation');
  }
  return Object.freeze({
    revision,
    sourceDocumentsRead: built.sourceDocumentsRead,
    stageBatches: built.stageBatches,
    chunksStaged: built.chunksStaged,
    documentsPublished: built.documentsPublished,
  });
}
