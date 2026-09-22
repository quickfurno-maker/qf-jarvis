import { describe, expect, it } from 'vitest';

import { KNOWLEDGE_EMBEDDING_DIMENSION_V1 } from '@qf-jarvis/knowledge-index';

import { OpenAICompatibleEmbeddingError, createOpenAICompatibleEmbeddingPort } from '../index.js';

const vector = () => new Array<number>(KNOWLEDGE_EMBEDDING_DIMENSION_V1).fill(0.01);

describe('OpenAI-compatible embedding adapter', () => {
  it('requires HTTPS plus a credential for hosted execution and loopback for local HTTP', () => {
    expect(() =>
      createOpenAICompatibleEmbeddingPort({
        endpoint: 'http://api.example.com/v1/embeddings',
        modelRef: 'embed-v1',
        executionClass: 'HOSTED',
      }),
    ).toThrow(OpenAICompatibleEmbeddingError);
    expect(() =>
      createOpenAICompatibleEmbeddingPort({
        endpoint: 'http://10.0.0.5:8080/v1/embeddings',
        modelRef: 'embed-v1',
        executionClass: 'LOCAL',
      }),
    ).toThrow(OpenAICompatibleEmbeddingError);
    expect(() =>
      createOpenAICompatibleEmbeddingPort({
        endpoint: 'https://embed.example.com/v1/embeddings',
        modelRef: 'embed-v1',
        executionClass: 'HOSTED',
      }),
    ).toThrow(OpenAICompatibleEmbeddingError);
    expect(() =>
      createOpenAICompatibleEmbeddingPort({
        endpoint: 'https://localhost/v1/embeddings',
        modelRef: 'embed-v1',
        executionClass: 'HOSTED',
        bearerToken: 'secret-test-token',
      }),
    ).toThrow(OpenAICompatibleEmbeddingError);
  });

  it('preserves provider indexes and validates every vector dimension', async () => {
    const seen: unknown[] = [];
    const port = createOpenAICompatibleEmbeddingPort({
      endpoint: 'https://embed.example.com/v1/embeddings',
      modelRef: 'embed-v1',
      executionClass: 'HOSTED',
      bearerToken: 'secret-test-token',
      fetchImpl: (_input, init) => {
        seen.push(init);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: 'embed-v1',
              data: [
                { index: 1, embedding: vector() },
                { index: 0, embedding: vector().map((v) => v * 2) },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      },
    });
    const result = await port.embed(['alpha', 'beta']);
    expect(result).toHaveLength(2);
    expect(result[0]?.[0]).toBe(0.02);
    expect(result[1]?.[0]).toBe(0.01);
    expect(JSON.stringify(seen[0])).toContain('Bearer secret-test-token');
    expect((seen[0] as RequestInit).redirect).toBe('error');
  });

  it('fails closed on provider errors and malformed dimensions', async () => {
    const bad = createOpenAICompatibleEmbeddingPort({
      endpoint: 'https://embed.example.com/v1/embeddings',
      modelRef: 'embed-v1',
      executionClass: 'HOSTED',
      bearerToken: 'secret-test-token',
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ model: 'embed-v1', data: [{ index: 0, embedding: [1, 2] }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });
    await expect(bad.embed(['alpha'])).rejects.toMatchObject({ code: 'response-invalid' });

    const down = createOpenAICompatibleEmbeddingPort({
      endpoint: 'https://embed.example.com/v1/embeddings',
      modelRef: 'embed-v1',
      executionClass: 'HOSTED',
      bearerToken: 'secret-test-token',
      fetchImpl: () => Promise.resolve(new Response('no', { status: 503 })),
    });
    await expect(down.embed(['alpha'])).rejects.toMatchObject({ code: 'request-failed' });
  });
});

it('refuses an oversized provider response before JSON parsing', async () => {
  const port = createOpenAICompatibleEmbeddingPort({
    endpoint: 'https://embed.example.com/v1/embeddings',
    modelRef: 'embed-v1',
    executionClass: 'HOSTED',
    bearerToken: 'secret-test-token',
    fetchImpl: () =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(32_000_001) },
        }),
      ),
  });
  await expect(port.embed(['alpha'])).rejects.toMatchObject({ code: 'response-too-large' });
});
