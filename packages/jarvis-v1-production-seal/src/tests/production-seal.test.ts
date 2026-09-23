import { describe, expect, it } from 'vitest';

import {
  CERTIFIED_AGENTS,
  GROQ_DATA_CONTROLS_REF,
  JF5B_CAPABILITY_PROFILE_REF,
  JF5B_EVALUATION_SUITE_ID,
  JF5B_EVALUATION_SUITE_VERSION,
  JF5B_FIXTURE_MANIFEST_ID,
  JF5B_PROVIDER_MODE,
  JF5B_RED_TEAM_SUITE_ID,
  NARA_DATA_CONTROLS_REF,
  PROMPT_BY_AGENT,
  createJf5bCoverageManifest,
  type Jf5bCoverageManifest,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';

import {
  createJf5cProductionSeal,
  type Jf5cHumanReview,
  type Jf5cOwnerAcceptance,
} from '../index.js';

const reviewDigest = 'c'.repeat(64);
const headSha = 'd'.repeat(40);
const knowledgeRevision = 'knowledge.quickfurno.certification.test.v1';

function manifest(over: Partial<Jf5bCoverageManifest> = {}): Jf5bCoverageManifest {
  const entries = CERTIFIED_AGENTS.map((agent, index) => {
    const prompt = PROMPT_BY_AGENT[agent];
    return {
      provider: 'groq' as const,
      agent,
      releaseId: 'rel.jf5b.groq.1',
      modelId: 'openai/gpt-oss-120b',
      modelVersion: 'certification-snapshot-2026-09-11',
      configDigest: 'a'.repeat(64),
      promptFamily: prompt.promptId,
      promptVersion: prompt.promptVersion,
      promptDigest: prompt.contentDigest,
      evaluationSuiteId: JF5B_EVALUATION_SUITE_ID,
      evaluationSuiteVersion: JF5B_EVALUATION_SUITE_VERSION,
      redTeamSuiteId: JF5B_RED_TEAM_SUITE_ID,
      fixtureManifestId: JF5B_FIXTURE_MANIFEST_ID,
      knowledgeRevision,
      liveRunId: 'jf5b.run.groq-only.test',
      caseSetDigest: String(index + 1)
        .repeat(64)
        .slice(0, 64),
      resultDigest: String(index + 4)
        .repeat(64)
        .slice(0, 64),
      safety: 'PASS' as const,
      qualityReview: 'REVIEW_PENDING' as const,
      languageCounts: { EN: 5, HI: 5, HINGLISH: 5 },
      reviewBundleDigest: reviewDigest,
    };
  });

  return createJf5bCoverageManifest({
    manifestVersion: 2,
    providerMode: JF5B_PROVIDER_MODE,
    runId: 'jf5b.run.groq-only.test',
    headSha,
    createdAt: '2026-09-21T04:45:00.000Z',
    dataControlsRefs: [GROQ_DATA_CONTROLS_REF],
    entries,
    ...over,
  });
}

function reviews(decision: Jf5cHumanReview['decision'] = 'ACCEPT'): readonly Jf5cHumanReview[] {
  return CERTIFIED_AGENTS.map((agent) => ({
    provider: 'groq',
    agent,
    reviewerRef: `reviewer.groq.${agent.toLowerCase()}`,
    reviewedAt: '2026-09-21T04:50:00.000Z',
    reviewBundleDigest: reviewDigest,
    decision,
  }));
}

function owner(decision: Jf5cOwnerAcceptance['decision'] = 'ACCEPT'): Jf5cOwnerAcceptance {
  return {
    ownerRef: 'owner.quickfurno',
    acceptedAt: '2026-09-21T04:51:00.000Z',
    decision,
  };
}

function seal(source = manifest(), humanReviews = reviews(), acceptance = owner()) {
  return createJf5cProductionSeal({
    manifest: source,
    reviews: humanReviews,
    ownerAcceptance: acceptance,
    sealedAt: '2026-09-21T04:52:00.000Z',
  });
}

describe('JF-5C v2 Groq-only production evidence seal', () => {
  it('seals exactly three Groq prompt-scoped approvals and one provider coverage record', () => {
    const result = seal();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.seal.version).toBe(2);
    expect(result.seal.target).toBe('ACTIVE_MODEL_RELEASE');
    expect(result.seal.providerMode).toBe('GROQ_ONLY');
    expect(result.seal.providerDataControlsRefs).toEqual([GROQ_DATA_CONTROLS_REF]);
    expect(result.seal.evidence).toHaveLength(3);
    expect(result.seal.providers).toHaveLength(1);
    expect(result.seal.providers[0]?.provider).toBe('groq');
    expect(result.seal.sourceHeadSha).toBe(headSha);

    for (const evidence of result.seal.evidence) {
      expect(evidence.synthetic).toBe(false);
      expect(evidence.productionApproval).toBe(true);
      expect(evidence.target).toBe('ACTIVE_MODEL_RELEASE');
      expect(evidence.binding.release.providerId).toBe('groq');
      expect(evidence.binding.capabilityProfileRef).toBe(JF5B_CAPABILITY_PROFILE_REF);
      expect(evidence.binding.knowledgeRevision).toBe(knowledgeRevision);
    }
    expect(result.seal.providers[0]?.evidenceRefs).toHaveLength(3);
    expect(new Set(result.seal.providers[0]?.promptDigests).size).toBe(3);
  });

  it('refuses any Groq-agent safety result that is not PASS', () => {
    const source = manifest();
    const entries = source.entries.map((entry, index) =>
      index === 0 ? { ...entry, safety: 'INCONCLUSIVE' as const } : entry,
    );
    const incomplete = createJf5bCoverageManifest({ ...source, entries });
    expect(seal(incomplete)).toEqual({ ok: false, reason: 'safety-incomplete' });
  });

  it('refuses missing, duplicate, or rejected Groq human-review coverage', () => {
    expect(seal(manifest(), reviews().slice(1))).toEqual({
      ok: false,
      reason: 'review-set-mismatch',
    });
    const allReviews = reviews();
    const first = allReviews[0];
    const second = allReviews[1];
    if (!first || !second) throw new Error('test-review-fixture-missing');
    expect(seal(manifest(), [first, first, second])).toEqual({
      ok: false,
      reason: 'review-set-mismatch',
    });
    const rejected = reviews().map((review, index) =>
      index === 2 ? { ...review, decision: 'REJECT' as const } : review,
    );
    expect(seal(manifest(), rejected)).toEqual({ ok: false, reason: 'review-rejected' });
  });

  it('refuses a review that does not bind to the blinded bundle', () => {
    const mismatched = reviews().map((review, index) =>
      index === 0 ? { ...review, reviewBundleDigest: '9'.repeat(64) } : review,
    );
    expect(seal(manifest(), mismatched)).toEqual({
      ok: false,
      reason: 'review-bundle-mismatch',
    });
  });

  it('refuses a legacy v1 dual-provider manifest for new production sealing', () => {
    const groq = manifest();
    const naraEntries = groq.entries.map((entry, index) => ({
      ...entry,
      provider: 'nara' as const,
      releaseId: 'rel.jf5b.nara.1',
      modelId: 'agnes-2.5-flash',
      configDigest: 'b'.repeat(64),
      resultDigest: String(index + 7)
        .repeat(64)
        .slice(0, 64),
    }));
    const legacy = createJf5bCoverageManifest({
      manifestVersion: 1,
      runId: groq.runId,
      headSha: groq.headSha,
      createdAt: groq.createdAt,
      dataControlsRefs: [GROQ_DATA_CONTROLS_REF, NARA_DATA_CONTROLS_REF],
      entries: [...groq.entries, ...naraEntries],
    });
    expect(
      createJf5cProductionSeal({
        manifest: legacy,
        reviews: reviews(),
        ownerAcceptance: owner(),
        sealedAt: '2026-09-21T04:52:00.000Z',
      }),
    ).toEqual({ ok: false, reason: 'provider-mode-mismatch' });
  });

  it('refuses any non-Groq-only data-controls set', () => {
    const source = manifest();
    const changed = createJf5bCoverageManifest({
      ...source,
      dataControlsRefs: [GROQ_DATA_CONTROLS_REF, NARA_DATA_CONTROLS_REF],
    });
    expect(seal(changed)).toEqual({ ok: false, reason: 'manifest-data-controls-mismatch' });
  });

  it('refuses prompt identity drift even when the Groq-only manifest shape is valid', () => {
    const source = manifest();
    const entries = source.entries.map((entry, index) =>
      index === 0 ? { ...entry, promptDigest: '1'.repeat(64) } : entry,
    );
    const drifted = createJf5bCoverageManifest({ ...source, entries });
    expect(seal(drifted)).toEqual({ ok: false, reason: 'binding-mismatch' });
  });
});

describe('JF-5C knowledge revision binding', () => {
  it('refuses a mixed knowledge revision manifest before sealing', () => {
    const source = manifest();
    const entries = source.entries.map((entry, index) =>
      index === 0 ? { ...entry, knowledgeRevision: 'knowledge.quickfurno.other' } : entry,
    );
    expect(() => createJf5bCoverageManifest({ ...source, entries })).toThrow(
      'invalid-coverage-manifest',
    );
  });
});
