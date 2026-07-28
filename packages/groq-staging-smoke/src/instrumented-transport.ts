/**
 * The instrumented, smoke-only Groq transport (QFJ-S1D-B).
 *
 * ## Why this is not a decorator
 *
 * The intended shape was a decorator around `createFetchGroqTransport`. That cannot work, and the
 * reason is structural rather than incidental: the gateway transport's `send()` only resolves AFTER it
 * has already awaited both the platform fetch and `response.text()`. From outside, a wrapper sees one
 * opaque await — it can time the exchange but never say whether 30 seconds went into DNS/TLS/connect,
 * into waiting for response headers, or into streaming the body. Those are precisely the phases the
 * S1D-A audit said we could not distinguish.
 *
 * So the observation point moves inward to the narrowest seam the smoke package owns: this module
 * implements `GroqTransport` itself and interleaves milestones around its own `fetch` call. **The Model
 * Gateway is not modified.** Its transport remains exactly as merged and is still the gateway's own
 * production path; the smoke simply supplies its own conforming implementation, as the injected
 * transport seam was always designed to allow.
 *
 * ## The cost, stated plainly
 *
 * This duplicates the gateway transport's wire semantics — fixed endpoint, `POST`, `redirect: 'error'`,
 * bounded body read, bounded `retry-after` parse. Duplication drifts. `timeout-diagnostics.test.ts`
 * therefore pins every one of those against the gateway's own source, so a change there fails here.
 *
 * ## What it still refuses to do
 *
 * One fetch, never a second. No retry on any outcome. The original error object is rethrown unchanged
 * so the gateway's normalisation is untouched; only a closed enum class is recorded. Request headers are
 * passed straight through and never read, so the `Authorization` value is never seen, copied, or stored.
 * Response bytes are handed to the gateway's own handling and never retained here.
 */
import { GROQ_CHAT_COMPLETIONS_ENDPOINT, type GroqTransport } from '@qf-jarvis/model-gateway';

import { normaliseTransportError, type DiagnosticRecorder } from './diagnostic-telemetry.js';

/**
 * The maximum response body read before truncation.
 *
 * Mirrors the gateway's `GROQ_MAX_RESPONSE_BYTES`, which is deliberately NOT exported from its barrel.
 * The mirror is pinned to the gateway source by test, so the two cannot silently diverge.
 */
export const INSTRUMENTED_MAX_RESPONSE_BYTES = 1_000_000;

/** The narrow `fetch` seam. Production uses the platform `fetch`; tests inject a deterministic fake. */
export type FetchLike = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly redirect: 'error';
    readonly signal: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** The minimal response surface the transport consumes. Nothing else is read. */
export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The production seam: the platform `fetch`, unmodified. */
export function createSystemFetchLike(): FetchLike {
  return (url, init) => fetch(url, init);
}

/** Parse a bounded `retry-after`. Identical to the gateway's rule; anything else becomes `null`. */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
    return null;
  }
  return seconds;
}

export interface InstrumentedTransportDeps {
  readonly fetchLike: FetchLike;
  readonly recorder: DiagnosticRecorder;
}

/**
 * Build the instrumented transport. It performs EXACTLY ONE fetch per `send`, marks the four wire
 * milestones around it, and rethrows any failure unchanged after classifying it.
 */
export function createInstrumentedGroqTransport(deps: InstrumentedTransportDeps): GroqTransport {
  return {
    async send(request, signal) {
      // The SSRF guard is identical to the gateway's, and runs before anything is marked or sent.
      if (request.url !== GROQ_CHAT_COMPLETIONS_ENDPOINT) {
        throw new Error('Refusing a Groq request to a non-official endpoint.');
      }

      deps.recorder.mark('fetchStarted');
      let response: FetchResponseLike;
      try {
        response = await deps.fetchLike(request.url, {
          method: 'POST',
          // Passed straight through. The Authorization value is never read, copied, or retained.
          headers: { ...request.headers },
          body: request.body,
          redirect: 'error',
          signal,
        });
      } catch (error: unknown) {
        deps.recorder.recordTransportError(normaliseTransportError(error));
        throw error;
      }
      // Headers are proven only once a Response object exists.
      deps.recorder.mark('headersReceived');

      deps.recorder.mark('responseBodyStarted');
      let raw: string;
      try {
        raw = await response.text();
      } catch (error: unknown) {
        deps.recorder.recordTransportError(normaliseTransportError(error));
        throw error;
      }
      deps.recorder.mark('responseBodyCompleted');

      const bodyText =
        raw.length > INSTRUMENTED_MAX_RESPONSE_BYTES
          ? raw.slice(0, INSTRUMENTED_MAX_RESPONSE_BYTES)
          : raw;
      return {
        status: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
        bodyText,
      };
    },
  };
}
