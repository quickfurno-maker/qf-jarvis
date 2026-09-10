/**
 * JF-3 owner correction — content-bound knowledge revision (ADR-0148 §11a).
 *
 * ### The bug these were written against
 *
 * The reviewed head took a registry and a revision string as two independent values, and the
 * activation gate compared `profile.knowledgeRevision` with `backend.knowledgeRevision`. That compares
 * two LABELS. Measured on head `7bbe1ab`: a registry holding unapproved text activated cleanly under
 * an approved revision, served that text, and cited the approved record's stale content digest while
 * doing it.
 *
 * The correction makes the substitution unconstructible rather than merely detected. A revision is
 * derived from the records it names, so two different bodies of knowledge cannot share one, and there
 * is no public constructor that pairs an arbitrary registry with an arbitrary revision.
 *
 * Items are labelled `RB-n` after the correction brief's own numbering.
 *
 * ### One deliberate choice about these specs
 *
 * They assert that revisions DIFFER rather than pinning literal hex values. A pinned digest would fail
 * on any change to the canonical form and tell you only that something moved; asserting the relation —
 * this change must change the revision, that reordering must not — says what the property actually is.
 * `RB-form` pins the shape and the format version, which is the part that must not drift silently.
 */
import { describe, expect, it } from 'vitest';

import {
  MISSING_PRODUCTION_KNOWLEDGE,
  PRODUCTION_KNOWLEDGE_PACK_LABEL,
  PRODUCTION_KNOWLEDGE_PACK_MANIFEST,
  PRODUCTION_KNOWLEDGE_PACK_REVISION,
  PRODUCTION_KNOWLEDGE_RECORDS,
  createProductionRagBackend,
  productionKnowledgePack,
} from '../knowledge-pack/production-knowledge-pack.js';
import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import {
  DERIVED_KNOWLEDGE_REVISION,
  canonicalPackForm,
  createRevisionBoundKnowledgePack,
} from '../service/create-revision-bound-knowledge-pack.js';
import { createRagProvisioningProfile } from '../contracts/provisioning-profile.js';
import { RagProvisioningError } from '../contracts/errors.js';
import { activeProfileInput, provisionedNoOpProfileInput } from '../testing/fixtures.js';
import { digest, testPack, testRecordInput, testRequest } from './knowledge-fixtures.js';
import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import { invokeNoOpRag } from '../service/invoke-no-op-rag.js';

const BASE = testRecordInput();

/** The revision a pack of these records derives. */
function revisionOf(...overrides: Partial<Parameters<typeof testRecordInput>[0]>[]): string {
  return createRevisionBoundKnowledgePack(overrides.map((o) => testRecordInput(o)))
    .knowledgeRevision;
}

const BASE_REVISION = revisionOf({});

describe('RB — the substitution that the reviewed head permitted', () => {
  it('(RB-1..5) two different bodies of knowledge cannot share one revision', () => {
    // Pack A: the text an owner approved. Pack B: different text, IDENTICAL in every other respect --
    // same knowledgeId, same version, same topic, same supplied contentDigest, same permissions.
    // On the reviewed head both could be labelled `know.rev.approved` and both would activate.
    const packA = testPack([BASE]);
    const packB = testPack([
      testRecordInput({
        content: 'UNAPPROVED RECORD B. Nobody ever reviewed this text.',
      }),
    ]);

    expect(packA.recordCount).toBe(packB.recordCount);
    expect(packA.topics).toEqual(packB.topics);
    // The correction, in one assertion.
    expect(packA.knowledgeRevision).not.toBe(packB.knowledgeRevision);

    const approvedProfile = activeProfileInput({ knowledgeRevision: packA.knowledgeRevision });
    expect(
      createRagProvisioner(approvedProfile, {
        backend: createGovernedExactBackend({ pack: packA }),
      }).state,
    ).toBe('active');

    const substituted = createRagProvisioner(approvedProfile, {
      backend: createGovernedExactBackend({ pack: packB }),
    });
    expect(substituted.state).toBe('invalid');
    expect(substituted.refusal).toBe('rag-knowledge-revision-mismatch');
    expect(substituted.backend).toBeUndefined();
  });

  it('(RB-4) the public API offers no way to relabel an arbitrary registry', () => {
    // Structural, and the reason the control above cannot be worked around. The backend factory takes
    // a bound pack; it has no `registry` option and no `knowledgeRevision` option, so there is no
    // parameter through which contents and claimed identity could be made to disagree.
    const pack = testPack([BASE]);
    expect(createGovernedExactBackend({ pack }).knowledgeRevision).toBe(pack.knowledgeRevision);

    // A hand-built object claiming an approved revision is not a pack, and is refused rather than
    // trusted -- the registry it would have to carry is the one the revision was derived from.
    for (const notAPack of [
      undefined,
      null,
      {},
      { knowledgeRevision: pack.knowledgeRevision },
      { knowledgeRevision: pack.knowledgeRevision, registry: undefined },
      { registry: pack.registry },
      { knowledgeRevision: '', registry: pack.registry },
    ]) {
      expect(() =>
        createGovernedExactBackend({ pack: notAPack as unknown as typeof pack }),
      ).toThrow(Error);
    }
  });
});

