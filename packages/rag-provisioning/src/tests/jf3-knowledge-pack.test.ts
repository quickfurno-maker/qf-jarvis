/**
 * JF-3 matrix items 59–64 — the revision-bound production knowledge pack (ADR-0148 §7, §8).
 *
 * The pack ships ZERO production records, because repository inspection found no accepted business
 * knowledge to build one from. These pin that the emptiness is deliberate and visible, that the
 * mechanism around it is real, and that the three ways content could get in dishonestly — a moving
 * revision, a duplicate identity, and a synthetic record drifting across from the test side — are all
 * closed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GovernedKnowledgeError,
  createGovernedKnowledgeRegistry,
} from '@qf-jarvis/governed-knowledge';
import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import {
  MISSING_PRODUCTION_KNOWLEDGE,
  PRODUCTION_KNOWLEDGE_PACK_MANIFEST,
  PRODUCTION_KNOWLEDGE_PACK_REVISION,
  PRODUCTION_KNOWLEDGE_RECORDS,
  PRODUCTION_KNOWLEDGE_PACK_LABEL,
  createProductionRagBackend,
  productionKnowledgePack,
} from '../knowledge-pack/production-knowledge-pack.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import { activeProfileInput } from '../testing/fixtures.js';
import { digest, testRecordInput, testRequest } from './knowledge-fixtures.js';

const PKG_DIR = new URL('../../', import.meta.url);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('JF-3 production knowledge pack', () => {
  it('(JF3-59) the pack revision is deterministic, derived, and content-addressed', () => {
    // Repeated construction gives the same revision and the same (empty) registry -- no clock, no
    // counter, no environment, nothing that could make two deployments disagree about what they hold.
    expect(createProductionRagBackend().knowledgeRevision).toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
    expect(createProductionRagBackend().knowledgeRevision).toBe(
      createProductionRagBackend().knowledgeRevision,
    );
    expect(productionKnowledgePack().registry.size).toBe(0);
    expect(productionKnowledgePack().registry.snapshot()).toEqual([]);

    // DERIVED, not chosen. The owner correction: the revision is a content identity computed from
    // the records, so nobody can label a different body of knowledge with it.
    expect(PRODUCTION_KNOWLEDGE_PACK_REVISION).toMatch(/^qfj\.knowledge\.sha256\.[0-9a-f]{64}$/);
    expect(PRODUCTION_KNOWLEDGE_PACK_REVISION).not.toBe(PRODUCTION_KNOWLEDGE_PACK_LABEL);

    // Derived, not declared alongside. A manifest that merely CLAIMED zero could say so while the
    // array held ten; deriving it means the only way to add a record silently is to not add one.
    expect(PRODUCTION_KNOWLEDGE_RECORDS).toHaveLength(0);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.recordCount).toBe(
      PRODUCTION_KNOWLEDGE_RECORDS.length,
    );
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.revision).toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.label).toBe(PRODUCTION_KNOWLEDGE_PACK_LABEL);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.hasApprovedContent).toBe(false);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.topics).toEqual([]);
    expect(Object.isFrozen(PRODUCTION_KNOWLEDGE_PACK_MANIFEST)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_KNOWLEDGE_RECORDS)).toBe(true);
  });

  it('(JF3-60) neither the revision nor the label can be a wildcard or `latest`', () => {
    // The revision is derived, so its shape is structural rather than checked -- but a spec that
    // says so is what would catch a future change to the derivation that reintroduced a pointer.
    const revision = PRODUCTION_KNOWLEDGE_PACK_REVISION;
    expect(revision).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(revision).not.toContain('*');
    expect(revision.toLowerCase()).not.toBe('latest');
    expect(revision.toLowerCase().split('.')).not.toContain('latest');
    expect(revision.length).toBeLessThanOrEqual(128);

    // The LABEL says what the pack is, for people. It is display metadata and never the binding:
    // the previous head proved what a typed label is worth as a security property.
    expect(PRODUCTION_KNOWLEDGE_PACK_LABEL).toContain('empty');
    expect(PRODUCTION_KNOWLEDGE_PACK_LABEL).not.toContain('*');
    expect(PRODUCTION_KNOWLEDGE_PACK_LABEL.toLowerCase().split('.')).not.toContain('latest');
  });

  it('(JF3-61) a duplicate knowledge identity refuses at pack construction', () => {
    // Both shapes, because they mean different things. Same identity + same digest is a duplicate
    // entry; same identity + different digest is two records claiming to be the same record, which is
    // the one that would otherwise let content be swapped under a citation that still verifies.
    expect(() => createGovernedKnowledgeRegistry([testRecordInput(), testRecordInput()])).toThrow(
      GovernedKnowledgeError,
    );
    expect(() =>
      createGovernedKnowledgeRegistry([
        testRecordInput(),
        testRecordInput({
          content: 'SYNTHETIC SUBSTITUTED CONTENT. Invented for a spec; not business truth.',
          contentDigest: digest('7'),
        }),
      ]),
    ).toThrow(GovernedKnowledgeError);
  });

  it('(JF3-62) an unreviewed or unattributed source cannot silently enter the pack', () => {
    // The pack is built through `createKnowledgeRecord`, so every governed precondition applies to it
    // exactly as it applies anywhere else. A draft record, or an ACTIVE one with no named approver,
    // fails LOUDLY at construction rather than becoming a quiet answer.
    for (const bad of [
      // ACTIVE with no attributable approval.
      testRecordInput({ approvedBy: undefined, approvedAt: undefined }),
      // Reviewed-but-not-approved, carrying approval metadata it has not earned.
      testRecordInput({ lifecycleState: 'REVIEWED' }),
      // A volatile source type with no declared expiry.
      testRecordInput({ sourceType: 'PACKAGE_REFERENCE', expiresAt: undefined }),
      // A wildcard identity.
      testRecordInput({ knowledgeId: 'latest' }),
      // No source revision to cite.
      testRecordInput({ sourceRevision: '' }),
    ]) {
      expect(() => createGovernedKnowledgeRegistry([bad])).toThrow(GovernedKnowledgeError);
    }
  });

  it('(JF3-63) synthetic test records stay outside every production export', () => {
    // The split that makes this true: synthetic PROFILE INPUTS ship under `./testing` because they are
    // configuration, and synthetic RECORDS live under `src/tests`, which the emitting build excludes.
    // A shipped module that could build a governed record could build a synthetic ANSWER.
    const build = JSON.parse(
      readFileSync(fileURLToPath(new URL('tsconfig.build.json', PKG_DIR)), 'utf8').replace(
        /^\s*\/\/.*$/gm,
        '',
      ),
    ) as { exclude?: string[] };
    expect(build.exclude).toContain('src/tests/**');

    for (const file of walk(fileURLToPath(new URL('src/testing', PKG_DIR)))) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/contentDigest|lifecycleState|knowledgeId|createKnowledgeRecord/);
    }

    const exported = barrel as Record<string, unknown>;
    for (const name of [
      'testRecordInput',
      'testRequestInput',
      'testBackend',
      'testRegistry',
      'activeProvisioner',
      'disabledProfileInput',
      'provisionedNoOpProfileInput',
      'activeProfileInput',
    ]) {
      expect(exported[name]).toBeUndefined();
    }
    // And the production pack itself holds no synthetic marker, because it holds nothing at all.
    expect(JSON.stringify(PRODUCTION_KNOWLEDGE_PACK_MANIFEST).toUpperCase()).not.toContain(
      'SYNTHETIC',
    );
  });

  it('(JF3-64) no volatile Core-owned fact is introduced as authoritative RAG knowledge', () => {
    // The boundary this defends is the one that decides what RAG is FOR. Stable reference material --
    // policy, process, approved reference -- belongs here. Live order status, current stock, a lead's
    // stage, today's price: those are Core's to answer, and a cached copy of a moving fact is a wrong
    // answer with a citation attached, which is worse than no answer.
    expect(PRODUCTION_KNOWLEDGE_RECORDS).toHaveLength(0);
    const missingText = JSON.stringify(MISSING_PRODUCTION_KNOWLEDGE).toLowerCase();
    for (const volatile of [
      'order status',
      'stock level',
      'inventory count',
      'lead stage',
      'current price',
      'today',
      'live ',
    ]) {
      expect(missingText).not.toContain(volatile);
    }

    // An ACTIVE profile bound to the empty pack composes, and refuses every retrieval -- so a caller
    // is TOLD it has no grounding on every request rather than inferring it from an empty success.
    const backend = createProductionRagBackend();
    expect(backend.knowledgeRevision).toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
    const active = createRagProvisioner(
      activeProfileInput({ knowledgeRevision: PRODUCTION_KNOWLEDGE_PACK_REVISION }),
      { backend },
    );
    expect(active.state).toBe('active');
    const outcome = invokeRagRetrieval(active, testRequest());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe('rag-retrieval-refused');
    expect(outcome.knowledgeReason).toBe('knowledge-not-found');
    expect(outcome.counters.augmentedCharacterCount).toBe(0);

    // A profile naming any OTHER revision cannot bind to this pack -- including the human-readable
    // LABEL, which is the mistake somebody would actually make. Approval is of a specific body of
    // knowledge, not of a package that happens to be installed.
    const wrong = createRagProvisioner(activeProfileInput(), { backend });
    expect(wrong.state).toBe('invalid');
    expect(wrong.refusal).toBe('rag-knowledge-revision-mismatch');
    expect(
      createRagProvisioner(
        activeProfileInput({ knowledgeRevision: PRODUCTION_KNOWLEDGE_PACK_LABEL }),
        { backend },
      ).refusal,
    ).toBe('rag-knowledge-revision-mismatch');
  });
});
