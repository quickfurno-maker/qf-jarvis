import type {
  EmbeddedKnowledgeBatch,
  EmbeddedKnowledgeChunk,
  KnowledgeEmbeddingCachePort,
  KnowledgeEmbeddingPort,
} from './contracts.js';
import { KNOWLEDGE_EMBEDDING_DIMENSION_V1 } from './contracts.js';
import type { EmbeddingReuseGroup, PreparedKnowledgeBatch } from '@qf-jarvis/knowledge-ingestion';

export interface EmbeddingBatchOptions {
  /** Maximum texts in one provider call. */
  readonly maxTextsPerRequest: number;
  /** Maximum aggregate UTF-16 characters in one provider call. */
  readonly maxCharsPerRequest: number;
}

export const DEFAULT_EMBEDDING_BATCH_OPTIONS: EmbeddingBatchOptions = Object.freeze({
  maxTextsPerRequest: 64,
  maxCharsPerRequest: 64_000,
});

function validateVector(vector: readonly number[], dimension: number): readonly number[] {
  if (vector.length !== dimension || vector.some((value) => !Number.isFinite(value))) {
    throw new TypeError('embedding-vector-invalid');
  }
  return Object.freeze([...vector]);
}

function assertEmbeddingAllowed(executionClass: 'HOSTED' | 'LOCAL', classification: string): void {
  if (classification === 'HUMAN_ONLY') {
    throw new TypeError('embedding-data-class-denied');
  }
  if (classification === 'LOCAL_ONLY' && executionClass !== 'LOCAL') {
    throw new TypeError('embedding-data-class-denied');
  }
}

function validateBatchOptions(options: EmbeddingBatchOptions): void {
  if (
    !Number.isInteger(options.maxTextsPerRequest) ||
    options.maxTextsPerRequest < 1 ||
    options.maxTextsPerRequest > 2_048 ||
    !Number.isInteger(options.maxCharsPerRequest) ||
    options.maxCharsPerRequest < 1_024 ||
    options.maxCharsPerRequest > 2_000_000
  ) {
    throw new TypeError('embedding-batch-options-invalid');
  }
}

function requestBatches(
  groups: readonly EmbeddingReuseGroup[],
  options: EmbeddingBatchOptions,
): readonly (readonly EmbeddingReuseGroup[])[] {
  const result: EmbeddingReuseGroup[][] = [];
  let current: EmbeddingReuseGroup[] = [];
  let chars = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    result.push(current);
    current = [];
    chars = 0;
  };

  for (const group of groups) {
    if (group.content.length > options.maxCharsPerRequest) {
      // A single chunk larger than the provider request budget is not silently split here: splitting
      // after chunk identity/citation construction would make the vector represent bytes different
      // from the governed record. The chunking profile must be corrected instead.
      throw new TypeError('embedding-text-too-large');
    }
    if (
      current.length >= options.maxTextsPerRequest ||
      (current.length > 0 && chars + group.content.length > options.maxCharsPerRequest)
    ) {
      flush();
    }
    current.push(group);
    chars += group.content.length;
  }
  flush();
  return Object.freeze(result.map((batch) => Object.freeze([...batch])));
}

async function embedPreparedKnowledgeBatchInternal(
  batch: PreparedKnowledgeBatch,
  port: KnowledgeEmbeddingPort,
  options: EmbeddingBatchOptions,
  cache?: KnowledgeEmbeddingCachePort,
): Promise<EmbeddedKnowledgeBatch> {
  if (port.dimension !== KNOWLEDGE_EMBEDDING_DIMENSION_V1 || port.modelRef.length === 0) {
    throw new TypeError('embedding-port-invalid');
  }
  validateBatchOptions(options);

  const classByDigest = new Map<string, Set<string>>();
  for (const chunk of batch.chunks) {
    const digest = chunk.record.contentDigest;
    const set = classByDigest.get(digest) ?? new Set<string>();
    set.add(chunk.record.classification);
    classByDigest.set(digest, set);
  }
  for (const classes of classByDigest.values()) {
    for (const classification of classes) {
      assertEmbeddingAllowed(port.executionClass, classification);
    }
  }

  const byDigest = new Map<string, readonly number[]>();
  if (cache !== undefined && batch.embeddingReuseGroups.length > 0) {
    const cached = await cache.read(
      port.modelRef,
      batch.embeddingReuseGroups.map((group) => group.chunkDigest),
    );
    for (const group of batch.embeddingReuseGroups) {
      const vector = cached.get(group.chunkDigest);
      if (vector !== undefined) {
        byDigest.set(group.chunkDigest, validateVector(vector, port.dimension));
      }
    }
  }

  const misses = batch.embeddingReuseGroups.filter((group) => !byDigest.has(group.chunkDigest));
  for (const groups of requestBatches(misses, options)) {
    const texts = groups.map((group) => group.content);
    const vectors = await port.embed(texts);
    if (vectors.length !== texts.length) {
      throw new TypeError('embedding-vector-count-invalid');
    }
    groups.forEach((group, index) => {
      const vector = vectors[index];
      if (vector === undefined) throw new TypeError('embedding-vector-count-invalid');
      byDigest.set(group.chunkDigest, validateVector(vector, port.dimension));
    });
  }

  const chunks: EmbeddedKnowledgeChunk[] = batch.chunks.map((chunk) => {
    const embedding = byDigest.get(chunk.record.contentDigest);
    if (embedding === undefined) throw new TypeError('embedding-vector-missing');
    return Object.freeze({
      chunk,
      embedding,
      embeddingModelRef: port.modelRef,
    });
  });

  return Object.freeze({
    source: batch,
    chunks: Object.freeze(chunks),
    uniqueEmbeddingsComputed: misses.length,
  });
}

export function embedPreparedKnowledgeBatch(
  batch: PreparedKnowledgeBatch,
  port: KnowledgeEmbeddingPort,
  options: EmbeddingBatchOptions = DEFAULT_EMBEDDING_BATCH_OPTIONS,
): Promise<EmbeddedKnowledgeBatch> {
  return embedPreparedKnowledgeBatchInternal(batch, port, options);
}

export function embedPreparedKnowledgeBatchWithCache(
  batch: PreparedKnowledgeBatch,
  port: KnowledgeEmbeddingPort,
  cache: KnowledgeEmbeddingCachePort,
  options: EmbeddingBatchOptions = DEFAULT_EMBEDDING_BATCH_OPTIONS,
): Promise<EmbeddedKnowledgeBatch> {
  return embedPreparedKnowledgeBatchInternal(batch, port, options, cache);
}

export async function embedHybridQuery(
  text: string,
  dataClass: string,
  port: KnowledgeEmbeddingPort,
): Promise<readonly number[]> {
  if (port.dimension !== KNOWLEDGE_EMBEDDING_DIMENSION_V1 || port.modelRef.length === 0) {
    throw new TypeError('embedding-port-invalid');
  }
  assertEmbeddingAllowed(port.executionClass, dataClass);
  const vectors = await port.embed([text]);
  const vector = vectors[0];
  if (vectors.length !== 1 || vector === undefined) {
    throw new TypeError('embedding-vector-count-invalid');
  }
  return validateVector(vector, port.dimension);
}
