/**
 * QFJ-S2-C-B amendment — the initial/restored rollout-state bypass is closed (ADR-0063 §10).
 *
 * The first S2-C-B revision gated only TRANSITIONS. This was reproducible before the fix: a fabricated
 * attestation citing `eval.qfj.synthetic-connectivity-smoke.v1`, seeded as the INITIAL `ACTIVE` policy
 * with no verifier at all, served a real response and invoked the provider once.
 *
 * Two gates now close it, sharing ONE implementation (`verifyCandidateEvidence`):
 *   - the controller factory refuses to be seeded with an unverified candidate-bearing policy;
 *   - the gateway serving boundary refuses a candidate-bearing snapshot BEFORE any provider is
 *     consulted, which also covers a FOREIGN controller implementation the factory never saw.
 *
 * Every test is offline: fake providers, fake transports, frozen fixtures. No network, no credential,
 * no database, no Docker.
 */
import {
  createEstimatedBudgetPolicy,
  createManualClock,
  createModelGateway,
  createProviderReleaseRef,
  createProviderRolloutController,
  createProviderRolloutPolicy,
  createRolloutApprovalAttestation,
  defineProviderCapabilities,
  isModelGatewayError,
  offRolloutPolicy,
  type EvaluationEvidenceVerifier,
  type GatewayMode,
  type ModelProvider,
  type ProviderReleaseRef,
  type ProviderRolloutController,
  type ProviderRolloutPolicy,
  type RolloutApprovalAttestation,
  type RolloutEvent,
  type RolloutRefusalReason,
} from '@qf-jarvis/model-gateway';
import { FakeModelProvider, completedText } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import { createEvaluationEvidenceRegistry } from '../evidence/evaluation-evidence-registry.js';
import {
  CONFIG_DIGEST,
  MODEL_ID,
  PROVIDER_ID,
  syntheticRelease,
} from './composition-test-support.js';
import {
  CAPABILITY_PROFILE_REF,
  derivedDigestOf,
  evidenceFor,
  productionEvidenceFor,
} from './evidence-test-support.js';

/** The S1 approval pack's hand-written label — the exact string used in the pre-fix reproduction. */
const S1_CONNECTIVITY_REF = 'eval.qfj.synthetic-connectivity-smoke.v1';

