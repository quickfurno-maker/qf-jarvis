/**
 * QFJ-S1A — one-shot behaviour, timeout ownership, and zero retry (ADR-0061 §C, §F, §G).
 *
 * Matrix: the fixed synthetic prompt cannot be overridden; bind, credential read, invocation, and HTTP
 * request each happen at most ONCE; no retry occurs on a 429, a 5xx, or a network failure; the result is
 * final and frozen after the first outcome; there is no chat loop or second-invocation surface; the
 * harness-owned timer is always cleared; a fired timer aborts the in-flight request; and an abort that
 * lands before the invocation produces zero transport calls.
 */
import { createManualClock, type GroqTransport } from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import {
  GROQ_CHAT_COMPLETIONS_ENDPOINT_FOR_TEST,
  runOnce,
  validConfig,
} from './smoke-test-support.js';
import {
  parseSmokeArgv,
  runGroqStagingSmokeOnce,
  SYNTHETIC_SMOKE_MESSAGES,
  type SmokeTimer,
} from '../index.js';
import * as barrel from '../index.js';
import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
} from '../testing/index.js';

// The raw HTTP request/response types stay INTERNAL to the model gateway by design, so the fakes below
// derive the parameter type from the exported transport interface rather than importing them.
type GroqRequestParam = Parameters<GroqTransport['send']>[0];

/** A transport that never settles until the signal aborts. Records its call count. NO network. */
function hangingTransport(): GroqTransport & { readonly calls: () => number } {
  const state = { calls: 0 };
  return {
    calls: () => state.calls,
    send(_request: GroqRequestParam, signal: AbortSignal): Promise<never> {
      state.calls += 1;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new Error('SYNTHETIC-ABORTED'));
          },
          { once: true },
        );
      });
    },
  };
}

/** A transport that rejects immediately, modelling a DNS/TLS/connect failure. NO network. */
function failingTransport(): GroqTransport & { readonly calls: () => number } {
  const state = { calls: 0 };
  return {
    calls: () => state.calls,
    send(): Promise<never> {
      state.calls += 1;
      return Promise.reject(new Error('SYNTHETIC-NETWORK-FAILURE'));
    },
  };
}

