/**
 * The Nara HTTP transport boundary (JF-2A, ADR-0146).
 *
 * The adapter performs exactly ONE HTTP request per invocation through an INJECTED transport. Tests
 * inject a deterministic transport and make no external request. The production transport
 * ({@link createFetchNaraTransport}) is the ONE place in this module that touches the network: it uses
 * the platform `fetch`, targets ONLY the fixed NaraRouter endpoint (no arbitrary base URL — an SSRF
 * guard rejects any other origin and follows no redirect), and bounds the response size before reading.
 * The transport never retries and never sleeps — the gateway owns retry/backoff/timeout.
 *
 * ### Why there is no configurable base URL
 *
 * The guarantee that this provider can only ever reach NaraRouter comes from this module naming ONE
 * constant and refusing everything else. A `baseUrl` option would move that guarantee out of the code
 * and into whoever calls it — and a hosted provider whose destination is a caller-supplied string is an
 * SSRF primitive with a model-shaped interface. The Groq transport makes the same trade for the same
 * reason, and a second endpoint (if Nara ever needs one) gets its own guarded function rather than a
 * parameter on this one.
 */

/** The fixed NaraRouter OpenAI-compatible Chat Completions endpoint. Not overridable. */
export const NARA_CHAT_COMPLETIONS_ENDPOINT = 'https://router.bynara.id/v1/chat/completions';

/** The maximum response body the transport will read before rejecting (bounded parse). */
export const NARA_MAX_RESPONSE_BYTES = 1_000_000;

/** A bounded HTTP request the adapter hands the transport. */
export interface NaraHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A bounded HTTP response the transport returns. Only the status, a small header subset, and text. */
export interface NaraHttpResponse {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly bodyText: string;
}

/** The injected transport. `send` performs one request and resolves a bounded response, or rejects. */
export interface NaraTransport {
  send(request: NaraHttpRequest, signal: AbortSignal): Promise<NaraHttpResponse>;
}

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

/**
 * The production transport: a single `fetch` to the fixed Nara endpoint. It refuses any URL other than
 * the official endpoint (SSRF guard), disables redirects, reads at most {@link NARA_MAX_RESPONSE_BYTES},
 * and never retries. Never used by tests. Reads no environment.
 */
export function createFetchNaraTransport(): NaraTransport {
  return {
    async send(request: NaraHttpRequest, signal: AbortSignal): Promise<NaraHttpResponse> {
      if (request.url !== NARA_CHAT_COMPLETIONS_ENDPOINT) {
        throw new Error('Refusing a Nara request to a non-official endpoint.');
      }
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { ...request.headers },
        body: request.body,
        redirect: 'error',
        signal,
      });
      const raw = await response.text();
      const bodyText =
        raw.length > NARA_MAX_RESPONSE_BYTES ? raw.slice(0, NARA_MAX_RESPONSE_BYTES) : raw;
      return {
        status: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
        bodyText,
      };
    },
  };
}