describe('RB — what changes the revision', () => {
  it('(RB-6,7,8) actual content is hashed, not the supplied contentDigest', () => {
    // The load-bearing detail of the whole correction. `createKnowledgeRecord` validates the SHAPE of
    // `contentDigest` (64 hex characters) but never recomputes it from the text, so a record whose
    // text was edited while its digest was left stale is a perfectly valid governed record.
    //
    // Both records below therefore carry the SAME digest and DIFFERENT text, and both construct
    // cleanly. If the pack hashed the digest instead of the text, they would share a revision -- which
    // is precisely how changed text would hide behind an approval.
    const stale = digest('a');
    const original = testRecordInput({ content: 'ORIGINAL TEXT.', contentDigest: stale });
    const edited = testRecordInput({ content: 'EDITED TEXT.', contentDigest: stale });
    expect(original.contentDigest).toBe(edited.contentDigest);

    const a = createRevisionBoundKnowledgePack([original]);
    const b = createRevisionBoundKnowledgePack([edited]);
    expect(a.knowledgeRevision).not.toBe(b.knowledgeRevision);

    // And the canonical form carries the text itself, so this is visible rather than inferred.
    expect(canonicalPackForm([...a.registry.listByTopic(BASE.topic)])).toContain('ORIGINAL TEXT.');
  });

  it('(RB-form) the revision shape and canonical-form version are pinned', () => {
    expect(BASE_REVISION).toMatch(DERIVED_KNOWLEDGE_REVISION);
    expect(BASE_REVISION.startsWith('qfj.knowledge.sha256.')).toBe(true);
    // The canonical form declares its own version, so a future change to the format changes every
    // revision deliberately and visibly rather than two builds silently disagreeing.
    expect(canonicalPackForm([])).toContain('qfj.knowledge.canonical.v1');
  });

  it('(RB-9..16) every governance-metadata change changes the revision', () => {
    // Each candidate is an individually VALID governed record, so none of these passes merely because
    // the record constructor rejected it before hashing. Changing any of them changes what the pack
    // means or who may see it, so each must change the approval identity too.
    const mutations: Record<string, Partial<Parameters<typeof testRecordInput>[0]>> = {
      classification: { classification: 'LOCAL_ONLY' },
      'permissions.tenantScope': {
        permissions: {
          tenantScope: 'tenant-a',
          allowedAgentScopes: ['CLIENT', 'COORDINATION'],
          allowedPurposes: ['CLIENT_RESPONSE', 'POLICY_LOOKUP'],
        },
      },
      'permissions.agentScopes': {
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['CLIENT', 'COORDINATION', 'VENDOR'],
          allowedPurposes: ['CLIENT_RESPONSE', 'POLICY_LOOKUP'],
        },
      },
      'permissions.purposes': {
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['CLIENT', 'COORDINATION'],
          allowedPurposes: ['CLIENT_RESPONSE'],
        },
      },
      sourceRevision: { sourceRevision: 'rev-2' },
      sourceRef: { sourceRef: 'test://synthetic/alpha-other' },
      approvedBy: { approvedBy: 'approver.other' },
      approvedAt: { approvedAt: '2025-12-31T00:00:00Z' },
      lifecycleState: { lifecycleState: 'RETIRED' },
      effectiveFrom: { effectiveFrom: '2026-01-03T00:00:00Z' },
      expiresAt: { sourceType: 'PACKAGE_REFERENCE', expiresAt: '2026-06-01T00:00:00Z' },
      subjectRef: { subjectRef: 'subject.test.1' },
      owner: { owner: 'owner.other' },
      authorityTier: { authorityTier: 'APPROVED_INTERNAL_DOCUMENT' },
      contentFormat: { contentFormat: 'MARKDOWN' },
      contentDigest: { contentDigest: digest('c') },
      topic: { topic: 'synthetic-other' },
      version: { version: 2 },
      knowledgeId: { knowledgeId: 'kb.synthetic.other' },
    };
    const seen = new Map<string, string>([[BASE_REVISION, 'base']]);
    for (const [name, overrides] of Object.entries(mutations)) {
      const revision = revisionOf(overrides);
      expect(revision, `${name} must change the revision`).not.toBe(BASE_REVISION);
      // And no two distinct mutations may collide onto one revision.
      expect(seen.has(revision), `${name} collided with ${seen.get(revision) ?? ''}`).toBe(false);
      seen.set(revision, name);
    }
  });

  it('(RB-15b) supersession is part of the identity', () => {
    // A supersession edge needs its successor to exist, so this is a two-record pack either way. What
    // changes is only whether v1 points at v2 -- and that changes which record answers.
    const successor = testRecordInput({ version: 2, contentDigest: digest('d') });
    const without = createRevisionBoundKnowledgePack([testRecordInput(), successor]);
    const with_ = createRevisionBoundKnowledgePack([
      testRecordInput({
        supersededBy: { knowledgeId: BASE.knowledgeId, version: 2 },
        lifecycleState: 'RETIRED',
      }),
      successor,
    ]);
    expect(without.knowledgeRevision).not.toBe(with_.knowledgeRevision);
  });

  it('(RB-29) adding or removing a record changes the revision', () => {
    const one = testPack([BASE]);
    const two = testPack([
      BASE,
      testRecordInput({
        knowledgeId: 'kb.synthetic.beta',
        topic: 'synthetic-beta',
        contentDigest: digest('b'),
      }),
    ]);
    const none = testPack([]);
    const revisions = new Set([
      one.knowledgeRevision,
      two.knowledgeRevision,
      none.knowledgeRevision,
    ]);
    expect(revisions.size).toBe(3);
  });
});

