/**
 * QFJ-S1A — credential ingress safety (ADR-0061 §B).
 *
 * Matrix: a non-TTY session is refused BEFORE any read; the echo-disabled seam is the only reader; the
 * secret is read exactly once; a bounded/invalid value is rejected; and the sentinel credential, the
 * credential reference value, and the `Authorization` header never appear in a result, a printed report,
 * an error, or a snapshot. Every test injects a scripted terminal — none touches a real terminal, the
 * environment, the filesystem, the network, or a real credential.
 */
import { createManualClock } from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import {
  createMaskedTtyCredentialResolver,
  formatSanitizedSmokeResult,
  MAX_CREDENTIAL_LENGTH,
  parseSmokeConfig,
  runGroqStagingSmokeOnce,
  type SmokeConfig,
} from '../index.js';
import {
  FAKE_SMOKE_SENTINEL_CREDENTIAL,
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
  syntheticSmokeConfigInput,
} from '../testing/index.js';

function validConfig(over: Readonly<Record<string, unknown>> = {}): SmokeConfig {
  const parsed = parseSmokeConfig(syntheticSmokeConfigInput(over));
  if (!parsed.ok) {
    throw new Error('the synthetic smoke fixture must be valid');
  }
  return parsed.config;
}

describe('(6) a non-interactive session is refused before any credential read', () => {
  it('refuses with smoke-tty-required and reads nothing', async () => {
    const source = scriptedSecretSource({ interactive: false });
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport,
      credentialSource: source,
      clock: createManualClock(),
      timer: manualSmokeTimer(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-tty-required');
    expect(source.reads()).toBe(0);
    expect(result.counters.credentialReads).toBe(0);
    expect(result.counters.binds).toBe(0);
    expect(result.counters.invocations).toBe(0);
    expect(transport.calls()).toBe(0);
  });

  it('the resolver re-checks interactivity on its own, not only through the harness', async () => {
    const source = scriptedSecretSource({ interactive: false });
    const resolver = createMaskedTtyCredentialResolver(source);
    await expect(resolver.resolve({ ref: 'groq.staging.secret.v1' })).rejects.toThrow();
    expect(resolver.lastFailure()).toBe('smoke-tty-required');
    expect(source.reads()).toBe(0);
  });
});

describe('(7, 8) the echo-disabled seam is the only reader, and it reads exactly once', () => {
  it('reads through the masked seam exactly once for a whole run', async () => {
    const source = scriptedSecretSource();
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: fakeGroqTransport(smokeProbeResponseBody()),
      credentialSource: source,
      clock: createManualClock(),
      timer: manualSmokeTimer(),
    });

    expect(result.ok).toBe(true);
    expect(source.reads()).toBe(1);
    expect(result.counters.credentialReads).toBe(1);
    // The prompt label names the purpose, never a value.
    expect(source.lastLabel()).toContain('Staging Groq credential');
    expect(source.lastLabel()).not.toContain(FAKE_SMOKE_SENTINEL_CREDENTIAL);
  });

  it('a second resolve fails closed instead of re-prompting', async () => {
    const source = scriptedSecretSource();
    const resolver = createMaskedTtyCredentialResolver(source);
    await resolver.resolve({ ref: 'groq.staging.secret.v1' });
    expect(source.reads()).toBe(1);

    await expect(resolver.resolve({ ref: 'groq.staging.secret.v1' })).rejects.toThrow();
    expect(resolver.lastFailure()).toBe('smoke-credential-invalid');
    // The terminal was NOT consulted a second time, and no second read was performed.
    expect(source.reads()).toBe(1);
    expect(resolver.reads()).toBe(1);
  });
});

