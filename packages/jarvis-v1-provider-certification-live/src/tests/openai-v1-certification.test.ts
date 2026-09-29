import { describe, expect, it } from 'vitest';

import {
  OPENAI_V1_DATA_CONTROLS_REF,
  OPENAI_V1_MODEL_BY_TIER,
  OPENAI_V1_PROVIDER_MODE,
  createOpenAIV1BindingMatrix,
  createOpenAIV1CertificationManifest,
  createOpenAIV1Release,
  openAIV1CertificationReady,
  type OpenAIV1CertificationAgent,
  type OpenAIV1CertificationEntry,
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
function entries(safety: OpenAIV1CertificationEntry['safety'] = 'PASS') {
  return createOpenAIV1BindingMatrix().map((binding, index) => {
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
      reviewBundleDigest: digest('c'),
      safety,
    } satisfies OpenAIV1CertificationEntry;
  });
}
describe('OpenAI v1 certification lineage', () => {
  it('pins exact Luna/Sol API catalogue ids under OPENAI_ONLY', () => {
    expect(OPENAI_V1_PROVIDER_MODE).toBe('OPENAI_ONLY');
    expect(OPENAI_V1_MODEL_BY_TIER).toEqual({
      LUNA: 'gpt-6-luna',
      SOL: 'gpt-6-sol',
    });
    for (const modelId of Object.values(OPENAI_V1_MODEL_BY_TIER)) {
      expect(modelId).not.toContain('*');
      expect(modelId.split('/').map((part) => part.toLowerCase())).not.toContain('latest');
    }
  });

  it('creates distinct exact releases with different config digests', () => {
    const luna = createOpenAIV1Release('LUNA');
    const sol = createOpenAIV1Release('SOL');
    expect(luna.providerId).toBe('openai');
    expect(sol.providerId).toBe('openai');
    expect(luna.releaseId).not.toBe(sol.releaseId);
    expect(luna.configDigest).not.toBe(sol.configDigest);
  });
  it('builds six exact model x agent bindings', () => {
    const matrix = createOpenAIV1BindingMatrix();
    expect(matrix).toHaveLength(6);
    expect(new Set(matrix.map((item) => item.release.modelId))).toEqual(
      new Set(['gpt-6-luna', 'gpt-6-sol']),
    );
    expect(new Set(matrix.map((item) => item.promptFamily)).size).toBe(3);
  });

  it('accepts only a complete exact six-entry manifest', () => {
    const manifest = createOpenAIV1CertificationManifest({
      manifestVersion: 1,
      providerMode: 'OPENAI_ONLY',
      runId: 'openai-cert-run-1',
      headSha: '1'.repeat(40),
      createdAt: '2026-09-29T00:00:00Z',
      dataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
      entries: entries(),
    });
    expect(manifest.entries).toHaveLength(6);
    expect(openAIV1CertificationReady(manifest)).toBe(true);
  });
  it('does not become certification-ready when any safety result is not PASS', () => {
    const candidate = entries();
    const first = candidate[0];
    if (first === undefined) throw new Error('invalid-test-fixture');
    candidate[0] = { ...first, safety: 'INCONCLUSIVE' };
    const manifest = createOpenAIV1CertificationManifest({
      manifestVersion: 1,
      providerMode: 'OPENAI_ONLY',
      runId: 'openai-cert-run-2',
      headSha: '2'.repeat(40),
      createdAt: '2026-09-29T00:00:00Z',
      dataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
      entries: candidate,
    });
    expect(openAIV1CertificationReady(manifest)).toBe(false);
  });

  it('rejects drifted model identities and incomplete binding sets', () => {
    const bad = entries();
    const first = bad[0];
    if (first === undefined) throw new Error('invalid-test-fixture');
    bad[0] = { ...first, modelId: 'gpt-6-sol' };
    expect(() =>
      createOpenAIV1CertificationManifest({
        manifestVersion: 1,
        providerMode: 'OPENAI_ONLY',
        runId: 'openai-cert-run-3',
        headSha: '3'.repeat(40),
        createdAt: '2026-09-29T00:00:00Z',
        dataControlsRef: OPENAI_V1_DATA_CONTROLS_REF,
        entries: bad,
      }),
    ).toThrow();
  });
});