describe('RB — determinism', () => {
  const BETA = testRecordInput({
    knowledgeId: 'kb.synthetic.beta',
    topic: 'synthetic-beta',
    contentDigest: digest('b'),
  });
  const GAMMA = testRecordInput({
    knowledgeId: 'kb.synthetic.gamma',
    topic: 'synthetic-gamma',
    contentDigest: digest('e'),
  });

  it('(RB-17) declaration order does not change the revision', () => {
    // Order is an authoring detail, not a fact about the knowledge. Two people writing the same pack
    // in different orders must not produce two approval identities for one body of knowledge.
    const forward = testPack([BASE, BETA, GAMMA]).knowledgeRevision;
    const reversed = testPack([GAMMA, BETA, BASE]).knowledgeRevision;
    const shuffled = testPack([BETA, BASE, GAMMA]).knowledgeRevision;
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it('(RB-18) the same pack built twice derives the same revision', () => {
    expect(testPack([BASE, BETA]).knowledgeRevision).toBe(testPack([BASE, BETA]).knowledgeRevision);
    expect(testPack([]).knowledgeRevision).toBe(testPack([]).knowledgeRevision);
  });

  it('(RB-19,20) Hindi and Hinglish content derive stable revisions, and differ from each other', () => {
    const hindi = 'सिंथेटिक परीक्षण रिकॉर्ड। यह व्यावसायिक सत्य नहीं है।';
    const hinglish = 'SYNTHETIC test record. Yeh spec ke liye hai, business truth nahi.';
    const hindiRevision = revisionOf({ content: hindi });
    const hinglishRevision = revisionOf({ content: hinglish });

    // Stable across builds: the canonical form preserves code points rather than normalising them.
    expect(revisionOf({ content: hindi })).toBe(hindiRevision);
    expect(revisionOf({ content: hinglish })).toBe(hinglishRevision);
    // And distinct from each other and from the ASCII base.
    expect(new Set([hindiRevision, hinglishRevision, BASE_REVISION]).size).toBe(3);
    // A single changed Devanagari character changes it, as any content change must.
    expect(revisionOf({ content: `${hindi} अतिरिक्त` })).not.toBe(hindiRevision);
  });
});

describe('RB — ACTIVE binding', () => {
  it('(RB-21) profile A + backend A activates and serves', () => {
    const pack = testPack([BASE]);
    const backend = createGovernedExactBackend({ pack });
    const provisioner = createRagProvisioner(
      activeProfileInput({ knowledgeRevision: pack.knowledgeRevision }),
      { backend },
    );
    expect(provisioner.state).toBe('active');
    const outcome = invokeRagRetrieval(provisioner, testRequest());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.knowledgeRevision).toBe(pack.knowledgeRevision);
  });

  it('(RB-22) profile A + backend B refuses with rag-knowledge-revision-mismatch', () => {
    const packA = testPack([BASE]);
    const packB = testPack([testRecordInput({ content: 'DIFFERENT SYNTHETIC TEXT.' })]);
    const provisioner = createRagProvisioner(
      activeProfileInput({ knowledgeRevision: packA.knowledgeRevision }),
      { backend: createGovernedExactBackend({ pack: packB }) },
    );
    expect(provisioner.refusal).toBe('rag-knowledge-revision-mismatch');
  });

  it('(RB-23,24,25) an invented, `latest` or wildcard revision refuses', () => {
    const backend = createGovernedExactBackend({ pack: testPack([BASE]) });
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: 'know.rev.invented' }), {
        backend,
      }).refusal,
    ).toBe('rag-knowledge-revision-mismatch');
    // A revision of the right SHAPE but the wrong digest is still just a mismatch -- shape is not
    // authority, and nothing here treats a well-formed identity as a valid one.
    expect(
      createRagProvisioner(
        activeProfileInput({ knowledgeRevision: `qfj.knowledge.sha256.${'0'.repeat(64)}` }),
        { backend },
      ).refusal,
    ).toBe('rag-knowledge-revision-mismatch');
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: 'latest' }), { backend })
        .refusal,
    ).toBe('rag-knowledge-revision-not-exact');
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: 'know.rev.*' }), { backend })
        .refusal,
    ).toBe('rag-profile-invalid');
  });
});

