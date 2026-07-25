/**
 * Supersession validation for the governed-knowledge registry (QFJ-P04.03, ADR-0051 §G).
 *
 * Every `supersededBy` edge must (1) resolve to an existing record, (2) not lie on a cycle, and
 * (3) point to a strictly NEWER record — a higher version within the same knowledge line, or a later
 * `effectiveFrom` across lines. The three checks run in that order so each failure is attributed to
 * its own precise, content-free {@link GovernedKnowledgeError}.
 */
import { GovernedKnowledgeError } from '../contracts/errors.js';
import { parseInstant } from '../contracts/instant.js';
import { recordIdentityKey } from '../contracts/knowledge-record.js';
import type { KnowledgeRecord } from '../contracts/knowledge-record.js';

function isNewer(target: KnowledgeRecord, source: KnowledgeRecord): boolean {
  if (target.knowledgeId === source.knowledgeId) {
    return target.version > source.version;
  }
  return parseInstant(target.effectiveFrom) > parseInstant(source.effectiveFrom);
}

/**
 * Validate all supersession edges over the registry's identity map. Throws `supersession-missing`,
 * `supersession-cycle`, or `supersession-not-newer` (checked in that order).
 */
export function validateSupersession(byIdentity: ReadonlyMap<string, KnowledgeRecord>): void {
  // 1. Existence — every edge resolves to a known record.
  for (const record of byIdentity.values()) {
    if (record.supersededBy === undefined) {
      continue;
    }
    const targetKey = recordIdentityKey(
      record.supersededBy.knowledgeId,
      record.supersededBy.version,
    );
    if (!byIdentity.has(targetKey)) {
      throw new GovernedKnowledgeError('supersession-missing');
    }
  }

  // 2. Cycles — walk each chain; a revisited node is a cycle.
  for (const start of byIdentity.values()) {
    const seen = new Set<string>();
    let cursor: KnowledgeRecord | undefined = start;
    while (cursor?.supersededBy !== undefined) {
      const here = recordIdentityKey(cursor.knowledgeId, cursor.version);
      if (seen.has(here)) {
        throw new GovernedKnowledgeError('supersession-cycle');
      }
      seen.add(here);
      const nextKey = recordIdentityKey(
        cursor.supersededBy.knowledgeId,
        cursor.supersededBy.version,
      );
      cursor = byIdentity.get(nextKey);
    }
  }

  // 3. Newer — every edge points to a strictly newer record.
  for (const record of byIdentity.values()) {
    if (record.supersededBy === undefined) {
      continue;
    }
    const targetKey = recordIdentityKey(
      record.supersededBy.knowledgeId,
      record.supersededBy.version,
    );
    const target = byIdentity.get(targetKey);
    if (target === undefined || !isNewer(target, record)) {
      throw new GovernedKnowledgeError('supersession-not-newer');
    }
  }
}
