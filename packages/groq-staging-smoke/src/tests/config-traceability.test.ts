/**
 * QFJ-S1A — the strict closed configuration and exact traceability (ADR-0061 §D, §E).
 *
 * Matrix: the closed document is accepted; unknown keys are rejected; secret/key/token/password fields,
 * prompt/output-body fields, and URL/header/arbitrary-provider-option fields are rejected as a forbidden
 * field class; the exact release/model/version/config-digest, the capability/evaluation/attestation
 * references, and the prompt family/version are all REQUIRED; a wildcard or `latest` is rejected before
 * any credential resolution; only HOSTED / HOSTED_ALLOWED is accepted; the timeout is bounded; and the
 * strict schema revision must be the exact compiled-in one.
 *
 * No value from a rejected document is ever read or echoed — the tests assert the sanitized code only.
 */
import { createManualClock } from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import {
  MAX_SMOKE_TIMEOUT_MS,
  MIN_SMOKE_TIMEOUT_MS,
  parseSmokeConfig,
  runGroqStagingSmokeOnce,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
  type SmokeConfig,
} from '../index.js';
import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
  syntheticSmokeConfigInput,
} from '../testing/index.js';

function expectInvalid(over: Readonly<Record<string, unknown>>, reason: string): void {
  const result = parseSmokeConfig(syntheticSmokeConfigInput(over));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe(reason);
}

function withRelease(over: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const base = syntheticSmokeConfigInput();
  return { ...base, release: { ...(base['release'] as Record<string, unknown>), ...over } };
}