describe('RB — the empty production pack', () => {
  it('(RB-26,27,28) it holds zero records under a derived, deterministic revision', () => {
    expect(PRODUCTION_KNOWLEDGE_RECORDS).toHaveLength(0);
    expect(productionKnowledgePack().recordCount).toBe(0);
    expect(PRODUCTION_KNOWLEDGE_PACK_REVISION).toMatch(DERIVED_KNOWLEDGE_REVISION);
    expect(createProductionRagBackend().knowledgeRevision).toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
    // The empty pack's revision is exactly what an independently-built empty pack derives: there is
    // nothing special-cased about production, and no separate code path that could drift from it.
    expect(testPack([]).knowledgeRevision).toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.revision).toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
  });

  it('(RB-29,30) a synthetic record changes a local pack revision and never enters production', () => {
    const withSynthetic = testPack([BASE]).knowledgeRevision;
    expect(withSynthetic).not.toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
    // Production stays empty, and its manifest still says so.
    expect(PRODUCTION_KNOWLEDGE_RECORDS).toHaveLength(0);
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.hasApprovedContent).toBe(false);
    const packText = JSON.stringify([
      PRODUCTION_KNOWLEDGE_PACK_MANIFEST,
      MISSING_PRODUCTION_KNOWLEDGE,
    ]).toUpperCase();
    for (const marker of ['SYNTHETIC', 'FIXTURE', 'TEST://']) {
      expect(packText).not.toContain(marker);
    }
    // The label is display metadata, and naming it is not naming the pack.
    expect(PRODUCTION_KNOWLEDGE_PACK_LABEL).not.toBe(PRODUCTION_KNOWLEDGE_PACK_REVISION);
  });
});

