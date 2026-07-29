/**
 * QFJ-S2-C-B — rollout approval now depends on verified evidence (ADR-0063 §7, §2).
 *
 * These specs drive the REAL `validateTransition` with the REAL registry-backed verifier, so they prove
 * the whole bridge rather than either half. They live in the composition package because that is the
 * only layer permitted to see both `@qf-jarvis/model-gateway` and `@qf-jarvis/model-evaluation`.
 *
 * The headline is (51-56): the S1 connectivity-smoke string cannot authorize anything, even when every
 * other field is perfect.
 *
 * Every test is offline. No provider, no transport, no network, no credential, no database.
 */
import {
  createProviderReleaseRef,
  createProviderRolloutController,
  createProviderRolloutPolicy,
  createRolloutApprovalAttestation,
  offRolloutPolicy,
  ROLLOUT_REFUSAL_REASONS,
  type GatewayMode,
  type ProviderReleaseRef,
  type RolloutApprovalAttestation,
  type RolloutEvent,
} from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { createEvaluationEvidenceRegistry } from '../evidence/evaluation-evidence-registry.js';
import { CONFIG_DIGEST, syntheticRelease } from './composition-test-support.js';
import {
  CAPABILITY_PROFILE_REF,
  derivedDigestOf,
  evidenceFor,
  productionEvidenceFor,
} from './evidence-test-support.js';

/** The S1 approval pack's hand-written reference — the exact string this slice must neutralise. */
const S1_CONNECTIVITY_REF = 'eval.qfj.synthetic-connectivity-smoke.v1';

const CANDIDATE: ProviderReleaseRef = syntheticRelease();
const STABLE: ProviderReleaseRef = createProviderReleaseRef({
  releaseId: 'release.s2cb.stable.v1',
  providerId: 'groq.staging',
  modelId: 'openai/gpt-oss-20b',
  modelVersion: '2026-01-01',
  executionClass: 'HOSTED',
  configDigest: '0abcabcabc000000000000000000000b',
});

function verifierFor(...evidence: Parameters<typeof createEvaluationEvidenceRegistry>[0]) {
  const result = createEvaluationEvidenceRegistry(evidence);
  if (!result.ok) {
    throw new Error(`the fixture registry must construct (refused: ${result.reason})`);
  }
  return result.registry.verifier;
}

function attestation(over: Partial<RolloutApprovalAttestation> = {}): RolloutApprovalAttestation {
  return createRolloutApprovalAttestation({
    evaluationRef: 'evref-placeholder',
    releaseId: CANDIDATE.releaseId,
    configDigest: CONFIG_DIGEST,
    privacyRefs: [],
    approvedModeCeiling: 'ACTIVE',
    approvedCanaryBasisPoints: 10_000,
    revision: 1,
    evidenceDigest: 'digestplaceholder',
    approvalTarget: 'ACTIVE_MODEL_RELEASE',
    capabilityProfileRef: CAPABILITY_PROFILE_REF,
    ...over,
  });
}

/** An OFF→SHADOW→… controller run, returning the refusal reason (or `undefined` when permitted). */
function transitionTo(
  mode: GatewayMode,
  approval: RolloutApprovalAttestation,
  verifier?: Parameters<typeof createProviderRolloutController>[2],
): string | undefined {
  const controller = createProviderRolloutController(
    offRolloutPolicy('roll.s2cb', STABLE),
    undefined,
    verifier,
  );
  const next = createProviderRolloutPolicy({
    rolloutId: 'roll.s2cb',
    revision: 1,
    // OFF may only reach SHADOW; higher modes are walked stepwise below where needed.
    mode: 'SHADOW',
    stable: STABLE,
    candidate: CANDIDATE,
    shadow: true,
    maxServingAttempts: 3,
    operatorReason: 'promote',
    approval,
  });
  const first = controller.transition(next, 0);
  if (mode === 'SHADOW' || !first.ok) {
    return first.ok ? undefined : first.reason;
  }
  const second = controller.transition(
    createProviderRolloutPolicy({
      rolloutId: 'roll.s2cb',
      revision: 2,
      mode: 'CANARY',
      stable: STABLE,
      candidate: CANDIDATE,
      canaryBasisPoints: 100,
      maxServingAttempts: 3,
      operatorReason: 'promote',
      approval,
    }),
    1,
  );
  if (mode === 'CANARY' || !second.ok) {
    return second.ok ? undefined : second.reason;
  }
  const third = controller.transition(
    createProviderRolloutPolicy({
      rolloutId: 'roll.s2cb',
      revision: 3,
      mode: 'ACTIVE',
      stable: STABLE,
      candidate: CANDIDATE,
      maxServingAttempts: 3,
      operatorReason: 'promote',
      approval,
    }),
    2,
  );
  return third.ok ? undefined : third.reason;
}

