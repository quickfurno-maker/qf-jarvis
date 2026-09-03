/**
 * The provider-independent invocation port (AS2, ADR-0143 §2).
 *
 * ### One narrow seam, so GPT and Claude are configuration rather than dependency
 *
 * Everything the harness needs from a model passes through `invoke`. That is what keeps the locked
 * GPT + Claude data-creation strategy from becoming a hard Jarvis dependency: swapping a family,
 * adding a local model later, or running entirely on deterministic fakes changes an adapter and
 * nothing else. No scenario, provenance, evidence or acceptance contract moves.
 *
 * ### What the port deliberately cannot express
 *
 * There is no place to pass a key, a URL, a header, an account or a tenant. An adapter resolves
 * transport from whatever `adapterRef` means to it, outside these contracts. A port that accepted
 * credentials would put them in every call site, and eventually in a log.
 *
 * ### The payload comes back UNTRUSTED
 *
 * `payload` is bounded text, not a parsed object, and it is deliberately typed as a string the caller
 * must put through a strict schema and a canonical constructor. A port that returned
 * `Promise<CustomerTurn>` would be asserting that a model returned a valid customer turn, which is
 * exactly the claim nothing has checked yet.
 */
import type {
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticInvocationResultV1,
} from '../contracts/invocation.js';

export interface RiyaSyntheticInvocationOptions {
  /** Cooperative cancellation. An adapter that ignores this will be cut off by the timeout anyway. */
  readonly signal?: AbortSignal;
  /** Per-invocation budget. Offline generation is patient, but never unbounded. */
  readonly timeoutMs: number;
}

export interface RiyaSyntheticInvocationOutcome {
  readonly result: RiyaSyntheticInvocationResultV1;
  /**
   * The raw bounded response, present only when `result.status` is `SUCCESS`.
   *
   * UNTRUSTED. It has not been parsed, validated or checked for role crossover, and it must not be
   * treated as authority until it has been through the parse pipeline.
   */
  readonly payload?: string;
}

export interface RiyaSyntheticModelInvoker {
  /**
   * Invoke one configured model in one role.
   *
   * `structuredInput` is `unknown` on purpose: the port does not know the shape of any role's input,
   * and an adapter is responsible for rendering it. Keeping it opaque here is what stops the port
   * from growing role-specific knowledge and becoming the thing every role has to agree with.
   *
   * Implementations must NOT throw for provider failure — they return a result whose status and
   * error class say what happened. Throwing would make failure handling depend on an exception type
   * the port cannot constrain.
   */
  invoke(
    request: RiyaSyntheticInvocationRequestV1,
    structuredInput: unknown,
    options: RiyaSyntheticInvocationOptions,
  ): Promise<RiyaSyntheticInvocationOutcome>;
}
