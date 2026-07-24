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
}
interface CancelledAttempt {
  readonly kind: 'cancelled';
}
type AttemptOutcome = AcceptedAttempt | FailedAttempt | CancelledAttempt;

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
      return { kind: 'failure', code: 'circuit-open', invoked: false };
    }

    let result;
    try {
      result = await provider.invoke({
        runId: request.runId,
        messages: request.messages,
        resultMode: request.resultMode,
        timeoutMs: request.timeoutMs,
        signal,
      });
    } catch {
      circuit.recordFailure(providerId);
      return { kind: 'failure', code: 'provider-failed', invoked: true };
    }

    switch (result.status) {
      case 'completed': {
        if (result.latencyMs > request.timeoutMs) {
          circuit.recordFailure(providerId);
          emit({ type: 'timeout', runId: request.runId, providerId });
          return { kind: 'failure', code: 'timeout', invoked: true };
        }
        const validation = validateOutput(request, result.output);
        if (!validation.ok) {
          circuit.recordFailure(providerId);
          if (validation.code === 'structured-output-invalid') {
            emit({ type: 'structured-output-failed', runId: request.runId, providerId });
          }
          return { kind: 'failure', code: validation.code, invoked: true };
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
        return { kind: 'failure', code: 'timeout', invoked: true };
      case 'cancelled':
        return { kind: 'cancelled' };
      case 'unavailable':
        circuit.recordFailure(providerId);
        return { kind: 'failure', code: 'provider-unavailable', invoked: true };
      case 'failed':
        circuit.recordFailure(providerId);
        return { kind: 'failure', code: 'provider-failed', invoked: true };
      case 'malformed':
        circuit.recordFailure(providerId);
        return { kind: 'failure', code: 'malformed-provider-output', invoked: true };
    }
  }

  async function runProvider(
    provider: ModelProvider,
    request: ModelRequest,
    signal: AbortSignal,
    maxTries: number,
    counter: { attempts: number },
  ): Promise<AttemptOutcome> {
    let last: FailedAttempt = { kind: 'failure', code: 'provider-failed', invoked: false };
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
      if (!outcome.invoked) {
        // Circuit is open — retrying the same provider is pointless.
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
    if (!usedFallback && request.retryBudget > 0) {
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
