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
 *
 * ### Authenticity: this module is the only place a pack can come from
 *
 * Deriving the revision here is necessary but was not sufficient. TypeScript interfaces are
 * structural, so an object literal with the right four fields satisfies `RevisionBoundKnowledgePack`
 * at compile time and passes any shape check at runtime — including one carrying pack A's approved
 * revision beside pack B's registry. Measured on the previous head, that forgery constructed a
 * backend, activated, and served B's records while reporting A's revision.
 *
 * So every pack this factory builds is recorded in a module-private `WeakSet`, and
 * {@link isAuthenticRevisionBoundKnowledgePack} answers one question: did THIS module make THIS
 * object? A lookalike is not a pack, however convincing its shape.
 *
 * A `WeakSet` rather than a brand field or a symbol, for a specific reason: a field can be copied. A
 * spread, a clone, a `JSON.parse` round trip and a hand-written literal all reproduce every field of
 * a pack, and any of them would carry a brand across with it. Membership of a set keyed on object
 * identity cannot be copied — only the exact object this module froze is in it. It is also weak, so a
 * pack that goes out of scope is collected normally and nothing here retains knowledge.
 *
 * **What this is not.** It is process-local and it is not a signature. It proves an object was made by
 * this factory in this process; it says nothing across a process boundary, a serialization, or an
 * IPC hop. A pack that has been serialized must be rebuilt from its governed records through this
 * factory, which re-derives the revision from the records — so the rebuild is a re-proof rather than
 * a re-labelling. A revision-bound pack is an in-memory capability, not a bearer token.
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

/**
 * Every pack this module has built, keyed by object identity.
 *
 * Module-private and deliberately unexported, in either direction: there is no accessor that reveals
 * it and no function that adds to it. The only way in is to build a pack here, which means deriving
 * the revision from validated records — so membership is not a claim about a pack, it IS the pack
 * having been derived.
 */
const AUTHENTIC_REVISION_BOUND_PACKS = new WeakSet<object>();

/**
 * Did this exact object come from {@link createRevisionBoundKnowledgePack}?
 *
 * PACKAGE-INTERNAL. Not exported from the package root and not from `./testing`; `package.json`
 * exposes only those two subpaths, so nothing outside this package can reach it. That matters less
 * for secrecy than for meaning: this is not a validator a caller should be able to consult about an
 * object it built, it is the backend's check that it was handed a real pack.
 *
 * Structural lookalikes return `false`, including a spread of an authentic pack, which is the whole
 * point — copying a pack's fields does not copy its provenance.
 */
export function isAuthenticRevisionBoundKnowledgePack(
  value: unknown,
): value is RevisionBoundKnowledgePack {
  return value !== null && typeof value === 'object' && AUTHENTIC_REVISION_BOUND_PACKS.has(value);
}

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

  const pack = Object.freeze({
    knowledgeRevision: `${KNOWLEDGE_REVISION_PREFIX}${digest}`,
    registry,
    recordCount: ordered.length,
    topics: Object.freeze([...new Set(ordered.map((r) => r.topic))].sort()),
  });

  // Recorded ONLY here, and only for an object whose revision was just derived from its own records.
  AUTHENTIC_REVISION_BOUND_PACKS.add(pack);
  return pack;
}
