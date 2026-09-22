import type { ChunkingProfile, KnowledgeSourceDocumentInput } from '@qf-jarvis/knowledge-ingestion';
import { DEFAULT_CHUNKING_PROFILE, prepareKnowledgeBatch } from '@qf-jarvis/knowledge-ingestion';
import type { EmbeddingBatchOptions, KnowledgeEmbeddingPort } from '@qf-jarvis/knowledge-index';
import {
  DEFAULT_EMBEDDING_BATCH_OPTIONS,
  embedPreparedKnowledgeBatch,
} from '@qf-jarvis/knowledge-index';

import type { KnowledgeDocumentRef, PostgresKnowledgeIndexWriter } from './writer.js';

export interface StreamingKnowledgeReleaseOptions {
  readonly revision: string;
  readonly sources:
    AsyncIterable<KnowledgeSourceDocumentInput> | Iterable<KnowledgeSourceDocumentInput>;
  readonly embedding: KnowledgeEmbeddingPort;
  readonly writer: PostgresKnowledgeIndexWriter;
  readonly chunking?: ChunkingProfile;
  readonly embeddingBatch?: EmbeddingBatchOptions;
  /** Bound on source documents materialized before one stage transaction. */
  readonly maxDocumentsPerStage?: number;
  /** Approximate source-character bound before one stage transaction. */
  readonly maxSourceCharsPerStage?: number;
  /** Explicit because activating a release changes what future retrievals may see. */
  readonly activateAfterSeal: boolean;
}

export interface StreamingKnowledgeReleaseResult {
  readonly revision: string;
  readonly sourceDocumentsRead: number;
  readonly stageBatches: number;
  readonly chunksStaged: number;
  readonly documentsPublished: number;
  readonly activated: boolean;
}

const DEFAULT_MAX_DOCUMENTS_PER_STAGE = 64;
const DEFAULT_MAX_SOURCE_CHARS_PER_STAGE = 4_000_000;

function estimateSourceChars(source: KnowledgeSourceDocumentInput): number {
  if (source.payload.kind === 'TEXT') return source.payload.text.length;
  let chars = 0;
  for (const field of source.payload.fields) {
    chars += field.key.length + 2;
    if (field.value === null) chars += 4;
    else if (typeof field.value === 'string') chars += field.value.length + 2;
    else chars += String(field.value).length;
  }
  return chars;
}

function validateBounds(maxDocuments: number, maxChars: number): void {
  if (
    !Number.isInteger(maxDocuments) ||
    maxDocuments < 1 ||
    maxDocuments > 1_024 ||
    !Number.isInteger(maxChars) ||
    maxChars < 2_000_000 ||
    maxChars > 64_000_000
  ) {
    throw new TypeError('knowledge-release-bounds-invalid');
  }
}

function refsFor(inputs: readonly KnowledgeSourceDocumentInput[]): readonly KnowledgeDocumentRef[] {
  return Object.freeze(
    inputs.map((input) =>
      Object.freeze({ knowledgeId: input.knowledgeId, version: input.version }),
    ),
  );
}

function asAsync(
  sources: AsyncIterable<KnowledgeSourceDocumentInput> | Iterable<KnowledgeSourceDocumentInput>,
): AsyncIterable<KnowledgeSourceDocumentInput> {
  if (Symbol.asyncIterator in Object(sources)) {
    return sources as AsyncIterable<KnowledgeSourceDocumentInput>;
  }
  const sync = sources as Iterable<KnowledgeSourceDocumentInput>;
  return {
    [Symbol.asyncIterator]() {
      const iterator = sync[Symbol.iterator]();
      return {
        next() {
          return Promise.resolve(iterator.next());
        },
      };
    },
  };
}

/**
 * Build one immutable revision from a potentially very large source stream.
 *
 * No batch is visible to retrieval while this runs: only a SEALED revision may be activated, and the
 * active release is switched once at the end when activateAfterSeal is explicitly true. If any
 * normalize/chunk/embed/stage operation fails, the previous active release remains untouched.
 */
export async function buildStreamingKnowledgeRelease(
  options: StreamingKnowledgeReleaseOptions,
): Promise<StreamingKnowledgeReleaseResult> {
  const maxDocuments = options.maxDocumentsPerStage ?? DEFAULT_MAX_DOCUMENTS_PER_STAGE;
  const maxChars = options.maxSourceCharsPerStage ?? DEFAULT_MAX_SOURCE_CHARS_PER_STAGE;
  validateBounds(maxDocuments, maxChars);

  const chunking = options.chunking ?? DEFAULT_CHUNKING_PROFILE;
  const embeddingBatch = options.embeddingBatch ?? DEFAULT_EMBEDDING_BATCH_OPTIONS;

  await options.writer.beginRelease(options.revision, options.embedding.modelRef);

  let pending: KnowledgeSourceDocumentInput[] = [];
  let pendingChars = 0;
  let sourceDocumentsRead = 0;
  let stageBatches = 0;
  let chunksStaged = 0;

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const current = pending;
    pending = [];
    pendingChars = 0;

    const prepared = prepareKnowledgeBatch(current, chunking);
    const embedded = await embedPreparedKnowledgeBatch(prepared, options.embedding, embeddingBatch);
    const staged = await options.writer.stage(embedded);
    await options.writer.addReleaseDocuments(options.revision, refsFor(current));
    stageBatches += 1;
    chunksStaged += staged.chunksStaged;
  };

  for await (const source of asAsync(options.sources)) {
    const chars = estimateSourceChars(source);
    if (pending.length > 0 && (pending.length >= maxDocuments || pendingChars + chars > maxChars)) {
      await flush();
    }
    pending.push(source);
    pendingChars += chars;
    sourceDocumentsRead += 1;

    // A single maximum-sized document is permitted. Flush it immediately rather than allowing the
    // next document to share its already-large normalization/chunking working set.
    if (pending.length >= maxDocuments || pendingChars >= maxChars) {
      await flush();
    }
  }
  await flush();

  const sealed = await options.writer.sealRelease(options.revision);
  if (options.activateAfterSeal) {
    await options.writer.activateRelease(options.revision);
  }

  return Object.freeze({
    revision: options.revision,
    sourceDocumentsRead,
    stageBatches,
    chunksStaged,
    documentsPublished: sealed.documentCount,
    activated: options.activateAfterSeal,
  });
}
