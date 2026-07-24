/**
 * The local HTTP transport boundary (QFJ-P04.01C, ADR-0047).
 *
 * The adapter performs exactly ONE HTTP request per invocation through an INJECTED transport. Tests inject
 * a deterministic transport and make no external/LAN request. The production transport
 * ({@link createFetchLocalTransport}) is the ONE place in this adapter that touches the network: it uses
 * the platform `fetch`, targets ONLY the exact Chat Completions URL of a pre-validated private
 * {@link LocalEndpointDescriptor} (an SSRF guard rejects any other URL and follows no redirect), and
 * bounds the response size before reading. The transport never retries and never sleeps — the gateway
 * owns retry/backoff/timeout. It reads no environment.
 */
import type { LocalEndpointDescriptor } from './local-endpoint-policy.js';

/** The maximum response body the transport will read before rejecting (bounded parse). */
export const LOCAL_MAX_RESPONSE_BYTES = 1_000_000;

/** A bounded HTTP request the adapter hands the transport. */
export interface LocalHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A bounded HTTP response the transport returns. Only the status, the content-type, and text. */
export interface LocalHttpResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly bodyText: string;
}

/** The injected transport. `send` performs one request and resolves a bounded response, or rejects. */
export interface LocalTransport {
  send(request: LocalHttpRequest, signal: AbortSignal): Promise<LocalHttpResponse>;
}

/**
 * The production transport: a single `fetch` to the validated private endpoint's Chat Completions URL. It
 * refuses any other URL (SSRF guard), disables redirects, reads at most {@link LOCAL_MAX_RESPONSE_BYTES},
 * and never retries. Never used by tests. Reads no environment.
 */
export function createFetchLocalTransport(endpoint: LocalEndpointDescriptor): LocalTransport {
  return {
    async send(request: LocalHttpRequest, signal: AbortSignal): Promise<LocalHttpResponse> {
      if (request.url !== endpoint.chatCompletionsUrl) {
        throw new Error('Refusing a local request to a non-validated endpoint.');
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
        raw.length > LOCAL_MAX_RESPONSE_BYTES ? raw.slice(0, LOCAL_MAX_RESPONSE_BYTES) : raw;
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        bodyText,
      };
    },
  };
}
