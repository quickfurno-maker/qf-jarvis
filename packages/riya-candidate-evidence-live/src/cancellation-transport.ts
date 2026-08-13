/**
 * The transport-boundary cancellation hook (MVP-P2A.2, correction B).
 *
 * ### Why the gateway boundary was not good enough
 *
 * The first attempt fired its "admitted" signal immediately after `gateway.invoke(...)` returned its
 * promise. That proves the gateway was ASKED, not that the provider was reached — routing, capability
 * matching, budget policy and the concurrency queue all sit between the two. Aborting there could
 * cancel a turn that never left the building, and the case would quietly become an admission test
 * instead of a cancellation test.
 *
 * ### The narrowest honest fix
 *
 * `GroqTransport` is public and is exactly one method. This wraps an EXISTING transport, signals at
 * the moment `send` is entered — the real request boundary — and then delegates the same request and
 * the same signal, unmodified.
 *
 * It writes no HTTP, builds no header, knows no endpoint, reads neither the prompt nor the output,
 * and retries nothing. It is selected only for the case whose request says the turn is cancelled
 * after admission; every other turn uses the ordinary transport untouched.
 */
import type { GroqTransport } from '@qf-jarvis/model-gateway';

/** A transport that announces when the real request boundary is crossed, then gets out of the way. */
export function createTransportStartHook(
  underlying: GroqTransport,
  onTransportStarted: () => void,
): GroqTransport {
  return Object.freeze({
    send: (
      request: Parameters<GroqTransport['send']>[0],
      signal: AbortSignal,
    ): ReturnType<GroqTransport['send']> => {
      // Fired BEFORE delegating, because the point of the hook is that the provider is now committed
      // to this request. Firing afterwards would wait for the response and cancel nothing.
      onTransportStarted();
      // The same request, the same signal, unchanged. Nothing is inspected, rewritten or retried —
      // this seam is a callback, not a client.
      return underlying.send(request, signal);
    },
  });
}

/**
 * Abort exactly once, at the transport boundary.
 *
 * Returned as a pair so a spec can assert the ORDER: the controller must not be aborted before the
 * hook fires, and must be aborted after it. A cancellation that arrived early would be indisputable
 * evidence of nothing.
 */
export function createTransportBoundaryAbort(): {
  readonly controller: AbortController;
  readonly onTransportStarted: () => void;
  readonly started: () => number;
} {
  const controller = new AbortController();
  let starts = 0;
  return {
    controller,
    onTransportStarted: (): void => {
      starts += 1;
      // One abort. A second would be a second cancellation of a turn that has already been cancelled.
      if (!controller.signal.aborted) {
        controller.abort();
      }
    },
    started: () => starts,
  };
}
