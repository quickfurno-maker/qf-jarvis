/**
 * JF-4B/C/D owner correction §12 — the production pack revision follows RECORDS, not vocabularies.
 *
 * This correction added `PROSPECT` to `KNOWLEDGE_AGENT_SCOPES` and `PROSPECT_RESPONSE` to
 * `KNOWLEDGE_PURPOSES` so Aarohi could retrieve under her own scope (ADR-0150 §4a). Both are inputs to
 * what a record's permissions may SAY — and neither is a record.
 *
 * ### Why this needs a spec of its own
 *
 * `PRODUCTION_KNOWLEDGE_PACK_REVISION` is the approval binding: an ACTIVE profile names it, and the
 * provisioner refuses unless the bound backend carries the same value (ADR-0148 §7). If a vocabulary
 * addition could move it, then every vocabulary change would silently invalidate a production
 * approval — or, worse, a derivation that folded the vocabulary in would let the revision change while
 * the approved BODY OF KNOWLEDGE did not, which is the same failure the JF-3 corrections closed from
 * the other direction.
 *
 * So the revision below is pinned as a literal. The pack is empty and must stay empty until the owner
 * supplies real records: this correction fabricates none, and `PRODUCTION_KNOWLEDGE_RECORDS` remains 0
 * by design, not by omission.
 */
import {
  KNOWLEDGE_AGENT_SCOPES,
  KNOWLEDGE_PURPOSES,
  type KnowledgeRecordInput,
} from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_KNOWLEDGE_PACK_MANIFEST,
  PRODUCTION_KNOWLEDGE_PACK_REVISION,
  PRODUCTION_KNOWLEDGE_RECORDS,
  createProductionRagBackend,
  createRevisionBoundKnowledgePack,
  productionKnowledgePack,
} from '../index.js';

/**
 * The exact revision of the EMPTY production pack, pinned.
 *
 * Derived by `createRevisionBoundKnowledgePack([])` — a SHA-256 over the canonical form of zero
 * records. It is written out here so that any change to the derivation, the canonical form, or the
 * record set fails this spec and has to be explained, rather than quietly re-labelling what a
 * production approval covers.
 */
const EMPTY_PACK_REVISION =
  'qfj.knowledge.sha256.f5cfdfecbeab1ea51bbdd4d37eb4dccca501bff07146f5b5ce6846a477006c0c';

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);

/** One synthetic record, so "adding a record moves the revision" can be measured rather than assumed. */
function syntheticRecord(over: Partial<KnowledgeRecordInput> = {}): KnowledgeRecordInput {
  return {
    knowledgeId: 'kb.synthetic.jf4',
    version: 1,
    topic: 'synthetic-topic',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: 'SYNTHETIC RECORD. Invented for a spec; not business truth and never provisioned.',
    contentDigest: digest('a'),
    sourceRef: 'test://synthetic',
    sourceRevision: 'rev-1',
    owner: 'owner.test',
    approvedBy: 'approver.test',
    approvedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-02T00:00:00Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: ['PROSPECT'],
      allowedPurposes: ['PROSPECT_RESPONSE'],
    },
    ...over,
  };
}

describe('JF-4 correction: the empty pack revision is unchanged by the vocabulary additions', () => {
  it('the vocabularies DID grow, and the empty pack revision did NOT move', () => {
    // Both halves matter. Asserting only the revision would pass trivially if the additions had never
    // landed; asserting only the additions would not say what they cost.
    expect([...KNOWLEDGE_AGENT_SCOPES]).toContain('PROSPECT');
    expect([...KNOWLEDGE_PURPOSES]).toContain('PROSPECT_RESPONSE');

    expect(PRODUCTION_KNOWLEDGE_RECORDS).toHaveLength(0);
    expect(PRODUCTION_KNOWLEDGE_PACK_REVISION).toBe(EMPTY_PACK_REVISION);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.revision).toBe(EMPTY_PACK_REVISION);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.recordCount).toBe(0);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.hasApprovedContent).toBe(false);
    // The BOUND backend an ACTIVE profile would have to match carries the same value.
    expect(createProductionRagBackend().knowledgeRevision).toBe(EMPTY_PACK_REVISION);
    expect(productionKnowledgePack().knowledgeRevision).toBe(EMPTY_PACK_REVISION);
  });

  it('the derivation depends on the RECORDS: it reproduces empty and moves when one is added', () => {
    // Re-derived from nothing, through the same public function the pack itself uses.
    expect(createRevisionBoundKnowledgePack([]).knowledgeRevision).toBe(EMPTY_PACK_REVISION);

    // And it is not a constant: one record, and the revision is different. Without this half, a
    // derivation that ignored its input would satisfy every assertion above.
    const withOne = createRevisionBoundKnowledgePack([syntheticRecord()]).knowledgeRevision;
    expect(withOne).not.toBe(EMPTY_PACK_REVISION);
    expect(withOne).toMatch(/^qfj\.knowledge\.sha256\.[0-9a-f]{64}$/);

    // Changing the PERMISSIONS of a record changes the revision too, because permissions are governed
    // metadata and a pack whose disclosure rules moved is a different pack.
    const narrower = createRevisionBoundKnowledgePack([
      syntheticRecord({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['CLIENT'],
          allowedPurposes: ['CLIENT_RESPONSE'],
        },
      }),
    ]).knowledgeRevision;
    expect(narrower).not.toBe(withOne);
    expect(narrower).not.toBe(EMPTY_PACK_REVISION);
  });

  it('this correction provisions nothing: the production registry is still empty', () => {
    // The synthetic records above exist only inside this spec. Nothing here reaches the production
    // pack, and no PROSPECT-scoped business truth was invented to make Aarohi look grounded.
    expect(productionKnowledgePack().registry.size).toBe(0);
    expect(productionKnowledgePack().registry.snapshot()).toEqual([]);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.topics).toEqual([]);
  });
});
