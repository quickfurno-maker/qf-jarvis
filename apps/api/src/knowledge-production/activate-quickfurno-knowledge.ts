import type { QuickFurnoKnowledgeApproval } from './quickfurno-production-corpus.js';
import {
  createApprovedQuickFurnoKnowledgeSourceManifest,
  deriveQuickFurnoKnowledgeReleaseRevision,
} from './quickfurno-production-corpus.js';

export interface QuickFurnoKnowledgeReleaseActivator {
  activate(revision: string): Promise<void>;
  assertReady(revision: string, embeddingModelRef: string): Promise<void>;
}

/**
 * Activate only the release derived from the owner-approved QuickFurno corpus.
 *
 * There is deliberately no revision parameter. An operator cannot point this function at a different
 * sealed release and still call it the approved QuickFurno v1 corpus.
 */
export async function activateQuickFurnoKnowledgeRelease(input: {
  readonly approval: QuickFurnoKnowledgeApproval;
  readonly embeddingModelRef: string;
  readonly activator: QuickFurnoKnowledgeReleaseActivator;
}): Promise<string> {
  const manifest = createApprovedQuickFurnoKnowledgeSourceManifest(input.approval);
  const revision = deriveQuickFurnoKnowledgeReleaseRevision(manifest);

  await input.activator.activate(revision);
  await input.activator.assertReady(revision, input.embeddingModelRef);
  return revision;
}
