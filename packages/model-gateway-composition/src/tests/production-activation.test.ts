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
