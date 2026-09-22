import { createKnowledgeRecord } from '@qf-jarvis/governed-knowledge';

import { DEFAULT_CHUNKING_PROFILE } from './contracts.js';
import type {
  ChunkingProfile,
  GovernedKnowledgeChunk,
  NormalizedKnowledgeDocument,
} from './contracts.js';
import { KnowledgeIngestionError } from './errors.js';
import { sha256Hex } from './normalize.js';

interface SourceBlock {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly headingPath: readonly string[];
}

interface DraftChunk {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly headingPath: readonly string[];
}

const HEADING = /^(#{1,6})\s+(.+?)\s*$/u;
const SENTENCE_END = /(?<=[.!?।])\s+/u;

function validateProfile(profile: ChunkingProfile): void {
  if (
    !Number.isInteger(profile.targetChars) ||
    !Number.isInteger(profile.maxChars) ||
    !Number.isInteger(profile.overlapChars) ||
    !Number.isInteger(profile.maxChunksPerDocument) ||
    profile.targetChars < 256 ||
    profile.maxChars < profile.targetChars ||
    profile.maxChars > 20_000 ||
    profile.overlapChars < 0 ||
    profile.overlapChars >= profile.targetChars ||
    profile.maxChunksPerDocument < 1 ||
    profile.maxChunksPerDocument > 100_000
  ) {
    throw new KnowledgeIngestionError('chunking-profile-invalid');
  }
}

function splitOversizedBlock(block: SourceBlock, maxChars: number): readonly SourceBlock[] {
  if (block.text.length <= maxChars) return [block];

  const sentences = block.text.split(SENTENCE_END).filter((part) => part.length > 0);
  const parts: SourceBlock[] = [];
  let cursor = block.start;
  let current = '';

  const flush = (): void => {
    const text = current.trim();
    if (text.length === 0) return;
    const relative = block.text.indexOf(text, Math.max(0, cursor - block.start));
    const start = relative < 0 ? cursor : block.start + relative;
    parts.push(
      Object.freeze({
        text,
        start,
        end: Math.min(block.end, start + text.length),
        headingPath: block.headingPath,
      }),
    );
    cursor = Math.min(block.end, start + text.length);
    current = '';
  };

  for (const sentence of sentences.length === 0 ? [block.text] : sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length > maxChars) {
      flush();
      let offset = 0;
      while (offset < trimmed.length) {
        const text = trimmed.slice(offset, offset + maxChars);
        const found = block.text.indexOf(text, Math.max(0, cursor - block.start));
        const start = found < 0 ? cursor : block.start + found;
        parts.push(
          Object.freeze({
            text,
            start,
            end: Math.min(block.end, start + text.length),
            headingPath: block.headingPath,
          }),
        );
        cursor = Math.min(block.end, start + text.length);
        offset += text.length;
      }
      continue;
    }
    const candidate = current.length === 0 ? trimmed : current + ' ' + trimmed;
    if (candidate.length > maxChars) flush();
    current = current.length === 0 ? trimmed : current + ' ' + trimmed;
  }
  flush();
  return parts;
}

function blocksFor(content: string, maxChars: number): readonly SourceBlock[] {
  const lines = content.split('\n');
  const headings: string[] = [];
  const blocks: SourceBlock[] = [];
  let absolute = 0;
  let paragraphStart = -1;
  let paragraphLines: string[] = [];
  let paragraphHeadings: readonly string[] = Object.freeze([]);

  const flushParagraph = (): void => {
    if (paragraphStart < 0 || paragraphLines.length === 0) return;
    const text = paragraphLines.join('\n').trim();
    if (text.length > 0) {
      const raw = content.indexOf(text, paragraphStart);
      const start = raw < 0 ? paragraphStart : raw;
      const block = Object.freeze({
        text,
        start,
        end: start + text.length,
        headingPath: paragraphHeadings,
      });
      blocks.push(...splitOversizedBlock(block, maxChars));
    }
    paragraphStart = -1;
    paragraphLines = [];
  };

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match !== null) {
      flushParagraph();
      const depth = match[1]?.length ?? 1;
      const title = match[2]?.trim() ?? '';
      headings.splice(Math.max(0, depth - 1));
      headings[depth - 1] = title;
      const text = line.trim();
      blocks.push(
        Object.freeze({
          text,
          start: absolute,
          end: absolute + line.length,
          headingPath: Object.freeze([...headings]),
        }),
      );
    } else if (line.trim().length === 0) {
      flushParagraph();
    } else {
      if (paragraphStart < 0) {
        paragraphStart = absolute;
        paragraphHeadings = Object.freeze([...headings]);
      }
      paragraphLines.push(line);
    }
    absolute += line.length + 1;
  }
  flushParagraph();
  return blocks;
}

