/**
 * QFJ-P04.01E — provider operations and rollout governance (ADR-0049).
 *
 * Pure coverage of the release/approval/policy validation, the transition matrix, the controller, the
 * deterministic canary, and the serving decision, plus end-to-end gateway integration with deterministic
 * FakeModelProviders — NO live call, NO real key/token, NO network. Proves: default OFF; SHADOW stable-only
 * serve with a single non-returning candidate shadow; deterministic CANARY cohort; ACTIVE candidate serve;
 * FALLBACK stable-primary + bounded candidate fallback; the strict promotion path and emergency disable;
 * fail-closed readiness/approval; and safe content-free rollout observability.
 */
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createManualClock,
  createModelGateway,
  createProviderReleaseRef,
  createProviderRolloutController,
  createProviderRolloutPolicy,
  createRolloutApprovalAttestation,
  defineProviderCapabilities,
  ModelGatewayError,
  offRolloutPolicy,
  type GatewayKillSwitch,
  type ModelGatewayConfig,
  type ProviderReleaseRef,
  type ProviderRolloutController,
  type ProviderRolloutPolicy,
  type ProviderCapabilities,
  type RequiredCapabilities,
  type RolloutApprovalAttestation,
  type RolloutEvent,
} from '../index.js';
import {
  FakeModelProvider,
  completedText,
  providerFailed,
  providerUnavailable,
} from '../testing/index.js';
import { decideServing } from '../operations/rollout-execution.js';
import { validateTransition } from '../operations/rollout-transitions.js';
import { canaryBucket, canaryCohort } from '../operations/canary-bucket.js';

const OFF_KILL: GatewayKillSwitch = { active: (): boolean => false };

