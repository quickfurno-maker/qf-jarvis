import {
  createGovernedKnowledgeRegistry,
  createRetrievalRequest,
  retrieveGovernedKnowledge,
} from '@qf-jarvis/governed-knowledge';
import type { KnowledgeRetrievalResult } from '@qf-jarvis/governed-knowledge';

import type {
  FusedKnowledgeCandidate,
  HybridKnowledgeHit,
  HybridKnowledgeRetrievalResult,
  HybridKnowledgeRetrieverOptions,
  HybridKnowledgeSearchRequest,
  HybridRetrievalReason,
  RankedChunkCandidate,
} from './contracts.js';
import { embedHybridQuery } from './embedding.js';
import { fuseHybridCandidates } from './fusion.js';
import { createDeterministicKnowledgeReranker } from './reranker.js';

function candidatesValid(candidates: readonly RankedChunkCandidate[], max: number): boolean {
  if (candidates.length > max) return false;
  const seen = new Set<string>();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === undefined) return false;
    if (
      candidate.rank !== index + 1 ||
      !Number.isFinite(candidate.score) ||
      seen.has(candidate.chunk.chunkId)
    ) {
      return false;
    }
    seen.add(candidate.chunk.chunkId);
  }
  return true;
}

function governed(
  candidate: FusedKnowledgeCandidate,
  request: HybridKnowledgeSearchRequest,
  options: HybridKnowledgeRetrieverOptions,
): KnowledgeRetrievalResult {
  const registry = createGovernedKnowledgeRegistry([candidate.chunk.record]);
  const exact = createRetrievalRequest({
    requestId: request.requestId,
    tenantId: request.tenantId,
    agentScope: request.agentScope,
    purpose: request.purpose,
    dataClass: request.dataClass,
    asOf: request.asOf,
    maxRecords: 1,
    maxContentChars: candidate.chunk.record.content.length,
    requireCitation: true,
    selectors: {
      ids: [
        {
          knowledgeId: candidate.chunk.record.knowledgeId,
          version: candidate.chunk.record.version,
        },
      ],
    },
  });
  return retrieveGovernedKnowledge(registry, exact, {
    ...(options.privacyGate === undefined ? {} : { privacyGate: options.privacyGate }),
  });
}

function hit(
  candidate: FusedKnowledgeCandidate,
  result: Extract<KnowledgeRetrievalResult, { readonly ok: true }>,
): HybridKnowledgeHit {
  const retrieved = result.records[0];
  if (retrieved === undefined || result.records.length !== 1) {
    throw new TypeError('hybrid-invariant');
  }
  return Object.freeze({
    chunkId: candidate.chunk.chunkId,
    parentKnowledgeId: candidate.chunk.parentKnowledgeId,
    parentVersion: candidate.chunk.parentVersion,
    topic: retrieved.record.topic,
    content: retrieved.record.content,
    contentFormat: retrieved.record.contentFormat,
    headingPath: candidate.chunk.headingPath,
    citation: retrieved.citation,
    fusedScore: candidate.fusedScore,
    rerankScore: candidate.rerankScore,
  });
}

