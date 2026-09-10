/**
 * JF-3 owner correction pass 2 — runtime pack authenticity (ADR-0148 §11e).
 *
 * ### The gap these were written against
 *
 * The first correction made the revision content-addressed and gave the backend a single `pack`
 * parameter, so a caller could no longer pair a registry with a chosen revision. But the backend then
 * checked the pack's SHAPE, and TypeScript interfaces are structural: an object literal with the right
 * four fields satisfies `RevisionBoundKnowledgePack` at compile time and passed that check at runtime.
 *
 * Measured on head `8532a2c`, this object — pack A's approved revision beside pack B's registry —
 * constructed a backend, reached `active`, and served B's unapproved text while reporting A's
 * revision:
 *
 * ```
 * { knowledgeRevision: packA.knowledgeRevision, registry: packB.registry,
 *   recordCount: packB.recordCount, topics: packB.topics }
 * ```
 *
 * A shape check cannot prove provenance. The backend now asks the factory whether it made this exact
 * object, and object identity is the one property of a pack that copying does not reproduce.
 *
 * ### Why the negative cases here are all WELL-FORMED
 *
 * A malformed object being refused proves nothing about this defect — the old guard already refused
 * those. Every forgery below is a perfect structural match, and several are exact field-for-field
 * copies of an authentic pack. That is the whole test: identical in every respect a type or a shape
 * check can see, and refused anyway.
 */
import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import * as testingBarrel from '../testing/index.js';
import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import { createRevisionBoundKnowledgePack } from '../service/create-revision-bound-knowledge-pack.js';
import type { RevisionBoundKnowledgePack } from '../contracts/revision-bound-knowledge-pack.js';
import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import { activeProfileInput } from '../testing/fixtures.js';
import { testRecordInput, testRequest } from './knowledge-fixtures.js';

const RECORD_A = testRecordInput({
  content: 'APPROVED RECORD A. The owner reviewed and approved exactly this text.',
});
const RECORD_B = testRecordInput({
  content: 'UNAPPROVED RECORD B. Nobody ever reviewed this text.',
});

function packA(): RevisionBoundKnowledgePack {
  return createRevisionBoundKnowledgePack([RECORD_A]);
}
function packB(): RevisionBoundKnowledgePack {
  return createRevisionBoundKnowledgePack([RECORD_B]);
}

