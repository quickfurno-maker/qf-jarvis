/**
 * The immutable governed-knowledge registry (QFJ-P04.03, ADR-0051 §B, §D, §G).
 *
 * Built once from a set of records: it rejects duplicate and content-conflicting identities, validates
 * every supersession edge, orders deterministically, and exposes only BOUNDED lookups (exact
 * id/version, exact topic) plus a content-free {@link KnowledgeRecordSummary} snapshot. There is no
 * mutation after construction and no unrestricted "list every record's content" operation.
 */
import { GovernedKnowledgeError } from '../contracts/errors.js';
import { createKnowledgeRecord, recordIdentityKey } from '../contracts/knowledge-record.js';
import type {
  KnowledgeRecord,
  KnowledgeRecordInput,
  KnowledgeVersionRef,
} from '../contracts/knowledge-record.js';
import type {
  KnowledgeAuthorityTier,
  KnowledgeDataClass,
  KnowledgeLifecycleState,
  KnowledgeSourceType,
} from '../contracts/vocabularies.js';
import { validateSupersession } from './supersession.js';

/** A safe, content-free summary of one record — no content and no subject reference. */
export interface KnowledgeRecordSummary {
  readonly knowledgeId: string;
  readonly version: number;
  readonly topic: string;
  readonly sourceType: KnowledgeSourceType;
  readonly authorityTier: KnowledgeAuthorityTier;
  readonly classification: KnowledgeDataClass;
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly effectiveFrom: string;
  readonly expiresAt: string | undefined;
  readonly contentDigest: string;
  readonly subjectLinked: boolean;
  readonly supersededBy: KnowledgeVersionRef | undefined;
}

/** The immutable registry surface consumed by retrieval and by a separate audit lookup. */
export interface GovernedKnowledgeRegistry {
  readonly size: number;
  /** Exact identity lookup; `undefined` when the id/version is not registered. */
  resolveExact(knowledgeId: string, version: number): KnowledgeRecord | undefined;
  /** Every record for one EXACT topic, in deterministic order (any lifecycle state). */
  listByTopic(topic: string): readonly KnowledgeRecord[];
  /** The deterministic list of `knowledgeId@version` identity keys. */
  identityKeys(): readonly string[];
  /** A frozen, content-free summary of every record. */
  snapshot(): readonly KnowledgeRecordSummary[];
}

function compareRecords(a: KnowledgeRecord, b: KnowledgeRecord): number {
  if (a.knowledgeId !== b.knowledgeId) {
    return a.knowledgeId < b.knowledgeId ? -1 : 1;
  }
  return a.version - b.version;
}

function summarize(record: KnowledgeRecord): KnowledgeRecordSummary {
  return Object.freeze({
    knowledgeId: record.knowledgeId,
    version: record.version,
    topic: record.topic,
    sourceType: record.sourceType,
    authorityTier: record.authorityTier,
    classification: record.classification,
    lifecycleState: record.lifecycleState,
    effectiveFrom: record.effectiveFrom,
    expiresAt: record.expiresAt,
    contentDigest: record.contentDigest,
    subjectLinked: record.subjectRef !== undefined,
    supersededBy: record.supersededBy,
  });
}

/**
 * Build an immutable registry from records or raw inputs. A duplicate identity with the SAME digest
 * is `duplicate-record`; the same identity with a DIFFERENT digest is `conflicting-record`. All
 * supersession edges are validated. The result is frozen and deterministically ordered.
 */
export function createGovernedKnowledgeRegistry(
  records: readonly (KnowledgeRecord | KnowledgeRecordInput)[],
): GovernedKnowledgeRegistry {
  const built = records.map((r) => createKnowledgeRecord(r));
  const ordered = [...built].sort(compareRecords);

  const byIdentity = new Map<string, KnowledgeRecord>();
  const byTopic = new Map<string, KnowledgeRecord[]>();

  for (const record of ordered) {
    const key = recordIdentityKey(record.knowledgeId, record.version);
    const existing = byIdentity.get(key);
    if (existing !== undefined) {
      throw new GovernedKnowledgeError(
        existing.contentDigest === record.contentDigest ? 'duplicate-record' : 'conflicting-record',
      );
    }
    byIdentity.set(key, record);
    const topicList = byTopic.get(record.topic);
    if (topicList === undefined) {
      byTopic.set(record.topic, [record]);
    } else {
      topicList.push(record);
    }
  }

  validateSupersession(byIdentity);

  const identityKeys = Object.freeze(
    ordered.map((r) => recordIdentityKey(r.knowledgeId, r.version)),
  );
  const frozenSnapshot = Object.freeze(ordered.map(summarize));

  return Object.freeze({
    size: ordered.length,
    resolveExact(knowledgeId: string, version: number): KnowledgeRecord | undefined {
      return byIdentity.get(recordIdentityKey(knowledgeId, version));
    },
    listByTopic(topic: string): readonly KnowledgeRecord[] {
      const list = byTopic.get(topic);
      return list === undefined ? Object.freeze([]) : Object.freeze([...list]);
    },
    identityKeys(): readonly string[] {
      return identityKeys;
    },
    snapshot(): readonly KnowledgeRecordSummary[] {
      return frozenSnapshot;
    },
  });
}
