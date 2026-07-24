/**
 * The governed, provider-neutral Model Gateway (QFJ-P04.01A, ADR-0045).
 *
 * The single waist every model call passes through. It authorizes NOTHING and executes NOTHING — it
 * turns a validated, minimized request into at most one accepted provider invocation and returns a
 * validated result with provenance. Deterministic order: validate → kill switch → mode → data class →
 * concurrency/queue → budget → health → capability/execution routing → bounded primary attempts (retry
 * + circuit) → at most ONE fallback → validate output → provenance. No voting, no parallel fan-out, at
 * most one accepted response. All time is injected; there is no wall-clock sleep and no background work.
 */
import { z } from 'zod';

import type { GatewayMode } from './contracts/enums.js';
import type { ModelProvider, ProviderOutput } from './contracts/provider.js';
import { validateModelRequest, type ModelRequest } from './contracts/request.js';
import type { ModelResponse, ModelUsage } from './contracts/response.js';
import type { ModelRunProvenance } from './contracts/provenance.js';
import { ModelGatewayError, type ModelGatewayErrorCode } from './errors/gateway-error.js';
import type { GatewayBudgetPolicy } from './budgets/budget-policy.js';
import {
  NOOP_OBSERVABILITY,
  type GatewayEvent,
  type GatewayObservabilityHook,
} from './observability/events.js';
import { CircuitBreaker, type CircuitBreakerConfig } from './reliability/circuit-breaker.js';
import type { GatewayClock } from './reliability/clock.js';
import { BoundedSemaphore } from './reliability/semaphore.js';
import { selectProviders } from './routing/select-providers.js';
import type { HybridRoutingPolicy } from './routing/hybrid-routing-policy.js';
import { buildRoutingPlan } from './routing/routing-plan.js';
import { decideFallover } from './routing/failover-policy.js';
import { AttemptLedger } from './routing/attempt-ledger.js';
import type { ProviderRolloutController } from './operations/rollout-controller.js';
import { decideServing } from './operations/rollout-execution.js';
import { capabilitiesSatisfy } from './contracts/capabilities.js';
import { approvalPermitsMode } from './operations/rollout-approval.js';
import type { ProviderReleaseRef } from './operations/provider-release.js';
import {
  NOOP_ROLLOUT_OBSERVABILITY,
  type RolloutObservabilityHook,
  type RolloutRefusalReason,
} from './operations/rollout-reasons.js';

/** The emergency kill switch — one injected predicate that stops all model invocation. */
export interface GatewayKillSwitch {
  active(): boolean;
}

/** The gateway's construction config. Providers are tried in array (policy) order. */
export interface ModelGatewayConfig {
  readonly mode: GatewayMode;
  readonly providers: readonly ModelProvider[];
  readonly clock: GatewayClock;
  readonly budgetPolicy: GatewayBudgetPolicy;
  readonly killSwitch: GatewayKillSwitch;
  readonly concurrency: { readonly maxConcurrent: number; readonly maxQueue: number };
  readonly circuit: CircuitBreakerConfig;
  readonly allowFallback: boolean;
  readonly observability?: GatewayObservabilityHook;
  /**
   * OPTIONAL hybrid-routing policy (QFJ-P04.01D, ADR-0048). When present, provider selection and the
   * single fallback are governed by the profile + failover matrix. When absent, the gateway behaves
   * exactly as the foundation (array-order selection, allowFallback), unchanged.
   */
  readonly routingProfile?: HybridRoutingPolicy;
  /**
   * OPTIONAL provider-rollout controller (QFJ-P04.01E, ADR-0049). When present, serving is governed by
   * the rollout mode (OFF/SHADOW/CANARY/ACTIVE/FALLBACK); it takes precedence over `routingProfile`. When
   * absent, the gateway behaves exactly as QFJ-P04.01D.
   */
  readonly rolloutController?: ProviderRolloutController;
  /** OPTIONAL sink for rollout observability events (QFJ-P04.01E). */
  readonly rolloutObservability?: RolloutObservabilityHook;
}

export interface ModelGatewayInvokeOptions {
  readonly signal?: AbortSignal;
}

/** The public gateway handle. */
export interface ModelGateway {
  invoke(request: unknown, options?: ModelGatewayInvokeOptions): Promise<ModelResponse>;
}

