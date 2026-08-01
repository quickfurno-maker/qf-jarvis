/**
 * QFJ-P04.02 — the model capability registry (ADR-0050).
 *
 * Pure coverage of the profile/requirement/registry validation and the single match authority, plus
 * end-to-end gateway/routing/rollout integration with deterministic FakeModelProviders — NO live call, NO
 * real key/token, NO network. Proves: immutable version-bound profiles; duplicate/conflict rejection;
 * exact release/descriptor matching (fail-closed); declared capability is not evaluation approval; and
 * that a configured registry excludes a mismatched provider/release BEFORE invocation while a gateway with
 * no registry is unchanged.
 */
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createManualClock,
  createModelCapabilityProfile,
  createModelCapabilityRegistry,
  createModelCapabilityRequirement,
  createModelGateway,
  createProviderReleaseRef,
  createProviderRolloutController,
  createProviderRolloutPolicy,
  createRolloutApprovalAttestation,
  defineProviderCapabilities,
  deriveCapabilityRequirement,
  ModelGatewayError,
  validateModelRequest,
  type GatewayKillSwitch,
  type ModelCapabilityProfile,
  type ModelCapabilityRegistry,
  type ModelGatewayConfig,
  type ProviderCapabilities,
  type ProviderReleaseRef,
  type RequiredCapabilities,
  type EvaluationEvidenceVerifier,
} from '../index.js';
import { FakeModelProvider, completedText } from '../testing/index.js';
import { matchDescriptor, matchRequirement } from '../capabilities/capability-match.js';

const OFF_KILL: GatewayKillSwitch = { active: (): boolean => false };

/** QFJ-S2-C-B amendment: a permissive evidence stub so these specs keep testing the registry. */
const PERMISSIVE_VERIFIER: EvaluationEvidenceVerifier = Object.freeze({
  verify: () => ({ ok: true as const }),
});

function release(overrides: Partial<ProviderReleaseRef> = {}): ProviderReleaseRef {
  return createProviderReleaseRef({
    releaseId: 'rel-a',
    providerId: 'groq',
    modelId: 'model-a',
    modelVersion: '1',
    executionClass: 'HOSTED',
    configDigest: 'digest-a-1',
    ...overrides,
  });
}

function profile(
  rel: ProviderReleaseRef,
  overrides: Partial<Parameters<typeof createModelCapabilityProfile>[0]> = {},
): ModelCapabilityProfile {
  return createModelCapabilityProfile({
    release: rel,
    taskClasses: ['RESPONSE_GENERATION', 'STRUCTURED_EXTRACTION'],
    resultModes: ['TEXT', 'STRUCTURED'],
    structuredOutputMode: 'strict-json-schema',
    maxInputTokens: 100000,
    maxCompletionTokens: 4096,
    supportsTimeout: true,
    supportsCancellation: true,
    ...overrides,
  });
}

function capsFor(
  rel: ProviderReleaseRef,
  overrides: Partial<ProviderCapabilities> = {},
): ProviderCapabilities {
  return defineProviderCapabilities({
    providerId: rel.providerId,
    modelId: rel.modelId,
    modelVersion: rel.modelVersion,
    executionClass: rel.executionClass,
    supportsStructuredOutput: true,
    supportsStrictJsonSchema: true,
    maxInputTokens: 100000,
    supportsTimeout: true,
    supportsCancellation: true,
    supportsNonStreaming: true,
    supportsStreaming: false,
    ...overrides,
  });
}

const NO_REQUIRED: RequiredCapabilities = {
  structuredOutput: false,
  strictJsonSchema: false,
  cancellation: false,
  minContextTokens: 0,
};

function req(overrides: Record<string, unknown> = {}) {
  const v = validateModelRequest({
    runId: 'run-1',
    purpose: 'qualify',
    agentScope: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    messages: [{ role: 'user', content: 'hello' }],
    requiredCapabilities: NO_REQUIRED,
    resultMode: 'TEXT',
    maxResultChars: 1000,
    promptId: 'p.qualify',
    promptVersion: '1',
    promptDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    tokenBudget: 1000,
    costBudget: 1,
    timeoutMs: 5000,
    retryBudget: 0,
    metadata: {},
    ...overrides,
  });
  if (!v.ok) {
    throw new Error('invalid test request');
  }
  return v.request;
}