export function createHybridKnowledgeRetriever(options: HybridKnowledgeRetrieverOptions): {
  readonly knowledgeRevision: string;
  retrieve(request: HybridKnowledgeSearchRequest): Promise<HybridKnowledgeRetrievalResult>;
} {
  const reranker = options.reranker ?? createDeterministicKnowledgeReranker();

  const emit = (
    request: HybridKnowledgeSearchRequest,
    reason: HybridRetrievalReason,
    lexicalCandidates: number,
    vectorCandidates: number,
    fusedCandidates: number,
    governedHits: number,
  ): void => {
    options.observability?.onEvent(
      Object.freeze({
        type: 'hybrid-knowledge-retrieval',
        requestId: request.requestId,
        reason,
        lexicalCandidates,
        vectorCandidates,
        fusedCandidates,
        governedHits,
      }),
    );
  };

  const failed = (
    request: HybridKnowledgeSearchRequest,
    reason: Exclude<HybridRetrievalReason, 'hybrid-served'>,
    counts: readonly [number, number, number, number],
  ): HybridKnowledgeRetrievalResult => {
    emit(request, reason, counts[0], counts[1], counts[2], counts[3]);
    return Object.freeze({ ok: false as const, reason });
  };

  return Object.freeze({
    knowledgeRevision: options.store.knowledgeRevision,
    async retrieve(request: HybridKnowledgeSearchRequest): Promise<HybridKnowledgeRetrievalResult> {
      if (request.dataClass === 'HUMAN_ONLY') {
        return failed(request, 'hybrid-query-embedding-denied', [0, 0, 0, 0]);
      }

      let queryEmbedding: readonly number[];
      try {
        queryEmbedding = await embedHybridQuery(
          request.queryText,
          request.dataClass,
          options.embedding,
        );
      } catch (error) {
        const reason =
          error instanceof TypeError && error.message === 'embedding-data-class-denied'
            ? 'hybrid-query-embedding-denied'
            : 'hybrid-embedding-failed';
        return failed(request, reason, [0, 0, 0, 0]);
      }

      let lexical: readonly RankedChunkCandidate[];
      let vector: readonly RankedChunkCandidate[];
      try {
        const searched = await options.store.search(
          request,
          queryEmbedding,
          options.embedding.modelRef,
        );
        lexical = searched.lexical;
        vector = searched.vector;
      } catch {
        return failed(request, 'hybrid-candidate-store-failed', [0, 0, 0, 0]);
      }

      if (
        !candidatesValid(lexical, request.candidatePool) ||
        !candidatesValid(vector, request.candidatePool)
      ) {
        return failed(request, 'hybrid-invariant', [lexical.length, vector.length, 0, 0]);
      }

      const fused = fuseHybridCandidates(lexical, vector, request.candidatePool);
      if (fused.length === 0) {
        return failed(request, 'hybrid-no-candidates', [lexical.length, vector.length, 0, 0]);
      }

      // Defense-in-depth gate before any pluggable reranker can see a candidate body.
      const preAuthorized = fused.filter((candidate) => governed(candidate, request, options).ok);
      if (preAuthorized.length === 0) {
        return failed(request, 'hybrid-governance-refused', [
          lexical.length,
          vector.length,
          fused.length,
          0,
        ]);
      }

      let reranked: readonly FusedKnowledgeCandidate[];
      try {
        reranked = await reranker.rerank(request.queryText, preAuthorized);
      } catch {
        return failed(request, 'hybrid-reranker-failed', [
          lexical.length,
          vector.length,
          fused.length,
          0,
        ]);
      }
      const canonicalById = new Map(
        preAuthorized.map((candidate) => [candidate.chunk.chunkId, candidate] as const),
      );
      if (
        reranked.length !== preAuthorized.length ||
        new Set(reranked.map((candidate) => candidate.chunk.chunkId)).size !== reranked.length ||
        reranked.some(
          (candidate) =>
            !canonicalById.has(candidate.chunk.chunkId) || !Number.isFinite(candidate.rerankScore),
        )
      ) {
        return failed(request, 'hybrid-invariant', [
          lexical.length,
          vector.length,
          fused.length,
          0,
        ]);
      }
      // A reranker may reorder and score only. Content/provenance always come back from the canonical
      // pre-authorized candidate, so a plugin cannot substitute a different record under a known id.
      const canonicalReranked = reranked.map((candidate) => {
        const canonical = canonicalById.get(candidate.chunk.chunkId);
        if (canonical === undefined) throw new TypeError('hybrid-invariant');
        return Object.freeze({ ...canonical, rerankScore: candidate.rerankScore });
      });

      const hits: HybridKnowledgeHit[] = [];
      let totalChars = 0;
      for (const candidate of canonicalReranked) {
        if (hits.length >= request.maxResults) break;

        // Final authoritative gate after ranking. A future time-varying privacy gate can change between
        // candidate generation and release; the last decision wins.
        const final = governed(candidate, request, options);
        if (!final.ok) continue;

        const next = hit(candidate, final);
        if (totalChars + next.content.length > request.maxContentChars) {
          if (hits.length === 0) {
            return failed(request, 'hybrid-content-limit', [
              lexical.length,
              vector.length,
              fused.length,
              0,
            ]);
          }
          break;
        }
        totalChars += next.content.length;
        hits.push(next);
      }

      if (hits.length === 0) {
        return failed(request, 'hybrid-governance-refused', [
          lexical.length,
          vector.length,
          fused.length,
          0,
        ]);
      }

      emit(request, 'hybrid-served', lexical.length, vector.length, fused.length, hits.length);
      return Object.freeze({
        ok: true as const,
        reason: 'hybrid-served' as const,
        hits: Object.freeze(hits),
      });
    },
  });
}
