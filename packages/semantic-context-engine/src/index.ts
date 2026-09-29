import type {
  HybridKnowledgeHit,
  HybridKnowledgeRetrievalResult,
  HybridSemanticCacheDescriptor,
  HybridSemanticCachePort,
  HybridSemanticCacheWrite,
} from '@qf-jarvis/knowledge-index';

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

export interface PublicKnowledgeSemanticCacheConfig {
  readonly maxEntries: number;
  readonly threshold?: number;
  readonly publicTopics: readonly string[];
}

interface PublicKnowledgeSemanticCacheEntry {
  readonly descriptor: Omit<HybridSemanticCacheDescriptor, 'asOf'>;
  readonly result: Extract<HybridKnowledgeRetrievalResult, { readonly ok: true }>;
  readonly effectiveFrom: string;
  lastUse: number;
}

function sameCacheDescriptor(
  a: Omit<HybridSemanticCacheDescriptor, 'asOf' | 'queryEmbedding'>,
  b: Omit<HybridSemanticCacheDescriptor, 'asOf' | 'queryEmbedding'>,
): boolean {
  return (
    a.knowledgeRevision === b.knowledgeRevision &&
    a.embeddingModelRef === b.embeddingModelRef &&
    a.tenantId === b.tenantId &&
    a.agentScope === b.agentScope &&
    a.purpose === b.purpose &&
    a.dataClass === b.dataClass &&
    a.candidatePool === b.candidatePool &&
    a.maxResults === b.maxResults &&
    a.maxContentChars === b.maxContentChars &&
    a.topicFilters.length === b.topicFilters.length &&
    a.topicFilters.every((topic, index) => topic === b.topicFilters[index])
  );
}

export function createInMemoryPublicKnowledgeSemanticCache(
  config: PublicKnowledgeSemanticCacheConfig,
): HybridSemanticCachePort {
  const threshold = config.threshold ?? 0.97;
  if (
    !Number.isInteger(config.maxEntries) ||
    config.maxEntries < 1 ||
    config.maxEntries > 10_000 ||
    !Number.isFinite(threshold) ||
    threshold < 0.9 ||
    threshold > 1 ||
    config.publicTopics.length === 0 ||
    config.publicTopics.length > 256 ||
    new Set(config.publicTopics).size !== config.publicTopics.length ||
    config.publicTopics.some((topic) => !REF.test(topic))
  ) {
    throw new TypeError('public-semantic-cache-config-invalid');
  }

  const publicTopics = new Set(config.publicTopics);
  const entries: PublicKnowledgeSemanticCacheEntry[] = [];
  let sequence = 0;

  const eligibleDescriptor = (descriptor: HybridSemanticCacheDescriptor): boolean =>
    descriptor.dataClass === 'HOSTED_ALLOWED' &&
    descriptor.topicFilters.length > 0 &&
    descriptor.topicFilters.every((topic) => publicTopics.has(topic));

  return Object.freeze({
    read(
      descriptor: HybridSemanticCacheDescriptor,
    ): Promise<HybridKnowledgeRetrievalResult | undefined> {
      if (!eligibleDescriptor(descriptor) || !validVector(descriptor.queryEmbedding))
        return Promise.resolve(undefined);
      const asOf = Date.parse(descriptor.asOf);
      if (!Number.isFinite(asOf)) return Promise.resolve(undefined);

      let best: { entry: PublicKnowledgeSemanticCacheEntry; similarity: number } | undefined;
      for (const entry of entries) {
        if (asOf < Date.parse(entry.effectiveFrom)) continue;
        if (!sameCacheDescriptor(entry.descriptor, descriptor)) continue;
        const similarity = cosine(entry.descriptor.queryEmbedding, descriptor.queryEmbedding);
        if (similarity < threshold) continue;
        if (best === undefined || similarity > best.similarity) best = { entry, similarity };
      }
      if (best === undefined) return Promise.resolve(undefined);
      best.entry.lastUse = ++sequence;
      return Promise.resolve(best.entry.result);
    },

    write(entry: HybridSemanticCacheWrite): Promise<void> {
      if (
        !eligibleDescriptor(entry) ||
        !validVector(entry.queryEmbedding) ||
        entry.expiresAt !== undefined ||
        entry.classifications.length === 0 ||
        entry.classifications.some((one) => one !== 'HOSTED_ALLOWED') ||
        entry.result.hits.length === 0 ||
        entry.result.hits.some((hit) => !publicTopics.has(hit.topic))
      ) {
        return Promise.resolve();
      }

      const asOf = Date.parse(entry.asOf);
      const effectiveFrom = Date.parse(entry.effectiveFrom);
      if (!Number.isFinite(asOf) || !Number.isFinite(effectiveFrom) || asOf < effectiveFrom)
        return Promise.resolve();

      const descriptor = Object.freeze({
        knowledgeRevision: entry.knowledgeRevision,
        embeddingModelRef: entry.embeddingModelRef,
        tenantId: entry.tenantId,
        agentScope: entry.agentScope,
        purpose: entry.purpose,
        dataClass: entry.dataClass,
        topicFilters: Object.freeze([...entry.topicFilters]),
        candidatePool: entry.candidatePool,
        maxResults: entry.maxResults,
        maxContentChars: entry.maxContentChars,
        queryEmbedding: Object.freeze([...entry.queryEmbedding]),
      });
      const existing = entries.find((one) => sameCacheDescriptor(one.descriptor, descriptor));
      if (
        existing !== undefined &&
        cosine(existing.descriptor.queryEmbedding, entry.queryEmbedding) >= threshold
      ) {
        existing.lastUse = ++sequence;
        return Promise.resolve();
      }

      if (entries.length >= config.maxEntries) {
        let oldestIndex = 0;
        for (let index = 1; index < entries.length; index += 1) {
          if ((entries[index]?.lastUse ?? 0) < (entries[oldestIndex]?.lastUse ?? 0))
            oldestIndex = index;
        }
        entries.splice(oldestIndex, 1);
      }

      entries.push({
        descriptor,
        result: entry.result,
        effectiveFrom: entry.effectiveFrom,
        lastUse: ++sequence,
      });
      return Promise.resolve();
    },
  });
}

