import {
  KNOWLEDGE_EMBEDDING_DIMENSION_V1,
  type EmbeddingExecutionClass,
  type KnowledgeEmbeddingPort,
} from '@qf-jarvis/knowledge-index';

export const OPENAI_COMPATIBLE_EMBEDDING_ERROR_CODES = [
  'invalid-config',
  'invalid-input',
  'request-failed',
  'response-too-large',
  'response-invalid',
] as const;
export type OpenAICompatibleEmbeddingErrorCode =
  (typeof OPENAI_COMPATIBLE_EMBEDDING_ERROR_CODES)[number];

export class OpenAICompatibleEmbeddingError extends Error {
  readonly code: OpenAICompatibleEmbeddingErrorCode;

  constructor(code: OpenAICompatibleEmbeddingErrorCode) {
    super(code);
    this.name = 'OpenAICompatibleEmbeddingError';
    this.code = code;
  }
}

export const MAX_OPENAI_COMPATIBLE_EMBEDDING_RESPONSE_CHARS = 32_000_000;

export interface OpenAICompatibleEmbeddingAdapterConfig {
  readonly endpoint: string;
  readonly modelRef: string;
  readonly executionClass: EmbeddingExecutionClass;
  readonly bearerToken?: string;
  readonly timeoutMs?: number;
  readonly maxBatchItems?: number;
  readonly maxInputChars?: number;
  readonly fetchImpl?: typeof fetch;
}

function isLoopback(hostname: string): boolean {
  const h = hostname.toLocaleLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function validatedUrl(raw: string, executionClass: EmbeddingExecutionClass): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OpenAICompatibleEmbeddingError('invalid-config');
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !url.pathname.endsWith('/embeddings')
  ) {
    throw new OpenAICompatibleEmbeddingError('invalid-config');
  }
  if (executionClass === 'HOSTED' && (url.protocol !== 'https:' || isLoopback(url.hostname))) {
    throw new OpenAICompatibleEmbeddingError('invalid-config');
  }
  if (
    executionClass === 'LOCAL' &&
    !((url.protocol === 'http:' || url.protocol === 'https:') && isLoopback(url.hostname))
  ) {
    throw new OpenAICompatibleEmbeddingError('invalid-config');
  }
  return url;
}

function parseEmbeddingResponse(
  value: unknown,
  expectedModel: string,
  expectedCount: number,
): readonly (readonly number[])[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OpenAICompatibleEmbeddingError('response-invalid');
  }
  const root = value as { readonly model?: unknown; readonly data?: unknown };
  if (
    root.model !== expectedModel ||
    !Array.isArray(root.data) ||
    root.data.length !== expectedCount
  ) {
    throw new OpenAICompatibleEmbeddingError('response-invalid');
  }

  const byIndex = new Map<number, readonly number[]>();
  for (const item of root.data) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new OpenAICompatibleEmbeddingError('response-invalid');
    }
    const row = item as { readonly index?: unknown; readonly embedding?: unknown };
    if (
      typeof row.index !== 'number' ||
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= expectedCount ||
      byIndex.has(row.index) ||
      !Array.isArray(row.embedding) ||
      row.embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSION_V1 ||
      row.embedding.some((one) => typeof one !== 'number' || !Number.isFinite(one))
    ) {
      throw new OpenAICompatibleEmbeddingError('response-invalid');
    }
    byIndex.set(row.index, Object.freeze([...(row.embedding as number[])]));
  }

  const ordered: (readonly number[])[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const vector = byIndex.get(index);
    if (vector === undefined) throw new OpenAICompatibleEmbeddingError('response-invalid');
    ordered.push(vector);
  }
  return Object.freeze(ordered);
}

export function createOpenAICompatibleEmbeddingPort(
  config: OpenAICompatibleEmbeddingAdapterConfig,
): KnowledgeEmbeddingPort {
  const endpoint = validatedUrl(config.endpoint, config.executionClass);
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20_000;
  const maxBatchItems = config.maxBatchItems ?? 128;
  const maxInputChars = config.maxInputChars ?? 200_000;
  const bearerToken = config.bearerToken;
  if (
    !/^[A-Za-z0-9._:/-]{1,256}$/u.test(config.modelRef) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 120_000 ||
    !Number.isInteger(maxBatchItems) ||
    maxBatchItems < 1 ||
    maxBatchItems > 512 ||
    !Number.isInteger(maxInputChars) ||
    maxInputChars < 1 ||
    maxInputChars > 2_000_000 ||
    (config.executionClass === 'HOSTED' && (bearerToken === undefined || bearerToken.length < 8)) ||
    (bearerToken !== undefined &&
      (bearerToken.length < 8 || bearerToken.length > 8192 || bearerToken.trim() !== bearerToken))
  ) {
    throw new OpenAICompatibleEmbeddingError('invalid-config');
  }

  return Object.freeze({
    modelRef: config.modelRef,
    dimension: KNOWLEDGE_EMBEDDING_DIMENSION_V1,
    executionClass: config.executionClass,
    async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
      if (
        texts.length < 1 ||
        texts.length > maxBatchItems ||
        texts.some((text) => typeof text !== 'string' || text.length < 1) ||
        texts.reduce((sum, text) => sum + text.length, 0) > maxInputChars
      ) {
        throw new OpenAICompatibleEmbeddingError('invalid-input');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(bearerToken === undefined ? {} : { authorization: 'Bearer ' + bearerToken }),
          },
          body: JSON.stringify({
            model: config.modelRef,
            input: [...texts],
            encoding_format: 'float',
          }),
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) throw new OpenAICompatibleEmbeddingError('request-failed');

        const declaredLength = response.headers.get('content-length');
        if (declaredLength !== null) {
          const bytes = Number(declaredLength);
          if (!Number.isFinite(bytes) || bytes < 0) {
            throw new OpenAICompatibleEmbeddingError('response-invalid');
          }
          if (bytes > MAX_OPENAI_COMPATIBLE_EMBEDDING_RESPONSE_CHARS) {
            throw new OpenAICompatibleEmbeddingError('response-too-large');
          }
        }

        const raw = await response.text();
        if (raw.length > MAX_OPENAI_COMPATIBLE_EMBEDDING_RESPONSE_CHARS) {
          throw new OpenAICompatibleEmbeddingError('response-too-large');
        }
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new OpenAICompatibleEmbeddingError('response-invalid');
        }
        return parseEmbeddingResponse(body, config.modelRef, texts.length);
      } catch (error) {
        if (error instanceof OpenAICompatibleEmbeddingError) throw error;
        throw new OpenAICompatibleEmbeddingError('request-failed');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