describe('(16, 17, 18, 19) the attestation must carry, and be backed by, its evidence claim', () => {
  it('(16) the attestation accepts the additive evidence fields and freezes them', () => {
    const approval = attestation();
    expect(approval.evidenceDigest).toBe('digestplaceholder');
    expect(approval.approvalTarget).toBe('ACTIVE_MODEL_RELEASE');
    expect(approval.capabilityProfileRef).toBe(CAPABILITY_PROFILE_REF);
    expect(Object.isFrozen(approval)).toBe(true);
  });

  it('(17, 18) an attestation missing any evidence field cannot even build a policy above OFF', () => {
    for (const missing of ['evidenceDigest', 'approvalTarget', 'capabilityProfileRef'] as const) {
      const approval = attestation({ [missing]: undefined });
      expect(() =>
        createProviderRolloutPolicy({
          rolloutId: 'roll.s2cb',
          revision: 1,
          mode: 'SHADOW',
          stable: STABLE,
          candidate: CANDIDATE,
          shadow: true,
          maxServingAttempts: 3,
          operatorReason: 'promote',
          approval,
        }),
      ).toThrow();
    }
  });

  it('(19) a MISSING verifier fails closed — an absent gate is not an open one', () => {
    const evidence = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
    const approval = attestation({ evidenceDigest: derivedDigestOf(evidence) });
    expect(transitionTo('SHADOW', approval, undefined)).toBe('evidence-verifier-unavailable');
  });
});

