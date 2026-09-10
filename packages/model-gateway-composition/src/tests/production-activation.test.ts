/**
 * Evidence-gated production activation (JF-2B, ADR-0147).
 *
 * ### What is being proved
 *
 * That `ACTIVE` is reachable, and that it is reachable ONLY through a gate nothing can walk around:
 * a named provider mode, an exactly-canonical roster, and a separate `ACTIVE_MODEL_RELEASE` production
 * approval for EVERY provider that could return customer-facing output. Under `AUTO` that is both
 * providers — the fallback answer is still an answer a customer reads.
 *
 * ### And that two axes stayed separate
 *
 * `SHADOW`/`CANARY`/`FALLBACK` are model-RELEASE rollout stages. `AUTO`/`GROQ_ONLY`/`NARA_ONLY` choose
 * a VENDOR. This composition refuses the first set outright, and never supplies a rollout controller —
 * a controller takes precedence over `routingProfile`, so passing one to obtain those labels would
 * silently disable provider selection while looking like a richer configuration.
 *
 * Every provider here is a deterministic fake. No credential, no socket, no clock read.
 */
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createManualClock,
  createModelCapabilityProfile,
  createModelCapabilityRegistry,
  createProviderReleaseRef,
  defineProviderCapabilities,
  type ModelCapabilityProfile,
  type ModelProvider,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';
import { FakeModelProvider, completedText } from '@qf-jarvis/model-gateway/testing';

import { createProductionModelGateway } from '../create-production-model-gateway.js';
import type {
  ProductionApprovalClaim,
  ProductionCompositionConfig,
} from '../contracts/production-composition-config.js';
import {
  CAPABILITY_PROFILE_REF,
  derivedDigestOf,
  evidenceBinding,
  evidenceFor,
} from './evidence-test-support.js';
import type { ApprovalEvidence } from '@qf-jarvis/model-evaluation';

const GROQ = 'groq';
const NARA = 'nara';

interface Leg {
  readonly release: ProviderReleaseRef;
  readonly profile: ModelCapabilityProfile;
  /** Typed as the FAKE, not the interface: the specs read its `invocations` counter. */
  readonly provider: FakeModelProvider;
  readonly evidence: ApprovalEvidence;
  readonly approval: ProductionApprovalClaim;
}

/** Build one canonical provider leg: release, profile, provider, production evidence, approval. */
function leg(
  providerId: string,
  options: {
    readonly synthetic?: boolean;
    readonly productionApproval?: boolean;
    readonly target?:
      'ACTIVE_MODEL_RELEASE' | 'CANARY_ELIGIBILITY' | 'SHADOW_ELIGIBILITY' | 'CONNECTIVITY_SMOKE';
  } = {},
): Leg {
  const modelId = `${providerId}/model-1`;
  const release = createProviderReleaseRef({
    releaseId: `release.jf2b.${providerId}.v1`,
    providerId,
    modelId,
    modelVersion: '2026-09-01',
    executionClass: 'HOSTED',
    configDigest: `0fadedbeef0000000000000000000${providerId === GROQ ? '0a1' : '0b2'}`,
  });
  const profile = createModelCapabilityProfile({
    release,
    taskClasses: ['RESPONSE_GENERATION'],
    resultModes: ['STRUCTURED', 'TEXT'],
    structuredOutputMode: 'strict-json-schema',
    maxInputTokens: 8192,
    maxCompletionTokens: 2048,
    supportsTimeout: true,
    supportsCancellation: true,
  });
  const provider = new FakeModelProvider({
    capabilities: defineProviderCapabilities({
      providerId,
      modelId,
      modelVersion: '2026-09-01',
      executionClass: 'HOSTED',
      supportsStructuredOutput: true,
      supportsStrictJsonSchema: true,
      maxInputTokens: 8192,
      supportsTimeout: true,
      supportsCancellation: true,
      supportsNonStreaming: true,
      supportsStreaming: false,
    }),
    responses: [completedText('ok')],
  });
  const target = options.target ?? 'ACTIVE_MODEL_RELEASE';
  const evidence = evidenceFor(target, {
    synthetic: options.synthetic ?? false,
    productionApproval: options.productionApproval ?? true,
    binding: evidenceBinding({ release }),
    evaluationRef: `evref.jf2b.${providerId}.${target}`,
  });
  return {
    release,
    profile,
    provider,
    evidence,
    approval: {
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
      approvalTarget: target,
      release,
      capabilityProfileRef: CAPABILITY_PROFILE_REF,
    },
  };
}