const CANDIDATE: ProviderReleaseRef = syntheticRelease();
const STABLE: ProviderReleaseRef = createProviderReleaseRef({
  releaseId: 'release.s2cb.stable.v1',
  providerId: PROVIDER_ID,
  modelId: MODEL_ID,
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

function initialPolicy(
  mode: GatewayMode,
  approval: RolloutApprovalAttestation,
): ProviderRolloutPolicy {
  return createProviderRolloutPolicy({
    rolloutId: 'roll.s2cb',
    revision: 1,
    mode,
    stable: STABLE,
    candidate: CANDIDATE,
    ...(mode === 'SHADOW' ? { shadow: true } : {}),
    ...(mode === 'CANARY' ? { canaryBasisPoints: 100 } : {}),
    maxServingAttempts: 3,
    operatorReason: 'promote',
    approval,
  });
}

/** Seed a controller with an initial policy; returns `undefined` when it was accepted. */
function seed(
  mode: GatewayMode,
  approval: RolloutApprovalAttestation,
  verifier?: EvaluationEvidenceVerifier,
): 'refused' | undefined {
  try {
    createProviderRolloutController(initialPolicy(mode, approval), undefined, verifier);
    return undefined;
  } catch {
    return 'refused';
  }
}

/** A provider that records every consultation, so a spec can prove ZERO of each. */
interface CountingProvider extends ModelProvider {
  readonly healthChecks: () => number;
  readonly invocations: () => number;
}

function countingProviderFor(release: ProviderReleaseRef): CountingProvider {
  const inner = new FakeModelProvider({
    capabilities: defineProviderCapabilities({
      providerId: release.providerId,
      modelId: release.modelId,
      modelVersion: release.modelVersion,
      executionClass: release.executionClass,
      supportsStructuredOutput: true,
      supportsStrictJsonSchema: true,
      maxInputTokens: 100_000,
      supportsTimeout: true,
      supportsCancellation: true,
      supportsNonStreaming: true,
      supportsStreaming: false,
    }),
    responses: [completedText('served')],
  });
  const counters = { health: 0 };
  return Object.freeze({
    descriptor: inner.descriptor,
    capabilities: () => inner.capabilities(),
    health: async () => {
      counters.health += 1;
      return inner.health();
    },
    invoke: (input: Parameters<ModelProvider['invoke']>[0]) => inner.invoke(input),
    healthChecks: () => counters.health,
    invocations: () => inner.invocations,
  });
}

const REQUEST = {
  runId: 'run.s2cb.1',
  purpose: 'agent.reply',
  agentScope: 'COORDINATION',
  dataClass: 'HOSTED_ALLOWED',
  messages: [{ role: 'user', content: 'synthetic probe' }],
  requiredCapabilities: {
    structuredOutput: false,
    strictJsonSchema: false,
    cancellation: false,
    minContextTokens: 0,
  },
  resultMode: 'TEXT',
  maxResultChars: 1024,
  promptId: 'qfj.s2cb',
  promptVersion: '1',
  tokenBudget: 4096,
  costBudget: 1,
  timeoutMs: 30_000,
  retryBudget: 0,
  metadata: {},
};

/** A FOREIGN controller: it never passed the factory, so only the serving boundary can stop it. */
function foreignController(policy: ProviderRolloutPolicy): ProviderRolloutController {
  return {
    snapshot: () => policy,
    transition: () => ({ ok: false, reason: 'invalid-transition' as RolloutRefusalReason }),
    emergencyDisable: () => ({ ok: false, reason: 'invalid-transition' as RolloutRefusalReason }),
  };
}

describe('(1-8) initial SHADOW policy validation', () => {
  it('(1) an initial OFF policy is accepted with no evidence and remains non-serving', () => {
    const controller = createProviderRolloutController(offRolloutPolicy('roll.s2cb', STABLE));
    expect(controller.snapshot().mode).toBe('OFF');
    expect(controller.snapshot().candidate).toBeUndefined();
  });

  it('(2) an initial SHADOW policy with NO verifier fails closed', () => {
    expect(seed('SHADOW', attestation(), undefined)).toBe('refused');
  });

  it('(3, 4) missing and fabricated evidence references fail closed', () => {
    const evidence = productionEvidenceFor('SHADOW_ELIGIBILITY');
    const verifier = verifierFor(evidence);
    expect(seed('SHADOW', attestation({ evaluationRef: 'evref-nope' }), verifier)).toBe('refused');
    expect(
      seed('SHADOW', attestation({ evaluationRef: 'evref-fabricated-by-hand' }), verifier),
    ).toBe('refused');
  });

  it('(5) the S1 connectivity-smoke reference fails closed as an initial SHADOW policy', () => {
    const verifier = verifierFor(evidenceFor('CONNECTIVITY_SMOKE'));
    expect(seed('SHADOW', attestation({ evaluationRef: S1_CONNECTIVITY_REF }), verifier)).toBe(
      'refused',
    );
  });

  it('(6) REGISTERED connectivity evidence still fails — its target permits no mode', () => {
    const connectivity = evidenceFor('CONNECTIVITY_SMOKE');
    const verifier = verifierFor(connectivity);
    const approval = attestation({
      evaluationRef: connectivity.evaluationRef,
      evidenceDigest: derivedDigestOf(connectivity),
      approvalTarget: 'CONNECTIVITY_SMOKE',
    });
    expect(seed('SHADOW', approval, verifier)).toBe('refused');
    // The precise reason is visible at the serving boundary, which shares the same gate.
    const events: RolloutEvent[] = [];
    const provider = countingProviderFor(CANDIDATE);
    const gateway = createModelGateway({
      mode: 'ACTIVE',
      providers: [provider, countingProviderFor(STABLE)],
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: { active: () => false },
      concurrency: { maxConcurrent: 1, maxQueue: 1 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      rolloutController: foreignController(initialPolicy('SHADOW', approval)),
      rolloutObservability: {
        record: (event) => {
          events.push(event);
        },
      },
      evidenceVerifier: verifier,
    });
    return gateway
      .invoke(REQUEST)
      .then(() => expect.unreachable('the serving boundary must refuse'))
      .catch((error: unknown) => {
        expect(isModelGatewayError(error)).toBe(true);
        expect(events.map((e) => e.reason)).toContain('evidence-target-insufficient');
      });
  });

  it('(7, 8) matching SHADOW_ELIGIBILITY evidence passes GOVERNANCE only — no provider is called', () => {
    const evidence = productionEvidenceFor('SHADOW_ELIGIBILITY');
    const approval = attestation({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
      approvalTarget: 'SHADOW_ELIGIBILITY',
    });
    const controller = createProviderRolloutController(
      initialPolicy('SHADOW', approval),
      undefined,
      verifierFor(evidence),
    );
    expect(controller.snapshot().mode).toBe('SHADOW');
    // Governance construction is pure: it constructs no provider and calls none.
    const provider = countingProviderFor(CANDIDATE);
    expect(provider.invocations()).toBe(0);
    expect(provider.healthChecks()).toBe(0);
  });
});

describe('(9-15) initial CANARY and ACTIVE demand production-approved evidence', () => {
  it('(9, 10) CANARY refuses synthetic and non-production-approved evidence', () => {
    for (const evidence of [
      evidenceFor('CANARY_ELIGIBILITY'),
      evidenceFor('CANARY_ELIGIBILITY', { synthetic: false, productionApproval: false }),
    ]) {
      const approval = attestation({
        evaluationRef: evidence.evaluationRef,
        evidenceDigest: derivedDigestOf(evidence),
        approvalTarget: 'CANARY_ELIGIBILITY',
      });
      expect(seed('CANARY', approval, verifierFor(evidence))).toBe('refused');
    }
  });

  it('(11) CANARY accepts non-synthetic, production-approved CANARY_ELIGIBILITY evidence', () => {
    const evidence = productionEvidenceFor('CANARY_ELIGIBILITY');
    const approval = attestation({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
      approvalTarget: 'CANARY_ELIGIBILITY',
    });
    expect(seed('CANARY', approval, verifierFor(evidence))).toBeUndefined();
  });

  it('(12) ACTIVE refuses CANARY_ELIGIBILITY evidence — target insufficiency', () => {
    const evidence = productionEvidenceFor('CANARY_ELIGIBILITY');
    const approval = attestation({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
      approvalTarget: 'CANARY_ELIGIBILITY',
    });
    expect(seed('ACTIVE', approval, verifierFor(evidence))).toBe('refused');
  });

  it('(13, 14) ACTIVE refuses synthetic and non-production-approved evidence', () => {
    for (const evidence of [
      evidenceFor('ACTIVE_MODEL_RELEASE'),
      evidenceFor('ACTIVE_MODEL_RELEASE', { synthetic: false, productionApproval: false }),
    ]) {
      const approval = attestation({
        evaluationRef: evidence.evaluationRef,
        evidenceDigest: derivedDigestOf(evidence),
      });
      expect(seed('ACTIVE', approval, verifierFor(evidence))).toBe('refused');
    }
  });

  it('(15) ACTIVE accepts non-synthetic, production-approved ACTIVE_MODEL_RELEASE evidence', () => {
    const evidence = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
    const approval = attestation({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
    });
    expect(seed('ACTIVE', approval, verifierFor(evidence))).toBeUndefined();
  });
});

describe('(16-26) no caller-supplied field bypasses verification', () => {
  const evidence = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
  const verifier = verifierFor(evidence);
  const good = () =>
    attestation({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
    });

  it('(22, 23) a wrong evidenceDigest or approvalTarget fails closed', () => {
    expect(
      seed('ACTIVE', attestation({ ...good(), evidenceDigest: 'aaaaaaaaaaaa' }), verifier),
    ).toBe('refused');
    expect(
      seed('ACTIVE', attestation({ ...good(), approvalTarget: 'SHADOW_ELIGIBILITY' }), verifier),
    ).toBe('refused');
  });

  it('(21) a wrong capabilityProfileRef fails closed', () => {
    expect(
      seed('ACTIVE', attestation({ ...good(), capabilityProfileRef: 'cap.other' }), verifier),
    ).toBe('refused');
  });

  it('(16-20) any release-identity mismatch fails closed', () => {
    // A candidate whose identity differs from the registered evidence, with an attestation that binds it.
    for (const over of [
      { releaseId: 'release.other.v1' },
      { providerId: 'other.provider' },
      { modelId: 'other/model' },
      { modelVersion: '1999-01-01' },
      { configDigest: '0ffffffff000000000000000000000c' },
    ]) {
      const divergent = createProviderReleaseRef({ ...CANDIDATE, ...over });
      const approval = createRolloutApprovalAttestation({
        ...good(),
        releaseId: divergent.releaseId,
        configDigest: divergent.configDigest,
      });
      let refused = false;
      try {
        createProviderRolloutController(
          createProviderRolloutPolicy({
            rolloutId: 'roll.s2cb',
            revision: 1,
            mode: 'ACTIVE',
            stable: STABLE,
            candidate: divergent,
            maxServingAttempts: 3,
            operatorReason: 'promote',
            approval,
          }),
          undefined,
          verifier,
        );
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    }
  });

  it('(24, 25, 26) a fresh revision, an ACTIVE ceiling and a schema-valid shape do not bypass', () => {
    const fabricated = attestation({
      evaluationRef: S1_CONNECTIVITY_REF,
      evidenceDigest: 'totallyfabricated',
      approvalTarget: 'ACTIVE_MODEL_RELEASE',
      approvedModeCeiling: 'ACTIVE',
      approvedCanaryBasisPoints: 10_000,
      revision: 999,
    });
    // Schema-valid: it constructed. Still refused, at every mode.
    expect(fabricated.approvedModeCeiling).toBe('ACTIVE');
    for (const mode of ['SHADOW', 'CANARY', 'ACTIVE'] as const) {
      expect(seed(mode, fabricated, verifier)).toBe('refused');
    }
  });
});

describe('(27-34) the serving boundary stops a FOREIGN controller before any provider contact', () => {
  const evidence = productionEvidenceFor('ACTIVE_MODEL_RELEASE');
  const verifier = verifierFor(evidence);

  /** Build a serving gateway over a foreign controller holding an unverified ACTIVE policy. */
  function servingHarness(options: { readonly withVerifier: boolean }) {
    const candidate = countingProviderFor(CANDIDATE);
    const stable = countingProviderFor(STABLE);
    const events: RolloutEvent[] = [];
    const fabricated = attestation({
      evaluationRef: S1_CONNECTIVITY_REF,
      evidenceDigest: 'totallyfabricated',
    });
    const gateway = createModelGateway({
      mode: 'ACTIVE',
      providers: [stable, candidate],
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: { active: () => false },
      concurrency: { maxConcurrent: 1, maxQueue: 1 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      rolloutController: foreignController(initialPolicy('ACTIVE', fabricated)),
      rolloutObservability: {
        record: (event) => {
          events.push(event);
        },
      },
      ...(options.withVerifier ? { evidenceVerifier: verifier } : {}),
    });
    return { gateway, candidate, stable, events };
  }

  for (const withVerifier of [true, false]) {
    it(`(27-34) refuses before selection, health, binding and invocation (verifier ${withVerifier ? 'present' : 'absent'})`, async () => {
      const { gateway, candidate, stable, events } = servingHarness({ withVerifier });
      const thrown = await gateway
        .invoke(REQUEST)
        .then(() => undefined)
        .catch((error: unknown) => error);

      expect(isModelGatewayError(thrown)).toBe(true);
      // (31, 32) every provider counter stays at zero — health included, which the gateway would
      // otherwise call for EVERY provider before the rollout controller is consulted.
      expect(candidate.invocations()).toBe(0);
      expect(candidate.healthChecks()).toBe(0);
      expect(stable.invocations()).toBe(0);
      expect(stable.healthChecks()).toBe(0);
      // (33, 34) no credential is resolved and no transport opened: the fake providers hold neither,
      // and neither was reached at all.
      const reasons = events.map((e) => e.reason);
      expect(reasons).toContain(
        withVerifier ? 'evidence-missing' : 'evidence-verifier-unavailable',
      );
      for (const event of events) {
        expect(JSON.stringify(event)).not.toMatch(/secret|token|password|prompt|message/i);
      }
    });
  }

  it('a verified foreign policy is permitted through the serving boundary', async () => {
    const candidate = countingProviderFor(CANDIDATE);
    const stable = countingProviderFor(STABLE);
    const approval = attestation({
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
    });
    const gateway = createModelGateway({
      mode: 'ACTIVE',
      providers: [stable, candidate],
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: { active: () => false },
      concurrency: { maxConcurrent: 1, maxQueue: 1 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      rolloutController: foreignController(initialPolicy('ACTIVE', approval)),
      evidenceVerifier: verifier,
    });
    const response = await gateway.invoke(REQUEST);
    // The gate is not simply "always refuse": correct evidence still serves.
    expect(response.textResult).toBe('served');
    expect(candidate.invocations()).toBe(1);
  });

  it('a gateway with NO rollout controller is completely unaffected', async () => {
    const provider = countingProviderFor(CANDIDATE);
    const gateway = createModelGateway({
      mode: 'ACTIVE',
      providers: [provider],
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: { active: () => false },
      concurrency: { maxConcurrent: 1, maxQueue: 1 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
    });
    const response = await gateway.invoke(REQUEST);
    expect(response.textResult).toBe('served');
  });
});
