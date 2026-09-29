import { describe, expect, it } from 'vitest';

import {
  OPENAI_V1_DATA_CONTROLS_REF,
  createOpenAIV1BindingMatrix,
  createOpenAIV1CertificationManifest,
  type OpenAIV1CertificationAgent,
  type OpenAIV1CertificationEntry,
} from '@qf-jarvis/jarvis-v1-provider-certification-live/openai-v1';

import {
  createOpenAIV1ProductionSeal,
  openAIV1RuntimeApprovalMaterial,
  type OpenAIV1HumanReview,
} from '../openai-v1/index.js';

const digest = (char: string) => char.repeat(64);
function agentAt(index: number): OpenAIV1CertificationAgent {
  switch (index % 3) {
    case 0:
      return 'RIYA';
    case 1:
      return 'ANISHA';
    default:
      return 'AAROHI';
  }
}
function manifest() {
  const entries = createOpenAIV1BindingMatrix().map((binding, index) => {
    const tier = index < 3 ? ('LUNA' as const) : ('SOL' as const);
    const agent = agentAt(index);
    return {
      tier,
      agent,
      releaseId: binding.release.releaseId,
      modelId: binding.release.modelId,
      modelVersion: binding.release.modelVersion,
      configDigest: binding.release.configDigest,
      promptFamily: binding.promptFamily,
      promptVersion: binding.promptVersion,
      promptDigest: binding.promptDigest,
      caseSetDigest: digest('a'),
      resultDigest: digest('b'),
      reviewBundleDigest: digest(String((index % 6) + 1)),
      safety: 'PASS',
    } satisfies OpenAIV1CertificationEntry;
  });
  return createOpenAIV1CertificationManifest({
    manifestVersion: 1,
    providerMode: 'OPENAI_ONLY',
    runId: 'openai-cert-run-seal-1',
    headSha: '4'.repeat(40),
    createdAt: '2026-09-29T00:00:00Z',
    dataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
    entries,
  });
}
function reviews(): readonly OpenAIV1HumanReview[] {
  return manifest().entries.map((entry) =>
    Object.freeze({
      tier: entry.tier,
      agent: entry.agent,
      reviewerRef: `reviewer.${entry.agent.toLowerCase()}`,
      reviewedAt: '2026-09-29T00:10:00Z',
      reviewBundleDigest: entry.reviewBundleDigest,
      decision: 'ACCEPT' as const,
    }),
  );
}

describe('OpenAI v1 production seal', () => {
  it('seals only after complete six-binding human review plus owner data-control acceptance', () => {
    const result = createOpenAIV1ProductionSeal({
      manifest: manifest(),
      reviews: reviews(),
      ownerAcceptance: {
        ownerRef: 'owner.quickfurno',
        acceptedAt: '2026-09-29T00:20:00Z',
        acceptedDataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
        decision: 'ACCEPT',
      },
      sealedAt: '2026-09-29T00:30:00Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seal.providerMode).toBe('OPENAI_ONLY');
    expect(result.seal.evidence).toHaveLength(6);
    expect(result.seal.runtimes).toHaveLength(2);
    expect(result.seal.evidence.every((item) => item.productionApproval)).toBe(true);

    const luna = openAIV1RuntimeApprovalMaterial(result.seal, 'LUNA');
    const sol = openAIV1RuntimeApprovalMaterial(result.seal, 'SOL');
    expect(luna.release.modelId).toBe('gpt-6-luna');
    expect(sol.release.modelId).toBe('gpt-6-sol');
    expect(luna.productionApprovals).toHaveLength(3);
    expect(sol.productionApprovals).toHaveLength(3);
  });

  it('refuses an incomplete review set', () => {
    const result = createOpenAIV1ProductionSeal({
      manifest: manifest(),
      reviews: reviews().slice(1),
      ownerAcceptance: {
        ownerRef: 'owner.quickfurno',
        acceptedAt: '2026-09-29T00:20:00Z',
        acceptedDataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
        decision: 'ACCEPT',
      },
      sealedAt: '2026-09-29T00:30:00Z',
    });
    expect(result).toEqual({ ok: false, reason: 'review-set-mismatch' });
  });
  it('refuses owner acceptance for a different data-control posture', () => {
    const result = createOpenAIV1ProductionSeal({
      manifest: manifest(),
      reviews: reviews(),
      ownerAcceptance: {
        ownerRef: 'owner.quickfurno',
        acceptedAt: '2026-09-29T00:20:00Z',
        acceptedDataControlsRef: 'datacontrols.openai.other-posture',
        decision: 'ACCEPT',
      },
      sealedAt: '2026-09-29T00:30:00Z',
    });
    expect(result).toEqual({ ok: false, reason: 'data-controls-mismatch' });
  });

  it('refuses a rejected individual review', () => {
    const changed = [...reviews()];
    const first = changed[0];
    if (first === undefined) throw new Error('invalid-test-fixture');
    changed[0] = { ...first, decision: 'REJECT' };
    const result = createOpenAIV1ProductionSeal({
      manifest: manifest(),
      reviews: changed,
      ownerAcceptance: {
        ownerRef: 'owner.quickfurno',
        acceptedAt: '2026-09-29T00:20:00Z',
        acceptedDataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
        decision: 'ACCEPT',
      },
      sealedAt: '2026-09-29T00:30:00Z',
    });
    expect(result).toEqual({ ok: false, reason: 'review-rejected' });
  });
});