/**
 * Build a release for `providerId` with overridable identity fields.
 *
 * Used to construct the "same provider, different release" case the exact-release join exists to
 * refuse. Deliberately NOT registered in the ACTIVE capability registry — the evaluation-evidence
 * registry and the runtime capability registry are separate authorities, and adding it to the latter
 * would change the thing being tested.
 */
function releaseFor(
  providerId: string,
  over: Partial<{
    releaseId: string;
    modelId: string;
    modelVersion: string;
    configDigest: string;
  }> = {},
): ProviderReleaseRef {
  return createProviderReleaseRef({
    releaseId: `release.jf2b.${providerId}.v1`,
    providerId,
    modelId: `${providerId}/model-1`,
    modelVersion: '2026-09-01',
    executionClass: 'HOSTED',
    configDigest: `0fadedbeef0000000000000000000${providerId === GROQ ? '0a1' : '0b2'}`,
    ...over,
  });
}

/**
 * An approval claim, and its registered evidence, bound to an ARBITRARY release.
 *
 * The claim and its evidence agree with each other perfectly. What they do not agree with is the
 * release the composition is configured to serve.
 */
function approvalFor(release: ProviderReleaseRef): {
  readonly evidence: ApprovalEvidence;
  readonly approval: ProductionApprovalClaim;
} {
  const evidence = evidenceFor('ACTIVE_MODEL_RELEASE', {
    synthetic: false,
    productionApproval: true,
    binding: evidenceBinding({ release }),
    evaluationRef: `evref.jf2b.join.${release.releaseId}.${release.configDigest}`,
  });
  return {
    evidence,
    approval: {
      evaluationRef: evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(evidence),
      approvalTarget: 'ACTIVE_MODEL_RELEASE',
      release,
      capabilityProfileRef: CAPABILITY_PROFILE_REF,
    },
  };
}

/** An ACTIVE config for a provider mode, from the supplied legs. */
function activeConfig(
  providerMode: 'AUTO' | 'GROQ_ONLY' | 'NARA_ONLY',
  legs: readonly Leg[],
  over: Partial<ProductionCompositionConfig> = {},
): ProductionCompositionConfig {
  return {
    mode: 'ACTIVE',
    providerMode,
    providers: legs.map((one) => one.provider),
    approvedReleases: legs.map((one) => one.release),
    capabilityRegistry: createModelCapabilityRegistry(legs.map((one) => one.profile)),
    evaluationEvidence: legs.map((one) => one.evidence),
    productionApprovals: legs.map((one) => one.approval),
    budgetPolicy: createEstimatedBudgetPolicy(),
    killSwitch: { active: () => false },
    clock: createManualClock(),
    concurrency: { maxConcurrent: 1, maxQueue: 1 },
    circuit: { failureThreshold: 3, cooldownMs: 1000 },
    ...over,
  };
}

const reasonOf = (result: ReturnType<typeof createProductionModelGateway>): string =>
  result.ok ? 'COMPOSED' : result.reason;

