/**
 * QFJ-S1C-A — the provider MODEL ID grammar, and the non-regression of every other identifier.
 *
 * Two properties are proven together, because either alone would be misleading: a namespaced model id
 * such as `openai/gpt-oss-20b` is now expressible on every provider-identity path, AND no neighbouring
 * identifier learned to accept a slash. The second half is the point of the exercise — widening the
 * shared charset would have "fixed" the model id by loosening a dozen unrelated fields.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createGroqApiKey,
  createGroqProviderConfig,
  createProviderReleaseRef,
  defineProviderCapabilities,
  isProviderModelId,
  MAX_PROVIDER_MODEL_ID_LENGTH,
  PROVIDER_MODEL_ID_PATTERN,
  providerModelIdSchema,
  type GroqTransport,
} from '../index.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);

/** The approved Groq staging model id, and other real catalogue shapes. */
const ACCEPTED_MODEL_IDS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'deepseek-r1-distill-llama-70b',
  'a',
  'a/b/c',
  'model.v1:2-final',
];

const REJECTED_MODEL_IDS: readonly { readonly why: string; readonly value: string }[] = [
  { why: 'leading slash', value: '/openai/gpt-oss-20b' },
  { why: 'trailing slash', value: 'openai/gpt-oss-20b/' },
  { why: 'double slash', value: 'openai//gpt-oss-20b' },
  { why: 'bare slash', value: '/' },
  { why: 'only slashes', value: '//' },
  { why: 'empty', value: '' },
  { why: 'backslash', value: 'openai\\gpt-oss-20b' },
  { why: 'inner space', value: 'openai/gpt oss 20b' },
  { why: 'leading space', value: ' openai/gpt-oss-20b' },
  { why: 'trailing space', value: 'openai/gpt-oss-20b ' },
  { why: 'tab', value: `openai/${String.fromCharCode(9)}gpt` },
  { why: 'newline', value: `openai/gpt${String.fromCharCode(10)}` },
  { why: 'query marker', value: 'openai/gpt-oss-20b?x=1' },
  { why: 'fragment marker', value: 'openai/gpt-oss-20b#frag' },
  { why: 'percent escape', value: 'openai/gpt%2Foss' },
  { why: 'ampersand', value: 'openai/gpt&oss' },
  { why: 'equals', value: 'openai/gpt=oss' },
  { why: 'at sign', value: 'openai@gpt-oss-20b' },
  { why: 'https URL', value: 'https://api.groq.com/openai/v1/chat/completions' },
  { why: 'http URL', value: 'http://localhost/model' },
  { why: 'scheme only', value: 'https://' },
  { why: 'protocol-relative URL', value: '//api.groq.com/model' },
  { why: 'over the length bound', value: `a/${'b'.repeat(MAX_PROVIDER_MODEL_ID_LENGTH)}` },
];

/** A transport stub used only so `createGroqProviderConfig` has its required injected object. */
const inertTransport: GroqTransport = {
  send: () => Promise.reject(new Error('SYNTHETIC-NEVER-CALLED')),
};

function releaseWith(modelId: string): unknown {
  return {
    releaseId: 'rel.groq.staging.1',
    providerId: 'groq',
    modelId,
    modelVersion: '2026-07',
    executionClass: 'HOSTED' as const,
    configDigest: 'cfg-groq-0001',
  };
}

function groqConfigWith(modelId: string): () => unknown {
  return () =>
    createGroqProviderConfig({
      providerId: 'groq',
      modelId,
      modelVersion: '2026-07',
      maxInputTokens: 512,
      maxCompletionTokens: 256,
      supportsStrictJsonSchema: true,
      apiKey: createGroqApiKey('SYNTHETIC-SENTINEL-NOT-A-REAL-KEY'),
      transport: inertTransport,
      dataControlsAttested: true,
    });
}

function capabilitiesWith(modelId: string): () => unknown {
  return () =>
    defineProviderCapabilities({
      providerId: 'groq',
      modelId,
      modelVersion: '2026-07',
      executionClass: 'HOSTED',
      supportsStructuredOutput: true,
      supportsStrictJsonSchema: true,
      maxInputTokens: 512,
      supportsTimeout: true,
      supportsCancellation: true,
      supportsNonStreaming: true,
      supportsStreaming: false,
    });
}