describe('(9) a bounded/invalid credential is rejected', () => {
  const rejected = [
    { label: 'empty', value: '' },
    { label: 'too short', value: 'short-key' },
    { label: 'too long', value: 'a'.repeat(MAX_CREDENTIAL_LENGTH + 1) },
    { label: 'whitespace', value: 'FAKE STAGING SENTINEL WITH SPACES 000' },
    { label: 'control-ish punctuation', value: 'FAKE-SENTINEL-WITH-$-AND-;-0000000' },
    { label: 'aborted read', value: null },
  ];
  for (const { label, value } of rejected) {
    it(`rejects a ${label} credential without reaching the transport`, async () => {
      const source = scriptedSecretSource({ value });
      const transport = fakeGroqTransport(smokeProbeResponseBody());
      const result = await runGroqStagingSmokeOnce(validConfig(), {
        transport,
        credentialSource: source,
        clock: createManualClock(),
        timer: manualSmokeTimer(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('smoke-credential-invalid');
        // The gateway's own sanitized bind reason is reported alongside, never a cause string.
        expect(result.bindReason).toBe('groq-bind-credential-unavailable');
      }
      expect(transport.calls()).toBe(0);
    });
  }
});

describe('(10, 11, 14) the credential, its reference, and the Authorization header never escape', () => {
  it('a successful run leaks neither the sentinel nor the reference nor a header', async () => {
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport,
      credentialSource: scriptedSecretSource(),
      clock: createManualClock(),
      timer: manualSmokeTimer(),
    });
    expect(result.ok).toBe(true);

    const serializedResult = JSON.stringify(result);
    const report = formatSanitizedSmokeResult(result, '2026-07-26T00:00:00.000Z');

    for (const surface of [serializedResult, report]) {
      expect(surface).not.toContain(FAKE_SMOKE_SENTINEL_CREDENTIAL);
      expect(surface).not.toContain('FAKE-STAGING-SENTINEL');
      expect(surface).not.toContain('Bearer');
      expect(surface.toLowerCase()).not.toContain('authorization');
      // The OPAQUE credential reference VALUE is configuration input, never output.
      expect(surface).not.toContain('groq.staging.secret.v1');
    }

    // Positive control: the credential did reach the wire, through the Authorization header only, and
    // the recorded request lives inside the deterministic fake transport — not in any harness surface.
    const request = transport.lastRequest();
    expect(request?.headers['authorization']).toContain('Bearer ');
    expect(Object.keys(request?.headers ?? {}).sort()).toEqual(['authorization', 'content-type']);
    expect(request?.body ?? '').not.toContain(FAKE_SMOKE_SENTINEL_CREDENTIAL);
  });

  it('a refused run leaks nothing either, and its error carries no cause', async () => {
    const source = scriptedSecretSource({ value: 'too-short' });
    const resolver = createMaskedTtyCredentialResolver(source);
    let thrown: unknown;
    try {
      await resolver.resolve({ ref: 'groq.staging.secret.v1' });
    } catch (error: unknown) {
      thrown = error;
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toBe('QFJ_SMOKE_CREDENTIAL_REFUSED');
    expect(message).not.toContain('too-short');
    expect(message).not.toContain('groq.staging.secret.v1');

    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: fakeGroqTransport(smokeProbeResponseBody()),
      credentialSource: scriptedSecretSource({ value: 'too-short' }),
      clock: createManualClock(),
      timer: manualSmokeTimer(),
    });
    const surface = `${JSON.stringify(result)}\n${formatSanitizedSmokeResult(result, 'T')}`;
    expect(surface).not.toContain('too-short');
    expect(surface).not.toContain('groq.staging.secret.v1');
    expect(surface).not.toContain('QFJ_SMOKE_CREDENTIAL_REFUSED');
  });

  it('the resolver exposes no accessor that could return the credential', () => {
    const resolver = createMaskedTtyCredentialResolver(scriptedSecretSource());
    expect(Object.keys(resolver).sort()).toEqual(['lastFailure', 'reads', 'resolve']);
    const surface = resolver as unknown as Record<string, unknown>;
    for (const forbidden of ['value', 'key', 'apiKey', 'secret', 'reveal', 'unwrap']) {
      expect(surface[forbidden]).toBeUndefined();
    }
    // The frozen object gains no own accessor later either.
    expect(Object.isFrozen(resolver)).toBe(true);
  });
});
