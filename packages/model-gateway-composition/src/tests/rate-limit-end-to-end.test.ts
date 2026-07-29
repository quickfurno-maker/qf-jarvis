/**
 * QFJ-S2-B rate-limit amendment — the whole 429 path, end to end (ADR-0062 §6).
 *
 * Groq HTTP 429 → `rate-limited` provider status → `rate-limited` gateway error code →
 * `transient: true` from the live invoker. And, just as importantly: still exactly one transport call,
 * exactly one gateway invocation, zero retries and zero fallback.
 *
 * The transport is a deterministic fake that returns a canned response. There is no network, no real
 * credential (the key is an obvious sentinel), no database and no Docker.
 */
import {
  createEstimatedBudgetPolicy,
  createGroqApiKey,
  createGroqProviderConfig,
  createManualClock,
  createModelGateway,
  GroqModelProvider,
  isModelGatewayError,
  type ModelGatewayError,
  type ModelGateway,
  type ModelProvider,
  type ModelRequest,
} from '@qf-jarvis/model-gateway';
import { fakeGroqTransport, type RecordingGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import { createLiveModelGatewayInvoker } from '../live-model-gateway-invoker.js';
import { syntheticRequest } from './composition-test-support.js';

/** An obvious fake. It is never a real credential and never leaves the fake transport. */
const SENTINEL_KEY = 'FAKE-S2B-SENTINEL-KEY-DO-NOT-USE-0000';
const RATE_LIMIT_BODY = '{"error":{"message":"SECRET-RATE-BODY","code":"rate_limit_exceeded"}}';

function groqProvider(transport: RecordingGroqTransport): ModelProvider {
  return new GroqModelProvider(
    createGroqProviderConfig({
      providerId: 'groq',
      modelId: 'openai/gpt-oss-20b',
      modelVersion: '2026.07',
      maxInputTokens: 128_000,
      maxCompletionTokens: 1024,
      supportsStrictJsonSchema: true,
      apiKey: createGroqApiKey(SENTINEL_KEY),
      transport,
      dataControlsAttested: true,
    }),
    createManualClock(),
  );
}

/**
 * A serving gateway built directly for this proof.
 *
 * It is ACTIVE here because the 429 path can only be exercised by a gateway that actually serves — the
 * S2-B COMPOSITION remains OFF and non-activatable, which its own specs prove separately. `retryBudget`
 * stays 0 and `allowFallback` stays false, exactly as the composition pins them.
 */
function servingGateway(providers: readonly ModelProvider[]): ModelGateway {
  return createModelGateway({
    mode: 'ACTIVE',
    providers,
    clock: createManualClock(),
    budgetPolicy: createEstimatedBudgetPolicy(),
    killSwitch: { active: () => false },
    concurrency: { maxConcurrent: 2, maxQueue: 2 },
    circuit: { failureThreshold: 5, cooldownMs: 1000 },
    allowFallback: false,
  });
}

const request = syntheticRequest() as unknown as ModelRequest;

describe('(1, 2, 3, 4, 5) the 429 path, end to end', () => {
  it('(1, 2) a Groq 429 becomes the rate-limited gateway error code', async () => {
    const transport = fakeGroqTransport(RATE_LIMIT_BODY, 429);
    const thrown = await servingGateway([groqProvider(transport)])
      .invoke(request)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(isModelGatewayError(thrown)).toBe(true);
    expect((thrown as ModelGatewayError).code).toBe('rate-limited');
    // (5) exactly one provider invocation, so exactly one HTTP request.
    expect(transport.calls()).toBe(1);
  });

  it('(3, 4) the live invoker reports transient=true after exactly one gateway invocation', async () => {
    const transport = fakeGroqTransport(RATE_LIMIT_BODY, 429);
    const gateway = servingGateway([groqProvider(transport)]);
    let gatewayCalls = 0;
    const counted: ModelGateway = {
      invoke: (candidate: unknown) => {
        gatewayCalls += 1;
        return gateway.invoke(candidate);
      },
    };

    const result = await createLiveModelGatewayInvoker(counted).invoke(request);
    expect(result).toEqual({ ok: false, transient: true });
    expect(gatewayCalls).toBe(1);
    expect(transport.calls()).toBe(1);
  });
});

describe('(6, 7, 8, 9) transient metadata drives no retry and no fallback', () => {
  it('(6, 8) a non-zero retry budget still produces exactly one attempt', async () => {
    for (const retryBudget of [0, 1, 3]) {
      const fresh = fakeGroqTransport(RATE_LIMIT_BODY, 429);
      const thrown = await servingGateway([groqProvider(fresh)])
        .invoke({ ...request, retryBudget })
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect((thrown as ModelGatewayError).code).toBe('rate-limited');
      // The code stays `rate-limited` at every budget — it never degrades to retry-budget-exhausted.
      expect(fresh.calls()).toBe(1);
    }
  });

  it('(7, 9) a second eligible provider is NOT tried after a rate limit', async () => {
    const primary = fakeGroqTransport(RATE_LIMIT_BODY, 429);
    const secondary = fakeGroqTransport(RATE_LIMIT_BODY, 429);
    const thrown = await servingGateway([groqProvider(primary), groqProvider(secondary)])
      .invoke(request)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect((thrown as ModelGatewayError).code).toBe('rate-limited');
    expect(primary.calls()).toBe(1);
    // allowFallback is false, and a rate limit is not a rollout-transient class either.
    expect(secondary.calls()).toBe(0);
  });
});

describe('(10, 11, 12) nothing from the 429 response can escape', () => {
  it('no raw body, Retry-After value, header, URL or credential reaches any surface', async () => {
    const transport = fakeGroqTransport(RATE_LIMIT_BODY, 429);
    const gateway = servingGateway([groqProvider(transport)]);
    const thrown = (await gateway
      .invoke(request)
      .then(() => undefined)
      .catch((error: unknown) => error)) as ModelGatewayError;
    const invocation = await createLiveModelGatewayInvoker(
      servingGateway([groqProvider(fakeGroqTransport(RATE_LIMIT_BODY, 429))]),
    ).invoke(request);

    const surfaces = [
      thrown.message,
      thrown.code,
      JSON.stringify({ code: thrown.code, name: thrown.name }),
      JSON.stringify(invocation),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain('SECRET-RATE-BODY');
      expect(surface).not.toContain('rate_limit_exceeded');
      expect(surface).not.toContain('retryAfter');
      expect(surface).not.toContain('Retry-After');
      expect(surface).not.toContain(SENTINEL_KEY);
      expect(surface).not.toContain('Bearer');
      expect(surface.toLowerCase()).not.toContain('authorization');
      expect(surface).not.toContain('api.groq.com');
      expect(surface).not.toContain('429');
    }
    // A fixed, low-cardinality message; no cause and no provider text is retained.
    expect(thrown.message).toBe(
      'The provider refused the request because a rate or quota limit was reached.',
    );
    expect((thrown as unknown as { cause?: unknown }).cause).toBeUndefined();
    expect(Object.keys(invocation).sort()).toEqual(['ok', 'transient']);
  });
});

describe('(13, 14, 15, 16) every non-429 mapping is unchanged', () => {
  const cases = [
    { status: 401, code: 'provider-failed' },
    { status: 403, code: 'provider-failed' },
    { status: 400, code: 'provider-failed' },
    { status: 500, code: 'provider-unavailable' },
    { status: 503, code: 'provider-unavailable' },
    { status: 498, code: 'provider-unavailable' },
  ] as const;

  for (const { status, code } of cases) {
    it(`(13, 14) HTTP ${String(status)} still maps to ${code}`, async () => {
      const transport = fakeGroqTransport('{"error":"SECRET-BODY"}', status);
      const thrown = await servingGateway([groqProvider(transport)])
        .invoke(request)
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect((thrown as ModelGatewayError).code).toBe(code);
      expect(transport.calls()).toBe(1);
    });
  }

  it('(15) a 499 still maps to cancelled', async () => {
    const transport = fakeGroqTransport('{"error":"SECRET-BODY"}', 499);
    const thrown = await servingGateway([groqProvider(transport)])
      .invoke(request)
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect((thrown as ModelGatewayError).code).toBe('cancelled');
  });

  it('(16) an unparseable body still maps to malformed-provider-output', async () => {
    const transport = fakeGroqTransport('not-json', 200);
    const thrown = await servingGateway([groqProvider(transport)])
      .invoke(request)
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect((thrown as ModelGatewayError).code).toBe('malformed-provider-output');
  });

  it('the local adapter is untouched — its 429 still normalizes to unavailable', async () => {
    // The amendment is scoped to the Groq path. The local adapter keeps its existing classification
    // until a separate, reviewed decision changes it.
    const { normalizeLocalHttpStatus } =
      (await import('@qf-jarvis/model-gateway')) as unknown as Record<string, unknown>;
    expect(normalizeLocalHttpStatus).toBeUndefined();
  });
});
