import type { HybridKnowledgeHit } from '@qf-jarvis/knowledge-index';

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_VECTOR = 4096;

function exactLiteral(value: unknown, expected: string): boolean {
  return value === expected;
}

export interface SemanticCacheCitation {
  readonly knowledgeId: string;
  readonly version: number;
  readonly sourceRef: string;
  readonly contentDigest: string;
}

export interface SemanticCacheEntry {
  readonly entryId: string;
  readonly scope: 'PUBLIC_KNOWLEDGE_ONLY';
  readonly dataClass: 'HOSTED_ALLOWED';
  readonly knowledgeRevision: string;
  readonly promptDigest: string;
  readonly releaseId: string;
  readonly agentScope: string;
  readonly purpose: string;
  readonly queryEmbedding: readonly number[];
  readonly responseText: string;
  readonly citations: readonly SemanticCacheCitation[];
}

function validVector(values: readonly number[]): boolean {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= MAX_VECTOR &&
    values.every((value) => Number.isFinite(value)) &&
    values.some((value) => value !== 0)
  );
}

export function createSemanticCacheEntry(input: SemanticCacheEntry): SemanticCacheEntry {
  const citationsCandidate: unknown = input.citations;
  if (
    !REF.test(input.entryId) ||
    !exactLiteral(input.scope, 'PUBLIC_KNOWLEDGE_ONLY') ||
    !exactLiteral(input.dataClass, 'HOSTED_ALLOWED') ||
    !REF.test(input.knowledgeRevision) ||
    !SHA256.test(input.promptDigest) ||
    !REF.test(input.releaseId) ||
    !REF.test(input.agentScope) ||
    !REF.test(input.purpose) ||
    !validVector(input.queryEmbedding) ||
    typeof input.responseText !== 'string' ||
    input.responseText.length === 0 ||
    input.responseText.length > 16_000 ||
    !Array.isArray(citationsCandidate) ||
    input.citations.length === 0 ||
    input.citations.length > 16
  ) {
    throw new TypeError('semantic-cache-entry-invalid');
  }
  const citations = input.citations.map((citation) => {
    if (
      !REF.test(citation.knowledgeId) ||
      !Number.isInteger(citation.version) ||
      citation.version < 1 ||
      !REF.test(citation.sourceRef) ||
      !SHA256.test(citation.contentDigest)
    ) {
      throw new TypeError('semantic-cache-entry-invalid');
    }
    return Object.freeze({ ...citation });
  });
  return Object.freeze({
    ...input,
    queryEmbedding: Object.freeze([...input.queryEmbedding]),
    citations: Object.freeze(citations),
  });
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !validVector(a) || !validVector(b)) return -1;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    aa += av * av;
    bb += bv * bv;
  }
  if (aa === 0 || bb === 0) return -1;
  return dot / Math.sqrt(aa * bb);
}

export type SemanticCacheLookup =
  | {
      readonly decision: 'HIT';
      readonly similarity: number;
      readonly entry: SemanticCacheEntry;
    }
  | { readonly decision: 'MISS' };

export function findSemanticCacheHit(input: {
  readonly entries: readonly SemanticCacheEntry[];
  readonly queryEmbedding: readonly number[];
  readonly knowledgeRevision: string;
  readonly promptDigest: string;
  readonly releaseId: string;
  readonly agentScope: string;
  readonly purpose: string;
  readonly threshold?: number;
}): SemanticCacheLookup {
  const threshold = input.threshold ?? 0.97;
  if (
    !validVector(input.queryEmbedding) ||
    !REF.test(input.knowledgeRevision) ||
    !SHA256.test(input.promptDigest) ||
    !REF.test(input.releaseId) ||
    !REF.test(input.agentScope) ||
    !REF.test(input.purpose) ||
    !Number.isFinite(threshold) ||
    threshold < 0.9 ||
    threshold > 1
  ) {
    throw new TypeError('semantic-cache-query-invalid');
  }
  let best: { entry: SemanticCacheEntry; similarity: number } | undefined;
  for (const raw of input.entries) {
    let entry: SemanticCacheEntry;
    try {
      entry = createSemanticCacheEntry(raw);
    } catch {
      continue;
    }
    if (
      entry.knowledgeRevision !== input.knowledgeRevision ||
      entry.promptDigest !== input.promptDigest ||
      entry.releaseId !== input.releaseId ||
      entry.agentScope !== input.agentScope ||
      entry.purpose !== input.purpose
    ) {
      continue;
    }
    const similarity = cosine(entry.queryEmbedding, input.queryEmbedding);
    if (similarity < threshold) continue;
    if (best === undefined || similarity > best.similarity) best = { entry, similarity };
  }
  return best === undefined
    ? Object.freeze({ decision: 'MISS' as const })
    : Object.freeze({ decision: 'HIT' as const, similarity: best.similarity, entry: best.entry });
}

