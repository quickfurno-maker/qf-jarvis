/**
 * The immutable governed-knowledge record (QFJ-P04.03, ADR-0051).
 *
 * A record is a reviewed, approved piece of reference material bound to an EXACT identity
 * (knowledge id + positive version + content digest) with provenance, lifecycle, freshness,
 * classification, and retrieval permissions. It carries no secret, no provider object, and no
 * arbitrary metadata bag. `createKnowledgeRecord` validates and deep-freezes; it throws a
 * content-free {@link GovernedKnowledgeError} on any violation.
 */
import { z } from 'zod';

import { GovernedKnowledgeError } from './errors.js';
import { isCanonicalInstant, parseInstant } from './instant.js';
import { freezePermissions, retrievalPermissionsSchema } from './permissions.js';
import type { RetrievalPermissions } from './permissions.js';
import {
  KNOWLEDGE_AUTHORITY_TIERS,
  KNOWLEDGE_CONTENT_FORMATS,
  KNOWLEDGE_DATA_CLASSES,
  KNOWLEDGE_LIFECYCLE_STATES,
  KNOWLEDGE_SOURCE_TYPES,
  VOLATILE_SOURCE_TYPES,
} from './vocabularies.js';
import type {
  KnowledgeAuthorityTier,
  KnowledgeContentFormat,
  KnowledgeDataClass,
  KnowledgeLifecycleState,
  KnowledgeSourceType,
} from './vocabularies.js';

/** The maximum stored content length of one record. */
export const MAX_RECORD_CONTENT_CHARS = 20_000;

/** The exact reference a `supersededBy` points at: an existing newer record's identity. */
export interface KnowledgeVersionRef {
  readonly knowledgeId: string;
  readonly version: number;
}

/** One immutable governed-knowledge record. */
export interface KnowledgeRecord {
  readonly knowledgeId: string;
  readonly version: number;
  readonly topic: string;
  readonly sourceType: KnowledgeSourceType;
  readonly authorityTier: KnowledgeAuthorityTier;
  readonly contentFormat: KnowledgeContentFormat;
  readonly content: string;
  readonly contentDigest: string;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly owner: string;
  readonly approvedBy: string | undefined;
  readonly approvedAt: string | undefined;
  readonly effectiveFrom: string;
  readonly expiresAt: string | undefined;
  readonly classification: KnowledgeDataClass;
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly permissions: RetrievalPermissions;
  readonly supersededBy: KnowledgeVersionRef | undefined;
  readonly subjectRef: string | undefined;
}

/** The mutable input accepted by {@link createKnowledgeRecord}. Optional fields may be omitted. */
export interface KnowledgeRecordInput {
  readonly knowledgeId: string;
  readonly version: number;
  readonly topic: string;
  readonly sourceType: KnowledgeSourceType;
  readonly authorityTier: KnowledgeAuthorityTier;
  readonly contentFormat: KnowledgeContentFormat;
  readonly content: string;
  readonly contentDigest: string;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly owner: string;
  readonly effectiveFrom: string;
  readonly classification: KnowledgeDataClass;
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly permissions: RetrievalPermissions;
  readonly approvedBy?: string | undefined;
  readonly approvedAt?: string | undefined;
  readonly expiresAt?: string | undefined;
  readonly supersededBy?: KnowledgeVersionRef | undefined;
  readonly subjectRef?: string | undefined;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const INSTANT = z.string().refine(isCanonicalInstant);
const VERSION = z.int().min(1).max(1_000_000);

/** Lifecycle states that require attributable approval metadata. */
const APPROVED_STATES: ReadonlySet<KnowledgeLifecycleState> = new Set([
  'APPROVED',
  'ACTIVE',
  'RETIRED',
]);

const recordSchema = z
  .object({
    knowledgeId: IDENTIFIER,
    version: VERSION,
    topic: IDENTIFIER,
    sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
    authorityTier: z.enum(KNOWLEDGE_AUTHORITY_TIERS),
    contentFormat: z.enum(KNOWLEDGE_CONTENT_FORMATS),
    content: z.string().min(1).max(MAX_RECORD_CONTENT_CHARS),
    contentDigest: z.string().regex(/^[0-9a-f]{64}$/),
    sourceRef: z.string().min(1).max(256),
    sourceRevision: z.string().min(1).max(128),
    owner: IDENTIFIER,
    effectiveFrom: INSTANT,
    classification: z.enum(KNOWLEDGE_DATA_CLASSES),
    lifecycleState: z.enum(KNOWLEDGE_LIFECYCLE_STATES),
    permissions: retrievalPermissionsSchema,
    approvedBy: IDENTIFIER.optional(),
    approvedAt: INSTANT.optional(),
    expiresAt: INSTANT.optional(),
    supersededBy: z.object({ knowledgeId: IDENTIFIER, version: VERSION }).strict().optional(),
    subjectRef: IDENTIFIER.optional(),
  })
  .strict();

/**
 * Validate and deep-freeze a candidate record. Enforces exact identity (no wildcard/`latest`),
 * approval metadata for approved-or-later states, a required expiry for volatile source types,
 * a coherent effective/expiry/approval ordering, and self-supersession rejection. Throws a
 * content-free {@link GovernedKnowledgeError} (`invalid-record`) on any violation.
 */
export function createKnowledgeRecord(input: KnowledgeRecordInput): KnowledgeRecord {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    throw new GovernedKnowledgeError('invalid-record');
  }
  const r = parsed.data;

