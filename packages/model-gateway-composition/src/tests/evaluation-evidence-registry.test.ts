/**
 * QFJ-S2-C-B — the frozen evidence registry and verifier (ADR-0063 §2, §5, §6).
 *
 * Matrix: the target ladder is total and connectivity smoke authorizes nothing; the registry validates,
 * freezes and de-duplicates; a conflicting duplicate fails closed; the digest is DERIVED and a caller's
 * claim is never trusted; and every mismatch resolves to a distinct closed refusal reason carrying no
 * evidence payload.
 *
 * Every test is offline: pure functions over frozen fixtures. No provider, network, database or Docker.
 */
import {
  EVALUATION_APPROVAL_TARGETS,
  contentDigest,
  type EvaluationApprovalTarget,
} from '@qf-jarvis/model-evaluation';
import type { GatewayMode, ProviderReleaseRef } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { createEvaluationEvidenceRegistry } from '../evidence/evaluation-evidence-registry.js';
import { syntheticRelease } from './composition-test-support.js';
import {
  CAPABILITY_PROFILE_REF,
  derivedDigestOf,
  evidenceBinding,
  evidenceFor,
  productionEvidenceFor,
} from './evidence-test-support.js';

const RELEASE: ProviderReleaseRef = syntheticRelease();
const ROLLOUT_MODES_ABOVE_OFF: readonly GatewayMode[] = ['SHADOW', 'CANARY', 'ACTIVE'];

/** Build a registry from one evidence object, asserting it constructed. */
function registryOf(...evidence: Parameters<typeof createEvaluationEvidenceRegistry>[0]) {
  const result = createEvaluationEvidenceRegistry(evidence);
  if (!result.ok) {
    throw new Error(`the fixture registry must construct (refused: ${result.reason})`);
  }
  return result.registry;
}

/** A complete, matching verification request for a piece of evidence at a given mode. */
function requestFor(
  evidence: ReturnType<typeof evidenceFor>,
  mode: GatewayMode,
  over: Record<string, unknown> = {},
) {
  return {
    evaluationRef: evidence.evaluationRef,
    evidenceDigest: derivedDigestOf(evidence),
    approvalTarget: evidence.target,
    release: RELEASE,
    capabilityProfileRef: CAPABILITY_PROFILE_REF,
    mode,
    ...over,
  };
}

describe('(1-7) the target ladder', () => {
  const LADDER: Readonly<Record<EvaluationApprovalTarget, readonly GatewayMode[]>> = {
    ACTIVE_MODEL_RELEASE: ['SHADOW', 'CANARY', 'ACTIVE'],
    CANARY_ELIGIBILITY: ['SHADOW', 'CANARY'],
    SHADOW_ELIGIBILITY: ['SHADOW'],
    CONNECTIVITY_SMOKE: [],
    SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY: [],
  };

  it('(7) is TOTAL over every declared approval target', () => {
    expect(Object.keys(LADDER).sort()).toEqual([...EVALUATION_APPROVAL_TARGETS].sort());
    expect(EVALUATION_APPROVAL_TARGETS).toHaveLength(5);
  });

  for (const [target, permitted] of Object.entries(LADDER) as [
    EvaluationApprovalTarget,
    readonly GatewayMode[],
  ][]) {
    it(`(2-6) ${target} permits exactly [${permitted.join(', ') || 'none'}]`, () => {
      for (const mode of ROLLOUT_MODES_ABOVE_OFF) {
        // Production modes additionally demand non-synthetic evidence, so use the production shape
        // where it is legal; the synthetic restriction is asserted separately below. CONNECTIVITY_SMOKE
        // may never be production-approved, so it keeps the synthetic shape — which is exactly why it
        // can never reach a production mode.
        const evidence =
          target === 'CONNECTIVITY_SMOKE' ? evidenceFor(target) : productionEvidenceFor(target);
        const registry = registryOf(evidence);
        const result = registry.verifier.verify(requestFor(evidence, mode));
        expect(result.ok).toBe(permitted.includes(mode));
        if (!result.ok && permitted.length === 0) {
          expect(result.reason).toBe('evidence-target-insufficient');
        }
      }
    });
  }

  it('(2) CONNECTIVITY_SMOKE authorizes no mode even when everything else matches exactly', () => {
    // Connectivity evidence must be synthetic, so it cannot use the production shape.
    const evidence = evidenceFor('CONNECTIVITY_SMOKE');
    const registry = registryOf(evidence);
    for (const mode of ROLLOUT_MODES_ABOVE_OFF) {
      const result = registry.verifier.verify(requestFor(evidence, mode));
      expect(result).toEqual({ ok: false, reason: 'evidence-target-insufficient' });
    }
  });

  it('(3) SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY authorizes no rollout mode', () => {
    const evidence = productionEvidenceFor('SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY');
    const registry = registryOf(evidence);
    for (const mode of ROLLOUT_MODES_ABOVE_OFF) {
      expect(registry.verifier.verify(requestFor(evidence, mode)).ok).toBe(false);
    }
  });
});