function buildDraftChunks(
  blocks: readonly SourceBlock[],
  profile: ChunkingProfile,
): readonly DraftChunk[] {
  const chunks: DraftChunk[] = [];
  let current: SourceBlock[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.map((b) => b.text).join('\n\n');
    const first = current[0];
    const last = current[current.length - 1];
    if (first === undefined || last === undefined) {
      throw new KnowledgeIngestionError('ingestion-invariant');
    }
    chunks.push(
      Object.freeze({
        text,
        start: first.start,
        end: last.end,
        headingPath: last.headingPath,
      }),
    );

    if (profile.overlapChars === 0) {
      current = [];
      currentLength = 0;
      return;
    }
    const overlapText = text.slice(-profile.overlapChars);
    const overlapStart = Math.max(first.start, last.end - overlapText.length);
    current =
      overlapText.length === 0
        ? []
        : [
            Object.freeze({
              text: overlapText,
              start: overlapStart,
              end: last.end,
              headingPath: last.headingPath,
            }),
          ];
    currentLength = overlapText.length;
  };

  for (const block of blocks) {
    const separator = current.length === 0 ? 0 : 2;
    if (current.length > 0 && currentLength + separator + block.text.length > profile.maxChars) {
      flush();
      if (current.length > 0 && currentLength + 2 + block.text.length > profile.maxChars) {
        const overlap = current[0];
        const allowed = Math.max(0, profile.maxChars - block.text.length - 2);
        if (overlap === undefined || allowed === 0) {
          current = [];
          currentLength = 0;
        } else {
          const text = overlap.text.slice(-allowed);
          current = [
            Object.freeze({
              text,
              start: Math.max(overlap.start, overlap.end - text.length),
              end: overlap.end,
              headingPath: overlap.headingPath,
            }),
          ];
          currentLength = text.length;
        }
      }
    }
    current.push(block);
    currentLength += (current.length === 1 ? 0 : 2) + block.text.length;
    if (currentLength >= profile.targetChars) flush();
  }
  flush();
  return chunks;
}

function chunkIdentity(
  document: NormalizedKnowledgeDocument,
  index: number,
  chunkDigest: string,
): string {
  const material = [
    document.governance.knowledgeId,
    String(document.governance.version),
    String(index),
    chunkDigest,
  ].join('\u0000');
  return 'kchunk.' + sha256Hex(material).slice(0, 56);
}

export function chunkKnowledgeDocument(
  document: NormalizedKnowledgeDocument,
  profile: ChunkingProfile = DEFAULT_CHUNKING_PROFILE,
): readonly GovernedKnowledgeChunk[] {
  validateProfile(profile);
  const drafts = buildDraftChunks(blocksFor(document.content, profile.maxChars), profile);
  if (drafts.length === 0 || drafts.length > profile.maxChunksPerDocument) {
    throw new KnowledgeIngestionError('chunk-limit-exceeded');
  }

  const chunkCount = drafts.length;
  return Object.freeze(
    drafts.map((draft, chunkIndex) => {
      const chunkDigest = sha256Hex(draft.text);
      const chunkId = chunkIdentity(document, chunkIndex, chunkDigest);
      const g = document.governance;
      let record;
      try {
        record = createKnowledgeRecord({
          knowledgeId: chunkId,
          version: 1,
          topic: g.topic,
          sourceType: g.sourceType,
          authorityTier: g.authorityTier,
          contentFormat: g.contentFormat,
          content: draft.text,
          contentDigest: chunkDigest,
          sourceRef: g.sourceRef,
          sourceRevision: g.sourceRevision,
          owner: g.owner,
          effectiveFrom: g.effectiveFrom,
          classification: g.classification,
          lifecycleState: g.lifecycleState,
          permissions: g.permissions,
          ...(g.approvedBy === undefined ? {} : { approvedBy: g.approvedBy }),
          ...(g.approvedAt === undefined ? {} : { approvedAt: g.approvedAt }),
          ...(g.expiresAt === undefined ? {} : { expiresAt: g.expiresAt }),
          ...(g.subjectRef === undefined ? {} : { subjectRef: g.subjectRef }),
        });
      } catch {
        throw new KnowledgeIngestionError('ingestion-invariant');
      }
      return Object.freeze({
        chunkId,
        parentKnowledgeId: g.knowledgeId,
        parentVersion: g.version,
        parentContentDigest: document.contentDigest,
        sourceLayer: document.sourceLayer,
        chunkIndex,
        chunkCount,
        headingPath: draft.headingPath,
        sourceStart: draft.start,
        sourceEnd: draft.end,
        record,
      });
    }),
  );
}