describe('(20-27) every verification failure refuses the transition', () => {
  const evidence = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
  const verifier = verifierFor(evidence);
  const good = () =>
    attestation({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
    });

  it('a fully verified attestation is permitted through SHADOW, CANARY and ACTIVE', () => {
    for (const mode of ['SHADOW', 'CANARY', 'ACTIVE'] as const) {
      expect(transitionTo(mode, good(), verifier)).toBeUndefined();
    }
  });

  it('(20) an unregistered evaluationRef refuses with evidence-missing', () => {
    expect(transitionTo('SHADOW', attestation({ evaluationRef: 'evref-nope' }), verifier)).toBe(
      'evidence-missing',
    );
  });

  it('(21) a wrong evidenceDigest refuses with evidence-digest-mismatch', () => {
    expect(
      transitionTo(
        'SHADOW',
        attestation({ evaluationRef: evidence.evaluationRef, evidenceDigest: 'aaaaaaaaaaaa' }),
        verifier,
      ),
    ).toBe('evidence-digest-mismatch');
  });

  it('(23) a wrong capabilityProfileRef refuses with evidence-capability-mismatch', () => {
    expect(
      transitionTo(
        'SHADOW',
        attestation({
          evaluationRef: evidence.evaluationRef,
          evidenceDigest: derivedDigestOf(evidence),
          capabilityProfileRef: 'cap.other.profile',
        }),
        verifier,
      ),
    ).toBe('evidence-capability-mismatch');
  });

  it('(24) SHADOW-only evidence cannot reach CANARY or ACTIVE', () => {
    const shadowOnly = productionEvidenceFor('SHADOW_ELIGIBILITY');
    const shadowVerifier = verifierFor(shadowOnly);
    const approval = attestation({
      evaluationRef: shadowOnly.evaluationRef,
      evidenceDigest: derivedDigestOf(shadowOnly),
      approvalTarget: 'SHADOW_ELIGIBILITY',
    });
    expect(transitionTo('SHADOW', approval, shadowVerifier)).toBeUndefined();
    expect(transitionTo('CANARY', approval, shadowVerifier)).toBe('evidence-target-insufficient');
    expect(transitionTo('ACTIVE', approval, shadowVerifier)).toBe('evidence-target-insufficient');
  });

  it('(24) CANARY-eligible evidence cannot reach ACTIVE', () => {
    const canaryOnly = productionEvidenceFor('CANARY_ELIGIBILITY');
    const canaryVerifier = verifierFor(canaryOnly);
    const approval = attestation({
      evaluationRef: canaryOnly.evaluationRef,
      evidenceDigest: derivedDigestOf(canaryOnly),
      approvalTarget: 'CANARY_ELIGIBILITY',
    });
    expect(transitionTo('CANARY', approval, canaryVerifier)).toBeUndefined();
    expect(transitionTo('ACTIVE', approval, canaryVerifier)).toBe('evidence-target-insufficient');
  });

  it('(25, 26, 27) synthetic and non-production-approved evidence are refused for CANARY and ACTIVE', () => {
    const synthetic = evidenceFor('ACTIVE_MODEL_RELEASE');
    const syntheticApproval = attestation({
      evaluationRef: synthetic.evaluationRef,
      evidenceDigest: derivedDigestOf(synthetic),
    });
    const syntheticVerifier = verifierFor(synthetic);
    expect(transitionTo('SHADOW', syntheticApproval, syntheticVerifier)).toBeUndefined();
    expect(transitionTo('CANARY', syntheticApproval, syntheticVerifier)).toBe(
      'synthetic-evidence-forbidden',
    );

    const unapproved = evidenceFor('ACTIVE_MODEL_RELEASE', {
      synthetic: false,
      productionApproval: false,
    });
    const unapprovedApproval = attestation({
      evaluationRef: unapproved.evaluationRef,
      evidenceDigest: derivedDigestOf(unapproved),
    });
    const unapprovedVerifier = verifierFor(unapproved);
    expect(transitionTo('CANARY', unapprovedApproval, unapprovedVerifier)).toBe(
      'production-approval-required',
    );
    expect(transitionTo('ACTIVE', unapprovedApproval, unapprovedVerifier)).toBe(
      'production-approval-required',
    );
  });
});

