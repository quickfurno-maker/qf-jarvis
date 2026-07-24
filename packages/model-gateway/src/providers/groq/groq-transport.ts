/**
 * The Groq HTTP transport boundary (QFJ-P04.01B, ADR-0046).
 *
 * The adapter performs exactly ONE HTTP request per invocation through an INJECTED transport. Tests
 * inject a deterministic transport and make no external request. The production transport
 * ({@link createFetchGroqTransport}) is the ONE place in this package that touches the network: it uses
 * the platform `fetch`, targets ONLY the fixed official Groq endpoint (no arbitrary base URL — an SSRF
 * guard rejects any other origin and follows no redirect), and bounds the response size before reading.
 * The transport never retries and never sleeps — the gateway owns retry/backoff/timeout.
 */

/** The fixed, official Groq OpenAI-compatible Chat Completions endpoint. Not overridable. */
export const GROQ_CHAT_COMPLETIONS_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** The maximum response body the transport will read before rejecting (bounded parse). */
export const GROQ_MAX_RESPONSE_BYTES = 1_000_000;

/** A bounded HTTP request the adapter hands the transport. */
export interface GroqHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A bounded HTTP response the transport returns. Only the status, a small header subset, and text. */
export interface GroqHttpResponse {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly bodyText: string;
}

/** The injected transport. `send` performs one request and resolves a bounded response, or rejects. */
export interface GroqTransport {
  send(request: GroqHttpRequest, signal: AbortSignal): Promise<GroqHttpResponse>;
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
 * The production transport: a single `fetch` to the fixed Groq endpoint. It refuses any URL other than
 * the official endpoint (SSRF guard), disables redirects, reads at most {@link GROQ_MAX_RESPONSE_BYTES},
 * and never retries. Never used by tests. Reads no environment.
 */
export function createFetchGroqTransport(): GroqTransport {
  return {
    async send(request: GroqHttpRequest, signal: AbortSignal): Promise<GroqHttpResponse> {
      if (request.url !== GROQ_CHAT_COMPLETIONS_ENDPOINT) {
        throw new Error('Refusing a Groq request to a non-official endpoint.');
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
        raw.length > GROQ_MAX_RESPONSE_BYTES ? raw.slice(0, GROQ_MAX_RESPONSE_BYTES) : raw;
      return {
        status: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
        bodyText,
      };
    },
  };
}
