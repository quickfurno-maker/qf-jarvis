import { createHash } from 'node:crypto';

import { createKnowledgeRecord } from '@qf-jarvis/governed-knowledge';

import {
  KNOWLEDGE_SOURCE_LAYERS,
  MAX_SOURCE_DOCUMENT_CHARS,
  MAX_STRUCTURED_FIELDS,
} from './contracts.js';
import type {
  KnowledgeGovernanceEnvelope,
  KnowledgeSourceDocumentInput,
  NormalizedKnowledgeDocument,
  StructuredKnowledgeField,
} from './contracts.js';
import { KnowledgeIngestionError } from './errors.js';

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;
const HORIZONTAL_SPACE = /[ \t]+/gu;
const TOO_MANY_BLANK_LINES = /\n{4,}/gu;
const STRUCTURED_KEY = /^[A-Za-z0-9._:-]{1,128}$/u;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stripUnsafeControls(input: string): string {
  let output = '';
  for (const character of input) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) continue;
    output += character;
  }
  return output;
}

export function normalizeKnowledgeText(input: string): string {
  const normalized = stripUnsafeControls(input)
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(ZERO_WIDTH, '')
    .split('\n')
    .map((line) => line.replace(HORIZONTAL_SPACE, ' ').trimEnd())
    .join('\n')
    .replace(TOO_MANY_BLANK_LINES, '\n\n\n')
    .trim();

  if (normalized.length === 0) {
    throw new KnowledgeIngestionError('invalid-source-document');
  }
  if (normalized.length > MAX_SOURCE_DOCUMENT_CHARS) {
    throw new KnowledgeIngestionError('source-too-large');
  }
  return normalized;
}

function structuredValue(value: StructuredKnowledgeField['value']): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFKC'));
  return JSON.stringify(value);
}

export function renderStructuredKnowledge(fields: readonly StructuredKnowledgeField[]): string {
  if (fields.length === 0 || fields.length > MAX_STRUCTURED_FIELDS) {
    throw new KnowledgeIngestionError('structured-field-invalid');
  }
  const seen = new Set<string>();
  const ordered = [...fields].sort((a, b) => a.key.localeCompare(b.key));
  const lines: string[] = [];
  for (const field of ordered) {
    if (!STRUCTURED_KEY.test(field.key) || seen.has(field.key)) {
      throw new KnowledgeIngestionError('structured-field-invalid');
    }
    if (typeof field.value === 'number' && !Number.isFinite(field.value)) {
      throw new KnowledgeIngestionError('structured-field-invalid');
    }
    seen.add(field.key);
    lines.push(field.key + ': ' + structuredValue(field.value));
  }
  return normalizeKnowledgeText(lines.join('\n'));
}

function validateEnvelope(input: KnowledgeSourceDocumentInput): KnowledgeGovernanceEnvelope {
  if (!(KNOWLEDGE_SOURCE_LAYERS as readonly string[]).includes(input.sourceLayer)) {
    throw new KnowledgeIngestionError('invalid-source-document');
  }
  if (
    (input.sourceLayer === 'STRUCTURED_DATA' && input.payload.kind !== 'STRUCTURED') ||
    (input.sourceLayer !== 'STRUCTURED_DATA' && input.payload.kind !== 'TEXT')
  ) {
    throw new KnowledgeIngestionError('invalid-source-document');
  }

  const sentinel = 'metadata-validation';
  let validated;
  try {
    validated = createKnowledgeRecord({
      knowledgeId: input.knowledgeId,
      version: input.version,
      topic: input.topic,
      sourceType: input.sourceType,
      authorityTier: input.authorityTier,
      contentFormat: input.contentFormat,
      content: sentinel,
      contentDigest: sha256Hex(sentinel),
      sourceRef: input.sourceRef,
      sourceRevision: input.sourceRevision,
      owner: input.owner,
      effectiveFrom: input.effectiveFrom,
      classification: input.classification,
      lifecycleState: input.lifecycleState,
      permissions: input.permissions,
      ...(input.approvedBy === undefined ? {} : { approvedBy: input.approvedBy }),
      ...(input.approvedAt === undefined ? {} : { approvedAt: input.approvedAt }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      ...(input.supersededBy === undefined ? {} : { supersededBy: input.supersededBy }),
      ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
    });
  } catch {
    throw new KnowledgeIngestionError('invalid-source-document');
  }

  return Object.freeze({
    knowledgeId: validated.knowledgeId,
    version: validated.version,
    topic: validated.topic,
    sourceType: validated.sourceType,
    authorityTier: validated.authorityTier,
    contentFormat: validated.contentFormat,
    sourceRef: validated.sourceRef,
    sourceRevision: validated.sourceRevision,
    owner: validated.owner,
    approvedBy: validated.approvedBy,
    approvedAt: validated.approvedAt,
    effectiveFrom: validated.effectiveFrom,
    expiresAt: validated.expiresAt,
    classification: validated.classification,
    lifecycleState: validated.lifecycleState,
    permissions: validated.permissions,
    supersededBy: validated.supersededBy,
    subjectRef: validated.subjectRef,
  });
}

export function normalizeSourceDocument(
  input: KnowledgeSourceDocumentInput,
): NormalizedKnowledgeDocument {
  const governance = validateEnvelope(input);
  const content =
    input.payload.kind === 'TEXT'
      ? normalizeKnowledgeText(input.payload.text)
      : renderStructuredKnowledge(input.payload.fields);
  return Object.freeze({
    sourceLayer: input.sourceLayer,
    governance,
    content,
    contentDigest: sha256Hex(content),
  });
}