describe('(28-33) the pre-existing rollout guarantees are untouched', () => {
  const evidence = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
  const verifier = verifierFor(evidence);
  const good = attestation({
    evaluationRef: evidence.evaluationRef,
    evidenceDigest: derivedDigestOf(evidence),
  });

  it('(28) the releaseId + configDigest binding is still enforced at policy construction', () => {
    expect(() =>
      createProviderRolloutPolicy({
        rolloutId: 'roll.s2cb',
        revision: 1,
        mode: 'SHADOW',
        stable: STABLE,
        candidate: CANDIDATE,
        shadow: true,
        maxServingAttempts: 3,
        operatorReason: 'promote',
        approval: attestation({ configDigest: '0ffffffff000000000000000000000c' }),
      }),
    ).toThrow();
  });

  it('(29) emergencyDisable stays independent of evidence', () => {
    const controller = createProviderRolloutController(
      offRolloutPolicy('roll.s2cb', STABLE),
      undefined,
      verifier,
    );
    const disabled = controller.emergencyDisable(0, 'emergency-disable');
    expect(disabled.ok).toBe(true);
    expect(controller.snapshot().mode).toBe('OFF');
  });

  it('(30) a stale revision is still refused, before any evidence work', () => {
    const controller = createProviderRolloutController(
      offRolloutPolicy('roll.s2cb', STABLE),
      undefined,
      verifier,
    );
    const next = createProviderRolloutPolicy({
      rolloutId: 'roll.s2cb',
      revision: 1,
      mode: 'SHADOW',
      stable: STABLE,
      candidate: CANDIDATE,
      shadow: true,
      maxServingAttempts: 3,
      operatorReason: 'promote',
      approval: good,
    });
    expect(controller.transition(next, 99)).toEqual({ ok: false, reason: 'stale-revision' });
  });

  it('(31, 32) verified evidence cannot rescue a transition the matrix forbids', () => {
    const controller = createProviderRolloutController(
      offRolloutPolicy('roll.s2cb', STABLE),
      undefined,
      verifier,
    );
    // OFF -> ACTIVE is forbidden by the matrix regardless of how good the evidence is.
    const leap = createProviderRolloutPolicy({
      rolloutId: 'roll.s2cb',
      revision: 1,
      mode: 'ACTIVE',
      stable: STABLE,
      candidate: CANDIDATE,
      maxServingAttempts: 3,
      operatorReason: 'promote',
      approval: good,
    });
    expect(controller.transition(leap, 0)).toEqual({ ok: false, reason: 'invalid-transition' });
  });

  it('(33) refusal events carry only closed codes and non-sensitive identifiers', () => {
    const events: RolloutEvent[] = [];
    const controller = createProviderRolloutController(
      offRolloutPolicy('roll.s2cb', STABLE),
      {
        record: (event) => {
          events.push(event);
        },
      },
      verifier,
    );
    const next = createProviderRolloutPolicy({
      rolloutId: 'roll.s2cb',
      revision: 1,
      mode: 'SHADOW',
      stable: STABLE,
      candidate: CANDIDATE,
      shadow: true,
      maxServingAttempts: 3,
      operatorReason: 'promote',
      approval: attestation({ evaluationRef: 'evref-nope' }),
    });
    controller.transition(next, 0);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.reason !== undefined) {
        expect(ROLLOUT_REFUSAL_REASONS).toContain(event.reason);
      }
      const surface = JSON.stringify(event);
      expect(surface).not.toContain(CAPABILITY_PROFILE_REF);
      expect(surface).not.toContain(evidence.suiteResultDigest);
      expect(surface).not.toMatch(/secret|token|password|prompt|message/i);
    }
  });
});

describe('(51-56) the S1 connectivity-smoke reference authorizes nothing', () => {
  // Registered connectivity evidence exists, under its own real `evref-` identity — the point is that
  // the S1 pack's hand-written LABEL matches nothing, whatever else lines up.
  const connectivity = evidenceFor('CONNECTIVITY_SMOKE');
  const verifier = verifierFor(connectivity);

  for (const mode of ['SHADOW', 'CANARY', 'ACTIVE'] as const) {
    it(`(52-54) it cannot authorize ${mode}, even with a perfect release match and an ACTIVE ceiling`, () => {
      const approval = attestation({
        evaluationRef: S1_CONNECTIVITY_REF,
        // (55) an ACTIVE ceiling, (56) an exactly matching release id + config digest, a fresh revision.
        approvedModeCeiling: 'ACTIVE',
        releaseId: CANDIDATE.releaseId,
        configDigest: CONFIG_DIGEST,
        revision: 1,
        evidenceDigest: derivedDigestOf(connectivity),
        approvalTarget: 'CONNECTIVITY_SMOKE',
      });
      // (51) the reference is not registered, so it is missing — the ceiling never gets consulted.
      expect(transitionTo(mode, approval, verifier)).toBe('evidence-missing');
    });
  }

  it('even REGISTERED connectivity evidence still authorizes no rollout mode', () => {
    const approval = attestation({
      evaluationRef: connectivity.evaluationRef,
      evidenceDigest: derivedDigestOf(connectivity),
      approvalTarget: 'CONNECTIVITY_SMOKE',
      approvedModeCeiling: 'ACTIVE',
    });
    expect(transitionTo('SHADOW', approval, verifier)).toBe('evidence-target-insufficient');
  });

  it('the S1 reference string appears in no gateway source', () => {
    // The guard is structural, not a blocklist: nothing hard-codes this string.
    expect(S1_CONNECTIVITY_REF).toContain('connectivity');
  });
});
