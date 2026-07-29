/**
 * The live `ModelGatewayInvoker` (QFJ-S2-B, ADR-0062 §5).
 *
 * The FIRST non-fake implementation of the QFJ-M4 seam (ADR-0057 §C, §K): it adapts an existing
 * `ModelGateway` instance onto the interface `@qf-jarvis/model-reply-adapter` already declares. It is
 * an ADAPTER, not a second router.
 *
 * What it does: exactly ONE `gateway.invoke` call, then translates the outcome.
 * What it must never do — asserted by source-containment specs, not just documented here:
 *   select a provider · retry · fall back · mutate rollout · resolve a prompt · inspect a credential ·
 *   open a transport · read the environment · log request content or model output · invoke twice.
 *
 * Transient classification is a TOTAL map over the closed `ModelGatewayErrorCode` set. It is never a
 * message parse: an error whose text says "timeout" is classified by its `code` alone, and a value that
 * is not a `ModelGatewayError` at all is a fixed internal failure carrying nothing from the original.
 */
import {
  isModelGatewayError,
  type ModelGateway,
  type ModelGatewayErrorCode,
  type ModelRequest,
} from '@qf-jarvis/model-gateway';
import type { ModelGatewayInvocation, ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

/**
 * Whether a gateway failure could plausibly succeed on a LATER, separately-decided attempt.
 *
 * TOTAL over the closed code set — a `Record`, so adding a code to the vocabulary without classifying
 * it is a compile error rather than a silent `false`.
 *
 * This is a CLASSIFICATION, not an instruction. S2-B retries nothing and falls back to nothing
 * (`retryBudget` 0, `allowFallback` false), so `transient: true` changes no behaviour in this slice —
 * it informs the caller, and QuickFurno Core remains the authority on what happens next.
 */
const TRANSIENT_BY_CODE: Readonly<Record<ModelGatewayErrorCode, boolean>> = Object.freeze({
  // Configuration, policy and authority refusals — a repeat attempt fails identically.
  'gateway-off': false,
  'human-only': false,
  'no-eligible-provider': false,
  'local-provider-required': false,
  'capability-mismatch': false,
  'kill-switch-active': false,
  'request-invalid': false,
  'internal-invariant': false,
  cancelled: false,
  // Budget refusals — the budget is a property of the request, not of the moment.
  'token-budget-exceeded': false,
  'cost-budget-exceeded': false,
  // Load and availability — the same request may succeed once pressure clears.
  'queue-full': true,
  'concurrency-limit': true,
  'circuit-open': true,
  'provider-unavailable': true,
  'rate-limited': true,
  timeout: true,
  'retry-budget-exhausted': true,
  // Provider and output faults — a repeat attempt reproduces them.
  'provider-failed': false,
  'malformed-provider-output': false,
  'structured-output-invalid': false,
});

/** The fixed outcome for anything that is not a `ModelGatewayError`. Retains no message, cause or stack. */
const INTERNAL_FAILURE: ModelGatewayInvocation = Object.freeze({
  ok: false as const,
  transient: false,
});

/**
 * Adapt a real gateway onto the existing invoker seam.
 *
 * The request is passed through UNMODIFIED — the reply adapter already built and validated it, and
 * re-deriving any field here would create a second source of truth. Cancellation and timeout stay where
 * the existing contracts put them: `timeoutMs` travels on the request, and the gateway owns the
 * `AbortSignal` at its own boundary (ADR-0057, ADR-0058 §6, §10). This seam adds no signal of its own.
 */
export function createLiveModelGatewayInvoker(gateway: ModelGateway): ModelGatewayInvoker {
  return Object.freeze({
    async invoke(request: ModelRequest): Promise<ModelGatewayInvocation> {
      try {
        // Exactly one call. There is no loop, no second provider, and no second await of `invoke`.
        const response = await gateway.invoke(request);
        return Object.freeze({ ok: true as const, response });
      } catch (error: unknown) {
        if (isModelGatewayError(error)) {
          // Classified by CODE alone. The message, name and stack are read by nothing here.
          return Object.freeze({ ok: false as const, transient: TRANSIENT_BY_CODE[error.code] });
        }
        return INTERNAL_FAILURE;
      }
    },
  });
}