  // No wildcard / `latest` authoritative identity.
  if (r.knowledgeId.toLowerCase() === 'latest' || r.topic.toLowerCase() === 'latest') {
    throw new GovernedKnowledgeError('invalid-record');
  }

  // Approved-or-later states require attributable approval metadata; earlier states must not carry it.
  const needsApproval = APPROVED_STATES.has(r.lifecycleState);
  const hasApproval = r.approvedBy !== undefined && r.approvedAt !== undefined;
  if (needsApproval !== hasApproval) {
    throw new GovernedKnowledgeError('invalid-record');
  }

  // Volatile source types must declare an expiry.
  if (VOLATILE_SOURCE_TYPES.has(r.sourceType) && r.expiresAt === undefined) {
    throw new GovernedKnowledgeError('invalid-record');
  }

  // Effective/expiry/approval ordering must be coherent.
  if (r.expiresAt !== undefined && parseInstant(r.expiresAt) <= parseInstant(r.effectiveFrom)) {
    throw new GovernedKnowledgeError('invalid-record');
  }
  if (r.approvedAt !== undefined && parseInstant(r.approvedAt) > parseInstant(r.effectiveFrom)) {
    throw new GovernedKnowledgeError('invalid-record');
  }

  // A record cannot supersede itself.
  const superseded = r.supersededBy;
  if (superseded !== undefined) {
    if (superseded.knowledgeId === r.knowledgeId && superseded.version === r.version) {
      throw new GovernedKnowledgeError('invalid-record');
    }
  }

  return Object.freeze({
    knowledgeId: r.knowledgeId,
    version: r.version,
    topic: r.topic,
    sourceType: r.sourceType,
    authorityTier: r.authorityTier,
    contentFormat: r.contentFormat,
    content: r.content,
    contentDigest: r.contentDigest,
    sourceRef: r.sourceRef,
    sourceRevision: r.sourceRevision,
    owner: r.owner,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt,
    effectiveFrom: r.effectiveFrom,
    expiresAt: r.expiresAt,
    classification: r.classification,
    lifecycleState: r.lifecycleState,
    permissions: freezePermissions(r.permissions),
    supersededBy:
      r.supersededBy === undefined
        ? undefined
        : Object.freeze({
            knowledgeId: r.supersededBy.knowledgeId,
            version: r.supersededBy.version,
          }),
    subjectRef: r.subjectRef,
  });
}

/** The exact tuple key `knowledgeId@version` identifying a record. */
export function recordIdentityKey(knowledgeId: string, version: number): string {
  return `${knowledgeId}@${String(version)}`;
}
