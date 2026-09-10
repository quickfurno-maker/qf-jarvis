/**
 * Deriving a content-addressed knowledge revision (JF-3 owner correction, ADR-0148 §11a).
 *
 * This is the ONLY file in the package that computes a digest, and the only one that imports
 * `node:crypto`. It performs no network, filesystem, environment, clock, provider or database access:
 * `createHash` here is a pure synchronous function over a string this module built itself.
 *
 * ### The canonical form, and why each part of it is there
 *
 * Every record is re-proved through `createKnowledgeRecord` first, so the hash is taken over VALIDATED
 * governed records rather than over whatever shape a caller passed. Records are then sorted by
 * `(knowledgeId, version)`, so the same pack declared in a different order yields the same revision —
 * declaration order is an authoring detail, not a fact about the knowledge.
 *
 * **Actual `content` is hashed, not just `contentDigest`.** This is the correction's load-bearing
 * detail. The governed contract treats `contentDigest` as a supplied field: `createKnowledgeRecord`
 * checks its SHAPE (64 hex characters) but does not recompute it from the text. So a record whose text
 * was edited while its digest was left stale is a valid governed record — and hashing only the digest
 * would let changed text hide behind it. Hashing the text closes that.
 *
 * **Governance metadata is hashed too**, not only the text. Changing a record's classification,
 * permissions, approver, lifecycle state, effective window, supersession, subject link or source
 * identity changes what the pack MEANS and who may see it. A revision that ignored those would let a
 * record be re-scoped from LOCAL_ONLY to HOSTED_ALLOWED, or re-permissioned to a new tenant, without
 * the approval identity changing.
 *
 * ### Encoding
 *
 * Each field is emitted as `name=<JSON>`, one per line. JSON string encoding is used precisely because
 * it is unambiguous: a record whose content contains newlines, `=` characters, or anything else that
 * would collide with a hand-rolled separator cannot be made to serialize identically to a different
 * record. `undefined` is emitted as `null` so an absent field and a null field cannot be confused.
 *
 * The format carries an explicit version line. If the canonical form ever changes, revisions change
 * with it — deliberately and visibly, rather than two builds of the same records silently disagreeing
 * across a release boundary.
 */
import { createHash } from 'node:crypto';

import {
  createGovernedKnowledgeRegistry,
  createKnowledgeRecord,
} from '@qf-jarvis/governed-knowledge';
import type { KnowledgeRecord, KnowledgeRecordInput } from '@qf-jarvis/governed-knowledge';

import type { RevisionBoundKnowledgePack } from '../contracts/revision-bound-knowledge-pack.js';

/** The canonical-form version. Bumping it deliberately changes every derived revision. */
const CANONICAL_FORM = 'qfj.knowledge.canonical.v1';

/** The prefix of every derived revision. */
export const KNOWLEDGE_REVISION_PREFIX = 'qfj.knowledge.sha256.';

/** Matches a revision this module could have produced. */
export const DERIVED_KNOWLEDGE_REVISION = /^qfj\.knowledge\.sha256\.[0-9a-f]{64}$/;

/** One field of the canonical form. `undefined` becomes `null`; strings keep their exact code points. */
function field(name: string, value: unknown): string {
  return `${name}=${JSON.stringify(value ?? null)}`;
}

/**
 * The canonical serialization of one validated record.
 *
 * The field list is explicit and ordered rather than derived from `Object.keys`, so adding a field to
 * the governed record contract does not silently change every revision in the repository — it fails
 * review here first, which is where that decision belongs.
 *
 * `permissions.allowedAgentScopes` and `allowedPurposes` arrive already canonical: `freezePermissions`
 * de-duplicates them and orders them by the governed vocabulary, so two records that permit the same
 * set serialize identically regardless of how the set was written. They are sets semantically, and
 * they are treated as sets here.
 */
function canonicalRecord(record: KnowledgeRecord): string {
  return [
    field('knowledgeId', record.knowledgeId),
    field('version', record.version),
    field('topic', record.topic),
    field('sourceType', record.sourceType),
    field('authorityTier', record.authorityTier),
    field('contentFormat', record.contentFormat),
    // The actual text. Not a proxy for it.
    field('content', record.content),
    field('contentDigest', record.contentDigest),
    field('sourceRef', record.sourceRef),
    field('sourceRevision', record.sourceRevision),
    field('owner', record.owner),
    field('approvedBy', record.approvedBy),
    field('approvedAt', record.approvedAt),
    field('effectiveFrom', record.effectiveFrom),
    field('expiresAt', record.expiresAt),
    field('classification', record.classification),
    field('lifecycleState', record.lifecycleState),
    field('permissions.tenantScope', record.permissions.tenantScope),
    field('permissions.allowedAgentScopes', [...record.permissions.allowedAgentScopes]),
    field('permissions.allowedPurposes', [...record.permissions.allowedPurposes]),
    field('supersededBy.knowledgeId', record.supersededBy?.knowledgeId),
    field('supersededBy.version', record.supersededBy?.version),
    field('subjectRef', record.subjectRef),
  ].join('\n');
}

/** Order records by exact identity, so declaration order cannot change the revision. */
function compareIdentity(a: KnowledgeRecord, b: KnowledgeRecord): number {
  if (a.knowledgeId !== b.knowledgeId) {
    return a.knowledgeId < b.knowledgeId ? -1 : 1;
  }
  return a.version - b.version;
}

/** The canonical serialization of a whole pack. Exported for the spec that pins the format. */
export function canonicalPackForm(records: readonly KnowledgeRecord[]): string {
  const ordered = [...records].sort(compareIdentity);
  return [
    CANONICAL_FORM,
    field('recordCount', ordered.length),
    ...ordered.map((record, index) => `record[${String(index)}]\n${canonicalRecord(record)}`),
  ].join('\n');
}

/**
 * Build a revision-bound knowledge pack from candidate records.
 *
 * Every record is validated through the governed record contract first, so an unreviewed, unattributed,
 * wildcard-identified or incoherent record cannot enter a pack — it throws, loudly, rather than
 * becoming a quiet answer with a freshly-minted revision attached.
 *
 * The registry is then built from EXACTLY the records the revision was derived from. Not from the
 * caller's input again, and not from a second pass: one list, hashed and registered, so there is no
 * window in which the two could differ.
 */
export function createRevisionBoundKnowledgePack(
  records: readonly (KnowledgeRecord | KnowledgeRecordInput)[],
): RevisionBoundKnowledgePack {
  const validated = records.map((record) => createKnowledgeRecord(record));
  const ordered = [...validated].sort(compareIdentity);

  const digest = createHash('sha256').update(canonicalPackForm(ordered), 'utf8').digest('hex');

  // The registry is built from the SAME validated list that was just hashed. `createGovernedKnowledgeRegistry`
  // additionally refuses duplicate and conflicting identities and validates every supersession edge,
  // so a pack that hashes cleanly can still be refused for being internally incoherent.
  const registry = createGovernedKnowledgeRegistry(ordered);

  return Object.freeze({
    knowledgeRevision: `${KNOWLEDGE_REVISION_PREFIX}${digest}`,
    registry,
    recordCount: ordered.length,
    topics: Object.freeze([...new Set(ordered.map((r) => r.topic))].sort()),
  });
}