describe('the grammar itself', () => {
  it('is the exact approved anchored slash-segment form', () => {
    expect(PROVIDER_MODEL_ID_PATTERN.source).toBe('^[A-Za-z0-9._:-]+(?:\\/[A-Za-z0-9._:-]+)*$');
    expect(PROVIDER_MODEL_ID_PATTERN.flags).toBe('');
    // The repository's pre-existing model-id length bound is unchanged.
    expect(MAX_PROVIDER_MODEL_ID_LENGTH).toBe(128);
  });

  for (const value of ACCEPTED_MODEL_IDS) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(isProviderModelId(value)).toBe(true);
      expect(providerModelIdSchema.safeParse(value).success).toBe(true);
    });
  }

  for (const { why, value } of REJECTED_MODEL_IDS) {
    it(`rejects ${why}`, () => {
      expect(isProviderModelId(value)).toBe(false);
      expect(providerModelIdSchema.safeParse(value).success).toBe(false);
    });
  }

  it('rejects a non-string', () => {
    for (const value of [null, undefined, 42, {}, ['openai/gpt-oss-20b']]) {
      expect(isProviderModelId(value)).toBe(false);
    }
  });
});

describe('all three provider-identity paths agree on modelId semantics', () => {
  for (const modelId of ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile']) {
    it(`accepts ${modelId} in the release ref, the Groq config, and the capability declaration`, () => {
      expect(createProviderReleaseRef(releaseWith(modelId)).modelId).toBe(modelId);
      expect(groqConfigWith(modelId)()).toBeDefined();
      expect(capabilitiesWith(modelId)()).toBeDefined();
    });
  }

  for (const { why, value } of REJECTED_MODEL_IDS) {
    it(`refuses ${why} in all three paths`, () => {
      expect(() => createProviderReleaseRef(releaseWith(value))).toThrow();
      expect(groqConfigWith(value)).toThrow();
      expect(capabilitiesWith(value)).toThrow();
    });
  }

  it('the three paths agree exactly across the whole accept/reject corpus', () => {
    for (const value of [...ACCEPTED_MODEL_IDS, ...REJECTED_MODEL_IDS.map((r) => r.value)]) {
      const byGrammar = isProviderModelId(value);
      const byRelease = (() => {
        try {
          createProviderReleaseRef(releaseWith(value));
          return true;
        } catch {
          return false;
        }
      })();
      const byGroqConfig = (() => {
        try {
          groqConfigWith(value)();
          return true;
        } catch {
          return false;
        }
      })();
      const byCapabilities = (() => {
        try {
          capabilitiesWith(value)();
          return true;
        } catch {
          return false;
        }
      })();
      expect({ value, byRelease, byGroqConfig, byCapabilities }).toEqual({
        value,
        byRelease: byGrammar,
        byGroqConfig: byGrammar,
        byCapabilities: byGrammar,
      });
    }
  });
});

describe('generic identifiers did NOT learn to accept a slash', () => {
  const NAMESPACED = 'openai/gpt-oss-20b';

  it('the release ref still refuses a slash in releaseId, providerId, modelVersion, configDigest', () => {
    for (const field of ['releaseId', 'providerId', 'modelVersion', 'configDigest'] as const) {
      const release = { ...(releaseWith('llama-3.3-70b-versatile') as Record<string, unknown>) };
      release[field] = NAMESPACED;
      expect(() => createProviderReleaseRef(release)).toThrow();
    }
  });

  it('the Groq config still refuses a slash in providerId and modelVersion', () => {
    expect(() =>
      createGroqProviderConfig({
        providerId: NAMESPACED,
        modelId: 'llama-3.3-70b-versatile',
        modelVersion: '2026-07',
        maxInputTokens: 512,
        maxCompletionTokens: 256,
        supportsStrictJsonSchema: true,
        apiKey: createGroqApiKey('SYNTHETIC-SENTINEL-NOT-A-REAL-KEY'),
        transport: inertTransport,
        dataControlsAttested: true,
      }),
    ).toThrow();
    expect(() =>
      createGroqProviderConfig({
        providerId: 'groq',
        modelId: 'llama-3.3-70b-versatile',
        modelVersion: NAMESPACED,
        maxInputTokens: 512,
        maxCompletionTokens: 256,
        supportsStrictJsonSchema: true,
        apiKey: createGroqApiKey('SYNTHETIC-SENTINEL-NOT-A-REAL-KEY'),
        transport: inertTransport,
        dataControlsAttested: true,
      }),
    ).toThrow();
  });

  it('the capability declaration still refuses a slash in providerId and modelVersion', () => {
    for (const field of ['providerId', 'modelVersion'] as const) {
      expect(() => {
        const input = {
          providerId: 'groq',
          modelId: 'llama-3.3-70b-versatile',
          modelVersion: '2026-07',
          executionClass: 'HOSTED' as const,
          supportsStructuredOutput: true,
          supportsStrictJsonSchema: true,
          maxInputTokens: 512,
          supportsTimeout: true,
          supportsCancellation: true,
          supportsNonStreaming: true,
          supportsStreaming: false,
        };
        return defineProviderCapabilities({ ...input, [field]: NAMESPACED });
      }).toThrow();
    }
  });

  it('the generic charset in source is byte-for-byte unchanged wherever it is still used', () => {
    // A single altered character here would silently widen unrelated fields.
    const generic = '/^[A-Za-z0-9._:-]+$/';
    for (const file of [
      'packages/model-gateway/src/contracts/capabilities.ts',
      'packages/model-gateway/src/operations/provider-release.ts',
      'packages/model-gateway/src/providers/groq/groq-config.ts',
      'packages/model-gateway/src/operations/rollout-approval.ts',
      'packages/model-gateway/src/operations/rollout-policy.ts',
      'packages/model-gateway/src/providers/local-openai-compatible/local-provider-config.ts',
      'packages/model-gateway/src/providers/groq/groq-staging-binding.ts',
    ]) {
      expect(readFileSync(fileURLToPath(new URL(file, REPO_ROOT)), 'utf8')).toContain(generic);
    }
  });
});

