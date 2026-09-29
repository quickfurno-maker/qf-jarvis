import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createSystemOneDecisionRequest } from '@qf-jarvis/system-one-decision-runtime';

import {
  TYPESAFE_JEV_SYSTEM_ONE_ENDPOINT,
  createTypeSafeApiKey,
  createTypeSafeJevDecisionEngine,
  type TypeSafeJevHttpRequest,
  type TypeSafeJevTransport,
} from '../index.js';

function request() {
  return createSystemOneDecisionRequest({
    runId: 'run.jev.adapter.1',
    actorRef: 'agent.riya',
    purposeRef: 'decision.turn-routing.v1',
    dataClass: 'MINIMIZED_BUSINESS',
    mode: 'SHADOW',
    state: { message: 'I want to join as a vendor.' },
    questions: {
      route: {
        type: 'choice',
        instructions: 'Choose the best specialist.',
        criteria: { RIYA: 'client', ANISHA: 'vendor', AAROHI: 'prospect' },
      },
      review: { type: 'noul', instructions: 'Needs review?' },
      urgency: {
        type: 'score',
        instructions: 'Rate urgency.',
        criteria: ['low', 'medium', 'high'],
      },
    },
    timeoutMs: 2_000,
  });
}

describe('TypeSafe Jev adapter', () => {
  it('sends one official System-One request and returns advisory typed answers', async () => {
    const sent: TypeSafeJevHttpRequest[] = [];
    const transport: TypeSafeJevTransport = {
      send(input) {
        sent.push(input);
        return Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({
            model: 'jev-1.13.0',
            answers: {
              route: {
                type: 'choice',
                choice: 'ANISHA',
                confidence: 0.96,
                probabilities: { RIYA: 0.02, ANISHA: 0.96, AAROHI: 0.02 },
              },
              review: { type: 'noul', noul: 0.12 },
              urgency: {
                type: 'score',
                score: 1.2,
                confidence: 0.88,
                legend: { 0: 'low', 1: 'medium', 2: 'high' },
                probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 },
              },
            },
            usage: { input_tokens: 120, output_tokens: 12 },
          }),
        });
      },
    };
    const engine = createTypeSafeJevDecisionEngine({
      model: 'jev-latest',
      apiKey: createTypeSafeApiKey('FAKE_DO_NOT_USE_TYPESAFE_KEY_1234567890'),
      transport,
    });
    const result = await engine.evaluate(request(), new AbortController().signal);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(TYPESAFE_JEV_SYSTEM_ONE_ENDPOINT);
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual({
      model: 'jev-latest',
      state: { message: 'I want to join as a vendor.' },
      questions: request().questions,
    });
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('expected completed result');
    expect(result.model).toBe('jev-1.13.0');
    expect(result.answers['route']).toMatchObject({ type: 'choice', choice: 'ANISHA' });
    expect(result.authority).toEqual({
      businessAuthority: false,
      approvalGranted: false,
      executionAuthorized: false,
    });
  });

  it('redacts the API key from string, JSON and node inspection', () => {
    const key = createTypeSafeApiKey('FAKE_DO_NOT_USE_TYPESAFE_KEY_ABCDEFGHIJK');
    expect(String(key)).toBe('[REDACTED_TYPESAFE_API_KEY]');
    expect(JSON.stringify(key)).toBe('"[REDACTED_TYPESAFE_API_KEY]"');
    expect(inspect(key)).toBe('[REDACTED_TYPESAFE_API_KEY]');
  });

  it('fails closed on type mismatches and probability/key drift', async () => {
    const transport: TypeSafeJevTransport = {
      send() {
        return Promise.resolve({
          status: 200,
          bodyText: JSON.stringify({
            model: 'jev-1.13.0',
            answers: {
              route: {
                type: 'choice',
                choice: 'ANISHA',
                confidence: 0.9,
                probabilities: { ANISHA: 1 },
              },
              review: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } },
              urgency: {
                type: 'score',
                score: 2,
                confidence: 1,
                legend: { 0: 'low', 1: 'medium', 2: 'high' },
                probabilities: { 0: 0, 1: 0, 2: 1 },
              },
            },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        });
      },
    };
    const engine = createTypeSafeJevDecisionEngine({
      model: 'jev-latest',
      apiKey: createTypeSafeApiKey('FAKE_DO_NOT_USE_TYPESAFE_KEY_ZYXWVUTSRQP'),
      transport,
    });
    await expect(engine.evaluate(request(), new AbortController().signal)).resolves.toEqual({
      status: 'malformed',
    });
  });

  it('normalizes provider failures without retries or leaked bodies', async () => {
    for (const [status, expected] of [
      [408, 'timeout'],
      [429, 'rate-limited'],
      [503, 'unavailable'],
      [401, 'failed'],
    ] as const) {
      let calls = 0;
      const engine = createTypeSafeJevDecisionEngine({
        model: 'jev-latest',
        apiKey: createTypeSafeApiKey('FAKE_DO_NOT_USE_TYPESAFE_KEY_PROVIDER_ERROR'),
        transport: {
          send() {
            calls += 1;
            return Promise.resolve({ status, bodyText: 'SECRET-SHAPED-REMOTE-BODY' });
          },
        },
      });
      const result = await engine.evaluate(request(), new AbortController().signal);
      expect(result).toEqual({ status: expected });
      expect(calls).toBe(1);
      expect(JSON.stringify(result)).not.toContain('SECRET-SHAPED-REMOTE-BODY');
    }
  });

  it('distinguishes caller cancellation from the bounded request timeout', async () => {
    const controller = new AbortController();
    const engine = createTypeSafeJevDecisionEngine({
      model: 'jev-latest',
      apiKey: createTypeSafeApiKey('FAKE_DO_NOT_USE_TYPESAFE_KEY_CANCEL'),
      transport: {
        send(_request, signal) {
          return new Promise((_, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                reject(new Error('aborted'));
              },
              { once: true },
            );
            controller.abort();
          });
        },
      },
    });
    await expect(engine.evaluate(request(), controller.signal)).resolves.toEqual({
      status: 'cancelled',
    });
  });
});