describe('RB — ACTIVE carries no unverified evidence reference', () => {
  function expectInvalid(input: Parameters<typeof createRagProvisioningProfile>[0]): void {
    expect(() => createRagProvisioningProfile(input)).toThrow(RagProvisioningError);
  }

  it('(RB-31,32,33) an ACTIVE profile carrying capability or evaluation refs fails closed', () => {
    // JF-3 verifies neither reference against any authority. A serving profile that DISPLAYS one reads
    // as evidence-bound to an operator, a reviewer, and every artifact that records it -- while the
    // string is ignored. A field that looks like a control and is not one is worse than an absent
    // field, because absence prompts the question and a decorative value settles it.
    expectInvalid(activeProfileInput({ capabilityRef: 'cap.profile.a' }));
    expectInvalid(activeProfileInput({ evaluationEvidenceRef: 'evref-000000' }));
    expectInvalid(
      activeProfileInput({ capabilityRef: 'cap.profile.a', evaluationEvidenceRef: 'evref-000000' }),
    );

    // Through the fail-closed provisioner path too, with a bound backend that would otherwise serve.
    const pack = testPack([BASE]);
    const provisioner = createRagProvisioner(
      {
        ...activeProfileInput({ knowledgeRevision: pack.knowledgeRevision }),
        evaluationEvidenceRef: 'evref-000000',
      },
      { backend: createGovernedExactBackend({ pack }) },
    );
    expect(provisioner.state).toBe('invalid');
    expect(provisioner.refusal).toBe('rag-profile-invalid');
    expect(provisioner.backend).toBeUndefined();
  });

  it('(RB-34) PROVISIONED_NO_OP still carries and checks those refs exactly as before', () => {
    // ADR-0053 behaviour preserved byte-for-byte: the refs remain future-facing declarations there,
    // and the no-op path still names the precise missing precondition when one is absent.
    const full = createRagProvisioner(provisionedNoOpProfileInput());
    expect(full.profile?.capabilityRef).toBe('cap.profile.a');
    expect(full.profile?.evaluationEvidenceRef).toBe('evref-000000');
    expect(invokeNoOpRag(full).reason).toBe('rag-provisioned-no-op');

    expect(
      invokeNoOpRag(createRagProvisioner(provisionedNoOpProfileInput({ capabilityRef: undefined })))
        .reason,
    ).toBe('rag-capability-reference-missing');
    expect(
      invokeNoOpRag(
        createRagProvisioner(provisionedNoOpProfileInput({ evaluationEvidenceRef: undefined })),
      ).reason,
    ).toBe('rag-evaluation-reference-missing');
  });

  it('(RB-35) no production path claims an evaluation or capability approval that does not exist', () => {
    // The shipped ACTIVE fixture carries neither ref, and the production pack claims no approval of
    // its own -- it reports what it holds, which is nothing.
    const active = activeProfileInput();
    expect(active.capabilityRef).toBeUndefined();
    expect(active.evaluationEvidenceRef).toBeUndefined();
    // The manifest reports what the pack HOLDS, which is nothing. It carries no evaluation or
    // capability reference, and claims no certification.
    //
    // `approvedBy` does appear -- inside the MISSING-items list, as one of the fields the owner has
    // still to supply. That is the opposite of a claim: it is the pack saying it has no named
    // approver. So the assertion is about the claim, not about the word.
    const manifest = JSON.stringify(PRODUCTION_KNOWLEDGE_PACK_MANIFEST).toLowerCase();
    expect(manifest).not.toContain('evaluationevidence');
    expect(manifest).not.toContain('capabilityref');
    expect(manifest).not.toContain('certified');
    expect(PRODUCTION_KNOWLEDGE_PACK_MANIFEST.hasApprovedContent).toBe(false);
    expect(MISSING_PRODUCTION_KNOWLEDGE.some((m) => m.requiredField.includes('approvedBy'))).toBe(
      true,
    );
  });
});
