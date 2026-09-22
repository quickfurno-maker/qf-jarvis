import { createRetrievalRequest } from '@qf-jarvis/governed-knowledge';
import { normalizeKnowledgeText } from '@qf-jarvis/knowledge-ingestion';

import {
  MAX_HYBRID_CANDIDATES,
  MAX_HYBRID_QUERY_CHARS,
  MAX_HYBRID_RESULTS,
  MAX_HYBRID_TOPIC_FILTERS,
} from './contracts.js';
import type {
  HybridKnowledgeSearchRequest,
  HybridKnowledgeSearchRequestInput,
} from './contracts.js';

export function createHybridKnowledgeSearchRequest(
  input: HybridKnowledgeSearchRequestInput,
): HybridKnowledgeSearchRequest {
  const queryText = normalizeKnowledgeText(input.queryText);
  if (queryText.length > MAX_HYBRID_QUERY_CHARS) {
    throw new TypeError('hybrid-invalid-request');
  }
  const topicFilters = Object.freeze([...(input.topicFilters ?? [])]);
  if (
    topicFilters.length > MAX_HYBRID_TOPIC_FILTERS ||
    new Set(topicFilters).size !== topicFilters.length
  ) {
    throw new TypeError('hybrid-invalid-request');
  }

  const candidatePool = input.candidatePool ?? 64;
  const maxResults = input.maxResults ?? 8;
  const maxContentChars = input.maxContentChars ?? 12_000;
  if (
    !Number.isInteger(candidatePool) ||
    candidatePool < 1 ||
    candidatePool > MAX_HYBRID_CANDIDATES ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_HYBRID_RESULTS ||
    maxResults > candidatePool ||
    !Number.isInteger(maxContentChars) ||
    maxContentChars < 256 ||
    maxContentChars > 200_000
  ) {
    throw new TypeError('hybrid-invalid-request');
  }

  // Reuse the existing authority to validate identifier, scope, purpose, class and instant grammar.
  createRetrievalRequest({
    requestId: input.requestId,
    tenantId: input.tenantId,
    agentScope: input.agentScope,
    purpose: input.purpose,
    dataClass: input.dataClass,
    asOf: input.asOf,
    maxRecords: 1,
    maxContentChars: 1,
    requireCitation: true,
    selectors: { topics: topicFilters.length === 0 ? ['hybrid-probe'] : topicFilters },
  });

  return Object.freeze({
    requestId: input.requestId,
    tenantId: input.tenantId,
    agentScope: input.agentScope,
    purpose: input.purpose,
    dataClass: input.dataClass,
    asOf: input.asOf,
    queryText,
    topicFilters,
    candidatePool,
    maxResults,
    maxContentChars,
  });
}
