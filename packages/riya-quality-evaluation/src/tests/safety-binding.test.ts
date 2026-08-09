/**
 * RWC-P10 — quality cannot exist without generic safety evidence (ADR-0106 §16, §18).
 *
 * The load-bearing property is that a caller cannot NAME a release, a model or a prompt. Every one of
 * those identities is copied out of an `ApprovalEvidence` that `@qf-jarvis/model-evaluation` issued.
 * That is what turns "safety is mandatory" from a rule in a document into something the type system
 * enforces — and it closes the drift where a candidate passes safety on one prompt and is measured
 * for quality on another.
 */
import { describe, expect, it } from 'vitest';

import {
  createRiyaQualityCandidateBinding,
  RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS,
  riyaQualityParityKey,
} from '../contracts/binding.js';
import { RiyaQualityEvaluationError } from '../contracts/errors.js';
import { createRiyaQualityEvidence } from '../service/create-evidence.js';
import { evaluateRiyaQualitySuite } from '../service/evaluate-suite.js';
import {
  buildRiyaQualityGoldenSuite,
  createSyntheticQualityBinding,
  createSyntheticSafetyEvidence,
  passingGoldenObservations,
  SYNTHETIC_INSTANT,
} from '../testing/builders.js';
import {
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
  RIYA_QUALITY_GOLDEN_SUITE_ID,
} from '../testing/golden-corpus.js';

const BASE = {
  qualitySuiteId: RIYA_QUALITY_GOLDEN_SUITE_ID,
  qualitySuiteVersion: 1,
  fixtureManifestId: RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
  fixtureManifestVersion: 1,
  thresholdsId: 'riya-quality-thresholds-v1',
  thresholdsVersion: 1,
  createdAt: SYNTHETIC_INSTANT,
};

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaQualityEvaluationError ? error.code : 'not-a-quality-error';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// 1. Which safety evidence qualifies.
// ---------------------------------------------------------------------------

describe('a quality binding may only rest on behavioural safety evidence', () => {
  it('accepts ACTIVE, SHADOW and CANARY', () => {
    expect([...RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS]).toStrictEqual([
      'ACTIVE_MODEL_RELEASE',
      'SHADOW_ELIGIBILITY',
      'CANARY_ELIGIBILITY',
    ]);
    for (const target of RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS) {
      const binding = createRiyaQualityCandidateBinding({
        ...BASE,
        safetyEvidence: createSyntheticSafetyEvidence({ target }),
      });
      expect(binding.safetyTarget).toBe(target);
    }
  });

  it('refuses CONNECTIVITY_SMOKE', () => {
    // It says only that a socket opened and something well-formed came back. Layering sales-quality
    // measurement on it would produce an artifact that LOOKS certified and rests on nothing about
    // behaviour.
    expect(
      codeOf(() =>
        createRiyaQualityCandidateBinding({
          ...BASE,
          safetyEvidence: createSyntheticSafetyEvidence({ target: 'CONNECTIVITY_SMOKE' }),
        }),
      ),
    ).toBe('safety-evidence-target-not-eligible');
  });

  it('refuses SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY', () => {
    // Research evidence for a retrieval capability this repository has deliberately not enabled.
    expect(
      codeOf(() =>
        createRiyaQualityCandidateBinding({
          ...BASE,
          safetyEvidence: createSyntheticSafetyEvidence({
            target: 'SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY',
          }),
        }),
      ),
    ).toBe('safety-evidence-target-not-eligible');
  });

  it('refuses missing evidence outright', () => {
    for (const bad of [undefined, null, {}, { evaluationRef: '' }]) {
      expect(
        codeOf(() => createRiyaQualityCandidateBinding({ ...BASE, safetyEvidence: bad as never })),
      ).toBe('safety-evidence-required');
    }
  });

  it('refuses evidence that is not synthetic, or that claims production approval', () => {
    // Quality evidence built on a production-approving artifact would inherit an authority this
    // slice was never granted.
    expect(
      codeOf(() =>
        createRiyaQualityCandidateBinding({
          ...BASE,
          safetyEvidence: createSyntheticSafetyEvidence({ synthetic: false }),
        }),
      ),
    ).toBe('safety-evidence-not-synthetic');
    expect(
      codeOf(() =>
        createRiyaQualityCandidateBinding({
          ...BASE,
          safetyEvidence: createSyntheticSafetyEvidence({ productionApproval: true }),
        }),
      ),
    ).toBe('safety-evidence-not-synthetic');
  });
});

// ---------------------------------------------------------------------------
// 2. Identity is copied, never supplied.
// ---------------------------------------------------------------------------