describe('(27) the fixed synthetic prompt cannot be overridden', () => {
  it('sends exactly the compiled-in messages and the strict schema', async () => {
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runOnce({ transport });
    expect(result.ok).toBe(true);

    const request = transport.lastRequest();
    expect(request?.url).toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT_FOR_TEST);
    const body = JSON.parse(request?.body ?? '{}') as Record<string, unknown>;
    expect(body['messages']).toEqual(SYNTHETIC_SMOKE_MESSAGES);
    expect(body['stream']).toBe(false);
    expect(body['n']).toBe(1);
    expect((body['response_format'] as { type?: string }).type).toBe('json_schema');
    for (const forbidden of ['tools', 'tool_choice', 'logprobs', 'logit_bias', 'top_logprobs']) {
      expect(body[forbidden]).toBeUndefined();
    }
  });

  it('the prompt literal is frozen, element-wise', () => {
    expect(Object.isFrozen(SYNTHETIC_SMOKE_MESSAGES)).toBe(true);
    for (const message of SYNTHETIC_SMOKE_MESSAGES) {
      expect(Object.isFrozen(message)).toBe(true);
    }
    // Nothing in the synthetic prompt resembles client, vendor, or subject data.
    const text = SYNTHETIC_SMOKE_MESSAGES.map((m) => m.content).join(' ');
    for (const forbidden of ['@', '+91', 'http', '客', 'order', 'invoice']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('the command surface accepts only --config <path>', () => {
    expect(parseSmokeArgv(['--config', './smoke.json'])).toEqual({
      ok: true,
      configPath: './smoke.json',
    });
    for (const argv of [
      [],
      ['--config'],
      ['--config', './a.json', '--extra'],
      ['--key', 'NEVER-TYPE-A-KEY-HERE'],
      ['--prompt', 'hello'],
      ['--config', '--key'],
      ['./a.json'],
    ]) {
      const parsed = parseSmokeArgv(argv);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe('smoke-config-invalid');
      // The offending token is never carried out of the parser.
      expect(JSON.stringify(parsed)).not.toContain('NEVER-TYPE-A-KEY-HERE');
    }
  });
});

describe('(28, 29, 30, 31) bind, credential read, invocation, and HTTP request happen once', () => {
  it('counts exactly one of each on a successful run', async () => {
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const source = scriptedSecretSource();
    const result = await runOnce({ transport, source });

    expect(result.ok).toBe(true);
    expect(result.counters.binds).toBe(1);
    expect(result.counters.credentialReads).toBe(1);
    expect(result.counters.invocations).toBe(1);
    expect(source.reads()).toBe(1);
    expect(transport.calls()).toBe(1);
  });

  it('counts at most one of each on every refusal path', async () => {
    const cases: { readonly transport: GroqTransport & { readonly calls: () => number } }[] = [
      { transport: fakeGroqTransport('{"error":"SECRET-BODY"}', 429) },
      { transport: fakeGroqTransport('{"error":"SECRET-BODY"}', 503) },
      { transport: fakeGroqTransport('not-json-at-all') },
      { transport: failingTransport() },
    ];
    for (const { transport } of cases) {
      const result = await runOnce({ transport });
      expect(result.ok).toBe(false);
      expect(result.counters.binds).toBe(1);
      expect(result.counters.credentialReads).toBe(1);
      expect(result.counters.invocations).toBe(1);
      expect(transport.calls()).toBe(1);
    }
  });
});

describe('(32) there is no retry on 429, 5xx, or a network failure', () => {
  it('maps a 429 to a single sanitized unavailable outcome', async () => {
    const transport = fakeGroqTransport('{"error":"SECRET-RATE-BODY"}', 429);
    const result = await runOnce({ transport });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-provider-unavailable');
      expect(result.retryable).toBe(true);
    }
    expect(transport.calls()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SECRET-RATE-BODY');
  });

  it('maps a 500 to a single sanitized unavailable outcome', async () => {
    const transport = fakeGroqTransport('{"error":"SECRET-5XX-BODY"}', 500);
    const result = await runOnce({ transport });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-provider-unavailable');
    expect(transport.calls()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SECRET-5XX-BODY');
  });

  it('maps a 401 to a single sanitized non-retryable failure', async () => {
    const transport = fakeGroqTransport('{"error":"SECRET-AUTH-BODY"}', 401);
    const result = await runOnce({ transport });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-provider-failed');
      expect(result.retryable).toBe(false);
    }
    expect(transport.calls()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SECRET-AUTH-BODY');
  });

  it('maps a network failure to a single sanitized unavailable outcome', async () => {
    const transport = failingTransport();
    const result = await runOnce({ transport });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-provider-unavailable');
    expect(transport.calls()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-NETWORK-FAILURE');
  });

  it('maps an unexpected body shape to a single sanitized malformed outcome', async () => {
    const transport = fakeGroqTransport(smokeProbeResponseBody({ unexpected: 'shape' }));
    const result = await runOnce({ transport });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-provider-malformed');
    expect(transport.calls()).toBe(1);
  });
});

describe('(33, 34) the outcome is final, and there is no second-invocation surface', () => {
  it('returns a frozen terminal result with frozen counters and references', async () => {
    const result = await runOnce({});
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.counters)).toBe(true);
    expect(Object.isFrozen(result.references)).toBe(true);
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of ['again', 'retry', 'next', 'continue', 'invoke', 'provider', 'send']) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });

  it('the barrel exposes no chat loop, session, or repeat-invocation symbol', () => {
    const names = Object.keys(barrel);
    for (const name of names) {
      const lowered = name.toLowerCase();
      for (const forbidden of ['chat', 'loop', 'session', 'repeat', 'retry', 'stream']) {
        expect(lowered).not.toContain(forbidden);
      }
    }
  });
});

describe('(35, 36, 37) the harness owns the timer and the abort', () => {
  it('arms exactly one timer at the configured timeout and always clears it', async () => {
    const timer = manualSmokeTimer();
    const result = await runOnce({ timer });
    expect(result.ok).toBe(true);
    expect(timer.armed()).toBe(1);
    expect(timer.armedMs()).toBe(30_000);
    expect(timer.cancelled()).toBe(1);
    expect(result.counters.timersArmed).toBe(1);
    expect(result.counters.timersCleared).toBe(1);
  });

  it('clears the timer on a refusal too', async () => {
    const timer = manualSmokeTimer();
    const result = await runOnce({ timer, transport: fakeGroqTransport('bad', 500) });
    expect(result.ok).toBe(false);
    expect(timer.cancelled()).toBe(1);
    expect(result.counters.timersCleared).toBe(1);
  });

  it('a fired timer aborts the in-flight request and reports smoke-timeout', async () => {
    const timer = manualSmokeTimer();
    const transport = hangingTransport();
    const pending = runGroqStagingSmokeOnce(validConfig(), {
      transport,
      credentialSource: scriptedSecretSource(),
      clock: createManualClock(),
      timer,
    });

    // Let the bind and the single invocation reach the hanging transport, then expire the timer.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(transport.calls()).toBe(1);
    timer.fire();

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-timeout');
    expect(transport.calls()).toBe(1);
    expect(result.counters.invocations).toBe(1);
    expect(result.counters.timersCleared).toBe(1);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-ABORTED');
  });

  it('an abort that lands before the invocation produces zero transport calls', async () => {
    // A timer that expires the instant it is armed — the controller aborts before the provider runs.
    const immediateTimer: SmokeTimer = {
      arm(_ms: number, onFire: () => void): () => void {
        onFire();
        return () => {
          /* nothing to cancel */
        };
      },
    };
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport,
      credentialSource: scriptedSecretSource(),
      clock: createManualClock(),
      timer: immediateTimer,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-timeout');
    expect(transport.calls()).toBe(0);
    expect(result.counters.invocations).toBe(1);
  });
});
