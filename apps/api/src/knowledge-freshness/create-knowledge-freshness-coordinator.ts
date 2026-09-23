import type { KnowledgeSourceDocumentInput } from '@qf-jarvis/knowledge-ingestion';
import { normalizeSourceDocument } from '@qf-jarvis/knowledge-ingestion';
import type { KnowledgeEmbeddingPort } from '@qf-jarvis/knowledge-index';
import {
  assessKnowledgeCandidate,
  assessKnowledgeFreshness,
  type KnowledgeSourceFingerprint,
} from '@qf-jarvis/knowledge-freshness';
import {
  buildStreamingKnowledgeRelease,
  type PostgresKnowledgeIndexWriter,
  type StreamingKnowledgeReleaseResult,
} from '@qf-jarvis/postgres-knowledge-index';

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const REVISION = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface KnowledgeFreshnessSourceBundle {
  readonly fingerprint: KnowledgeSourceFingerprint;
  readonly document: KnowledgeSourceDocumentInput;
}

export interface KnowledgeFreshnessSourcePort {
  readCurrent(): Promise<readonly KnowledgeFreshnessSourceBundle[]>;
}

export interface KnowledgeFreshnessEvaluationResult {
  readonly passed: boolean;
  readonly evidenceRef: string;
}

export interface KnowledgeFreshnessEvaluationPort {
  evaluate(input: {
    readonly candidateRevision: string;
    readonly sources: readonly KnowledgeFreshnessSourceBundle[];
  }): Promise<KnowledgeFreshnessEvaluationResult>;
}

export interface KnowledgeCandidateBuildPort {
  build(input: {
    readonly revision: string;
    readonly documents: readonly KnowledgeSourceDocumentInput[];
  }): Promise<StreamingKnowledgeReleaseResult>;
}

export type KnowledgeFreshnessCycleResult =
  | { readonly outcome: 'NO_CHANGE' }
  | { readonly outcome: 'BLOCKED_MISSING_SOURCE' }
  | { readonly outcome: 'BLOCKED_UNAPPROVED_SOURCE' }
  | { readonly outcome: 'BLOCKED_EVALUATION'; readonly evidenceRef: string }
  | {
      readonly outcome: 'CANDIDATE_SEALED_INACTIVE';
      readonly revision: string;
      readonly evaluationEvidenceRef: string;
      readonly sourceCount: number;
      readonly chunksStaged: number;
    };

function validateRevision(value: string): void {
  if (!REVISION.test(value) || value === '*' || value.toLowerCase() === 'latest') {
    throw new TypeError('knowledge-freshness-revision-invalid');
  }
}

function proveBundle(bundle: KnowledgeFreshnessSourceBundle): void {
  const normalized = normalizeSourceDocument(bundle.document);
  const fp = bundle.fingerprint;
  if (
    fp.sourceRef !== bundle.document.sourceRef ||
    fp.sourceRevision !== bundle.document.sourceRevision ||
    fp.ownerRef !== bundle.document.owner ||
    fp.contentDigest !== normalized.contentDigest
  ) {
    throw new TypeError('knowledge-freshness-source-binding-invalid');
  }
  if (fp.approvedForProduction) {
    if (
      fp.approvalRef === undefined ||
      !REF.test(fp.approvalRef) ||
      bundle.document.approvedBy === undefined ||
      bundle.document.approvedAt === undefined
    ) {
      throw new TypeError('knowledge-freshness-approval-binding-invalid');
    }
  }
}

export function createStreamingKnowledgeCandidateBuilder(input: {
  readonly embedding: KnowledgeEmbeddingPort;
  readonly writer: PostgresKnowledgeIndexWriter;
}): KnowledgeCandidateBuildPort {
  return Object.freeze({
    build(args: Parameters<KnowledgeCandidateBuildPort['build']>[0]) {
      return buildStreamingKnowledgeRelease({
        revision: args.revision,
        sources: args.documents,
        embedding: input.embedding,
        writer: input.writer,
        activateAfterSeal: false,
      });
    },
  });
}

/**
 * One explicit freshness cycle. There is no scheduler and no activation surface here.
 *
 * A changed approved source set must pass evaluation before a candidate is built. The builder is
 * hard-checked to have left the release inactive, so source freshness can prepare immutable evidence
 * but can never change what serving retrieval sees.
 */
export function createKnowledgeFreshnessCoordinator(input: {
  readonly acceptedSources: readonly KnowledgeSourceFingerprint[];
  readonly sourcePort: KnowledgeFreshnessSourcePort;
  readonly evaluation: KnowledgeFreshnessEvaluationPort;
  readonly builder: KnowledgeCandidateBuildPort;
}) {
  return Object.freeze({
    async run(candidateRevision: string): Promise<KnowledgeFreshnessCycleResult> {
      validateRevision(candidateRevision);
      const bundles = await input.sourcePort.readCurrent();
      for (const bundle of bundles) proveBundle(bundle);
      const observed = Object.freeze(bundles.map((bundle) => bundle.fingerprint));
      const freshness = assessKnowledgeFreshness(input.acceptedSources, observed);

      if (!freshness.requiresCandidateRelease)
        return Object.freeze({ outcome: 'NO_CHANGE' as const });
      if (freshness.missingCount > 0) {
        return Object.freeze({ outcome: 'BLOCKED_MISSING_SOURCE' as const });
      }
      if (
        observed.some((source) => !source.approvedForProduction || source.approvalRef === undefined)
      ) {
        return Object.freeze({ outcome: 'BLOCKED_UNAPPROVED_SOURCE' as const });
      }

      const evaluation = await input.evaluation.evaluate({ candidateRevision, sources: bundles });
      if (!REF.test(evaluation.evidenceRef))
        throw new TypeError('knowledge-freshness-evidence-invalid');
      const candidate = assessKnowledgeCandidate({
        freshness,
        observedSources: observed,
        evaluationPassed: evaluation.passed,
      });
      if (candidate.decision !== 'ELIGIBLE_FOR_STAGING_BUILD') {
        return Object.freeze({
          outcome: 'BLOCKED_EVALUATION' as const,
          evidenceRef: evaluation.evidenceRef,
        });
      }

      const built = await input.builder.build({
        revision: candidateRevision,
        documents: Object.freeze(bundles.map((bundle) => bundle.document)),
      });
      if (built.revision !== candidateRevision || built.activated) {
        throw new TypeError('knowledge-freshness-builder-authority-violation');
      }
      return Object.freeze({
        outcome: 'CANDIDATE_SEALED_INACTIVE' as const,
        revision: built.revision,
        evaluationEvidenceRef: evaluation.evidenceRef,
        sourceCount: built.sourceDocumentsRead,
        chunksStaged: built.chunksStaged,
      });
    },
  });
}