export interface AdvancedRetrievalPlan {
  readonly candidatePool: number;
  readonly maxResults: number;
  readonly compressionTargetChars: number;
}

export function planAdvancedRetrieval(input: {
  readonly complexity: 'SIMPLE' | 'STANDARD' | 'COMPLEX';
  readonly availableContextChars: number;
}): AdvancedRetrievalPlan {
  if (
    !Number.isInteger(input.availableContextChars) ||
    input.availableContextChars < 512 ||
    input.availableContextChars > 200_000
  ) {
    throw new TypeError('advanced-retrieval-plan-invalid');
  }
  let candidatePool: number;
  let maxResults: number;
  let targetCeiling: number;
  switch (input.complexity) {
    case 'SIMPLE':
      candidatePool = 24;
      maxResults = 4;
      targetCeiling = 10_000;
      break;
    case 'STANDARD':
      candidatePool = 64;
      maxResults = 8;
      targetCeiling = 10_000;
      break;
    case 'COMPLEX':
      candidatePool = 128;
      maxResults = 12;
      targetCeiling = 16_000;
      break;
  }
  return Object.freeze({
    candidatePool,
    maxResults,
    compressionTargetChars: Math.min(input.availableContextChars, targetCeiling),
  });
}

export interface CompressedKnowledgeBlock {
  readonly chunkId: string;
  readonly content: string;
  readonly citation: HybridKnowledgeHit['citation'];
  readonly originalChars: number;
  readonly compressedChars: number;
}

export type ContextCompressionResult =
  | {
      readonly ok: true;
      readonly blocks: readonly CompressedKnowledgeBlock[];
      readonly totalChars: number;
    }
  | { readonly ok: false; readonly reason: 'CONTEXT_LIMIT_TOO_SMALL' | 'NO_USABLE_CONTEXT' };

function tokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]{3,}/gu) ?? []).filter((token) => token.length >= 3),
  );
}

function sentenceScore(sentence: string, queryTokens: ReadonlySet<string>): number {
  const sentenceTokens = tokens(sentence);
  let score = 0;
  for (const token of queryTokens) if (sentenceTokens.has(token)) score += 1;
  return score;
}

export function compressKnowledgeContext(input: {
  readonly hits: readonly HybridKnowledgeHit[];
  readonly queryText: string;
  readonly maxChars: number;
  readonly maxHits?: number;
}): ContextCompressionResult {
  if (
    typeof input.queryText !== 'string' ||
    input.queryText.trim().length === 0 ||
    !Number.isInteger(input.maxChars) ||
    input.maxChars < 256 ||
    input.maxChars > 200_000 ||
    (input.maxHits !== undefined &&
      (!Number.isInteger(input.maxHits) || input.maxHits < 1 || input.maxHits > 16))
  ) {
    throw new TypeError('context-compression-input-invalid');
  }
  const maxHits = input.maxHits ?? 8;
  const queryTokens = tokens(input.queryText);
  const blocks: CompressedKnowledgeBlock[] = [];
  let totalChars = 0;

  for (const hit of input.hits.slice(0, maxHits)) {
    const sentences = hit.content
      .split(/\n+|(?<=[.!?])\s+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
      .map((sentence, index) => ({ sentence, index, score: sentenceScore(sentence, queryTokens) }));

    const ranked = [...sentences].sort((a, b) => b.score - a.score || a.index - b.index);
    const selected: typeof ranked = [];
    let blockChars = 0;
    for (const item of ranked) {
      const addition = item.sentence.length + (selected.length === 0 ? 0 : 1);
      if (blockChars + addition > Math.max(128, Math.floor(input.maxChars / maxHits))) continue;
      selected.push(item);
      blockChars += addition;
      if (selected.length >= 3) break;
    }
    selected.sort((a, b) => a.index - b.index);
    const content = selected.map((item) => item.sentence).join(' ');
    if (content.length === 0) continue;
    if (totalChars + content.length > input.maxChars) break;
    totalChars += content.length;
    blocks.push(
      Object.freeze({
        chunkId: hit.chunkId,
        content,
        citation: hit.citation,
        originalChars: hit.content.length,
        compressedChars: content.length,
      }),
    );
  }

  if (blocks.length === 0) {
    return Object.freeze({
      ok: false as const,
      reason:
        input.hits.length === 0
          ? ('NO_USABLE_CONTEXT' as const)
          : ('CONTEXT_LIMIT_TOO_SMALL' as const),
    });
  }
  return Object.freeze({ ok: true as const, blocks: Object.freeze(blocks), totalChars });
}