describe('JF-2B 1-7. mode and activation', () => {
  it('2. ACTIVE without a provider mode refuses rather than defaulting to AUTO', () => {
    const groq = leg(GROQ);
    const config = activeConfig('AUTO', [groq]);
    const { providerMode, ...withoutMode } = config;
    void providerMode;
    expect(reasonOf(createProductionModelGateway(withoutMode as ProductionCompositionConfig))).toBe(
      'provider-mode-required',
    );
  });

  it('2b. an unrecognised provider mode refuses', () => {
    const groq = leg(GROQ);
    const config = activeConfig('AUTO', [groq], {
      providerMode: 'GROQ_PREFERRED' as unknown as 'AUTO',
    });
    expect(reasonOf(createProductionModelGateway(config))).toBe('provider-mode-invalid');
  });

  it('3-5. every release-rollout stage is refused, never reinterpreted', () => {
    for (const mode of ['SHADOW', 'CANARY', 'FALLBACK'] as const) {
      const groq = leg(GROQ);
      const config = activeConfig('GROQ_ONLY', [groq], { mode });
      expect(reasonOf(createProductionModelGateway(config)), mode).toBe('mode-not-supported');
    }
  });

  it('6. ACTIVE with no providers or no releases refuses', () => {
    const groq = leg(GROQ);
    expect(
      reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [groq], { providers: [] }))),
    ).toBe('empty-composition');
    expect(
      reasonOf(
        createProductionModelGateway(activeConfig('GROQ_ONLY', [groq], { approvedReleases: [] })),
      ),
    ).toBe('empty-composition');
  });

  it('7. the kill switch blocks an ACTIVE invocation before any provider is touched', async () => {
    const groq = leg(GROQ);
    const result = createProductionModelGateway(
      activeConfig('GROQ_ONLY', [groq], { killSwitch: { active: () => true } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(
      result.composition.gateway.invoke({
        runId: 'run-1',
        dataClass: 'HOSTED_ALLOWED',
        resultMode: 'TEXT',
        requiredCapabilities: {},
        taskClass: 'RESPONSE_GENERATION',
        prompt: { system: 's', user: 'u' },
      }),
    ).rejects.toThrow();
    expect(groq.provider.invocations).toBe(0);
  });

  it('1. OFF is unchanged, inert and non-activatable', () => {
    const groq = leg(GROQ);
    const result = createProductionModelGateway({
      ...activeConfig('GROQ_ONLY', [groq]),
      mode: 'OFF',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition.status.mode).toBe('OFF');
    expect(result.composition.status.activatable).toBe(false);
    expect(result.composition.status.fallbackEnabled).toBe(false);
    expect(result.composition.status.providerMode).toBeUndefined();
    expect(groq.provider.invocations).toBe(0);
  });
});

describe('JF-2B 8-24. the production evidence gate', () => {
  it('12. AUTO with exact ACTIVE_MODEL_RELEASE evidence for BOTH providers composes', () => {
    const result = createProductionModelGateway(activeConfig('AUTO', [leg(GROQ), leg(NARA)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { status } = result.composition;
    expect(status.mode).toBe('ACTIVE');
    expect(status.activatable).toBe(true);
    expect(status.providerMode).toBe('AUTO');
    expect(status.servingProviderIds).toStrictEqual([GROQ, NARA]);
    expect(status.verifiedApprovalCount).toBe(2);
    expect(status.fallbackEnabled).toBe(true);
    expect(status.retryBudget).toBe(0);
  });

  it('10-11. AUTO with only ONE provider approved refuses', () => {
    // Groq approved, Nara not.
    const groqOnlyApproval = activeConfig('AUTO', [leg(GROQ), leg(NARA)]);
    const naraId = groqOnlyApproval.productionApprovals?.find(
      (one) => one.release.providerId === NARA,
    );
    expect(naraId).toBeDefined();
    expect(
      reasonOf(
        createProductionModelGateway({
          ...groqOnlyApproval,
          productionApprovals: (groqOnlyApproval.productionApprovals ?? []).filter(
            (one) => one.release.providerId !== NARA,
          ),
        }),
      ),
    ).toBe('production-approval-missing');

    // And the mirror: Nara approved, Groq not.
    expect(
      reasonOf(
        createProductionModelGateway({
          ...groqOnlyApproval,
          productionApprovals: (groqOnlyApproval.productionApprovals ?? []).filter(
            (one) => one.release.providerId !== GROQ,
          ),
        }),
      ),
    ).toBe('production-approval-missing');
  });

  it('8-9. a single-provider mode still needs its own approval', () => {
    for (const [mode, providerId] of [
      ['GROQ_ONLY', GROQ],
      ['NARA_ONLY', NARA],
    ] as const) {
      const one = leg(providerId);
      expect(
        reasonOf(
          createProductionModelGateway(activeConfig(mode, [one], { productionApprovals: [] })),
        ),
        mode,
      ).toBe('production-approval-missing');
    }
  });

  it('13. synthetic evidence never authorizes production', () => {
    const groq = leg(GROQ, { synthetic: true, productionApproval: false });
    expect(reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [groq])))).toBe(
      'production-evidence-synthetic',
    );
  });

  it('14. productionApproval=false refuses', () => {
    const groq = leg(GROQ, { synthetic: false, productionApproval: false });
    expect(reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [groq])))).toBe(
      'production-approval-required',
    );
  });

  it('16-17. a lower approval target cannot authorize ACTIVE', () => {
    for (const target of ['SHADOW_ELIGIBILITY', 'CANARY_ELIGIBILITY'] as const) {
      const groq = leg(GROQ, { target });
      expect(
        reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [groq]))),
        target,
      ).toBe('production-evidence-target-insufficient');
    }
  });

  it('15. connectivity evidence cannot even be REGISTERED as production-approved', () => {
    // Stricter than the target ladder, and it fires first: an existing registry invariant refuses a
    // CONNECTIVITY_SMOKE object that claims production approval at all. A socket opening says nothing
    // about model quality, so the flag combination is illegal before any mode is considered.
    const groq = leg(GROQ, { target: 'CONNECTIVITY_SMOKE' });
    expect(reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [groq])))).toBe(
      'evidence-approval-flags-invalid',
    );
  });

  it('18. a wrong claimed digest refuses — the claim is recomputed, never believed', () => {
    const groq = leg(GROQ);
    const tampered: ProductionApprovalClaim = {
      ...groq.approval,
      evidenceDigest: 'a'.repeat(64),
    };
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [groq], { productionApprovals: [tampered] }),
        ),
      ),
    ).toBe('production-evidence-digest-mismatch');
  });

  it('19. evidence produced against a DIFFERENT release refuses', () => {
    const groq = leg(GROQ);
    const other = leg(NARA);
    // Groq's approval, but citing Nara's evidence: the release will not match.
    const crossed: ProductionApprovalClaim = {
      ...groq.approval,
      evaluationRef: other.evidence.evaluationRef,
      evidenceDigest: derivedDigestOf(other.evidence),
    };
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [groq], {
            evaluationEvidence: [groq.evidence, other.evidence],
            productionApprovals: [crossed],
          }),
        ),
      ),
    ).toBe('production-evidence-release-mismatch');
  });

  it('20. a capability-profile mismatch refuses', () => {
    const groq = leg(GROQ);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [groq], {
            productionApprovals: [{ ...groq.approval, capabilityProfileRef: 'cap.wrong.v1' }],
          }),
        ),
      ),
    ).toBe('production-evidence-capability-mismatch');
  });

  it('an unregistered evaluationRef refuses', () => {
    const groq = leg(GROQ);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [groq], {
            productionApprovals: [{ ...groq.approval, evaluationRef: 'evref.not.registered' }],
          }),
        ),
      ),
    ).toBe('production-evidence-missing');
  });

  it('22. a wildcard or latest identity in an approval refuses', () => {
    const groq = leg(GROQ);
    for (const field of ['modelVersion', 'configDigest'] as const) {
      const release: ProviderReleaseRef = { ...groq.release, [field]: 'latest' };
      expect(
        reasonOf(
          createProductionModelGateway(
            activeConfig('GROQ_ONLY', [groq], {
              productionApprovals: [{ ...groq.approval, release }],
            }),
          ),
        ),
        field,
      ).toBe('wildcard-identity');
    }
  });

  it('23. conflicting evidence for one reference refuses the whole composition', () => {
    const groq = leg(GROQ);
    const conflicting = { ...groq.evidence, createdAt: '2026-08-01T00:00:00.000Z' };
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [groq], {
            evaluationEvidence: [groq.evidence, conflicting],
          }),
        ),
      ),
    ).toBe('conflicting-evidence-registration');
  });

  it('24. no approval can be added after construction', () => {
    const result = createProductionModelGateway(activeConfig('AUTO', [leg(GROQ), leg(NARA)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The whole surface is a gateway and a status. There is no register/approve/transition method.
    expect(Object.keys(result.composition).sort()).toStrictEqual(['gateway', 'status']);
    expect(Object.keys(result.composition.gateway)).toStrictEqual(['invoke']);
    expect(Object.isFrozen(result.composition)).toBe(true);
    expect(Object.isFrozen(result.composition.status)).toBe(true);
  });
});

describe('JF-2B 25-34. the ACTIVE roster is exactly canonical', () => {
  it('25. AUTO composes with exactly Groq and Nara', () => {
    const result = createProductionModelGateway(activeConfig('AUTO', [leg(GROQ), leg(NARA)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition.status.servingProviderIds).toStrictEqual([GROQ, NARA]);
  });

  it('26-27. AUTO missing either provider refuses', () => {
    expect(reasonOf(createProductionModelGateway(activeConfig('AUTO', [leg(GROQ)])))).toBe(
      'active-roster-mismatch',
    );
    expect(reasonOf(createProductionModelGateway(activeConfig('AUTO', [leg(NARA)])))).toBe(
      'active-roster-mismatch',
    );
  });

  it('28-29. a single-provider mode composes without the other provider', () => {
    const groqOnly = createProductionModelGateway(activeConfig('GROQ_ONLY', [leg(GROQ)]));
    expect(groqOnly.ok).toBe(true);
    if (groqOnly.ok) {
      expect(groqOnly.composition.status.servingProviderIds).toStrictEqual([GROQ]);
      expect(groqOnly.composition.status.fallbackEnabled).toBe(false);
    }
    const naraOnly = createProductionModelGateway(activeConfig('NARA_ONLY', [leg(NARA)]));
    expect(naraOnly.ok).toBe(true);
    if (naraOnly.ok) {
      expect(naraOnly.composition.status.servingProviderIds).toStrictEqual([NARA]);
      expect(naraOnly.composition.status.fallbackEnabled).toBe(false);
    }
  });

  it('30. a scoped Groq diagnostic identity is not active-roster eligible', () => {
    const scoped = leg('groq.shadow.candidate');
    expect(reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [scoped])))).toBe(
      'active-roster-mismatch',
    );
  });

  it('31. an extra provider in the roster refuses — a superset is not the set', () => {
    expect(
      reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [leg(GROQ), leg(NARA)]))),
    ).toBe('active-roster-mismatch');
  });

  it('32. two provider instances publishing one identity refuse', () => {
    // Two providers with the same id would collide in the health map, the circuit breaker and the
    // routing plan — all three are keyed by providerId.
    //
    // The clone declares the SAME capabilities on purpose. A clone that disagreed would be caught
    // earlier by the pre-existing release-vs-provider guard (`provider-release-mismatch`), which is
    // stricter and fires first; this constructs the case where the roster check is the operative one.
    const a = leg(GROQ);
    const clone: ModelProvider = {
      descriptor: a.provider.descriptor,
      capabilities: () => a.provider.capabilities(),
      health: () => a.provider.health(),
      invoke: (input: Parameters<ModelProvider['invoke']>[0]) => a.provider.invoke(input),
    };
    expect(
      reasonOf(
        createProductionModelGateway(activeConfig('AUTO', [a], { providers: [a.provider, clone] })),
      ),
    ).toBe('duplicate-provider-identity');
  });

  it('33-34. neither provider can satisfy the other mode', () => {
    expect(reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [leg(NARA)])))).toBe(
      'active-roster-mismatch',
    );
    expect(reasonOf(createProductionModelGateway(activeConfig('NARA_ONLY', [leg(GROQ)])))).toBe(
      'active-roster-mismatch',
    );
  });
});

