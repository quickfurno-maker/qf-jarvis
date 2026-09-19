import { describe, expect, it } from 'vitest';

import {
  CERTIFIED_AGENTS,
  CERTIFIED_PROVIDERS,
  GROQ_DATA_CONTROLS_REF,
  JF5B_CAPABILITY_PROFILE_REF,
  JF5B_EVALUATION_SUITE_ID,
  JF5B_EVALUATION_SUITE_VERSION,
  JF5B_FIXTURE_MANIFEST_ID,
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

function manifest(over: Partial<Jf5bCoverageManifest> = {}): Jf5bCoverageManifest {
  const entries = CERTIFIED_PROVIDERS.flatMap((provider) =>
    CERTIFIED_AGENTS.map((agent, index) => {
      const prompt = PROMPT_BY_AGENT[agent];
      return {
        provider,
        agent,
        releaseId: `rel.jf5b.${provider}.1`,
        modelId: provider === 'groq' ? 'openai/gpt-oss-120b' : 'agnes-2.5-flash',
        modelVersion: 'certification-snapshot-2026-09-11',
        configDigest: provider === 'groq' ? 'a'.repeat(64) : 'b'.repeat(64),
        promptFamily: prompt.promptId,
        promptVersion: prompt.promptVersion,
        promptDigest: prompt.contentDigest,
        evaluationSuiteId: JF5B_EVALUATION_SUITE_ID,
        evaluationSuiteVersion: JF5B_EVALUATION_SUITE_VERSION,
        redTeamSuiteId: JF5B_RED_TEAM_SUITE_ID,
        fixtureManifestId: JF5B_FIXTURE_MANIFEST_ID,
        liveRunId: 'jf5b.run.test',
        caseSetDigest: String(index + 1)
          .repeat(64)
          .slice(0, 64),
        resultDigest: (provider === 'groq' ? 'e' : 'f').repeat(64 - index) + '0'.repeat(index),
        safety: 'PASS' as const,
        qualityReview: 'REVIEW_PENDING' as const,
        languageCounts: { EN: 5, HI: 5, HINGLISH: 5 },
        reviewBundleDigest: reviewDigest,
      };
    }),
  );
  return createJf5bCoverageManifest({
    manifestVersion: 1,
    runId: 'jf5b.run.test',
    headSha,
    createdAt: '2026-09-19T03:30:00.000Z',
    dataControlsRefs: [GROQ_DATA_CONTROLS_REF, NARA_DATA_CONTROLS_REF],
    entries,
    ...over,
  });
}

function reviews(decision: Jf5cHumanReview['decision'] = 'ACCEPT'): readonly Jf5cHumanReview[] {
  return CERTIFIED_PROVIDERS.flatMap((provider) =>
    CERTIFIED_AGENTS.map((agent) => ({
      provider,
      agent,
      reviewerRef: `reviewer.${provider}.${agent.toLowerCase()}`,
      reviewedAt: '2026-09-19T03:35:00.000Z',
      reviewBundleDigest: reviewDigest,
      decision,
    })),
  );
}

function owner(decision: Jf5cOwnerAcceptance['decision'] = 'ACCEPT'): Jf5cOwnerAcceptance {
  return {
    ownerRef: 'owner.quickfurno',
    acceptedAt: '2026-09-19T03:36:00.000Z',
    naraDataControlsRef: NARA_DATA_CONTROLS_REF,
    decision,
  };
}

function seal(source = manifest(), humanReviews = reviews(), acceptance = owner()) {
  return createJf5cProductionSeal({
    manifest: source,
    reviews: humanReviews,
    ownerAcceptance: acceptance,
    sealedAt: '2026-09-19T03:37:00.000Z',
  });
}

describe('JF-5C production evidence seal', () => {
  it('seals exactly six prompt-scoped approvals and two provider coverage records', () => {
    const result = seal();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.seal.target).toBe('ACTIVE_MODEL_RELEASE');
    expect(result.seal.evidence).toHaveLength(6);
    expect(result.seal.providers).toHaveLength(2);
    expect(result.seal.naraDataControlsRef).toBe(NARA_DATA_CONTROLS_REF);
    expect(result.seal.sourceHeadSha).toBe(headSha);

    for (const evidence of result.seal.evidence) {
      expect(evidence.synthetic).toBe(false);
      expect(evidence.productionApproval).toBe(true);
      expect(evidence.target).toBe('ACTIVE_MODEL_RELEASE');
      expect(evidence.binding.capabilityProfileRef).toBe(JF5B_CAPABILITY_PROFILE_REF);
    }
    for (const provider of result.seal.providers) {
      expect(provider.evidenceRefs).toHaveLength(3);
      expect(new Set(provider.promptDigests).size).toBe(3);
    }
  });
  it('refuses any provider-agent safety result that is not PASS', () => {
    const source = manifest();
    const entries = source.entries.map((entry, index) =>
      index === 0 ? { ...entry, safety: 'INCONCLUSIVE' as const } : entry,
    );
    const incomplete = createJf5bCoverageManifest({ ...source, entries });
    expect(seal(incomplete)).toEqual({ ok: false, reason: 'safety-incomplete' });
  });

  it('refuses missing, duplicate, or rejected human review coverage', () => {
    expect(seal(manifest(), reviews().slice(1))).toEqual({
      ok: false,
      reason: 'review-set-mismatch',
    });
    const allReviews = reviews();
    const firstReview = allReviews[0];
    if (!firstReview) throw new Error('test-review-fixture-missing');
    const duplicate = [...allReviews.slice(0, -1), firstReview];
    expect(seal(manifest(), duplicate)).toEqual({
      ok: false,
      reason: 'review-set-mismatch',
    });
    const rejected = reviews().map((review, index) =>
      index === 2 ? { ...review, decision: 'REJECT' as const } : review,
    );
    expect(seal(manifest(), rejected)).toEqual({
      ok: false,
      reason: 'review-rejected',
    });
  });

  it('refuses a review that does not bind to the JF-5B blinded bundle', () => {
    const mismatched = reviews().map((review, index) =>
      index === 0 ? { ...review, reviewBundleDigest: '9'.repeat(64) } : review,
    );
    expect(seal(manifest(), mismatched)).toEqual({
      ok: false,
      reason: 'review-bundle-mismatch',
    });
  });

  it('refuses absent or changed Nara data-controls acceptance', () => {
    expect(seal(manifest(), reviews(), owner('REJECT'))).toEqual({
      ok: false,
      reason: 'nara-data-controls-not-accepted',
    });
    expect(
      seal(manifest(), reviews(), {
        ...owner(),
        naraDataControlsRef: 'datacontrols.nara.other',
      }),
    ).toEqual({ ok: false, reason: 'nara-data-controls-not-accepted' });
  });

  it('refuses prompt identity drift even when the manifest shape is valid', () => {
    const source = manifest();
    const entries = source.entries.map((entry, index) =>
      index === 0 ? { ...entry, promptDigest: '1'.repeat(64) } : entry,
    );
    const drifted = createJf5bCoverageManifest({ ...source, entries });
    expect(seal(drifted)).toEqual({ ok: false, reason: 'binding-mismatch' });
  });
});