describe('(34-39, 49) registry construction, freezing and duplicates', () => {
  it('(34, 35, 36, 49) constructs, freezes, exposes no mutator, and lists deterministically', () => {
    const a = evidenceFor('SHADOW_ELIGIBILITY');
    const b = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
    const registry = registryOf(b, a);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.verifier)).toBe(true);
    expect(Object.keys(registry).sort()).toEqual(['references', 'size', 'verifier']);
    const surface = registry as unknown as Record<string, unknown>;
    for (const forbidden of ['register', 'add', 'set', 'delete', 'clear', 'entries', 'map']) {
      expect(surface[forbidden]).toBeUndefined();
    }
    // Deterministic listing: sorted, and stable across construction order.
    expect(registry.references()).toEqual([...registry.references()].sort());
    expect(registryOf(a, b).references()).toEqual(registry.references());
    expect(Object.isFrozen(registry.references())).toBe(true);
    expect(registry.size()).toBe(2);
  });

  it('(37) an IDENTICAL duplicate registration is idempotent', () => {
    const evidence = evidenceFor('SHADOW_ELIGIBILITY');
    const registry = registryOf(evidence, evidence, { ...evidence });
    expect(registry.size()).toBe(1);
    expect(registry.verifier.verify(requestFor(evidence, 'SHADOW')).ok).toBe(true);
  });

  it('(38) the same evaluationRef with DIFFERENT content fails closed', () => {
    const first = evidenceFor('SHADOW_ELIGIBILITY', { evaluationRef: 'evref-collide' });
    const second = evidenceFor('SHADOW_ELIGIBILITY', {
      evaluationRef: 'evref-collide',
      suiteResultDigest: contentDigest({ different: true }),
    });
    const result = createEvaluationEvidenceRegistry([first, second]);
    expect(result).toEqual({ ok: false, reason: 'conflicting-evidence-registration' });
  });

  it('(39, 40) the digest is DERIVED, and a caller-supplied digest is never trusted', () => {
    const evidence = evidenceFor('SHADOW_ELIGIBILITY');
    const registry = registryOf(evidence);
    // Deterministic: the same evidence derives the same digest every time.
    expect(derivedDigestOf(evidence)).toBe(derivedDigestOf({ ...evidence }));
    // A confident but wrong claim is refused, not believed.
    expect(
      registry.verifier.verify(
        requestFor(evidence, 'SHADOW', { evidenceDigest: 'deadbeefdeadbeef' }),
      ),
    ).toEqual({ ok: false, reason: 'evidence-digest-mismatch' });
  });

  it('rejects structurally invalid evidence and illegal flag combinations', () => {
    // synthetic AND production-approved is a contradiction.
    expect(
      createEvaluationEvidenceRegistry([
        evidenceFor('ACTIVE_MODEL_RELEASE', { synthetic: true, productionApproval: true }),
      ]),
    ).toEqual({ ok: false, reason: 'evidence-approval-flags-invalid' });
    // Connectivity evidence must be synthetic and never production approval.
    expect(
      createEvaluationEvidenceRegistry([
        evidenceFor('CONNECTIVITY_SMOKE', { synthetic: false, productionApproval: true }),
      ]),
    ).toEqual({ ok: false, reason: 'evidence-approval-flags-invalid' });
    // An unknown target, and a binding that fails the existing factory's grammar.
    const forged = { ...evidenceFor('SHADOW_ELIGIBILITY'), target: 'NOT_A_TARGET' };
    expect(createEvaluationEvidenceRegistry([forged as never])).toEqual({
      ok: false,
      reason: 'evidence-invalid',
    });
    const badBinding = {
      ...evidenceFor('SHADOW_ELIGIBILITY'),
      binding: { ...evidenceBinding(), promptFamily: 'latest' },
    };
    expect(createEvaluationEvidenceRegistry([badBinding as never])).toEqual({
      ok: false,
      reason: 'evidence-invalid',
    });
  });
});