describe('JF-2B: the two axes stay separate, and the retry budget stays zero', () => {
  it('supplies a routing profile and never a rollout controller', () => {
    const result = createProductionModelGateway(activeConfig('AUTO', [leg(GROQ), leg(NARA)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Proved structurally in the containment spec; proved behaviourally by the ordering above.
    expect(result.composition.status.providerMode).toBe('AUTO');
    expect(result.composition.status.servingProviderIds?.[0]).toBe(GROQ);
    expect(result.composition.status.servingProviderIds?.[1]).toBe(NARA);
  });

  it('45. refuses a request that asks for a same-provider retry', async () => {
    const result = createProductionModelGateway(activeConfig('AUTO', [leg(GROQ), leg(NARA)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(
      result.composition.gateway.invoke({
        runId: 'run-1',
        dataClass: 'HOSTED_ALLOWED',
        resultMode: 'TEXT',
        requiredCapabilities: {},
        taskClass: 'RESPONSE_GENERATION',
        prompt: { system: 's', user: 'u' },
        retryBudget: 1,
      }),
    ).rejects.toThrow();
  });

  it('a caller-supplied allowFallback may agree but never contradict the provider mode', () => {
    // GROQ_ONLY derives false; asking for true is asking for one provider and two at once.
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [leg(GROQ)], { allowFallback: true }),
        ),
      ),
    ).toBe('fallback-not-disabled');
    // AUTO derives true; asking for false contradicts it too.
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [leg(GROQ), leg(NARA)], { allowFallback: false }),
        ),
      ),
    ).toBe('fallback-not-disabled');
    // Agreeing is fine.
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [leg(GROQ), leg(NARA)], { allowFallback: true }),
        ),
      ),
    ).toBe('COMPOSED');
  });

  it('refuses a non-zero default retry budget in either mode', () => {
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [leg(GROQ)], { defaultRetryBudget: 1 }),
        ),
      ),
    ).toBe('retry-budget-not-zero');
  });
});

