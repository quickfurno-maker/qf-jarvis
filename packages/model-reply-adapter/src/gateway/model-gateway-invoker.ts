/**
 * The narrow, synchronous injected model-gateway invoker (QFJ-M4, ADR-0057 §C, §K).
 *
 * A THIN provider-neutral seam over the EXISTING `@qf-jarvis/model-gateway` — never a second router.
 * It accepts the gateway's own validated `ModelRequest` and returns the gateway's own `ModelResponse`
 * (or a bounded refusal with a transient flag). It performs NO provider selection, NO fallback, NO
 * activation, NO rollout mutation, and NO network/credential access itself — the underlying gateway
 * owns all routing/capability/rollout/failover/timeout/retry/circuit and provider-error normalization.
 * A live async gateway binding is deferred; the only concrete implementation here is the deterministic
 * fake under `./testing`.
 */
import type { ModelRequest, ModelResponse } from '@qf-jarvis/model-gateway';

/** The result of one gateway invocation: a validated response, or a bounded refusal (no raw error). */
export type ModelGatewayInvocation =
  | { readonly ok: true; readonly response: ModelResponse }
  | { readonly ok: false; readonly transient: boolean };

/** Sends a validated request to the existing gateway and returns its validated response. May throw. */
export interface ModelGatewayInvoker {
  invoke(request: ModelRequest): ModelGatewayInvocation;
}