// ===================================================================================================
// Profile / registry validation.
// ===================================================================================================
describe('capability profile / registry validation', () => {
  it('freezes a valid profile bound to an exact release', () => {
    const p = profile(release());
    expect(Object.isFrozen(p)).toBe(true);
    expect(p.release.releaseId).toBe('rel-a');
    expect(p.supportsNonStreaming).toBe(true);
  });

  it('rejects an invalid release identity and a wildcard/latest version is just an opaque id (still exact)', () => {
    expect(() => profile(release({ modelVersion: 'bad ver!' }))).toThrow();
    // "latest" is not privileged — it is only ever an exact literal id, never an authoritative alias.
    const p = profile(release({ modelVersion: 'latest', configDigest: 'digest-latest-1' }));
    expect(p.release.modelVersion).toBe('latest');
  });

  it('rejects impossible limits and incoherent structured config', () => {
    expect(() => profile(release(), { maxInputTokens: 100, maxCompletionTokens: 200 })).toThrow();
    // STRUCTURED result mode without a structured output mode.
    expect(() =>
      profile(release(), {
        resultModes: ['TEXT', 'STRUCTURED'],
        structuredOutputMode: 'unsupported',
      }),
    ).toThrow();
    // structured mode declared but STRUCTURED not in result modes.
    expect(() =>
      profile(release(), { resultModes: ['TEXT'], structuredOutputMode: 'strict-json-schema' }),
    ).toThrow();
  });

  it('rejects unknown task / result / structured modes', () => {
    expect(() => profile(release(), { taskClasses: ['UNKNOWN' as never] })).toThrow();
    expect(() => profile(release(), { resultModes: ['AUDIO' as never] })).toThrow();
    expect(() => profile(release(), { structuredOutputMode: 'yaml' as never })).toThrow();
  });

  it('builds a deterministically ordered registry and rejects duplicates/conflicts', () => {
    const a = profile(release({ releaseId: 'rel-b', configDigest: 'digest-b-1' }));
    const b = profile(release({ releaseId: 'rel-a', configDigest: 'digest-a-1' }));
    const registry = createModelCapabilityRegistry([a, b]);
    expect(registry.releaseIds()).toEqual(['rel-a', 'rel-b']);
    // duplicate release id
    expect(() =>
      createModelCapabilityRegistry([
        b,
        profile(release({ releaseId: 'rel-a', configDigest: 'digest-a-2' })),
      ]),
    ).toThrow();
    // duplicate exact provider/model/version/config tuple (different release id)
    expect(() =>
      createModelCapabilityRegistry([b, profile(release({ releaseId: 'rel-a2' }))]),
    ).toThrow();
  });

  it('produces a frozen, content-free snapshot with no secret/provider object', () => {
    const registry = createModelCapabilityRegistry([profile(release())]);
    const snap = registry.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    const json = JSON.stringify(snap);
    // No secret VALUES (api keys, bearer tokens, private-key blocks) and no message content.
    expect(json).not.toMatch(/gsk_|sk-[A-Za-z0-9]|Bearer |BEGIN [A-Z ]*PRIVATE KEY/);
    expect(json).not.toContain('hello');
    expect(json).not.toMatch(/kimi/i);
    // No provider instance or function is exposed.
    expect(json).not.toContain('function');
  });
});

