export const TYPESAFE_SYSTEM_ONE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_MODELS_ENDPOINT = 'https://api.typesafe.ai/v1/models';
export const TYPESAFE_MAX_RESPONSE_BYTES = 1_000_000;

export interface TypeSafeHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface TypeSafeHttpResponse {
  readonly status: number;
  readonly bodyText: string;
}

export interface TypeSafeTransport {
  send(request: TypeSafeHttpRequest, signal: AbortSignal): Promise<TypeSafeHttpResponse>;
}

export function createFetchTypeSafeTransport(): TypeSafeTransport {
  return {
    async send(request: TypeSafeHttpRequest, signal: AbortSignal): Promise<TypeSafeHttpResponse> {
      if (
        request.url !== TYPESAFE_SYSTEM_ONE_ENDPOINT &&
        request.url !== TYPESAFE_MODELS_ENDPOINT
      ) {
        throw new Error('Refusing a TypeSafe request to a non-official endpoint.');
      }
      const response = await fetch(request.url, {
        method: request.body === undefined ? 'GET' : 'POST',
        headers: { ...request.headers },
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: 'error',
        signal,
      });
      const raw = await response.text();
      return {
        status: response.status,
        bodyText:
          raw.length > TYPESAFE_MAX_RESPONSE_BYTES
            ? raw.slice(0, TYPESAFE_MAX_RESPONSE_BYTES)
            : raw,
      };
    },
  };
}
