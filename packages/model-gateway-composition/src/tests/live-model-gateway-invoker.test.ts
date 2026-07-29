/**
 * QFJ-S2-B — the live `ModelGatewayInvoker` (ADR-0062 §5).
 *
 * Matrix: exactly ONE `gateway.invoke` per call; the response passes through untouched; every closed
 * gateway error code maps deterministically; a foreign thrown value becomes a fixed internal failure
 * carrying nothing; and the adapter contains no routing, retry, fallback, prompt or credential logic.
 *
 * Every test injects a scripted gateway. None touches a provider, a transport, or the network.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MODEL_GATEWAY_ERROR_CODES,
  ModelGatewayError,
  type ModelGateway,
  type ModelGatewayErrorCode,
  type ModelRequest,
  type ModelResponse,
} from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { createLiveModelGatewayInvoker } from '../live-model-gateway-invoker.js';
import { syntheticRequest } from './composition-test-support.js';

/**
 * The invoker's CODE, with documentation stripped.
 *
 * The module's own header lists what it must never do ("inspect a credential", "select a provider"), so
 * a raw-text scan would flag the prohibition as the violation. Block comments and whole-line `//`
 * comments are removed; a trailing comment is kept so nothing on a code line can hide behind one.
 */
const INVOKER_SOURCE = readFileSync(
  fileURLToPath(new URL('../live-model-gateway-invoker.ts', import.meta.url)),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');

/** The codes an operator may reasonably retry LATER. S2-B itself retries nothing. */
const TRANSIENT_CODES: readonly ModelGatewayErrorCode[] = [
  'queue-full',
  'concurrency-limit',
  'circuit-open',
  'provider-unavailable',
  'rate-limited',
  'timeout',
  'retry-budget-exhausted',
];

/** A scripted gateway that records every call. No provider, no transport, no network. */
function scriptedGateway(
  behaviour: { readonly response: ModelResponse } | { readonly throws: unknown },
): ModelGateway & { readonly calls: () => number; readonly seen: () => readonly unknown[] } {
  const state = { calls: 0, seen: [] as unknown[] };
  return {
    invoke: (request: unknown): Promise<ModelResponse> => {
      state.calls += 1;
      state.seen.push(request);
      if ('throws' in behaviour) {
        // Rejecting with an arbitrary value is deliberate: it is exactly the condition the invoker's
        // fixed internal-failure fallback must survive.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(behaviour.throws);
      }
      return Promise.resolve(behaviour.response);
    },
    calls: () => state.calls,
    seen: () => state.seen,
  };
}

function syntheticResponse(runId = 'run.s2b.synthetic.1'): ModelResponse {
  return Object.freeze({
    runId,
    resultMode: 'TEXT' as const,
    textResult: 'a synthetic draft',
    provenance: {
      runId,
      purpose: 'agent.reply',
      providerId: 'groq.staging',
      modelId: 'openai/gpt-oss-20b',
      modelVersion: '2026-07-01',
      promptId: 'qfj.s2b.synthetic',
      promptVersion: '1',
      mode: 'OFF' as const,
      usedFallback: false,
      attempts: 1,
    },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    latencyMs: 523,
    finishStatus: 'completed' as const,
  });
}

const request = syntheticRequest() as unknown as ModelRequest;

describe('(21, 22, 33, 34) one invocation, response passed through unmodified', () => {
  it('(21, 34) calls the gateway exactly once on success and never a second time', async () => {
    const gateway = scriptedGateway({ response: syntheticResponse() });
    const invoker = createLiveModelGatewayInvoker(gateway);
    const result = await invoker.invoke(request);
    expect(result.ok).toBe(true);
    expect(gateway.calls()).toBe(1);
  });

  it('(34) a failure also produces exactly one invocation — no retry loop', async () => {
    const gateway = scriptedGateway({ throws: new ModelGatewayError('timeout') });
    const result = await createLiveModelGatewayInvoker(gateway).invoke(request);
    expect(result.ok).toBe(false);
    expect(gateway.calls()).toBe(1);
  });

  it('(22) returns the exact ModelResponse object, unmodified', async () => {
    const response = syntheticResponse();
    const result = await createLiveModelGatewayInvoker(scriptedGateway({ response })).invoke(
      request,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response).toBe(response);
    expect(JSON.stringify(result.response)).toBe(JSON.stringify(response));
  });

  it('(33) request identity, timeout and budgets reach the gateway untouched', async () => {
    const gateway = scriptedGateway({ response: syntheticResponse() });
    await createLiveModelGatewayInvoker(gateway).invoke(request);
    const seen = gateway.seen()[0] as ModelRequest;
    expect(seen).toBe(request);
    expect(seen.runId).toBe('run.s2b.synthetic.1');
    expect(seen.timeoutMs).toBe(30_000);
    expect(seen.retryBudget).toBe(0);
  });
});

describe('(23, 24, 25) every closed error code maps deterministically', () => {
  it('(23) the transient map is TOTAL over MODEL_GATEWAY_ERROR_CODES', async () => {
    for (const code of MODEL_GATEWAY_ERROR_CODES) {
      const result = await createLiveModelGatewayInvoker(
        scriptedGateway({ throws: new ModelGatewayError(code) }),
      ).invoke(request);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(typeof result.transient).toBe('boolean');
      expect(result.transient).toBe(TRANSIENT_CODES.includes(code));
    }
  });

  it('(24) rate-limited is classified transient', async () => {
    const result = await createLiveModelGatewayInvoker(
      scriptedGateway({ throws: new ModelGatewayError('rate-limited') }),
    ).invoke(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(true);
  });

  it('(25) permanent failures are classified non-transient', async () => {
    for (const code of [
      'human-only',
      'request-invalid',
      'structured-output-invalid',
      'malformed-provider-output',
      'kill-switch-active',
      'capability-mismatch',
      'cancelled',
    ] as const) {
      const result = await createLiveModelGatewayInvoker(
        scriptedGateway({ throws: new ModelGatewayError(code) }),
      ).invoke(request);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.transient).toBe(false);
    }
  });

  it('classification uses the CODE, never the message text', async () => {
    // A permanent code whose message is irrelevant: `rate-limited` text cannot make it transient.
    const liar = new ModelGatewayError('human-only');
    Object.defineProperty(liar, 'message', {
      value: 'timeout rate-limited circuit-open transient',
    });
    const result = await createLiveModelGatewayInvoker(scriptedGateway({ throws: liar })).invoke(
      request,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transient).toBe(false);
  });
});

describe('(26, 27) a foreign thrown value becomes a fixed internal failure', () => {
  it('(26) maps an unknown throw to a non-transient failure', async () => {
    for (const thrown of [
      new Error('SYNTHETIC-RAW-PROVIDER-BODY'),
      'a string rejection',
      { code: 'timeout' },
      undefined,
      null,
    ]) {
      const result = await createLiveModelGatewayInvoker(
        scriptedGateway({ throws: thrown }),
      ).invoke(request);
      expect(result).toEqual({ ok: false, transient: false });
    }
  });

  it('(27) retains no message, cause, name or stack from the thrown value', async () => {
    const raw = new Error('SYNTHETIC-RAW-PROVIDER-BODY');
    raw.name = 'ProviderHttpError';
    const result = await createLiveModelGatewayInvoker(scriptedGateway({ throws: raw })).invoke(
      request,
    );
    const surface = JSON.stringify(result);
    expect(surface).not.toContain('SYNTHETIC-RAW-PROVIDER-BODY');
    expect(surface).not.toContain('ProviderHttpError');
    expect(Object.keys(result).sort()).toEqual(['ok', 'transient']);
    // A duck-typed impostor is NOT trusted as a gateway error.
    const impostor = { name: 'ModelGatewayError', code: 'timeout', message: 'x' };
    const impostorResult = await createLiveModelGatewayInvoker(
      scriptedGateway({ throws: impostor }),
    ).invoke(request);
    expect(impostorResult).toEqual({ ok: false, transient: false });
  });
});

describe('(28, 29, 30, 31, 32) the adapter contains no second router', () => {
  it('performs no selection, retry, fallback, prompt resolution or credential access', () => {
    for (const forbidden of [
      'selectProviders',
      'buildRoutingPlan',
      'decideFallover',
      'AttemptLedger',
      'CircuitBreaker',
      'createProviderRolloutController',
      'transition(',
      'promptId',
      'promptVersion',
      'resolve(',
      'credential',
      'apiKey',
    ]) {
      expect(INVOKER_SOURCE).not.toContain(forbidden);
    }
    expect(INVOKER_SOURCE).not.toMatch(/process\s*\.\s*env/);
    expect(INVOKER_SOURCE).not.toMatch(/\bfetch\s*\(/);
    expect(INVOKER_SOURCE).not.toMatch(/from ['"]node:/);
    // Exactly one call site, and no loop of any kind around it.
    expect(INVOKER_SOURCE.match(/gateway\.invoke\(/g)).toHaveLength(1);
    expect(INVOKER_SOURCE).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\.map\(|\.reduce\(/);
  });

  it('logs no request content and no model output', () => {
    expect(INVOKER_SOURCE).not.toMatch(/console\./);
    expect(INVOKER_SOURCE).not.toMatch(/\.messages\b/);
    expect(INVOKER_SOURCE).not.toMatch(/textResult|structuredResult/);
  });

  it('the returned invoker exposes no accessor beyond the interface', () => {
    const invoker = createLiveModelGatewayInvoker(
      scriptedGateway({ response: syntheticResponse() }),
    );
    expect(Object.keys(invoker)).toEqual(['invoke']);
    expect(Object.isFrozen(invoker)).toBe(true);
  });
});