describe('JF-2B correction A. the claim must authorize the release actually served', () => {
  /**
   * The gap this closes, stated once.
   *
   * Verifying a claim against registered evidence proves `claim` against `evidence`. It does not prove
   * the claim against the release this composition SERVES. Without that third link, perfectly valid
   * production evidence for Groq release B satisfies the verifier while the composition serves Groq
   * release A — and every artifact afterwards says release A was production-approved.
   *
   * In each case below the claim and its evidence are internally flawless, registration succeeds, the
   * provider instance and capability registry are valid for the ACTIVE release, and the provider id
   * matches. The ONLY defect is the join.
   */
  function crossBoundConfig(
    providerMode: 'GROQ_ONLY' | 'NARA_ONLY',
    servingProvider: string,
    otherRelease: ProviderReleaseRef,
  ): ProductionCompositionConfig {
    const serving = leg(servingProvider);
    const other = approvalFor(otherRelease);
    return activeConfig(providerMode, [serving], {
      // Only the SERVING release is approved and registered for capability.
      approvedReleases: [serving.release],
      // The evidence for the other release registers cleanly.
      evaluationEvidence: [other.evidence],
      productionApprovals: [other.approval],
    });
  }

  it('1. a different Groq release entirely is refused', () => {
    const releaseB = releaseFor(GROQ, {
      releaseId: 'release.jf2b.groq.v2',
      configDigest: '0fadedbeef0000000000000000000ff9',
    });
    expect(
      reasonOf(createProductionModelGateway(crossBoundConfig('GROQ_ONLY', GROQ, releaseB))),
    ).toBe('production-approval-release-mismatch');
  });

  it('2. a configDigest-only difference is refused', () => {
    const releaseB = releaseFor(GROQ, { configDigest: '0fadedbeef0000000000000000000ff8' });
    expect(
      reasonOf(createProductionModelGateway(crossBoundConfig('GROQ_ONLY', GROQ, releaseB))),
    ).toBe('production-approval-release-mismatch');
  });

  it('3. a releaseId-only difference is refused', () => {
    const releaseB = releaseFor(GROQ, { releaseId: 'release.jf2b.groq.v9' });
    expect(
      reasonOf(createProductionModelGateway(crossBoundConfig('GROQ_ONLY', GROQ, releaseB))),
    ).toBe('production-approval-release-mismatch');
  });

  it('4. a modelVersion-only difference is refused', () => {
    const releaseB = releaseFor(GROQ, { modelVersion: '2026-10-01' });
    expect(
      reasonOf(createProductionModelGateway(crossBoundConfig('GROQ_ONLY', GROQ, releaseB))),
    ).toBe('production-approval-release-mismatch');
  });

  it('5. a modelId-only difference is refused', () => {
    const releaseB = releaseFor(GROQ, { modelId: 'groq/model-2' });
    expect(
      reasonOf(createProductionModelGateway(crossBoundConfig('GROQ_ONLY', GROQ, releaseB))),
    ).toBe('production-approval-release-mismatch');
  });

  it('6. the exact release composes', () => {
    const serving = leg(GROQ);
    expect(reasonOf(createProductionModelGateway(activeConfig('GROQ_ONLY', [serving])))).toBe(
      'COMPOSED',
    );
  });

  it('7-8. AUTO refuses when EITHER leg is cross-bound', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);

    // Groq exact, Nara cross-bound.
    const naraOther = approvalFor(releaseFor(NARA, { releaseId: 'release.jf2b.nara.v2' }));
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], {
            evaluationEvidence: [groq.evidence, naraOther.evidence],
            productionApprovals: [groq.approval, naraOther.approval],
          }),
        ),
      ),
    ).toBe('production-approval-release-mismatch');

    // Nara exact, Groq cross-bound.
    const groqOther = approvalFor(releaseFor(GROQ, { releaseId: 'release.jf2b.groq.v3' }));
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], {
            evaluationEvidence: [groqOther.evidence, nara.evidence],
            productionApprovals: [groqOther.approval, nara.approval],
          }),
        ),
      ),
    ).toBe('production-approval-release-mismatch');
  });

  it('9. AUTO with both legs exact composes', () => {
    expect(
      reasonOf(createProductionModelGateway(activeConfig('AUTO', [leg(GROQ), leg(NARA)]))),
    ).toBe('COMPOSED');
  });
});

