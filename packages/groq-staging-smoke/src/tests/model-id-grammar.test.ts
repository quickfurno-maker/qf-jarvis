/**
 * QFJ-S1C-A — the smoke configuration accepts a namespaced provider model id, and nothing else moved.
 *
 * The smoke configuration is the last gate before a staging run, so it gets its own proof rather than
 * inheriting the gateway's: it must accept the approved `openai/gpt-oss-20b`, keep refusing every
 * path-shaped or URL-shaped value, keep refusing a wildcard/`latest` model id, and keep refusing a
 * slash in every OTHER field. It must also agree with the gateway grammar exactly — one shared
 * constant, not two that happen to match today.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROVIDER_MODEL_ID_PATTERN, isProviderModelId } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { parseSmokeConfig } from '../index.js';
import { syntheticSmokeConfigInput } from '../testing/index.js';

/** Build a candidate document with a substituted `release.modelId`. */
function withModelId(modelId: unknown): Record<string, unknown> {
  const base = syntheticSmokeConfigInput();
  return { ...base, release: { ...(base['release'] as Record<string, unknown>), modelId } };
}

function accepts(modelId: unknown): boolean {
  return parseSmokeConfig(withModelId(modelId)).ok;
}

describe('the approved namespaced model id is accepted', () => {
  it('accepts openai/gpt-oss-20b', () => {
    expect(accepts('openai/gpt-oss-20b')).toBe(true);
  });

  it('accepts openai/gpt-oss-120b', () => {
    expect(accepts('openai/gpt-oss-120b')).toBe(true);
  });

  it('keeps accepting ordinary non-namespaced model ids', () => {
    for (const modelId of [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'deepseek-r1-distill-llama-70b',
    ]) {
      expect(accepts(modelId)).toBe(true);
    }
  });

  it('accepts a deeper namespace', () => {
    expect(accepts('meta-llama/llama-4-scout-17b-16e-instruct')).toBe(true);
  });
});

describe('path-shaped and URL-shaped model ids stay refused', () => {
  const rejected: readonly { readonly why: string; readonly value: unknown }[] = [
    { why: 'leading slash', value: '/openai/gpt-oss-20b' },
    { why: 'trailing slash', value: 'openai/gpt-oss-20b/' },
    { why: 'double slash', value: 'openai//gpt-oss-20b' },
    { why: 'bare slash', value: '/' },
    { why: 'empty', value: '' },
    { why: 'backslash', value: 'openai\\gpt-oss-20b' },
    { why: 'inner whitespace', value: 'openai/gpt oss 20b' },
    { why: 'trailing whitespace', value: 'openai/gpt-oss-20b ' },
    { why: 'query marker', value: 'openai/gpt-oss-20b?x=1' },
    { why: 'fragment marker', value: 'openai/gpt-oss-20b#f' },
    { why: 'percent escape', value: 'openai/gpt%2Foss' },
    { why: 'ampersand', value: 'openai/gpt&oss' },
    { why: 'equals', value: 'openai/gpt=oss' },
    { why: 'at sign', value: 'openai@gpt-oss-20b' },
    { why: 'https URL', value: 'https://api.groq.com/openai/v1/chat/completions' },
    { why: 'protocol-relative URL', value: '//api.groq.com/model' },
    { why: 'over the length bound', value: `a/${'b'.repeat(128)}` },
    { why: 'non-string', value: 42 },
    { why: 'null', value: null },
  ];

  for (const { why, value } of rejected) {
    it(`rejects ${why} with the sanitized config code`, () => {
      const result = parseSmokeConfig(withModelId(value));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The reason code is unchanged by this repair — no model-specific code was introduced.
        expect(result.reason).toBe('smoke-config-invalid');
      }
      // The rejected value never becomes part of the outcome.
      expect(JSON.stringify(result)).not.toContain('api.groq.com');
    });
  }
});

describe('wildcard and `latest` model ids stay refused by the configuration', () => {
  for (const value of ['*', 'latest', 'LATEST', 'Latest']) {
    it(`rejects ${value}`, () => {
      expect(accepts(value)).toBe(false);
    });
  }

  it('`latest` is well-formed by grammar yet refused by the configuration', () => {
    // Proves the refusal is policy in the configuration, not an accident of the character class.
    expect(isProviderModelId('latest')).toBe(true);
    expect(accepts('latest')).toBe(false);
  });

  it('a namespaced id whose segments merely CONTAIN "latest" is still accepted', () => {
    expect(accepts('openai/gpt-latest-20b')).toBe(true);
  });
});

describe('no other configuration field learned to accept a slash', () => {
  const NAMESPACED = 'openai/gpt-oss-20b';

  for (const field of ['releaseId', 'providerId', 'modelVersion', 'configDigest'] as const) {
    it(`release.${field} still rejects a slash`, () => {
      const base = syntheticSmokeConfigInput();
      const release = { ...(base['release'] as Record<string, unknown>), [field]: NAMESPACED };
      const result = parseSmokeConfig({ ...base, release });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
    });
  }

  for (const field of [
    'credentialReference',
    'capabilityProfileRef',
    'evaluationRef',
    'dataControlsAttestationRef',
    'promptFamily',
    'schemaRevision',
  ]) {
    it(`${field} still rejects a slash`, () => {
      const result = parseSmokeConfig(syntheticSmokeConfigInput({ [field]: NAMESPACED }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('smoke-config-invalid');
    });
  }
});

describe('the smoke configuration and the gateway share ONE grammar', () => {
  it('agrees with the gateway grammar across the whole corpus', () => {
    const corpus = [
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'a/b/c',
      '/leading',
      'trailing/',
      'double//slash',
      '/',
      '',
      'openai\\gpt',
      'openai/gpt oss',
      'openai/gpt?x=1',
      'https://api.groq.com/x',
      '//api.groq.com/x',
      'openai@gpt',
    ];
    for (const value of corpus) {
      // `latest`/`*` are excluded here: the configuration adds a policy refusal ON TOP of the
      // grammar, so those two are the one place the answers legitimately differ (asserted above).
      expect({ value, accepted: accepts(value) }).toEqual({
        value,
        accepted: isProviderModelId(value),
      });
    }
  });

  it('imports the shared pattern rather than re-declaring one', () => {
    const source = readFileSync(fileURLToPath(new URL('../config.ts', import.meta.url)), 'utf8');
    expect(source).toContain("import { providerModelIdSchema } from '@qf-jarvis/model-gateway'");
    // The slash-segment grammar is NOT duplicated in this package.
    expect(source).not.toContain('(?:\\/[A-Za-z0-9._:-]+)*');
    // And the generic charset it still uses for every other field is untouched.
    expect(source).toContain('/^[A-Za-z0-9._:-]+$/');
    expect(PROVIDER_MODEL_ID_PATTERN.source).toBe('^[A-Za-z0-9._:-]+(?:\\/[A-Za-z0-9._:-]+)*$');
  });
});