/** Rebuild an object without one key, so a required-field test never uses a dynamic `delete`. */
function without(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

describe('(15) the strict closed configuration is accepted', () => {
  it('accepts the exact document and freezes it', () => {
    const result = parseSmokeConfig(syntheticSmokeConfigInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(result.config.credentialReference).toBe('groq.staging.secret.v1');
    expect(result.config.release.executionClass).toBe('HOSTED');
    expect(result.config.dataClass).toBe('HOSTED_ALLOWED');
    expect(result.config.promptFamily).toBe(SMOKE_PROMPT_FAMILY);
    expect(result.config.promptVersion).toBe(SMOKE_PROMPT_VERSION);
    expect(result.config.schemaRevision).toBe(SMOKE_SCHEMA_REVISION);
  });

  it('rejects a non-object document', () => {
    for (const raw of [null, undefined, 'x', 42, [syntheticSmokeConfigInput()]]) {
      const result = parseSmokeConfig(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
    }
  });
});

describe('(16) an unknown key is rejected', () => {
  for (const key of ['extra', 'notes', 'region', 'retries', 'verbose']) {
    it(`rejects an unknown "${key}" key`, () => {
      expectInvalid({ [key]: 'anything' }, 'smoke-config-invalid');
    });
  }

  it('rejects an unknown key nested inside release', () => {
    const result = parseSmokeConfig(withRelease({ region: 'eu' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
  });
});

describe('(17) a secret/key/token/password field is rejected as a forbidden field class', () => {
  for (const key of [
    'apiKey',
    'api_key',
    'key',
    'secret',
    'groqSecret',
    'token',
    'accessToken',
    'password',
    'passphrase',
    'authorization',
    'bearer',
    'credentials',
    'signature',
  ]) {
    it(`rejects "${key}" without reading its value`, () => {
      expectInvalid({ [key]: 'NEVER-READ-THIS-VALUE' }, 'smoke-config-secret-field-forbidden');
    });
  }

  it('rejects a key-like field nested inside release', () => {
    const result = parseSmokeConfig(withRelease({ apiKey: 'NEVER-READ-THIS-VALUE' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('smoke-config-secret-field-forbidden');
    // The rejected value never becomes part of the outcome.
    expect(JSON.stringify(result)).not.toContain('NEVER-READ-THIS-VALUE');
  });

  it('does not mistake the legitimate credentialReference for a secret field', () => {
    expect(parseSmokeConfig(syntheticSmokeConfigInput()).ok).toBe(true);
  });
});

describe('(18) a prompt-text or output-body field is rejected', () => {
  for (const key of [
    'prompt',
    'promptText',
    'messages',
    'message',
    'systemPrompt',
    'userContent',
    'content',
    'instructions',
    'expectedOutput',
    'completion',
    'transcript',
    'history',
  ]) {
    it(`rejects "${key}"`, () => {
      expectInvalid(
        { [key]: 'synthetic text that must not be configurable' },
        'smoke-config-secret-field-forbidden',
      );
    });
  }

  it('still accepts the legitimate promptFamily/promptVersion identity fields', () => {
    expect(parseSmokeConfig(syntheticSmokeConfigInput()).ok).toBe(true);
  });
});

describe('(19) a URL, header, or arbitrary provider option is rejected', () => {
  for (const key of [
    'url',
    'baseUrl',
    'base_url',
    'endpoint',
    'origin',
    'host',
    'headers',
    'header',
    'proxy',
    'temperature',
    'topP',
    'topK',
    'seed',
    'tools',
    'toolChoice',
    'logprobs',
    'logitBias',
    'stream',
    'stopSequences',
    'frequencyPenalty',
  ]) {
    it(`rejects "${key}"`, () => {
      expectInvalid({ [key]: 'x' }, 'smoke-config-secret-field-forbidden');
    });
  }

  it('rejects a subject/client/vendor identity field', () => {
    for (const key of ['phone', 'subjectId', 'clientName', 'vendorId', 'email', 'whatsapp']) {
      expectInvalid({ [key]: 'x' }, 'smoke-config-secret-field-forbidden');
    }
  });
});

describe('(20, 21, 22) the exact release, approval, and prompt references are required', () => {
  for (const key of ['releaseId', 'providerId', 'modelId', 'modelVersion', 'configDigest']) {
    it(`requires release.${key}`, () => {
      const base = syntheticSmokeConfigInput();
      const release = without(base['release'] as Record<string, unknown>, key);
      const result = parseSmokeConfig({ ...base, release });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
    });
  }

  for (const key of [
    'credentialReference',
    'capabilityProfileRef',
    'evaluationRef',
    'dataControlsAttestationRef',
    'promptFamily',
    'promptVersion',
    'schemaRevision',
    'maxInputTokens',
    'maxCompletionTokens',
    'timeoutMs',
  ]) {
    it(`requires ${key}`, () => {
      const result = parseSmokeConfig(without(syntheticSmokeConfigInput(), key));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
    });
  }

  it('rejects a prompt family or version that is not the compiled-in identity', () => {
    expectInvalid({ promptFamily: 'some.other.family' }, 'smoke-config-invalid');
    expectInvalid({ promptVersion: SMOKE_PROMPT_VERSION + 1 }, 'smoke-config-invalid');
    expectInvalid({ promptVersion: 'latest' }, 'smoke-config-invalid');
  });

  it('rejects a false or absent data-controls attestation', () => {
    expectInvalid({ dataControlsAttested: false }, 'smoke-config-invalid');
  });
});

describe('(23) a wildcard or `latest` is rejected, and never reaches credential resolution', () => {
  for (const field of ['releaseId', 'providerId', 'modelId', 'modelVersion', 'configDigest']) {
    for (const value of ['*', 'latest', 'LATEST']) {
      it(`rejects release.${field} = ${value} at configuration time`, () => {
        const result = parseSmokeConfig(withRelease({ [field]: value }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
      });
    }
  }

  for (const field of ['capabilityProfileRef', 'evaluationRef', 'dataControlsAttestationRef']) {
    it(`rejects ${field} = latest at configuration time`, () => {
      expectInvalid({ [field]: 'latest' }, 'smoke-config-invalid');
    });
  }

  it('even if a non-exact release reached the run, the credential is never read', async () => {
    // `modelVersion: 'latest'` satisfies the identifier pattern, so this proves the RUN-level gate:
    // the gateway binding refuses before the resolver is consulted and before any transport call.
    const parsed = parseSmokeConfig(withRelease({ modelVersion: 'la-test' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const smuggled = {
      ...parsed.config,
      release: { ...parsed.config.release, modelVersion: 'latest' },
    } as SmokeConfig;

    const source = scriptedSecretSource();
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runGroqStagingSmokeOnce(smuggled, {
      transport,
      credentialSource: source,
      clock: createManualClock(),
      timer: manualSmokeTimer(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('smoke-bind-refused');
      expect(result.bindReason).toBe('groq-bind-release-invalid');
    }
    expect(source.reads()).toBe(0);
    expect(result.counters.credentialReads).toBe(0);
    expect(transport.calls()).toBe(0);
  });
});

describe('(24) only HOSTED execution and HOSTED_ALLOWED data class are accepted', () => {
  for (const executionClass of ['LOCAL', 'HOSTED_ALLOWED', 'hosted', '*']) {
    it(`rejects executionClass ${executionClass}`, () => {
      const result = parseSmokeConfig(withRelease({ executionClass }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
    });
  }

  for (const dataClass of ['LOCAL_ONLY', 'HUMAN_ONLY', 'hosted_allowed']) {
    it(`rejects dataClass ${dataClass}`, () => {
      expectInvalid({ dataClass }, 'smoke-config-invalid');
    });
  }

  it('rejects a downgraded strict-schema flag', () => {
    expectInvalid({ supportsStrictJsonSchema: false }, 'smoke-config-invalid');
  });
});

describe('(25) the timeout is bounded', () => {
  it('accepts the bounds and rejects anything outside them', () => {
    expect(
      parseSmokeConfig(syntheticSmokeConfigInput({ timeoutMs: MIN_SMOKE_TIMEOUT_MS })).ok,
    ).toBe(true);
    expect(
      parseSmokeConfig(syntheticSmokeConfigInput({ timeoutMs: MAX_SMOKE_TIMEOUT_MS })).ok,
    ).toBe(true);
    expectInvalid({ timeoutMs: MIN_SMOKE_TIMEOUT_MS - 1 }, 'smoke-config-invalid');
    expectInvalid({ timeoutMs: MAX_SMOKE_TIMEOUT_MS + 1 }, 'smoke-config-invalid');
    expectInvalid({ timeoutMs: 0 }, 'smoke-config-invalid');
    expectInvalid({ timeoutMs: -1 }, 'smoke-config-invalid');
    expectInvalid({ timeoutMs: 1500.5 }, 'smoke-config-invalid');
  });

  it('bounds the completion budget so a smoke cannot become a long generation', () => {
    expectInvalid({ maxCompletionTokens: 0 }, 'smoke-config-invalid');
    expectInvalid({ maxCompletionTokens: 4097 }, 'smoke-config-invalid');
  });
});

describe('(26) the exact strict schema revision is required', () => {
  it('rejects any schema revision other than the compiled-in one', () => {
    expectInvalid({ schemaRevision: 'qfj.s1a.synthetic.smoke.schema.v2' }, 'smoke-config-invalid');
    expectInvalid({ schemaRevision: 'latest' }, 'smoke-config-invalid');
    expectInvalid({ schemaRevision: '' }, 'smoke-config-invalid');
  });
});