interface AcceptedAttempt {
  readonly kind: 'accepted';
  readonly output: unknown;
  readonly usage: ModelUsage;
  readonly latencyMs: number;
}
interface FailedAttempt {
  readonly kind: 'failure';
  readonly code: ModelGatewayErrorCode;
  readonly invoked: boolean;
  /** Whether retrying this provider could plausibly succeed. A non-retryable failure stops retries. */
  readonly retryable: boolean;
}
interface CancelledAttempt {
  readonly kind: 'cancelled';
}
type AttemptOutcome = AcceptedAttempt | FailedAttempt | CancelledAttempt;

/**
 * Render a STRUCTURED request's zod schema to a JSON Schema hint for a real provider (e.g. Groq's
 * `response_format.json_schema`). On any conversion failure it returns `{}` — the provider may then fall
 * back to best-effort JSON mode, and the gateway's local zod validation remains the authority.
 */
function toStructuredJsonSchema(request: ModelRequest): unknown {
  if (request.structuredSchema === undefined) {
    return {};
  }
  try {
    return z.toJSONSchema(request.structuredSchema);
  } catch {
    return {};
  }
}

/** Map a rollout serving refusal to a safe closed gateway error code (never a rollout-internal reason). */
function mapRolloutRefusal(
  reason: RolloutRefusalReason,
  dataClass: ModelRequest['dataClass'],
): ModelGatewayErrorCode {
  if (reason === 'mode-off') {
    return 'gateway-off';
  }
  if (reason === 'privacy-forbidden') {
    return dataClass === 'LOCAL_ONLY' ? 'local-provider-required' : 'human-only';
  }
  return 'no-eligible-provider';
}

/** True iff a serving failure is a bounded transient category that a rollout fallback may act on. */
function isRolloutTransient(outcome: {
  readonly code: ModelGatewayErrorCode;
  readonly invoked: boolean;
  readonly retryable: boolean;
}): boolean {
  if (!outcome.invoked && outcome.code === 'circuit-open') {
    return true;
  }
  return (
    outcome.invoked &&
    outcome.retryable &&
    (outcome.code === 'provider-unavailable' || outcome.code === 'timeout')
  );
}

function validateOutput(
  request: ModelRequest,
  output: ProviderOutput,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: ModelGatewayErrorCode } {
  if (request.resultMode === 'STRUCTURED') {
    if (output.mode !== 'STRUCTURED') {
      return { ok: false, code: 'malformed-provider-output' };
    }
    const schema = request.structuredSchema;
    if (schema === undefined) {
      return { ok: false, code: 'internal-invariant' };
    }
    const parsed = schema.safeParse(output.value);
    if (!parsed.success) {
      return { ok: false, code: 'structured-output-invalid' };
    }
    return { ok: true, value: parsed.data };
  }
  if (output.mode !== 'TEXT') {
    return { ok: false, code: 'malformed-provider-output' };
  }
  if (output.text.length > request.maxResultChars) {
    return { ok: false, code: 'malformed-provider-output' };
  }
  return { ok: true, value: output.text };
}