describe('JF-3 pack authenticity', () => {
  it('(PA-1) a factory-created pack builds a backend', () => {
    const pack = packA();
    expect(() => createGovernedExactBackend({ pack })).not.toThrow();
    expect(createGovernedExactBackend({ pack }).knowledgeRevision).toBe(pack.knowledgeRevision);
  });

  it('(PA-2) a structurally identical clone is refused', () => {
    // Every field copied, including the registry object itself. Indistinguishable from the authentic
    // pack to any check that reads properties -- and refused, because it was not derived.
    const pack = packA();
    const clone = {
      knowledgeRevision: pack.knowledgeRevision,
      registry: pack.registry,
      recordCount: pack.recordCount,
      topics: pack.topics,
    };
    expect(clone).toEqual({ ...pack });
    // Note there is no cast here, and the compiler is content: the clone genuinely satisfies the pack
    // type. That is the defect in one line -- the type describes a shape, and a shape is copyable.
    expect(() => createGovernedExactBackend({ pack: clone })).toThrow(Error);
  });

  it('(PA-3) a spread clone is refused', () => {
    // The most likely accidental version of this: somebody spreads a pack to "add a field" and hands
    // the result on. A brand property would have survived that spread; object identity does not.
    const pack = packA();
    const forged = { ...pack };
    expect(forged.knowledgeRevision).toBe(pack.knowledgeRevision);
    expect(forged.registry).toBe(pack.registry);
    expect(() => createGovernedExactBackend({ pack: forged })).toThrow(Error);
  });

  it('(PA-4) an approved revision beside a substituted registry is refused, before any retrieval', () => {
    // The measured forgery. On head 8532a2c this constructed, activated and served B's text under A's
    // revision. It is now refused at backend construction, so there is no provisioner to activate and
    // no retrieval to make -- the failure happens before anything could be answered.
    const a = packA();
    const b = packB();
    expect(a.knowledgeRevision).not.toBe(b.knowledgeRevision);

    const forged = {
      knowledgeRevision: a.knowledgeRevision,
      registry: b.registry,
      recordCount: b.recordCount,
      topics: b.topics,
    } as RevisionBoundKnowledgePack;

    expect(() => createGovernedExactBackend({ pack: forged })).toThrow(Error);

    // And the mirror, in case somebody reasons that the registry is "the real one": B's revision
    // beside A's registry is equally refused. Neither half is the thing being trusted.
    const mirrored = {
      knowledgeRevision: b.knowledgeRevision,
      registry: a.registry,
      recordCount: a.recordCount,
      topics: a.topics,
    } as RevisionBoundKnowledgePack;
    expect(() => createGovernedExactBackend({ pack: mirrored })).toThrow(Error);
  });

  it('(PA-5) a genuine pack still reaches ACTIVE and serves', () => {
    // The control that makes the refusals above meaningful: the same call, with the authentic object,
    // works end to end.
    const pack = packA();
    const provisioner = createRagProvisioner(
      activeProfileInput({ knowledgeRevision: pack.knowledgeRevision }),
      { backend: createGovernedExactBackend({ pack }) },
    );
    expect(provisioner.state).toBe('active');
    expect(provisioner.refusal).toBeUndefined();

    const outcome = invokeRagRetrieval(provisioner, testRequest());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.knowledgeRevision).toBe(pack.knowledgeRevision);
    expect(outcome.records[0]?.record.content).toContain('APPROVED RECORD A');
  });

  it('(PA-6) authenticity does not transfer to any copy, by any route', () => {
    const pack = packA();
    const copies: unknown[] = [
      { ...pack },
      Object.assign({}, pack),
      Object.freeze({ ...pack }),
      Object.create(pack) as unknown,
      Object.fromEntries(Object.entries(pack)),
      // A structured clone: the closest a copy gets to being the same object, and still not it.
      structuredClone({
        knowledgeRevision: pack.knowledgeRevision,
        recordCount: pack.recordCount,
        topics: [...pack.topics],
        registry: null,
      }),
    ];
    for (const copy of copies) {
      expect(() =>
        createGovernedExactBackend({ pack: copy as RevisionBoundKnowledgePack }),
      ).toThrow(Error);
    }
    // Only the object the factory froze is accepted.
    expect(() => createGovernedExactBackend({ pack })).not.toThrow();
  });

  it('(PA-6b) rebuilding from the records is the supported route, and re-derives the revision', () => {
    // A pack that crossed a process boundary cannot be revived by reassembling its fields -- and it
    // should not be. Rebuilding from the governed records re-derives the revision from the records
    // themselves, so the result is a re-proof rather than a re-labelling. The revision matching is the
    // evidence that nothing was lost or substituted on the way.
    const original = packA();
    const rebuilt = createRevisionBoundKnowledgePack([RECORD_A]);
    expect(rebuilt).not.toBe(original);
    expect(rebuilt.knowledgeRevision).toBe(original.knowledgeRevision);
    expect(() => createGovernedExactBackend({ pack: rebuilt })).not.toThrow();

    // Rebuilding from DIFFERENT records gives a different revision, so a substitution during the
    // round trip cannot pass itself off as the approved pack.
    expect(createRevisionBoundKnowledgePack([RECORD_B]).knowledgeRevision).not.toBe(
      original.knowledgeRevision,
    );
  });

  it('(PA-7) the authenticity checker is package-internal, and nothing can register a pack', () => {
    // Not exported from the root and not from ./testing -- and package.json exposes only those two
    // subpaths, so nothing outside this package can reach it.
    const root = barrel as Record<string, unknown>;
    const testing = testingBarrel as Record<string, unknown>;
    for (const name of [
      'isAuthenticRevisionBoundKnowledgePack',
      'AUTHENTIC_REVISION_BOUND_PACKS',
      'registerRevisionBoundKnowledgePack',
      'markAuthentic',
      'trustPack',
    ]) {
      expect(root[name]).toBeUndefined();
      expect(testing[name]).toBeUndefined();
    }

    // And the module that owns it exports no way to ADD to it. Deriving a pack is the only route in,
    // which means a pack is authentic exactly when its revision came from its own records.
    expect(root['createRevisionBoundKnowledgePack']).toBeTypeOf('function');
  });
});