describe('(41-48, 50) every mismatch resolves to a distinct closed reason', () => {
  const evidence = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
  const registry = registryOf(evidence);

  it('(41) an unregistered evaluationRef is evidence-missing', () => {
    expect(
      registry.verifier.verify(requestFor(evidence, 'ACTIVE', { evaluationRef: 'evref-unknown' })),
    ).toEqual({ ok: false, reason: 'evidence-missing' });
  });

  it('(42, 43, 44) release / provider / model / version / digest mismatches fail closed', () => {
    for (const over of [
      { releaseId: 'rel.other' },
      { providerId: 'other.provider' },
      { modelId: 'other/model' },
      { modelVersion: '1999-01-01' },
      { configDigest: 'otherdigest000000000000000000000' },
      { executionClass: 'LOCAL' as const },
    ]) {
      const result = registry.verifier.verify(
        requestFor(evidence, 'ACTIVE', { release: { ...RELEASE, ...over } }),
      );
      expect(result).toEqual({ ok: false, reason: 'evidence-release-mismatch' });
    }
  });

  it('(45) a capability-profile mismatch is its own distinct reason', () => {
    expect(
      registry.verifier.verify(
        requestFor(evidence, 'ACTIVE', { capabilityProfileRef: 'cap.some.other' }),
      ),
    ).toEqual({ ok: false, reason: 'evidence-capability-mismatch' });
  });

  it('(46) a claimed target the evidence does not carry fails closed', () => {
    expect(
      registry.verifier.verify(
        requestFor(evidence, 'ACTIVE', { approvalTarget: 'SHADOW_ELIGIBILITY' }),
      ),
    ).toEqual({ ok: false, reason: 'evidence-target-insufficient' });
  });

  it('(47) synthetic evidence cannot authorize CANARY or ACTIVE, but may authorize SHADOW', () => {
    const synthetic = evidenceFor('ACTIVE_MODEL_RELEASE', {
      synthetic: true,
      productionApproval: false,
    });
    const syntheticRegistry = registryOf(synthetic);
    for (const mode of ['CANARY', 'ACTIVE'] as const) {
      expect(syntheticRegistry.verifier.verify(requestFor(synthetic, mode))).toEqual({
        ok: false,
        reason: 'synthetic-evidence-forbidden',
      });
    }
    // SHADOW discards output, so synthetic evidence is acceptable there.
    expect(syntheticRegistry.verifier.verify(requestFor(synthetic, 'SHADOW')).ok).toBe(true);
  });

  it('(48) non-synthetic but NOT production-approved is its own distinct reason', () => {
    const unapproved = evidenceFor('ACTIVE_MODEL_RELEASE', {
      synthetic: false,
      productionApproval: false,
    });
    const unapprovedRegistry = registryOf(unapproved);
    for (const mode of ['CANARY', 'ACTIVE'] as const) {
      expect(unapprovedRegistry.verifier.verify(requestFor(unapproved, mode))).toEqual({
        ok: false,
        reason: 'production-approval-required',
      });
    }
  });

  it('(50) no refusal carries an evidence payload, digest, binding or message', () => {
    const results = [
      registry.verifier.verify(requestFor(evidence, 'ACTIVE', { evaluationRef: 'evref-unknown' })),
      registry.verifier.verify(requestFor(evidence, 'ACTIVE', { evidenceDigest: 'aaaaaaaaaaaa' })),
      registry.verifier.verify(
        requestFor(evidence, 'ACTIVE', { capabilityProfileRef: 'cap.other' }),
      ),
    ];
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(['ok', 'reason']);
      const surface = JSON.stringify(result);
      expect(surface).not.toContain(CAPABILITY_PROFILE_REF);
      expect(surface).not.toContain(evidence.evaluationRef);
      expect(surface).not.toContain(evidence.suiteResultDigest);
      expect(surface).not.toContain('binding');
      expect(surface).not.toContain('message');
    }
  });

  it('a fully matching production request is permitted', () => {
    expect(registry.verifier.verify(requestFor(evidence, 'ACTIVE'))).toEqual({ ok: true });
  });
});
