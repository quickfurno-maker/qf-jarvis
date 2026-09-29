import { describe, expect, it } from 'vitest';
import { createJarvisDecisionPreflight } from '@qf-jarvis/decision-intelligence';
import {
  JevDecisionProvider,
  TYPESAFE_MODELS_ENDPOINT,
  createJevDecisionShadowPort,
  TYPESAFE_SYSTEM_ONE_ENDPOINT,
  createTypeSafeApiKey,
  type TypeSafeHttpRequest,
  type TypeSafeTransport,
} from '../index.js';

class CapturingTransport implements TypeSafeTransport {
  public readonly requests: TypeSafeHttpRequest[] = [];
  public response: { status: number; bodyText: string } = {
    status: 200,
    bodyText: JSON.stringify({
      model: 'jev-2026-09-15',
      answers: {
        task_shape: {
          type: 'choice',
          choice: 'RETRIEVAL',
          confidence: 0.94,
          probabilities: { RETRIEVAL: 0.94, DIRECT_RESPONSE: 0.06 },
        },
        ambiguity: {
          type: 'score',
          score: 0.2,
          confidence: 0.9,
          legend: { '0': 'Clear', '1': 'Minor' },
          probabilities: { '0': 0.8, '1': 0.2 },
        },
        human_review: { type: 'noul', noul: 0.05 },
      },
      usage: { input_tokens: 50, output_tokens: 3 },
    }),
  };

  public send(request: TypeSafeHttpRequest): Promise<{ status: number; bodyText: string }> {
    this.requests.push(request);
    return Promise.resolve(this.response);
  }
}

describe('Jev decision adapter', () => {
  it('maps neutral questions to the official System One API and maps typed answers back', async () => {
    const transport = new CapturingTransport();
    const key = createTypeSafeApiKey('sentinel-secret');
    const provider = new JevDecisionProvider({ model: 'jev-latest', apiKey: key, transport });
    const preflight = createJarvisDecisionPreflight({
      actorRef: 'RIYA',
      dataClass: 'HOSTED_ALLOWED',
      state: { message: 'Where is my order?' },
    });
    const result = await provider.decide(preflight.request, new AbortController().signal);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe(TYPESAFE_SYSTEM_ONE_ENDPOINT);
    expect(transport.requests[0]?.headers['authorization']).toBe('Bearer sentinel-secret');
    expect(JSON.parse(transport.requests[0]?.body ?? '{}')).toMatchObject({
      model: 'jev-latest',
      questions: {
        task_shape: { type: 'choice' },
        ambiguity: { type: 'score' },
        human_review: { type: 'noul' },
      },
    });
    expect(result).toMatchObject({
      providerId: 'typesafe-jev',
      model: 'jev-2026-09-15',
      answers: {
        task_shape: { type: 'CHOICE', choice: 'RETRIEVAL', confidence: 0.94 },
        ambiguity: { type: 'SCORE', score: 0.2, confidence: 0.9 },
        human_review: { type: 'BOOLEAN', probability: 0.05 },
      },
    });
    expect(String(key)).toBe('[REDACTED_TYPESAFE_API_KEY]');
    expect(JSON.stringify(key)).not.toContain('sentinel-secret');
  });

  it('discovers authenticated model names through the fixed models endpoint', async () => {
    const transport = new CapturingTransport();
    transport.response = {
      status: 200,
      bodyText: JSON.stringify({ models: [{ name: 'jev-latest' }, { name: 'jev-2026-09-15' }] }),
    };
    const provider = new JevDecisionProvider({
      model: 'jev-latest',
      apiKey: createTypeSafeApiKey('sentinel'),
      transport,
    });
    await expect(provider.listModels(new AbortController().signal)).resolves.toStrictEqual([
      'jev-latest',
      'jev-2026-09-15',
    ]);
    expect(transport.requests[0]?.url).toBe(TYPESAFE_MODELS_ENDPOINT);
    expect(transport.requests[0]?.body).toBeUndefined();
  });

  it('refuses non-hosted data classes before the transport', async () => {
    const transport = new CapturingTransport();
    const provider = new JevDecisionProvider({
      model: 'jev-latest',
      apiKey: createTypeSafeApiKey('sentinel'),
      transport,
    });
    await expect(
      provider.decide(
        {
          dataClass: 'LOCAL_ONLY',
          state: 'secret',
          questions: { q: { type: 'BOOLEAN', instructions: 'Is this relevant?' } },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('jev-data-class-refused');
    expect(transport.requests).toHaveLength(0);
  });

  it('drops saturated shadow observations instead of queueing customer work', async () => {
    let release: (() => void) | undefined;
    const transport: TypeSafeTransport = {
      async send(request) {
        if (request.url === TYPESAFE_MODELS_ENDPOINT) {
          return { status: 200, bodyText: JSON.stringify({ models: [{ name: 'jev-latest' }] }) };
        }
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new CapturingTransport().response;
      },
    };
    const provider = new JevDecisionProvider({
      model: 'jev-latest',
      apiKey: createTypeSafeApiKey('sentinel'),
      transport,
    });
    const shadow = createJevDecisionShadowPort({ provider, maxConcurrent: 1, timeoutMs: 5_000 });
    const first = shadow.observe({
      actorRef: 'RIYA',
      dataClass: 'HOSTED_ALLOWED',
      taskClass: 'RESPONSE_GENERATION',
      normalizedText: 'first',
    });
    await Promise.resolve();
    await expect(
      shadow.observe({
        actorRef: 'ANISHA',
        dataClass: 'HOSTED_ALLOWED',
        taskClass: 'RESPONSE_GENERATION',
        normalizedText: 'second',
      }),
    ).resolves.toBeUndefined();
    expect(release).toBeTypeOf('function');
    release?.();
    await first;
  });

  it('rejects malformed provider answers rather than guessing', async () => {
    const transport = new CapturingTransport();
    transport.response = {
      status: 200,
      bodyText: JSON.stringify({
        model: 'jev-latest',
        answers: {
          q: { type: 'choice', choice: 'X', confidence: 2, probabilities: { X: 1 } },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    };
    const provider = new JevDecisionProvider({
      model: 'jev-latest',
      apiKey: createTypeSafeApiKey('sentinel'),
      transport,
    });
    await expect(
      provider.decide(
        {
          dataClass: 'HOSTED_ALLOWED',
          state: 'state',
          questions: {
            q: {
              type: 'CHOICE',
              instructions: 'Choose.',
              criteria: { X: 'x', Y: 'y' },
            },
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('jev-response-malformed');
  });
});