describe('JF-2B correction C-D. the ACTIVE release and approval sets are one-to-one', () => {
  it('10. AUTO missing an approved release refuses', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], { approvedReleases: [groq.release] }),
        ),
      ),
    ).toBe('active-release-set-mismatch');
  });

  it('11. AUTO with an extra unrelated approved release refuses', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], {
            approvedReleases: [groq.release, nara.release, releaseFor('local-workstation')],
          }),
        ),
      ),
    ).toBe('active-release-set-mismatch');
  });

  it('12. two approved releases for the same provider refuse', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], {
            approvedReleases: [
              groq.release,
              releaseFor(GROQ, { releaseId: 'release.jf2b.groq.v2' }),
              nara.release,
            ],
          }),
        ),
      ),
    ).toBe('active-release-set-mismatch');
  });

  it('13. GROQ_ONLY carrying a Nara approved release refuses', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [groq], {
            approvedReleases: [groq.release, nara.release],
          }),
        ),
      ),
    ).toBe('active-release-set-mismatch');
  });

  it('14. NARA_ONLY carrying a scoped extra release refuses', () => {
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('NARA_ONLY', [nara], {
            approvedReleases: [nara.release, releaseFor('groq.shadow.candidate')],
          }),
        ),
      ),
    ).toBe('active-release-set-mismatch');
  });

  it('15, 17. duplicate approval claims refuse', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], {
            productionApprovals: [groq.approval, groq.approval, nara.approval],
          }),
        ),
      ),
    ).toBe('production-approval-set-mismatch');
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('GROQ_ONLY', [groq], {
            productionApprovals: [groq.approval, groq.approval],
          }),
        ),
      ),
    ).toBe('production-approval-set-mismatch');
  });

  it('16, 18. an approval for a provider this mode does not serve refuses', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('NARA_ONLY', [nara], {
            productionApprovals: [nara.approval, groq.approval],
          }),
        ),
      ),
    ).toBe('production-approval-set-mismatch');
  });

  it('19. claim order does not change the outcome', () => {
    const groq = leg(GROQ);
    const nara = leg(NARA);
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], {
            productionApprovals: [groq.approval, nara.approval],
          }),
        ),
      ),
    ).toBe('COMPOSED');
    expect(
      reasonOf(
        createProductionModelGateway(
          activeConfig('AUTO', [groq, nara], {
            productionApprovals: [nara.approval, groq.approval],
          }),
        ),
      ),
    ).toBe('COMPOSED');

    // And a cross-bound claim is refused from either position, so order cannot hide it.
    const groqOther = approvalFor(releaseFor(GROQ, { releaseId: 'release.jf2b.groq.v4' }));
    for (const approvals of [
      [groqOther.approval, nara.approval],
      [nara.approval, groqOther.approval],
    ]) {
      expect(
        reasonOf(
          createProductionModelGateway(
            activeConfig('AUTO', [groq, nara], {
              evaluationEvidence: [groqOther.evidence, nara.evidence],
              productionApprovals: approvals,
            }),
          ),
        ),
      ).toBe('production-approval-release-mismatch');
    }
  });
});
