import type { KnowledgeSourceDocumentInput } from './contracts.js';
import { KnowledgeIngestionError } from './errors.js';

export const EXTRACTED_KNOWLEDGE_MEDIA_TYPES = [
  'text/plain',
  'text/markdown',
  'text/html',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type ExtractedKnowledgeMediaType = (typeof EXTRACTED_KNOWLEDGE_MEDIA_TYPES)[number];

export interface ExtractedKnowledgeSourceInput {
  readonly document: Omit<KnowledgeSourceDocumentInput, 'payload' | 'contentFormat'>;
  readonly mediaType: ExtractedKnowledgeMediaType;
  readonly extractedText: string;
  readonly extractionRef: string;
  readonly sourceDigest: string;
  readonly malwareScan: 'PASSED' | 'FAILED' | 'UNKNOWN';
}

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

/**
 * Admit already-extracted file content into the semantic pipeline.
 *
 * Binary parsing, OCR, archive expansion and malware scanning stay outside the RAG core. This boundary
 * accepts only bounded extracted text plus explicit provenance and a PASSED malware-scan assertion.
 * It never accepts raw PDF/DOCX/HTML bytes and therefore cannot accidentally become a file parser.
 */
export function createExtractedKnowledgeSource(
  input: ExtractedKnowledgeSourceInput,
): KnowledgeSourceDocumentInput {
  if (
    !(EXTRACTED_KNOWLEDGE_MEDIA_TYPES as readonly string[]).includes(input.mediaType) ||
    !REF.test(input.extractionRef) ||
    !SHA256.test(input.sourceDigest) ||
    input.malwareScan !== 'PASSED' ||
    input.document.sourceLayer === 'STRUCTURED_DATA' ||
    typeof input.extractedText !== 'string' ||
    input.extractedText.length < 1
  ) {
    throw new KnowledgeIngestionError('invalid-source-document');
  }

  const sourceRevision = `${input.document.sourceRevision}.extract.${input.sourceDigest.slice(0, 16)}`;
  const sourceRef = `${input.document.sourceRef}#extract=${input.extractionRef}`;
  if (sourceRevision.length > 128 || sourceRef.length > 256) {
    throw new KnowledgeIngestionError('invalid-source-document');
  }
  const contentFormat = input.mediaType === 'text/markdown' ? 'MARKDOWN' : 'PLAIN_TEXT';
  return Object.freeze({
    ...input.document,
    contentFormat,
    payload: Object.freeze({ kind: 'TEXT' as const, text: input.extractedText }),
    sourceRevision,
    sourceRef,
  });
}