export function createModelGateway(config: ModelGatewayConfig): ModelGateway {
  const observability = config.observability ?? NOOP_OBSERVABILITY;
  const semaphore = new BoundedSemaphore(
    config.concurrency.maxConcurrent,
    config.concurrency.maxQueue,
  );
  const circuit = new CircuitBreaker(config.clock, config.circuit);

  function emit(event: GatewayEvent): void {
    observability.record(event);
  }

  async function tryOnce(
    provider: ModelProvider,
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<AttemptOutcome> {
    if (signal.aborted) {
      return { kind: 'cancelled' };
    }
    const providerId = provider.descriptor.providerId;
    if (!circuit.canAttempt(providerId)) {
      return { kind: 'failure', code: 'circuit-open', invoked: false, retryable: false };
    }

    let result;
    try {
      result = await provider.invoke({
        runId: request.runId,
        messages: request.messages,
        resultMode: request.resultMode,
        timeoutMs: request.timeoutMs,
        signal,
        ...(request.resultMode === 'STRUCTURED'
          ? { structuredJsonSchema: toStructuredJsonSchema(request) }
          : {}),
      });
    } catch {
      circuit.recordFailure(providerId);
      return { kind: 'failure', code: 'provider-failed', invoked: true, retryable: false };
    }

    switch (result.status) {
      case 'completed': {
        if (result.latencyMs > request.timeoutMs) {
          circuit.recordFailure(providerId);
          emit({ type: 'timeout', runId: request.runId, providerId });
          return { kind: 'failure', code: 'timeout', invoked: true, retryable: true };
        }
        const validation = validateOutput(request, result.output);
        if (!validation.ok) {
          circuit.recordFailure(providerId);
          if (validation.code === 'structured-output-invalid') {
            emit({ type: 'structured-output-failed', runId: request.runId, providerId });
          }
          return { kind: 'failure', code: validation.code, invoked: true, retryable: false };
        }
        circuit.recordSuccess(providerId);
        return {
          kind: 'accepted',
          output: validation.value,
          usage: result.usage ?? {},
          latencyMs: result.latencyMs,
        };
      }
      case 'timeout':
        circuit.recordFailure(providerId);
        emit({ type: 'timeout', runId: request.runId, providerId });
        return { kind: 'failure', code: 'timeout', invoked: true, retryable: true };
      case 'cancelled':
        return { kind: 'cancelled' };
      case 'unavailable':
        circuit.recordFailure(providerId);
        return {
          kind: 'failure',
          code: 'provider-unavailable',
          invoked: true,
          retryable: result.retryable ?? true,
        };
      case 'failed':
        circuit.recordFailure(providerId);
        return {
          kind: 'failure',
          code: 'provider-failed',
          invoked: true,
          retryable: result.retryable ?? true,
        };
      case 'malformed':
        circuit.recordFailure(providerId);
        return {
          kind: 'failure',
          code: 'malformed-provider-output',
          invoked: true,
          retryable: false,
        };
    }
  }

  async function runProvider(
    provider: ModelProvider,
    request: ModelRequest,
    signal: AbortSignal,
    maxTries: number,
    counter: { attempts: number },
  ): Promise<AttemptOutcome> {
    let last: FailedAttempt = {
      kind: 'failure',
      code: 'provider-failed',
      invoked: false,
      retryable: false,
    };
    for (let attempt = 0; attempt < maxTries; attempt += 1) {
      if (signal.aborted) {
        return { kind: 'cancelled' };
      }
      const outcome = await tryOnce(provider, request, signal);
      if (outcome.kind === 'cancelled') {
        return outcome;
      }
      if (outcome.kind === 'accepted') {
        counter.attempts += 1;
        return outcome;
      }
      if (outcome.invoked) {
        counter.attempts += 1;
      }
      last = outcome;
      if (!outcome.invoked || !outcome.retryable) {
        // Circuit open, or a non-retryable failure — retrying the same provider is pointless.
        break;
      }
    }
    return last;
  }

  function terminalCode(
    request: ModelRequest,
    last: FailedAttempt,
    usedFallback: boolean,
  ): ModelGatewayErrorCode {
    if (!last.invoked) {
      return 'circuit-open';
    }
    if (last.retryable && !usedFallback && request.retryBudget > 0) {
      return 'retry-budget-exhausted';
    }
    return last.code;
  }

  async function serve(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    emit({ type: 'invocation-started', runId: request.runId, mode: config.mode });

    // Budget admission.
    const budget = config.budgetPolicy.admit(request);
    if (!budget.admitted) {
      emit({ type: 'budget-refused', runId: request.runId, code: budget.code });
      throw new ModelGatewayError(budget.code);
    }

    // Health map (a provider whose health check throws is treated as unavailable).
    const healthy = new Map<string, boolean>();
    for (const provider of config.providers) {
      let available: boolean;
      try {
        available = (await provider.health()).available;
      } catch {
        available = false;
      }
      healthy.set(provider.descriptor.providerId, available);
    }

    // QFJ-P04.01E: a rollout controller governs serving by mode; it takes precedence over routing.
    if (config.rolloutController !== undefined) {
      return serveRollout(request, signal, healthy, config.rolloutController);
    }
    // QFJ-P04.01D: when a hybrid-routing policy is configured, selection and the single fallback are
    // governed by the profile + failover matrix. Otherwise the foundation's array-order path runs.
    if (config.routingProfile !== undefined) {
      return serveHybrid(request, signal, healthy, config.routingProfile);
    }

    const selection = selectProviders(request, config.providers, healthy);
    if (!selection.ok) {
      emit({ type: 'invocation-failed', runId: request.runId, code: selection.code });
      throw new ModelGatewayError(selection.code);
    }

    const primary = selection.eligible[0];
    if (primary === undefined) {
      throw new ModelGatewayError('internal-invariant');
    }
    emit({
      type: 'provider-selected',
      runId: request.runId,
      providerId: primary.descriptor.providerId,
    });

    const counter = { attempts: 0 };
    const primaryOutcome = await runProvider(
      primary,
      request,
      signal,
      1 + request.retryBudget,
      counter,
    );
    if (primaryOutcome.kind === 'cancelled') {
      emit({ type: 'cancelled', runId: request.runId });
      throw new ModelGatewayError('cancelled');
    }
    if (primaryOutcome.kind === 'accepted') {
      return finish(request, primary, primaryOutcome, false, counter.attempts);
    }

    // At most ONE fallback, only when allowed and a distinct eligible provider exists.
    const fallback = config.allowFallback ? selection.eligible[1] : undefined;
    if (fallback !== undefined) {
      const fallbackOutcome = await runProvider(fallback, request, signal, 1, counter);
      if (fallbackOutcome.kind === 'cancelled') {
        emit({ type: 'cancelled', runId: request.runId });
        throw new ModelGatewayError('cancelled');
      }
      if (fallbackOutcome.kind === 'accepted') {
        emit({
          type: 'fallback-used',
          runId: request.runId,
          providerId: fallback.descriptor.providerId,
        });
        return finish(request, fallback, fallbackOutcome, true, counter.attempts);
      }
      const code = terminalCode(request, fallbackOutcome, true);
      emit({ type: 'invocation-failed', runId: request.runId, code, attempts: counter.attempts });
      throw new ModelGatewayError(code);
    }

    const code = terminalCode(request, primaryOutcome, false);
    emit({ type: 'invocation-failed', runId: request.runId, code, attempts: counter.attempts });
    throw new ModelGatewayError(code);
  }

  async function serveHybrid(
    request: ModelRequest,
    signal: AbortSignal,
    healthy: ReadonlyMap<string, boolean>,
    policy: HybridRoutingPolicy,
  ): Promise<ModelResponse> {
    const planResult = buildRoutingPlan(
      request,
      config.providers,
      healthy,
      (id) => !circuit.canAttempt(id),
      policy,
    );
    if (!planResult.ok) {
      emit({
        type: 'routing-decided',
        runId: request.runId,
        code: planResult.code,
        profile: policy.profile,
        dataClass: request.dataClass,
      });
      emit({ type: 'invocation-failed', runId: request.runId, code: planResult.code });
      throw new ModelGatewayError(planResult.code);
    }
    const plan = planResult.plan;
    emit({
      type: 'routing-decided',
      runId: request.runId,
      providerId: plan.primary.descriptor.providerId,
      profile: policy.profile,
      dataClass: request.dataClass,
    });
    emit({
      type: 'provider-selected',
      runId: request.runId,
      providerId: plan.primary.descriptor.providerId,
    });

    const ledger = new AttemptLedger(policy.maxTotalAttempts);
    const counter = { attempts: 0 };

    // Primary: bounded by the request retry budget AND the policy's total-attempt ceiling.
    const primaryTries = Math.min(1 + request.retryBudget, ledger.remaining());
    const primaryOutcome = await runProviderLedger(
      plan.primary,
      request,
      signal,
      primaryTries,
      counter,
      ledger,
      false,
    );
    if (primaryOutcome.kind === 'cancelled') {
      emit({ type: 'cancelled', runId: request.runId });
      throw new ModelGatewayError('cancelled');
    }
    if (primaryOutcome.kind === 'accepted') {
      ledger.markAccepted();
      return finish(request, plan.primary, primaryOutcome, false, counter.attempts);
    }

    // Failover matrix: a single, gated fallback.
    const decision = decideFallover(
      {
        cancelled: signal.aborted,
        hasEligibleFallback: plan.fallback !== undefined,
        fallbackExecutionClass: plan.fallbackExecutionClass,
        dataClass: request.dataClass,
        primaryCode: primaryOutcome.code,
        primaryInvoked: primaryOutcome.invoked,
        primaryRetryable: primaryOutcome.retryable,
        attemptsRemaining: ledger.remaining(),
      },
      policy,
    );
    emit({
      type: 'routing-decided',
      runId: request.runId,
      profile: policy.profile,
      dataClass: request.dataClass,
      fallbackReason: decision.reason,
    });

    if (decision.allow && plan.fallback !== undefined) {
      const fallbackOutcome = await runProviderLedger(
        plan.fallback,
        request,
        signal,
        Math.min(1, ledger.remaining()),
        counter,
        ledger,
        true,
      );
      if (fallbackOutcome.kind === 'cancelled') {
        emit({ type: 'cancelled', runId: request.runId });
        throw new ModelGatewayError('cancelled');
      }
      if (fallbackOutcome.kind === 'accepted') {
        ledger.markAccepted();
        emit({
          type: 'fallback-used',
          runId: request.runId,
          providerId: plan.fallback.descriptor.providerId,
        });
        return finish(request, plan.fallback, fallbackOutcome, true, counter.attempts);
      }
      const code = terminalCode(request, fallbackOutcome, true);
      emit({ type: 'invocation-failed', runId: request.runId, code, attempts: counter.attempts });
      throw new ModelGatewayError(code);
    }

    const code = terminalCode(request, primaryOutcome, false);
    emit({ type: 'invocation-failed', runId: request.runId, code, attempts: counter.attempts });
    throw new ModelGatewayError(code);
  }

  /** Run one provider under the shared attempt ledger: the ledger caps total invocations across the run. */
  async function runProviderLedger(
    provider: ModelProvider,
    request: ModelRequest,
    signal: AbortSignal,
    maxTries: number,
    counter: { attempts: number },
    ledger: AttemptLedger,
    isFallbackProvider: boolean,
  ): Promise<AttemptOutcome> {
    let last: FailedAttempt = {
      kind: 'failure',
      code: 'provider-failed',
      invoked: false,
      retryable: false,
    };
    for (let attempt = 0; attempt < maxTries; attempt += 1) {
      if (signal.aborted) {
        return { kind: 'cancelled' };
      }
      if (!ledger.canAttempt()) {
        break;
      }
      const outcome = await tryOnce(provider, request, signal);
      if (outcome.kind === 'cancelled') {
        return outcome;
      }
      if (outcome.kind === 'accepted') {
        // An accepted attempt is a real invocation; count it in the ledger and the provenance counter.
        ledger.record(provider.descriptor.providerId, isFallbackProvider);
        counter.attempts += 1;
        return outcome;
      }
      if (outcome.invoked) {
        ledger.record(provider.descriptor.providerId, isFallbackProvider);
        counter.attempts += 1;
      }
      last = outcome;
      if (!outcome.invoked || !outcome.retryable) {
        break;
      }
    }
    return last;
  }

  async function serveRollout(
    request: ModelRequest,
    signal: AbortSignal,
    healthy: ReadonlyMap<string, boolean>,
    controller: ProviderRolloutController,
  ): Promise<ModelResponse> {
    const rolloutHook: RolloutObservabilityHook =
      config.rolloutObservability ?? NOOP_ROLLOUT_OBSERVABILITY;
    const policy = controller.snapshot();
    const decision = decideServing(policy, request.runId);
    const providersById = new Map(config.providers.map((p) => [p.descriptor.providerId, p]));

    const rolloutRefuse = (reason: RolloutRefusalReason): ModelGatewayError => {
      rolloutHook.record({
        type: 'rollout-refused',
        rolloutId: policy.rolloutId,
        runId: request.runId,
        mode: policy.mode,
        reason,
      });
      const code = mapRolloutRefusal(reason, request.dataClass);
      emit({ type: 'invocation-failed', runId: request.runId, code });
      return new ModelGatewayError(code);
    };

    if (!decision.serve || decision.servingRelease === undefined) {
      throw rolloutRefuse(decision.reason ?? 'mode-off');
    }
    const servingRelease = decision.servingRelease;

    // Privacy: a LOCAL_ONLY request may serve only a LOCAL release (HUMAN_ONLY is refused before serving).
    if (request.dataClass === 'LOCAL_ONLY' && servingRelease.executionClass !== 'LOCAL') {
      throw rolloutRefuse('privacy-forbidden');
    }
    // ACTIVE requires an approval that permits ACTIVE (defense in depth beyond the transition check).
    if (
      policy.mode === 'ACTIVE' &&
      (policy.approval === undefined || !approvalPermitsMode(policy.approval, 'ACTIVE'))
    ) {
      throw rolloutRefuse('approval-mode-ceiling');
    }
    const servingProvider = providersById.get(servingRelease.providerId);
    if (servingProvider === undefined) {
      throw rolloutRefuse('no-serving-provider');
    }
    if (servingProvider.descriptor.executionClass !== servingRelease.executionClass) {
      throw rolloutRefuse('no-serving-provider');
    }
    if (healthy.get(servingRelease.providerId) !== true) {
      throw rolloutRefuse('readiness-unhealthy');
    }
    if (!capabilitiesSatisfy(servingProvider.capabilities(), request.requiredCapabilities)) {
      emit({ type: 'invocation-failed', runId: request.runId, code: 'capability-mismatch' });
      throw new ModelGatewayError('capability-mismatch');
    }

    rolloutHook.record({
      type: 'serving-release-selected',
      rolloutId: policy.rolloutId,
      runId: request.runId,
      mode: policy.mode,
      ...(decision.servingTarget === undefined ? {} : { serve: decision.servingTarget }),
      releaseId: servingRelease.releaseId,
      providerId: servingRelease.providerId,
    });
    if (decision.mode === 'CANARY' && decision.canaryBucket !== undefined) {
      rolloutHook.record({
        type: 'canary-assigned',
        rolloutId: policy.rolloutId,
        runId: request.runId,
        ...(decision.servingTarget === undefined ? {} : { serve: decision.servingTarget }),
        ...(decision.canaryBasisPoints === undefined
          ? {}
          : { canaryBasisPoints: decision.canaryBasisPoints }),
        canaryBucket: decision.canaryBucket,
      });
    }
    emit({
      type: 'provider-selected',
      runId: request.runId,
      providerId: servingProvider.descriptor.providerId,
    });

    const ledger = new AttemptLedger(policy.maxServingAttempts);
    const counter = { attempts: 0 };
    const servingTries = Math.min(1 + request.retryBudget, ledger.remaining());
    const outcome = await runProviderLedger(
      servingProvider,
      request,
      signal,
      servingTries,
      counter,
      ledger,
      false,
    );
    if (outcome.kind === 'cancelled') {
      emit({ type: 'cancelled', runId: request.runId });
      throw new ModelGatewayError('cancelled');
    }
    if (outcome.kind === 'accepted') {
      ledger.markAccepted();
      const response = finish(request, servingProvider, outcome, false, counter.attempts);
      // SHADOW: after a stable acceptance, at most one sequential candidate shadow call; output discarded.
      if (decision.shadowRelease !== undefined) {
        await runShadow(
          request,
          signal,
          decision.shadowRelease,
          providersById,
          healthy,
          policy,
          controller,
          rolloutHook,
        );
      }
      return response;
    }

    // A single bounded candidate/stable fallback (CANARY candidate→stable, FALLBACK stable→candidate).
    const fallbackRelease = decision.fallbackRelease;
    const privacyOkForFallback =
      fallbackRelease !== undefined &&
      !(request.dataClass === 'LOCAL_ONLY' && fallbackRelease.executionClass !== 'LOCAL');
    if (
      fallbackRelease !== undefined &&
      privacyOkForFallback &&
      !signal.aborted &&
      ledger.remaining() > 0 &&
      controller.snapshot().revision === policy.revision &&
      isRolloutTransient(outcome)
    ) {
      const fbProvider = providersById.get(fallbackRelease.providerId);
      if (fbProvider !== undefined) {
        const fbEligible =
          fbProvider.descriptor.executionClass === fallbackRelease.executionClass &&
          healthy.get(fallbackRelease.providerId) === true &&
          capabilitiesSatisfy(fbProvider.capabilities(), request.requiredCapabilities);
        if (fbEligible) {
          const fbOutcome = await runProviderLedger(
            fbProvider,
            request,
            signal,
            Math.min(1, ledger.remaining()),
            counter,
            ledger,
            true,
          );
          if (fbOutcome.kind === 'cancelled') {
            emit({ type: 'cancelled', runId: request.runId });
            throw new ModelGatewayError('cancelled');
          }
          if (fbOutcome.kind === 'accepted') {
            ledger.markAccepted();
            rolloutHook.record({
              type: 'candidate-fallback-to-stable',
              rolloutId: policy.rolloutId,
              runId: request.runId,
              ...(decision.fallbackTarget === undefined ? {} : { serve: decision.fallbackTarget }),
              releaseId: fallbackRelease.releaseId,
              providerId: fallbackRelease.providerId,
            });
            emit({
              type: 'fallback-used',
              runId: request.runId,
              providerId: fbProvider.descriptor.providerId,
            });
            return finish(request, fbProvider, fbOutcome, true, counter.attempts);
          }
          const code = terminalCode(request, fbOutcome, true);
          emit({
            type: 'invocation-failed',
            runId: request.runId,
            code,
            attempts: counter.attempts,
          });
          throw new ModelGatewayError(code);
        }
      }
    }

    const code = terminalCode(request, outcome, false);
    emit({ type: 'invocation-failed', runId: request.runId, code, attempts: counter.attempts });
    throw new ModelGatewayError(code);
  }

  /** Run one bounded, non-returning candidate shadow call. Never fatal; output is discarded. */
  async function runShadow(
    request: ModelRequest,
    signal: AbortSignal,
    shadowRelease: ProviderReleaseRef,
    providersById: ReadonlyMap<string, ModelProvider>,
    healthy: ReadonlyMap<string, boolean>,
    policy: { readonly rolloutId: string; readonly revision: number },
    controller: ProviderRolloutController,
    rolloutHook: RolloutObservabilityHook,
  ): Promise<void> {
    if (signal.aborted || controller.snapshot().revision !== policy.revision) {
      return;
    }
    const provider = providersById.get(shadowRelease.providerId);
    if (provider === undefined) {
      return;
    }
    if (
      provider.descriptor.executionClass !== shadowRelease.executionClass ||
      healthy.get(shadowRelease.providerId) !== true ||
      !capabilitiesSatisfy(provider.capabilities(), request.requiredCapabilities)
    ) {
      return;
    }
    rolloutHook.record({
      type: 'shadow-started',
      rolloutId: policy.rolloutId,
      runId: request.runId,
      releaseId: shadowRelease.releaseId,
      providerId: shadowRelease.providerId,
    });
    const outcome = await tryOnce(provider, request, signal);
    rolloutHook.record({
      type: outcome.kind === 'accepted' ? 'shadow-completed' : 'shadow-failed',
      rolloutId: policy.rolloutId,
      runId: request.runId,
      releaseId: shadowRelease.releaseId,
      providerId: shadowRelease.providerId,
    });
  }

  function finish(
    request: ModelRequest,
    provider: ModelProvider,
    accepted: AcceptedAttempt,
    usedFallback: boolean,
    attempts: number,
  ): ModelResponse {
    config.budgetPolicy.settle(request, accepted.usage);
    const capabilities = provider.capabilities();
    const provenance: ModelRunProvenance = {
      runId: request.runId,
      purpose: request.purpose,
      providerId: capabilities.providerId,
      modelId: capabilities.modelId,
      modelVersion: capabilities.modelVersion,
      promptId: request.promptId,
      promptVersion: request.promptVersion,
      mode: config.mode,
      usedFallback,
      attempts,
    };
    emit({
      type: 'invocation-completed',
      runId: request.runId,
      providerId: capabilities.providerId,
      attempts,
      latencyMs: accepted.latencyMs,
    });
    const base = {
      runId: request.runId,
      resultMode: request.resultMode,
      provenance,
      usage: accepted.usage,
      latencyMs: accepted.latencyMs,
      finishStatus: 'completed' as const,
    };
    return request.resultMode === 'STRUCTURED'
      ? { ...base, structuredResult: accepted.output }
      : { ...base, textResult: accepted.output as string };
  }

  return {
    async invoke(input: unknown, options?: ModelGatewayInvokeOptions): Promise<ModelResponse> {
      const validation = validateModelRequest(input);
      if (!validation.ok) {
        throw new ModelGatewayError('request-invalid');
      }
      const request = validation.request;
      const signal = options?.signal ?? new AbortController().signal;

      if (config.killSwitch.active()) {
        emit({ type: 'kill-switch', runId: request.runId });
        throw new ModelGatewayError('kill-switch-active');
      }
      // Only OFF and ACTIVE are executable in P04.01A; every other mode fails closed as not-enabled.
      if (config.mode !== 'ACTIVE') {
        throw new ModelGatewayError('gateway-off');
      }
      if (request.dataClass === 'HUMAN_ONLY') {
        throw new ModelGatewayError('human-only');
      }

      const admission = await semaphore.acquire();
      if (!admission.acquired) {
        emit({
          type: admission.refusal === 'queue-full' ? 'queue-refused' : 'concurrency-refused',
          runId: request.runId,
          code: admission.refusal,
        });
        throw new ModelGatewayError(admission.refusal);
      }
      try {
        return await serve(request, signal);
      } finally {
        semaphore.release();
      }
    },
  };
}