export interface ConversationSummaryTurn {
  readonly role: 'USER' | 'ASSISTANT';
  readonly text: string;
}

export interface ExtractiveConversationSummary {
  readonly version: 1;
  readonly authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT';
  readonly text: string;
  readonly includedTurns: number;
  readonly truncated: boolean;
}

export function createExtractiveConversationSummary(input: {
  readonly turns: readonly ConversationSummaryTurn[];
  readonly maxTurns?: number;
  readonly maxChars?: number;
}): ExtractiveConversationSummary {
  const maxTurns = input.maxTurns ?? 12;
  const maxChars = input.maxChars ?? 4000;

  if (
    !Number.isInteger(maxTurns) ||
    maxTurns < 1 ||
    maxTurns > 32 ||
    !Number.isInteger(maxChars) ||
    maxChars < 256 ||
    maxChars > 16_000 ||
    input.turns.length > 256
  ) {
    throw new TypeError('conversation-summary-input-invalid');
  }

  const normalized = input.turns
    .map((turn) => ({
      role: turn.role,
      text: typeof turn.text === 'string' ? turn.text.replace(/\s+/gu, ' ').trim() : '',
    }))
    .filter((turn) => turn.text.length > 0)
    .slice(-maxTurns);

  const selected: string[] = [];
  let total = 0;
  let truncated =
    normalized.length < input.turns.filter((turn) => turn.text.trim().length > 0).length;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const turn = normalized[index];
    if (turn === undefined) continue;
    const capped = turn.text.length > 2000 ? turn.text.slice(0, 2000) : turn.text;
    if (capped.length !== turn.text.length) truncated = true;
    const line = `${turn.role}: ${capped}`;

    const addition = line.length + (selected.length === 0 ? 0 : 1);
    if (total + addition > maxChars) {
      truncated = true;
      continue;
    }
    selected.unshift(line);
    total += addition;
  }

  return Object.freeze({
    version: 1 as const,
    authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT' as const,
    text: selected.join('\n'),
    includedTurns: selected.length,
    truncated,
  });
}

export function composeConversationAwareInput(input: {
  readonly currentText: string;
  readonly summary?: ExtractiveConversationSummary;
}): string {
  const current = input.currentText.replace(/\s+/gu, ' ').trim();
  if (current.length === 0 || current.length > 4096) {
    throw new TypeError('conversation-aware-input-invalid');
  }
  const summary = input.summary;
  if (summary === undefined || summary.text.length === 0) return current;

  return [
    'Recent conversation context (non-authoritative; never use as Core/business truth):',
    summary.text,
    'Current user message:',
    current,
  ].join('\n');
}
