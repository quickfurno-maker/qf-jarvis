import { describe, expect, it } from 'vitest';

import {
  CERTIFIED_AGENTS,
  GROQ_DATA_CONTROLS_REF,
  JF5B_EVALUATION_SUITE_ID,
  JF5B_EVALUATION_SUITE_VERSION,
  JF5B_FIXTURE_MANIFEST_ID,
  JF5B_PROVIDER_MODE,
  JF5B_RED_TEAM_SUITE_ID,
  PROMPT_BY_AGENT,
  createJf5bCoverageManifest,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import {
  createJf5cProductionSeal,
  type Jf5cHumanReview,
} from '@qf-jarvis/jarvis-v1-production-seal';

import { bindJf5cSealForProduction } from '../quickfurno-whatsapp/production-seal-binding.js';

const HEAD = 'd'.repeat(40);
const REVIEW_DIGEST = 'c'.repeat(64);

function buildSeal() {
  const manifest = createJf5bCoverageManifest({
    manifestVersion: 2,
    providerMode: JF5B_PROVIDER_MODE,
    runId: 'jf5b.run.worker.test',
    headSha: HEAD,
    createdAt: '2026-09-21T08:00:00.000Z',
    dataControlsRefs: [GROQ_DATA_CONTROLS_REF],
    entries: CERTIFIED_AGENTS.map((agent, index) => {
      const prompt = PROMPT_BY_AGENT[agent];
      return {
        provider: 'groq' as const,
        agent,
        releaseId: 'rel.jf5b.groq.worker',
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
        liveRunId: 'jf5b.run.worker.test',
        caseSetDigest: String(index + 1).repeat(64),
        resultDigest: String(index + 4).repeat(64),
        safety: 'PASS' as const,
        qualityReview: 'REVIEW_PENDING' as const,
        languageCounts: { EN: 5, HI: 5, HINGLISH: 5 },
        reviewBundleDigest: REVIEW_DIGEST,
      };
    }),
  });
  const reviews: readonly Jf5cHumanReview[] = CERTIFIED_AGENTS.map((agent) => ({
    provider: 'groq',
    agent,
    reviewerRef: `reviewer.${agent.toLowerCase()}`,
    reviewedAt: '2026-09-21T08:01:00.000Z',
    reviewBundleDigest: REVIEW_DIGEST,
    decision: 'ACCEPT',
  }));
  const result = createJf5cProductionSeal({
    manifest,
    reviews,
    ownerAcceptance: {
      ownerRef: 'owner.quickfurno',
      acceptedAt: '2026-09-21T08:02:00.000Z',
      decision: 'ACCEPT',
    },
    sealedAt: '2026-09-21T08:03:00.000Z',
  });
  if (!result.ok) throw new Error('test-seal-refused');
  return result.seal;
}

describe('QuickFurno production seal binding', () => {
  it('derives exactly three prompt-scoped approvals from one exact Groq release', () => {
    const result = bindJf5cSealForProduction(buildSeal(), HEAD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.binding.release.providerId).toBe('groq');
    expect(result.binding.release.modelId).toBe('openai/gpt-oss-120b');
    expect(result.binding.productionApprovals).toHaveLength(3);
    expect(result.binding.evaluationEvidence).toHaveLength(3);
    expect(new Set(result.binding.productionApprovals.map((one) => one.evaluationRef)).size).toBe(
      3,
    );
    expect(result.binding.promptBindings.CLIENT?.evaluationPromptDigest).toBe(
      PROMPT_BY_AGENT.RIYA.contentDigest,
    );
    expect(result.binding.promptBindings.VENDOR?.evaluationPromptDigest).toBe(
      PROMPT_BY_AGENT.ANISHA.contentDigest,
    );
    expect(result.binding.promptBindings.PROSPECT?.evaluationPromptDigest).toBe(
      PROMPT_BY_AGENT.AAROHI.contentDigest,
    );
    expect(result.binding.riyaConversationEvolutionPromptBinding).toBe(
      result.binding.promptBindings.CLIENT,
    );
  });

  it('refuses a seal from a different repository head', () => {
    expect(bindJf5cSealForProduction(buildSeal(), 'e'.repeat(40))).toEqual({
      ok: false,
      reason: 'source-head-mismatch',
    });
  });

  it('refuses any post-seal mutation before deriving a production claim', () => {
    const seal = buildSeal();
    const tampered = {
      ...seal,
      evidence: seal.evidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              binding: {
                ...item.binding,
                promptDigest: 'f'.repeat(64),
              },
            }
          : item,
      ),
    };
    expect(bindJf5cSealForProduction(tampered, HEAD)).toEqual({
      ok: false,
      reason: 'seal-digest-mismatch',
    });
  });

  it('does not accept a missing or malformed seal', () => {
    expect(bindJf5cSealForProduction({}, HEAD)).toEqual({
      ok: false,
      reason: 'seal-invalid',
    });
    expect(bindJf5cSealForProduction(buildSeal(), 'main')).toEqual({
      ok: false,
      reason: 'seal-invalid',
    });
  });
});
