/**
 * The narrow, asynchronous injected model-gateway invoker (QFJ-M4, ADR-0057 §C, §K; ADR-0058 §1, §10).
 *
 * A THIN provider-neutral seam over the EXISTING `@qf-jarvis/model-gateway` — never a second router.
 * It accepts the gateway's own validated `ModelRequest` and resolves the gateway's own `ModelResponse`
 * (or a bounded refusal with a transient flag). It performs NO provider selection, NO fallback, NO
 * activation, NO rollout mutation, and NO network/credential access itself — the underlying gateway
 * owns all routing/capability/rollout/failover/timeout/retry/circuit and provider-error normalization.
 *
 * The seam is `Promise`-based because the existing gateway's `invoke` is `async`
 * (`invoke(request, options?): Promise<ModelResponse>`); a live binding awaits it directly. Cancellation
 * is NOT re-invented here — the gateway already owns an `AbortSignal` at its own boundary, and stale/
 * cancelled conversation state is enforced by the injected state gate around the awaited call
 * (ADR-0058 §6, §10). A live async gateway binding is still deferred; the only concrete implementation
 * here is the deterministic fake under `./testing`.
 */
import type { ModelRequest, ModelResponse } from '@qf-jarvis/model-gateway';

/** The result of one gateway invocation: a validated response, or a bounded refusal (no raw error). */
export type ModelGatewayInvocation =
  | { readonly ok: true; readonly response: ModelResponse }
  | { readonly ok: false; readonly transient: boolean };

/** Sends a validated request to the existing gateway and resolves its validated response. May reject. */
export interface ModelGatewayInvoker {
  invoke(request: ModelRequest): Promise<ModelGatewayInvocation>;
}