// ===================================================================================================
// Matching (the single authority).
// ===================================================================================================
describe('capability matching', () => {
  const rel = release();
  const p = profile(rel);

  it('matches an exact descriptor and rejects an identity mismatch', () => {
    expect(matchDescriptor(p, capsFor(rel)).ok).toBe(true);
    expect(matchDescriptor(p, capsFor(rel, { modelVersion: '2' }))).toEqual({
      ok: false,
      reason: 'registry-descriptor-mismatch',
    });
    expect(matchDescriptor(p, capsFor(rel, { executionClass: 'LOCAL' }))).toEqual({
      ok: false,
      reason: 'registry-descriptor-mismatch',
    });
  });

  it('rejects a descriptor that claims more than the profile (profile is the ceiling)', () => {
    const strictOnly = profile(rel, { structuredOutputMode: 'json-object' });
    expect(matchDescriptor(strictOnly, capsFor(rel, { supportsStrictJsonSchema: true }))).toEqual({
      ok: false,
      reason: 'registry-descriptor-mismatch',
    });
    expect(matchDescriptor(p, capsFor(rel, { maxInputTokens: 200000 }))).toEqual({
      ok: false,
      reason: 'registry-descriptor-mismatch',
    });
  });

  it('matches supported and rejects unsupported task classes', () => {
    expect(
      matchRequirement(
        p,
        createModelCapabilityRequirement({
          taskClass: 'RESPONSE_GENERATION',
          resultMode: 'TEXT',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ).ok,
    ).toBe(true);
    expect(
      matchRequirement(
        p,
        createModelCapabilityRequirement({
          taskClass: 'CONVERSATION_SUMMARY',
          resultMode: 'TEXT',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-task-unsupported' });
  });

  it('enforces result mode and structured strictness', () => {
    const textOnly = profile(rel, { resultModes: ['TEXT'], structuredOutputMode: 'unsupported' });
    expect(
      matchRequirement(
        textOnly,
        createModelCapabilityRequirement({
          resultMode: 'STRUCTURED',
          structuredMode: 'json-object',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-result-mode-unsupported' });

    const bestEffort = profile(rel, { structuredOutputMode: 'json-object' });
    expect(
      matchRequirement(
        bestEffort,
        createModelCapabilityRequirement({
          resultMode: 'STRUCTURED',
          structuredMode: 'strict-json-schema',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-structured-mode-unsupported' });
    expect(
      matchRequirement(
        bestEffort,
        createModelCapabilityRequirement({
          resultMode: 'STRUCTURED',
          structuredMode: 'json-object',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ).ok,
    ).toBe(true);
    expect(
      matchRequirement(
        p,
        createModelCapabilityRequirement({
          resultMode: 'STRUCTURED',
          structuredMode: 'strict-json-schema',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ).ok,
    ).toBe(true);
  });

  it('enforces context/completion budgets and timeout/cancellation', () => {
    expect(
      matchRequirement(
        p,
        createModelCapabilityRequirement({
          resultMode: 'TEXT',
          minInputTokens: 100001,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-context-limit' });
    expect(
      matchRequirement(
        p,
        createModelCapabilityRequirement({
          resultMode: 'TEXT',
          minInputTokens: 0,
          minCompletionTokens: 5000,
          requiresTimeout: false,
          requiresCancellation: false,
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-context-limit' });
    const noTimeout = profile(rel, { supportsTimeout: false });
    expect(
      matchRequirement(
        noTimeout,
        createModelCapabilityRequirement({
          resultMode: 'TEXT',
          minInputTokens: 0,
          requiresTimeout: true,
          requiresCancellation: false,
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-timeout-unsupported' });
    const noCancel = profile(rel, { supportsCancellation: false });
    expect(
      matchRequirement(
        noCancel,
        createModelCapabilityRequirement({
          resultMode: 'TEXT',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: true,
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-cancellation-unsupported' });
  });

  it('enforces an optional prompt/cost profile reference exactly', () => {
    const withRefs = profile(rel, { promptProfileRef: 'prompt/v1', costProfileRef: 'cost/v1' });
    expect(
      matchRequirement(
        withRefs,
        createModelCapabilityRequirement({
          resultMode: 'TEXT',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
          promptProfileRef: 'prompt/v2',
        }),
      ),
    ).toEqual({ ok: false, reason: 'registry-prompt-profile-mismatch' });
    expect(
      matchRequirement(
        withRefs,
        createModelCapabilityRequirement({
          resultMode: 'TEXT',
          minInputTokens: 0,
          requiresTimeout: false,
          requiresCancellation: false,
          promptProfileRef: 'prompt/v1',
        }),
      ).ok,
    ).toBe(true);
  });

  it('resolves an exact release (with digest) and fails a missing/mismatched one', () => {
    const registry = createModelCapabilityRegistry([p]);
    const requirement = createModelCapabilityRequirement({
      resultMode: 'TEXT',
      minInputTokens: 0,
      requiresTimeout: false,
      requiresCancellation: false,
    });
    expect(registry.resolveRelease(rel, requirement, capsFor(rel)).ok).toBe(true);
    expect(registry.resolveRelease(release({ releaseId: 'nope' }), requirement)).toEqual({
      ok: false,
      reason: 'registry-release-missing',
    });
    // same release id, different config digest -> not the exact bound identity.
    expect(registry.resolveRelease(release({ configDigest: 'digest-a-2' }), requirement)).toEqual({
      ok: false,
      reason: 'registry-descriptor-mismatch',
    });
  });

  it('is deterministic — the same inputs resolve identically', () => {
    const registry = createModelCapabilityRegistry([p]);
    const requirement = deriveCapabilityRequirement(req());
    const a = registry.resolveDescriptor(capsFor(rel), requirement);
    const b = registry.resolveDescriptor(capsFor(rel), requirement);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toContain('hello'); // no request content in the result
  });
});

// ===================================================================================================
// Gateway / routing / rollout integration.
// ===================================================================================================
describe('gateway integration — capability registry', () => {
  const rel = release();

  function provider(
    rr: ProviderReleaseRef,
    cfg: Partial<ConstructorParameters<typeof FakeModelProvider>[0]> = {},
  ): FakeModelProvider {
    return new FakeModelProvider({
      capabilities: capsFor(rr),
      responses: [completedText('ok')],
      ...cfg,
    });
  }

  function gateway(
    providers: readonly FakeModelProvider[],
    overrides: Partial<ModelGatewayConfig> = {},
  ): ReturnType<typeof createModelGateway> {
    return createModelGateway({
      mode: 'ACTIVE',
      providers,
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: OFF_KILL,
      concurrency: { maxConcurrent: 4, maxQueue: 4 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      ...overrides,
    });
  }

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    let raised: unknown;
    try {
      await promise;
    } catch (e: unknown) {
      raised = e;
    }
    expect(raised).toBeInstanceOf(ModelGatewayError);
    expect((raised as ModelGatewayError).code).toBe(code);
  }

  it('with no registry, behaviour is unchanged', async () => {
    const p = provider(rel, { responses: [completedText('unchanged')] });
    const response = await gateway([p]).invoke(req());
    expect(response.textResult).toBe('unchanged');
  });

  it('a matching registry admits the provider', async () => {
    const registry = createModelCapabilityRegistry([profile(rel)]);
    const p = provider(rel, { responses: [completedText('admitted')] });
    const response = await gateway([p], { capabilityRegistry: registry }).invoke(req());
    expect(response.textResult).toBe('admitted');
  });

  it('a registry missing the provider release excludes it before invocation', async () => {
    const registry = createModelCapabilityRegistry([
      profile(
        release({ releaseId: 'other', providerId: 'other-prov', configDigest: 'digest-o-1' }),
      ),
    ]);
    const p = provider(rel);
    await expectCode(
      gateway([p], { capabilityRegistry: registry }).invoke(req()),
      'no-eligible-provider',
    );
    expect(p.invocations).toBe(0);
  });

  it('a registry descriptor mismatch (context ceiling) excludes it before invocation', async () => {
    // Profile ceiling is smaller than what the descriptor advertises -> mismatch.
    const registry = createModelCapabilityRegistry([profile(rel, { maxInputTokens: 50000 })]);
    const p = provider(rel); // descriptor maxInputTokens 100000 > profile 50000
    await expectCode(
      gateway([p], { capabilityRegistry: registry }).invoke(req()),
      'no-eligible-provider',
    );
    expect(p.invocations).toBe(0);
  });

  it('emits a safe content-free capability event on rejection', async () => {
    const events: { type: string; reason?: string; providerId?: string }[] = [];
    const registry = createModelCapabilityRegistry([profile(rel, { maxInputTokens: 50000 })]);
    const p = provider(rel);
    await expectCode(
      gateway([p], {
        capabilityRegistry: registry,
        capabilityObservability: {
          record: (e) => {
            events.push(e);
          },
        },
      }).invoke(req({ messages: [{ role: 'user', content: 'SECRET-PROMPT' }] })),
      'no-eligible-provider',
    );
    expect(
      events.some(
        (e) => e.type === 'capability-rejected' && e.reason === 'registry-descriptor-mismatch',
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain('SECRET-PROMPT');
  });

  it('LOCAL_ONLY still never reaches a hosted release, HUMAN_ONLY reaches none', async () => {
    const hostedRel = release();
    const localRel = release({
      releaseId: 'rel-local',
      providerId: 'local',
      modelId: 'model-l',
      executionClass: 'LOCAL',
      configDigest: 'digest-l-1',
    });
    const registry = createModelCapabilityRegistry([profile(hostedRel), profile(localRel)]);
    const hosted = provider(hostedRel, { responses: [completedText('hosted')] });
    const local = provider(localRel, { responses: [completedText('local')] });
    const response = await gateway([hosted, local], { capabilityRegistry: registry }).invoke(
      req({ dataClass: 'LOCAL_ONLY' }),
    );
    expect(response.textResult).toBe('local');
    expect(hosted.invocations).toBe(0);
    await expectCode(
      gateway([hosted, local], { capabilityRegistry: registry }).invoke(
        req({ dataClass: 'HUMAN_ONLY' }),
      ),
      'human-only',
    );
  });
});

// ===================================================================================================
// Rollout integration — exact release binding.
// ===================================================================================================
describe('rollout integration — capability registry', () => {
  const stableRel = release({
    releaseId: 'rel-stable',
    providerId: 'stable-prov',
    modelId: 'model-s',
    configDigest: 'digest-s-1',
  });
  const candRel = release({
    releaseId: 'rel-cand',
    providerId: 'cand-prov',
    modelId: 'model-c',
    modelVersion: '2',
    configDigest: 'digest-c-1',
  });

  function provider(
    rr: ProviderReleaseRef,
    cfg: Partial<ConstructorParameters<typeof FakeModelProvider>[0]> = {},
  ): FakeModelProvider {
    return new FakeModelProvider({
      capabilities: capsFor(rr),
      responses: [completedText('ok')],
      ...cfg,
    });
  }

  function approval() {
    return createRolloutApprovalAttestation({
      evaluationRef: 'eval/x',
      releaseId: candRel.releaseId,
      configDigest: candRel.configDigest,
      privacyRefs: [],
      approvedModeCeiling: 'ACTIVE',
      approvedCanaryBasisPoints: 10000,
      revision: 1,
      // QFJ-S2-C-B: shape-valid evidence references, required for any policy above OFF.
      evidenceDigest: 'evidence-digest-placeholder',
      approvalTarget: 'ACTIVE_MODEL_RELEASE',
      capabilityProfileRef: 'cap.profile.test',
    });
  }

  function policy(mode: 'SHADOW' | 'ACTIVE') {
    return createProviderRolloutPolicy({
      rolloutId: 'roll-1',
      revision: 1,
      mode,
      stable: stableRel,
      candidate: candRel,
      shadow: mode === 'SHADOW',
      maxServingAttempts: 3,
      maxShadowAttempts: 1,
      operatorReason: 'promote',
      approval: approval(),
    });
  }

  function gw(
    controller: ReturnType<typeof createProviderRolloutController>,
    providers: readonly FakeModelProvider[],
    registry?: ModelCapabilityRegistry,
  ): ReturnType<typeof createModelGateway> {
    return createModelGateway({
      mode: 'ACTIVE',
      providers,
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: OFF_KILL,
      concurrency: { maxConcurrent: 4, maxQueue: 4 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      rolloutController: controller,
      // QFJ-S2-C-B amendment: the serving boundary refuses a candidate-bearing policy without a
      // verifier. These specs exercise ROLLOUT behaviour, so they inject the permissive stub; the
      // fail-closed path is proved separately in the S2-C-B suites.
      evidenceVerifier: PERMISSIVE_VERIFIER,
      ...(registry === undefined ? {} : { capabilityRegistry: registry }),
    });
  }

  function textReq(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      runId: 'run-1',
      purpose: 'qualify',
      agentScope: 'CLIENT',
      dataClass: 'HOSTED_ALLOWED',
      messages: [{ role: 'user', content: 'hi' }],
      requiredCapabilities: NO_REQUIRED,
      resultMode: 'TEXT',
      maxResultChars: 1000,
      promptId: 'p.q',
      promptVersion: '1',
      promptDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      tokenBudget: 1000,
      costBudget: 1,
      timeoutMs: 5000,
      retryBudget: 0,
      metadata: {},
      ...overrides,
    };
  }

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    let raised: unknown;
    try {
      await promise;
    } catch (e: unknown) {
      raised = e;
    }
    expect(raised).toBeInstanceOf(ModelGatewayError);
    expect((raised as ModelGatewayError).code).toBe(code);
  }

  it('ACTIVE serves the candidate when its release resolves in the registry', async () => {
    const registry = createModelCapabilityRegistry([profile(stableRel), profile(candRel)]);
    const controller = createProviderRolloutController(
      policy('ACTIVE'),
      undefined,
      PERMISSIVE_VERIFIER,
    );
    const stable = provider(stableRel);
    const cand = provider(candRel, { responses: [completedText('active-cand')] });
    const response = await gw(controller, [stable, cand], registry).invoke(textReq());
    expect(response.textResult).toBe('active-cand');
  });

  it('ACTIVE approval alone cannot bypass a registry mismatch (candidate release missing)', async () => {
    // Registry has stable only — the ACTIVE candidate release does not resolve.
    const registry = createModelCapabilityRegistry([profile(stableRel)]);
    const controller = createProviderRolloutController(
      policy('ACTIVE'),
      undefined,
      PERMISSIVE_VERIFIER,
    );
    const stable = provider(stableRel);
    const cand = provider(candRel);
    await expectCode(
      gw(controller, [stable, cand], registry).invoke(textReq()),
      'no-eligible-provider',
    );
    expect(cand.invocations).toBe(0);
  });

  it('SHADOW requires both stable and candidate to resolve; a candidate-registry gap skips the shadow', async () => {
    // Registry has stable only -> stable serves, but the candidate shadow release does not resolve, so
    // the shadow is skipped (candidate never invoked). The stable response is still returned.
    const registry = createModelCapabilityRegistry([profile(stableRel)]);
    const controller = createProviderRolloutController(
      policy('SHADOW'),
      undefined,
      PERMISSIVE_VERIFIER,
    );
    const stable = provider(stableRel, { responses: [completedText('stable-ok')] });
    const cand = provider(candRel);
    const response = await gw(controller, [stable, cand], registry).invoke(textReq());
    expect(response.textResult).toBe('stable-ok');
    expect(cand.invocations).toBe(0);
  });
});

// ===================================================================================================
// Declared vs approved / authority.
// ===================================================================================================
describe('declared-vs-approved and authority', () => {
  it('a profile records only a declared capability and an opaque approval reference, not approval itself', () => {
    const p = profile(release(), { evaluationApprovalRef: 'eval/opaque/ref' });
    // The reference is opaque and does not constitute evaluation evidence; no boolean "approved" field.
    expect(p.evaluationApprovalRef).toBe('eval/opaque/ref');
    expect(JSON.stringify(p)).not.toMatch(/"approved"\s*:/);
  });

  it('the registry grants no business authority — resolution is a data summary with no method', () => {
    const registry = createModelCapabilityRegistry([profile(release())]);
    const resolution = registry.resolveDescriptor(
      capsFor(release()),
      deriveCapabilityRequirement(req()),
    );
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(typeof (resolution.summary as unknown as { authorize?: unknown }).authorize).toBe(
        'undefined',
      );
      expect(typeof (resolution.summary as unknown as { execute?: unknown }).execute).toBe(
        'undefined',
      );
    }
  });
});