describe('wildcard and `latest` protections are unchanged', () => {
  it('a `*` model id is still rejected by the grammar itself', () => {
    expect(isProviderModelId('*')).toBe(false);
    expect(isProviderModelId('openai/*')).toBe(false);
    expect(() => createProviderReleaseRef(releaseWith('*'))).toThrow();
  });

  it('`latest` remains WELL-FORMED but is refused by the staging binding, not by the grammar', () => {
    // The grammar deliberately does not encode approval policy: `latest` is a legal string that a
    // caller must still be refused. That refusal lives with the binding and the smoke configuration.
    expect(isProviderModelId('latest')).toBe(true);
    expect(isProviderModelId('openai/latest')).toBe(true);
    const binding = readFileSync(
      fileURLToPath(
        new URL('packages/model-gateway/src/providers/groq/groq-staging-binding.ts', REPO_ROOT),
      ),
      'utf8',
    );
    expect(binding).toContain("new Set(['*', 'latest'])");
    expect(binding).toContain('hasWildcardIdentity');
    expect(binding).toContain("refuse('groq-bind-release-invalid')");
  });
});

describe('repository invariants this repair must not move', () => {
  const LOCKED_MIGRATION_HASHES: Record<string, string> = {
    '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
    '0002_event_runtime_grants.sql':
      '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
    '0003_ingestion_rejection_and_event_conflict.sql':
      '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
    '0004_projection_foundation.sql':
      '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
    '0005_projection_event_positions.sql':
      '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
    '0006_projection_failure_operations.sql':
      'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
    '0007_subject_activity_projection.sql':
      '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
  };

  it('migrations 0001-0007 are byte-identical and 0008 is neither present nor reserved', () => {
    const dir = fileURLToPath(
      new URL('packages/event-backbone/src/persistence/migrations', REPO_ROOT),
    );
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED_MIGRATION_HASHES));
    for (const [name, hash] of Object.entries(LOCKED_MIGRATION_HASHES)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    expect(sql.some((name) => name.startsWith('0008'))).toBe(false);
  });

  it('the event-backbone root API lock remains 39', () => {
    expect(
      readFileSync(
        fileURLToPath(new URL('packages/event-backbone/src/tests/public-api.test.ts', REPO_ROOT)),
        'utf8',
      ),
    ).toContain('toHaveLength(39)');
  });

  it('this repair adds exactly the four model-id symbols to the gateway barrel', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    for (const added of [
      'PROVIDER_MODEL_ID_PATTERN',
      'MAX_PROVIDER_MODEL_ID_LENGTH',
      'providerModelIdSchema',
      'isProviderModelId',
    ]) {
      expect(barrel[added]).toBeDefined();
    }
    // No provider instance, secret accessor, or raw HTTP type joined the surface alongside them.
    for (const forbidden of ['GroqHttpRequest', 'GroqHttpResponse', 'authorizationHeaderValue']) {
      expect(barrel[forbidden]).toBeUndefined();
    }
  });

  it('no source touched by this repair references the protected reconciliation directory', () => {
    for (const file of [
      'packages/model-gateway/src/contracts/model-id.ts',
      'packages/model-gateway/src/contracts/capabilities.ts',
      'packages/model-gateway/src/operations/provider-release.ts',
      'packages/model-gateway/src/providers/groq/groq-config.ts',
      'packages/model-gateway/src/index.ts',
      'packages/groq-staging-smoke/src/config.ts',
    ]) {
      expect(readFileSync(fileURLToPath(new URL(file, REPO_ROOT)), 'utf8')).not.toContain(
        'qfj-managed-reconciliation',
      );
    }
  });
});
