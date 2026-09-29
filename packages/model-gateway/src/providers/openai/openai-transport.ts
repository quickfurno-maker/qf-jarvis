/**
 * Fixed-endpoint OpenAI Responses API transport.
 *
 * One request per invocation, no retries, no redirects, bounded response read, and no environment
 * access. The adapter cannot be pointed at an arbitrary origin.
 */
export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const OPENAI_MAX_RESPONSE_BYTES = 1_000_000;

export interface OpenAIHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface OpenAIHttpResponse {
  readonly status: number;
  readonly bodyText: string;
}

export interface OpenAITransport {
  send(request: OpenAIHttpRequest, signal: AbortSignal): Promise<OpenAIHttpResponse>;
}

export function createFetchOpenAITransport(): OpenAITransport {
  return {
    async send(request: OpenAIHttpRequest, signal: AbortSignal): Promise<OpenAIHttpResponse> {
      if (request.url !== OPENAI_RESPONSES_ENDPOINT) {
        throw new Error('Refusing an OpenAI request to a non-official endpoint.');
      }
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { ...request.headers },
        body: request.body,
        redirect: 'error',
        signal,
      });
      const raw = await response.text();
      return {
        status: response.status,
        bodyText:
          raw.length > OPENAI_MAX_RESPONSE_BYTES ? raw.slice(0, OPENAI_MAX_RESPONSE_BYTES) : raw,
      };
    },
  };
}