function caps(
  overrides: Partial<ProviderCapabilities> & { providerId: string },
): ProviderCapabilities {
  return defineProviderCapabilities({
    modelId: 'fake-model',
    modelVersion: '1',
    executionClass: 'HOSTED',
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

function release(overrides: Partial<ProviderReleaseRef> = {}): ProviderReleaseRef {
  return createProviderReleaseRef({
    releaseId: 'rel-stable',
    providerId: 'stable-prov',
    modelId: 'model-a',
    modelVersion: '1',
    executionClass: 'HOSTED',
    configDigest: 'digest-stable-1',
    ...overrides,
  });
}

const STABLE = release();
const CANDIDATE = release({
  releaseId: 'rel-candidate',
  providerId: 'cand-prov',
  modelId: 'model-b',
  modelVersion: '2',
  configDigest: 'digest-cand-1',
});

function approval(overrides: Partial<RolloutApprovalAttestation> = {}): RolloutApprovalAttestation {
  return createRolloutApprovalAttestation({
    evaluationRef: 'eval/2026-07-24/abc',
    releaseId: CANDIDATE.releaseId,
    configDigest: CANDIDATE.configDigest,
    privacyRefs: ['zdr/groq'],
    approvedModeCeiling: 'ACTIVE',
    approvedCanaryBasisPoints: 10_000,
    revision: 1,
    ...overrides,
  });
}

function policy(overrides: Record<string, unknown> = {}): ProviderRolloutPolicy {
  return createProviderRolloutPolicy({
    rolloutId: 'roll-1',
    revision: 1,
    mode: 'SHADOW',
    stable: STABLE,
    candidate: CANDIDATE,
    shadow: true,
    maxServingAttempts: 3,
    maxShadowAttempts: 1,
    operatorReason: 'promote',
    approval: approval(),
    ...overrides,
  });
}

// ===================================================================================================
// Release / approval / policy validation.
// ===================================================================================================
describe('provider release / approval / policy validation', () => {
  it('freezes a valid release and rejects invalid fields / extra keys', () => {
    expect(Object.isFrozen(STABLE)).toBe(true);
    expect(() => createProviderReleaseRef({ ...STABLE, releaseId: 'bad id!' })).toThrow();
    expect(() => createProviderReleaseRef({ ...STABLE, executionClass: 'CLOUD' })).toThrow();
    expect(() => createProviderReleaseRef({ ...STABLE, extra: 1 })).toThrow();
    expect(() => createProviderReleaseRef({ ...STABLE, configDigest: 'short' })).toThrow();
  });

  it('freezes a valid approval and bounds the canary ceiling', () => {
    expect(Object.isFrozen(approval())).toBe(true);
    expect(() => approval({ approvedCanaryBasisPoints: 10_001 })).toThrow();
    expect(() => approval({ approvedModeCeiling: 'NONE' as never })).toThrow();
  });

  it('defaults to OFF and carries no candidate', () => {
    const off = offRolloutPolicy('roll-1', STABLE);
    expect(off.mode).toBe('OFF');
    expect(off.candidate).toBeUndefined();
    expect(off.revision).toBe(0);
  });

  it('requires a candidate for SHADOW/CANARY/ACTIVE/FALLBACK', () => {
    for (const mode of ['SHADOW', 'CANARY', 'ACTIVE', 'FALLBACK'] as const) {
      expect(() =>
        createProviderRolloutPolicy({
          rolloutId: 'roll-1',
          revision: 1,
          mode,
          stable: STABLE,
          maxServingAttempts: 3,
          operatorReason: 'promote',
        }),
      ).toThrow();
    }
  });

  it('permits non-zero canary basis points only in CANARY, and the shadow flag only in SHADOW', () => {
    expect(() => policy({ mode: 'ACTIVE', shadow: false, canaryBasisPoints: 100 })).toThrow();
    expect(() => policy({ mode: 'CANARY', shadow: true, canaryBasisPoints: 100 })).toThrow();
    expect(() => policy({ mode: 'CANARY', shadow: false, canaryBasisPoints: 100 })).not.toThrow();
  });

  it('requires an approval that binds the candidate release', () => {
    expect(() => policy({ approval: undefined })).toThrow();
    expect(() => policy({ approval: approval({ configDigest: 'digest-wrong-1' }) })).toThrow();
  });

  it('rejects a candidate identical to the stable release', () => {
    expect(() =>
      policy({
        candidate: release(),
        approval: approval({ releaseId: STABLE.releaseId, configDigest: STABLE.configDigest }),
      }),
    ).toThrow();
  });

  it('carries no secret/prompt field and no Kimi reference', () => {
    const json = JSON.stringify(policy());
    expect(json).not.toMatch(/secret|token|password|prompt|message/i);
    expect(json).not.toMatch(/kimi/i);
  });
});

// ===================================================================================================
// Transition matrix.
// ===================================================================================================
describe('validateTransition — the transition matrix', () => {
  const off = offRolloutPolicy('roll-1', STABLE);
  const shadow = policy({ revision: 1, mode: 'SHADOW', shadow: true });
  const canary = policy({ revision: 2, mode: 'CANARY', shadow: false, canaryBasisPoints: 500 });
  const active = policy({ revision: 3, mode: 'ACTIVE', shadow: false });

  it('allows the promotion path OFF->SHADOW->CANARY->ACTIVE', () => {
    expect(validateTransition(off, shadow, 0).ok).toBe(true);
    expect(validateTransition(shadow, canary, 1).ok).toBe(true);
    expect(validateTransition(canary, active, 2).ok).toBe(true);
  });

  it('rejects OFF->ACTIVE and SHADOW->ACTIVE', () => {
    expect(
      validateTransition(off, policy({ revision: 1, mode: 'ACTIVE', shadow: false }), 0),
    ).toEqual({
      ok: false,
      reason: 'invalid-transition',
    });
    expect(
      validateTransition(shadow, policy({ revision: 2, mode: 'ACTIVE', shadow: false }), 1),
    ).toEqual({
      ok: false,
      reason: 'invalid-transition',
    });
  });

  it('allows rollback and emergency-style demotions', () => {
    expect(
      validateTransition(
        active,
        policy({ revision: 4, mode: 'CANARY', shadow: false, canaryBasisPoints: 100 }),
        3,
      ).ok,
    ).toBe(true);
    expect(
      validateTransition(active, policy({ revision: 4, mode: 'FALLBACK', shadow: false }), 3).ok,
    ).toBe(true);
    expect(
      validateTransition(canary, policy({ revision: 3, mode: 'SHADOW', shadow: true }), 2).ok,
    ).toBe(true);
    expect(validateTransition(active, offRolloutPolicy('roll-1', STABLE), 3).ok).toBe(false); // revision 0 not monotonic
    expect(
      validateTransition(
        active,
        policy({
          revision: 4,
          mode: 'OFF',
          shadow: false,
          candidate: undefined,
          approval: undefined,
        }),
        3,
      ).ok,
    ).toBe(true);
  });

  it('rejects a stale expectedRevision and a non-monotonic revision', () => {
    expect(validateTransition(shadow, canary, 0)).toEqual({ ok: false, reason: 'stale-revision' });
    expect(
      validateTransition(
        shadow,
        policy({ revision: 1, mode: 'CANARY', shadow: false, canaryBasisPoints: 1 }),
        1,
      ),
    ).toEqual({
      ok: false,
      reason: 'stale-revision',
    });
  });

  it('requires a safe restart (OFF/SHADOW) when the candidate release changes', () => {
    const changed = release({
      releaseId: 'rel-candidate2',
      providerId: 'cand2',
      configDigest: 'digest-cand-2',
    });
    const changedApproval = approval({
      releaseId: changed.releaseId,
      configDigest: changed.configDigest,
    });
    // CANARY -> CANARY with a changed candidate is rejected.
    expect(
      validateTransition(
        canary,
        policy({
          revision: 3,
          mode: 'CANARY',
          shadow: false,
          canaryBasisPoints: 100,
          candidate: changed,
          approval: changedApproval,
        }),
        2,
      ),
    ).toEqual({ ok: false, reason: 'invalid-transition' });
    // CANARY -> SHADOW with a changed candidate is allowed (re-shadow).
    expect(
      validateTransition(
        canary,
        policy({
          revision: 3,
          mode: 'SHADOW',
          shadow: true,
          candidate: changed,
          approval: changedApproval,
        }),
        2,
      ).ok,
    ).toBe(true);
  });

  it('rejects a canary increase beyond the approval ceiling and allows a decrease', () => {
    const cappedApproval = approval({ approvedCanaryBasisPoints: 1000 });
    const capped = policy({
      revision: 2,
      mode: 'CANARY',
      shadow: false,
      canaryBasisPoints: 1000,
      approval: cappedApproval,
    });
    const shadowCapped = policy({
      revision: 1,
      mode: 'SHADOW',
      shadow: true,
      approval: cappedApproval,
    });
    expect(
      validateTransition(
        shadowCapped,
        policy({
          revision: 2,
          mode: 'CANARY',
          shadow: false,
          canaryBasisPoints: 2000,
          approval: cappedApproval,
        }),
        1,
      ),
    ).toEqual({ ok: false, reason: 'approval-canary-ceiling' });
    expect(
      validateTransition(
        capped,
        policy({
          revision: 3,
          mode: 'CANARY',
          shadow: false,
          canaryBasisPoints: 100,
          approval: cappedApproval,
        }),
        2,
      ).ok,
    ).toBe(true);
  });
});

// ===================================================================================================
// Controller.
// ===================================================================================================
describe('createProviderRolloutController', () => {
  it('applies a valid transition and rejects a stale one', () => {
    const controller = createProviderRolloutController(offRolloutPolicy('roll-1', STABLE));
    expect(controller.snapshot().mode).toBe('OFF');
    const ok = controller.transition(policy({ revision: 1, mode: 'SHADOW', shadow: true }), 0);
    expect(ok.ok).toBe(true);
    expect(controller.snapshot().mode).toBe('SHADOW');
    const stale = controller.transition(
      policy({ revision: 2, mode: 'CANARY', shadow: false, canaryBasisPoints: 1 }),
      0,
    );
    expect(stale).toEqual({ ok: false, reason: 'stale-revision' });
    expect(controller.snapshot().mode).toBe('SHADOW');
  });

  it('emergency-disables from any mode and a stale revision cannot re-enable', () => {
    const controller = createProviderRolloutController(
      policy({ revision: 5, mode: 'ACTIVE', shadow: false }),
    );
    const disabled = controller.emergencyDisable(5, 'emergency-disable');
    expect(disabled.ok).toBe(true);
    expect(controller.snapshot().mode).toBe('OFF');
    expect(controller.snapshot().revision).toBe(6);
    // A stale caller (revision 5) cannot transition back to a serving mode.
    const stale = controller.transition(policy({ revision: 6, mode: 'SHADOW', shadow: true }), 5);
    expect(stale.ok).toBe(false);
    expect(controller.snapshot().mode).toBe('OFF');
  });

  it('emits safe content-free transition events', () => {
    const events: RolloutEvent[] = [];
    const controller = createProviderRolloutController(offRolloutPolicy('roll-1', STABLE), {
      record: (e) => {
        events.push(e);
      },
    });
    controller.transition(policy({ revision: 1, mode: 'SHADOW', shadow: true }), 0);
    expect(events.some((e) => e.type === 'rollout-transitioned' && e.mode === 'SHADOW')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/secret|token|prompt|message/i);
  });
});

// ===================================================================================================
// Deterministic canary.
// ===================================================================================================
describe('canary bucket', () => {
  it('is deterministic for the same rollout + run', () => {
    expect(canaryBucket('roll-1', 'run-x')).toBe(canaryBucket('roll-1', 'run-x'));
  });

  it('is bounded to [0, 10000)', () => {
    for (const run of ['a', 'b', 'c', 'run-123', 'zzz']) {
      const b = canaryBucket('roll-1', run);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(10_000);
    }
  });

  it('routes everyone to stable at 0 bp and to candidate at 10000 bp', () => {
    for (const run of ['a', 'b', 'c', 'd', 'e']) {
      expect(canaryCohort('roll-1', run, 0).serve).toBe('stable');
      expect(canaryCohort('roll-1', run, 10_000).serve).toBe('candidate');
    }
  });
});

// ===================================================================================================
// Serving decision (pure).
// ===================================================================================================
describe('decideServing', () => {
  it('refuses in OFF', () => {
    expect(decideServing(offRolloutPolicy('roll-1', STABLE), 'run-1')).toMatchObject({
      serve: false,
      reason: 'mode-off',
    });
  });

  it('serves stable and shadows the candidate in SHADOW', () => {
    const d = decideServing(policy({ mode: 'SHADOW', shadow: true }), 'run-1');
    expect(d.servingRelease?.releaseId).toBe(STABLE.releaseId);
    expect(d.shadowRelease?.releaseId).toBe(CANDIDATE.releaseId);
    expect(d.fallbackRelease).toBeUndefined();
  });

  it('serves the candidate in ACTIVE with no fallback', () => {
    const d = decideServing(policy({ mode: 'ACTIVE', shadow: false }), 'run-1');
    expect(d.servingRelease?.releaseId).toBe(CANDIDATE.releaseId);
    expect(d.fallbackRelease).toBeUndefined();
  });

  it('serves stable with a candidate fallback in FALLBACK', () => {
    const d = decideServing(policy({ mode: 'FALLBACK', shadow: false }), 'run-1');
    expect(d.servingRelease?.releaseId).toBe(STABLE.releaseId);
    expect(d.fallbackRelease?.releaseId).toBe(CANDIDATE.releaseId);
  });
});

// ===================================================================================================
// Gateway integration.
// ===================================================================================================
describe('gateway — rollout integration', () => {
  function providerFor(
    release: ProviderReleaseRef,
    cfg: Partial<ConstructorParameters<typeof FakeModelProvider>[0]> = {},
  ): FakeModelProvider {
    return new FakeModelProvider({
      capabilities: caps({
        providerId: release.providerId,
        executionClass: release.executionClass,
        modelId: release.modelId,
        modelVersion: release.modelVersion,
      }),
      ...cfg,
    });
  }

  function gateway(
    controller: ProviderRolloutController,
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
      rolloutController: controller,
      ...overrides,
    });
  }

  function textRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      runId: 'run-1',
      purpose: 'qualify',
      agentScope: 'CLIENT',
      dataClass: 'HOSTED_ALLOWED',
      messages: [{ role: 'user', content: 'SECRET-PROMPT' }],
      requiredCapabilities: NO_REQUIRED,
      resultMode: 'TEXT',
      maxResultChars: 1000,
      promptId: 'p.qualify',
      promptVersion: '1',
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
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ModelGatewayError);
    expect((raised as ModelGatewayError).code).toBe(code);
  }

  const ctl = (
    p: ProviderRolloutPolicy,
    events?: RolloutEvent[],
  ): { controller: ProviderRolloutController; obs?: { record: (e: RolloutEvent) => void } } => {
    const controller = createProviderRolloutController(p);
    return events === undefined
      ? { controller }
      : {
          controller,
          obs: {
            record: (e) => {
              events.push(e);
            },
          },
        };
  };

  it('OFF invokes no provider', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable')] });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('cand')] });
    const { controller } = ctl(offRolloutPolicy('roll-1', STABLE));
    await expectCode(gateway(controller, [stable, candidate]).invoke(textRequest()), 'gateway-off');
    expect(stable.invocations).toBe(0);
    expect(candidate.invocations).toBe(0);
  });

  it('SHADOW serves stable, shadows the candidate once, and never returns candidate output', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable-ok')] });
    const candidate = providerFor(CANDIDATE, {
      responses: [completedText('candidate-shadow-only')],
    });
    const events: RolloutEvent[] = [];
    const { controller } = ctl(policy({ mode: 'SHADOW', shadow: true }));
    const response = await gateway(controller, [stable, candidate], {
      rolloutObservability: {
        record: (e) => {
          events.push(e);
        },
      },
    }).invoke(textRequest());
    expect(response.textResult).toBe('stable-ok');
    expect(response.provenance.providerId).toBe('stable-prov');
    expect(stable.invocations).toBe(1);
    expect(candidate.invocations).toBe(1); // one shadow call
    expect(JSON.stringify(response)).not.toContain('candidate-shadow-only');
    expect(events.some((e) => e.type === 'shadow-completed')).toBe(true);
  });

  it('SHADOW: a candidate shadow failure is non-fatal', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable-ok')] });
    const candidate = providerFor(CANDIDATE, { responses: [providerFailed()] });
    const { controller } = ctl(policy({ mode: 'SHADOW', shadow: true }));
    const response = await gateway(controller, [stable, candidate]).invoke(textRequest());
    expect(response.textResult).toBe('stable-ok');
    expect(candidate.invocations).toBe(1);
  });

  it('SHADOW: a stable failure prevents the shadow', async () => {
    const stable = providerFor(STABLE, { responses: [providerFailed()] });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('cand')] });
    const { controller } = ctl(policy({ mode: 'SHADOW', shadow: true }));
    await expectCode(
      gateway(controller, [stable, candidate]).invoke(textRequest()),
      'provider-failed',
    );
    expect(candidate.invocations).toBe(0);
  });

  it('CANARY at 0 bp serves stable; at 10000 bp serves candidate', async () => {
    const stable0 = providerFor(STABLE, { responses: [completedText('stable-0')] });
    const cand0 = providerFor(CANDIDATE, { responses: [completedText('cand-0')] });
    const r0 = await gateway(
      ctl(policy({ mode: 'CANARY', shadow: false, canaryBasisPoints: 0 })).controller,
      [stable0, cand0],
    ).invoke(textRequest());
    expect(r0.textResult).toBe('stable-0');
    expect(cand0.invocations).toBe(0);

    const stable1 = providerFor(STABLE, { responses: [completedText('stable-1')] });
    const cand1 = providerFor(CANDIDATE, { responses: [completedText('cand-1')] });
    const r1 = await gateway(
      ctl(policy({ mode: 'CANARY', shadow: false, canaryBasisPoints: 10_000 })).controller,
      [stable1, cand1],
    ).invoke(textRequest());
    expect(r1.textResult).toBe('cand-1');
    expect(stable1.invocations).toBe(0);
  });

  it('CANARY candidate falls back to stable on a retryable failure when enabled', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable-rescue')] });
    const candidate = providerFor(CANDIDATE, { responses: [providerUnavailable()] });
    const response = await gateway(
      ctl(
        policy({
          mode: 'CANARY',
          shadow: false,
          canaryBasisPoints: 10_000,
          fallbackToStable: true,
        }),
      ).controller,
      [stable, candidate],
    ).invoke(textRequest());
    expect(response.textResult).toBe('stable-rescue');
    expect(response.provenance.usedFallback).toBe(true);
    expect(candidate.invocations).toBe(1);
    expect(stable.invocations).toBe(1);
  });

  it('CANARY does not fall back on a non-retryable failure', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable')] });
    const candidate = providerFor(CANDIDATE, { responses: [providerFailed()] });
    await expectCode(
      gateway(
        ctl(
          policy({
            mode: 'CANARY',
            shadow: false,
            canaryBasisPoints: 10_000,
            fallbackToStable: true,
          }),
        ).controller,
        [stable, candidate],
      ).invoke(textRequest()),
      'provider-failed',
    );
    expect(stable.invocations).toBe(0);
  });

  it('ACTIVE serves the candidate for all eligible traffic', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable')] });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('active-candidate')] });
    const response = await gateway(ctl(policy({ mode: 'ACTIVE', shadow: false })).controller, [
      stable,
      candidate,
    ]).invoke(textRequest());
    expect(response.textResult).toBe('active-candidate');
    expect(stable.invocations).toBe(0);
  });

  it('FALLBACK serves stable and falls over to the candidate on a transient stable failure', async () => {
    const stable = providerFor(STABLE, { responses: [providerUnavailable()] });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('candidate-fallback')] });
    const response = await gateway(ctl(policy({ mode: 'FALLBACK', shadow: false })).controller, [
      stable,
      candidate,
    ]).invoke(textRequest());
    expect(response.textResult).toBe('candidate-fallback');
    expect(response.provenance.usedFallback).toBe(true);
  });

  it('FALLBACK terminates on a non-retryable stable failure without the candidate', async () => {
    const stable = providerFor(STABLE, { responses: [providerFailed()] });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('cand')] });
    await expectCode(
      gateway(ctl(policy({ mode: 'FALLBACK', shadow: false })).controller, [
        stable,
        candidate,
      ]).invoke(textRequest()),
      'provider-failed',
    );
    expect(candidate.invocations).toBe(0);
  });

  it('an emergency disable blocks the next call and a stale revision cannot re-enable', async () => {
    const stable = providerFor(STABLE, {
      responses: [completedText('stable'), completedText('stable')],
    });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('cand')] });
    const controller = createProviderRolloutController(
      policy({ revision: 4, mode: 'ACTIVE', shadow: false }),
    );
    controller.emergencyDisable(4, 'emergency-disable');
    await expectCode(gateway(controller, [stable, candidate]).invoke(textRequest()), 'gateway-off');
    expect(candidate.invocations).toBe(0);
  });

  it('refuses when the serving provider is unhealthy', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable')], available: false });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('cand')] });
    await expectCode(
      gateway(ctl(policy({ mode: 'SHADOW', shadow: true })).controller, [stable, candidate]).invoke(
        textRequest(),
      ),
      'no-eligible-provider',
    );
  });

  it('never serves a LOCAL_ONLY request from a HOSTED release', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable')] });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('cand')] });
    await expectCode(
      gateway(ctl(policy({ mode: 'SHADOW', shadow: true })).controller, [stable, candidate]).invoke(
        textRequest({ dataClass: 'LOCAL_ONLY' }),
      ),
      'local-provider-required',
    );
    expect(stable.invocations).toBe(0);
  });

  it('emits safe content-free rollout observability with no prompt', async () => {
    const stable = providerFor(STABLE, { responses: [completedText('stable-ok')] });
    const candidate = providerFor(CANDIDATE, { responses: [completedText('cand')] });
    const events: RolloutEvent[] = [];
    await gateway(
      ctl(
        policy({
          mode: 'CANARY',
          shadow: false,
          canaryBasisPoints: 10_000,
          fallbackToStable: true,
        }),
      ).controller,
      [stable, candidate],
      {
        rolloutObservability: {
          record: (e) => {
            events.push(e);
          },
        },
      },
    ).invoke(textRequest());
    expect(events.some((e) => e.type === 'serving-release-selected')).toBe(true);
    expect(
      events.some((e) => e.type === 'canary-assigned' && typeof e.canaryBucket === 'number'),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain('SECRET-PROMPT');
    for (const e of events) {
      expect(e.rolloutId).toBe('roll-1');
    }
  });
});