describe('release and prompt identity are COPIED from the safety evidence', () => {
  it('carries exactly what the evidence said, and offers no way to override it', () => {
    const evidence = createSyntheticSafetyEvidence({
      releaseId: 'release.beta',
      modelId: 'vendor.beta/model-beta',
      promptFamily: 'riya.conversation',
      promptVersion: 7,
      promptDigest: 'f'.repeat(64),
      capabilityProfileRef: 'capability.riya.beta',
      knowledgeRevision: 'knowledge.rev.9',
      policyContractRevision: 'policy.rev.4',
    });
    const binding = createRiyaQualityCandidateBinding({ ...BASE, safetyEvidence: evidence });

    expect(binding.release).toStrictEqual(evidence.binding.release);
    expect(binding.promptFamily).toBe('riya.conversation');
    expect(binding.promptVersion).toBe(7);
    expect(binding.promptDigest).toBe('f'.repeat(64));
    expect(binding.capabilityProfileRef).toBe('capability.riya.beta');
    expect(binding.knowledgeRevision).toBe('knowledge.rev.9');
    expect(binding.policyContractRevision).toBe('policy.rev.4');
    expect(binding.safetyEvaluationRef).toBe(evidence.evaluationRef);

    // A caller passing these directly is refused by `.strict()` — there is no override path, so a
    // quality run cannot claim a prompt digest safety never covered.
    expect(
      codeOf(() =>
        createRiyaQualityCandidateBinding({
          ...BASE,
          safetyEvidence: evidence,
          promptDigest: '0'.repeat(64),
          release: { releaseId: 'forged' },
        } as never),
      ),
    ).toBe('no-error');
    const ignored = createRiyaQualityCandidateBinding({
      ...BASE,
      safetyEvidence: evidence,
      promptDigest: '0'.repeat(64),
    } as never);
    // Even when an extra key is present it is IGNORED, not honoured: the evidence still decides.
    expect(ignored.promptDigest).toBe('f'.repeat(64));
  });

  it('stamps its own evaluator identity', () => {
    const binding = createSyntheticQualityBinding();
    expect(binding.evaluatorImplId).toBe('riya-quality-evaluator');
    expect(binding.evaluatorImplVersion).toBe(1);
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it('refuses a wildcard suite, fixture or threshold identity', () => {
    for (const override of [
      { qualitySuiteId: 'latest' },
      { fixtureManifestId: 'riya-*' },
      { thresholdsId: 'LATEST' },
    ]) {
      expect(
        codeOf(() =>
          createRiyaQualityCandidateBinding({
            ...BASE,
            ...override,
            safetyEvidence: createSyntheticSafetyEvidence(),
          }),
        ),
      ).toBe('invalid-candidate-binding');
    }
  });

  it('the PARITY key ignores provider, model, release and prompt', () => {
    // Those are exactly what a comparison varies. If they changed the parity key, no two candidates
    // would ever be comparable and the feature would be dead on arrival.
    const base = createSyntheticQualityBinding();
    for (const varied of [
      { releaseId: 'release.gamma' },
      { modelId: 'vendor.gamma/model-gamma' },
      { promptVersion: 42 },
      { promptDigest: '9'.repeat(64) },
    ]) {
      expect(riyaQualityParityKey(createSyntheticQualityBinding(varied))).toBe(
        riyaQualityParityKey(base),
      );
    }
    // Capability, knowledge and policy DO change it: those decide what a correct answer even is.
    for (const varied of [
      { capabilityProfileRef: 'capability.other' },
      { knowledgeRevision: 'knowledge.rev.99' },
      { policyContractRevision: 'policy.rev.99' },
    ]) {
      expect(riyaQualityParityKey(createSyntheticQualityBinding(varied))).not.toBe(
        riyaQualityParityKey(base),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Evidence.
// ---------------------------------------------------------------------------

describe('quality evidence exists only for an eligible run, and approves nothing', () => {
  const eligibleResult = () =>
    evaluateRiyaQualitySuite(buildRiyaQualityGoldenSuite(), passingGoldenObservations());

  it('an eligible run produces deterministic, synthetic, non-approving evidence', () => {
    const result = eligibleResult();
    expect(result.qualityEligible).toBe(true);

    const first = createRiyaQualityEvidence(result);
    const second = createRiyaQualityEvidence(eligibleResult());
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error('expected evidence');
    }
    expect(first.evidence.qualityRef).toBe(second.evidence.qualityRef);
    expect(first.evidence.synthetic).toBe(true);
    expect(first.evidence.productionApproval).toBe(false);
    expect(first.evidence.resultDigest).toBe(result.resultDigest);
    expect(first.evidence.caseSetDigest).toBe(result.caseSetDigest);
    expect(Object.isFrozen(first.evidence)).toBe(true);
  });

  it('an INELIGIBLE run produces no evidence at all', () => {
    // Evidence for a run that breached a threshold would be a record of a failure wearing the shape
    // of an approval.
    const result = evaluateRiyaQualitySuite(
      buildRiyaQualityGoldenSuite(),
      passingGoldenObservations({ withhold: ['CLARITY'], withholdCases: 20 }),
    );
    expect(result.qualityEligible).toBe(false);
    const attempt = createRiyaQualityEvidence(result);
    expect(attempt).toStrictEqual({ ok: false, code: 'quality-not-eligible' });
  });

  it('a TAMPERED result is refused before eligibility is even considered', () => {
    const result = eligibleResult();
    const tampered = {
      ...result,
      caseResults: result.caseResults.map((one, index) =>
        index === 0 ? { ...one, outcome: 'PASS' as const, objectiveFailures: [] } : one,
      ),
      // The digest is left as it was, which is precisely what an edited artifact looks like.
      caseSetDigest: 'deadbeef'.repeat(4),
    };
    expect(createRiyaQualityEvidence(tampered)).toStrictEqual({
      ok: false,
      code: 'quality-digest-invalid',
    });
  });

  it('carries no reviewer reference, no raw text and no prompt text', () => {
    const created = createRiyaQualityEvidence(eligibleResult());
    if (!created.ok) {
      throw new Error('expected evidence');
    }
    const serialized = JSON.stringify(created.evidence);
    for (const forbidden of [
      'reviewer.alpha',
      'reviewer.beta',
      'modular kitchen',
      'lakh',
      'You are Riya',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(created.evidence).sort()).toStrictEqual([
      'candidateBinding',
      'caseSetDigest',
      'createdAt',
      'productionApproval',
      'qualityRef',
      'resultDigest',
      'synthetic',
      'version',
    ]);
  });
});
