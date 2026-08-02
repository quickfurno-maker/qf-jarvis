import { SYNTHETIC_PROMPT_DIGEST } from '../testing/fixtures.js';
/**
 * QFJ-S1C-B — evaluation bindings accept a namespaced provider model id, and the mirrored grammar is
 * proven identical to the canonical one.
 *
 * The grammar in `contracts/model-id.ts` is a deliberate mirror of
 * `packages/model-gateway/src/contracts/model-id.ts`, because this package must not depend on the
 * gateway it produces evidence about. A mirror that is merely *intended* to match is a mirror that
 * silently drifts, so the equality here is mechanical: the canonical source is read, its pattern and
 * bound are reconstructed, and both are compared textually AND behaviourally across a shared corpus.
 * No dependency is added in either direction to make that work.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MAX_PROVIDER_MODEL_ID_LENGTH,
  PROVIDER_MODEL_ID_PATTERN,
  isProviderModelId,
} from '../contracts/model-id.js';
import { createEvaluationBinding } from '../index.js';
import * as barrel from '../index.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);

const CANONICAL_SOURCE_PATH = 'packages/model-gateway/src/contracts/model-id.ts';

/** Model ids that MUST be accepted — the approved Groq identity plus other real catalogue shapes. */
const ACCEPTED = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'deepseek-r1-distill-llama-70b',
  'a/b/c',
  'a',
  'model.v1:2-final',
];

/** Model ids that MUST be rejected, with the reason each one exists in the corpus. */
const REJECTED: readonly { readonly why: string; readonly value: string }[] = [
  { why: 'empty', value: '' },
  { why: 'leading slash', value: '/openai/gpt-oss-20b' },
  { why: 'trailing slash', value: 'openai/gpt-oss-20b/' },
  { why: 'double slash', value: 'openai//gpt-oss-20b' },
  { why: 'bare slash', value: '/' },
  { why: 'only slashes', value: '//' },
  { why: 'backslash', value: `openai${String.fromCharCode(92)}gpt-oss-20b` },
  { why: 'inner space', value: 'openai/gpt oss 20b' },
  { why: 'leading space', value: ' openai/gpt-oss-20b' },
  { why: 'trailing space', value: 'openai/gpt-oss-20b ' },
  { why: 'tab', value: `openai/${String.fromCharCode(9)}gpt` },
  { why: 'newline', value: `openai/gpt${String.fromCharCode(10)}` },
  { why: 'question mark', value: 'openai/gpt-oss-20b?x=1' },
  { why: 'hash', value: 'openai/gpt-oss-20b#frag' },
  { why: 'percent', value: 'openai/gpt%2Foss' },
  { why: 'ampersand', value: 'openai/gpt&oss' },
  { why: 'equals', value: 'openai/gpt=oss' },
  { why: 'at sign', value: 'openai@gpt-oss-20b' },
  { why: 'https URL', value: 'https://api.groq.com/openai/v1/chat/completions' },
  { why: 'http URL', value: 'http://localhost/model' },
  { why: 'protocol-relative URL', value: '//api.groq.com/model' },
  { why: 'wildcard', value: '*' },
  { why: 'over the length bound', value: `a/${'b'.repeat(MAX_PROVIDER_MODEL_ID_LENGTH)}` },
];

function bindingWith(modelId: string): () => unknown {
  return () =>
    createEvaluationBinding({
      evaluationSuiteId: 'suite.connectivity',
      evaluationSuiteVersion: 1,
      fixtureManifestId: 'fixtures.connectivity',
      fixtureManifestVersion: 1,
      evaluatorImplId: 'evaluator.deterministic',
      evaluatorImplVersion: 1,
      release: {
        releaseId: 'rel.groq.staging.1',
        providerId: 'groq',
        modelId,
        modelVersion: '2026-07',
        configDigest: 'abcdef01',
        executionClass: 'HOSTED',
      },
      promptFamily: 'qfj.s1a.synthetic.smoke',
      promptVersion: 1,
      promptDigest: SYNTHETIC_PROMPT_DIGEST,
      capabilityProfileRef: 'cap.groq.reply.v1',
      policyContractRevision: 'policy.v1',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
}

function accepts(modelId: string): boolean {
  try {
    bindingWith(modelId)();
    return true;
  } catch {
    return false;
  }
}

describe('an evaluation binding accepts the approved namespaced model id', () => {
  it('accepts openai/gpt-oss-20b', () => {
    expect(accepts('openai/gpt-oss-20b')).toBe(true);
  });

  it('accepts openai/gpt-oss-120b', () => {
    expect(accepts('openai/gpt-oss-120b')).toBe(true);
  });

  it('keeps accepting existing slash-free model ids', () => {
    for (const modelId of [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'deepseek-r1-distill-llama-70b',
    ]) {
      expect(accepts(modelId)).toBe(true);
    }
  });

  it('accepts a deeper namespace', () => {
    expect(accepts('a/b/c')).toBe(true);
    expect(accepts('meta-llama/llama-4-scout-17b-16e-instruct')).toBe(true);
  });

  it('records the model id verbatim, without normalisation', () => {
    const binding = createEvaluationBinding({
      evaluationSuiteId: 'suite.connectivity',
      evaluationSuiteVersion: 1,
      fixtureManifestId: 'fixtures.connectivity',
      fixtureManifestVersion: 1,
      evaluatorImplId: 'evaluator.deterministic',
      evaluatorImplVersion: 1,
      release: {
        releaseId: 'rel.groq.staging.1',
        providerId: 'groq',
        modelId: 'openai/gpt-oss-20b',
        modelVersion: '2026-07',
        configDigest: 'abcdef01',
        executionClass: 'HOSTED',
      },
      promptFamily: 'qfj.s1a.synthetic.smoke',
      promptVersion: 1,
      promptDigest: SYNTHETIC_PROMPT_DIGEST,
      capabilityProfileRef: 'cap.groq.reply.v1',
      policyContractRevision: 'policy.v1',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    expect(binding.release.modelId).toBe('openai/gpt-oss-20b');
  });
});

describe('malformed, URL-shaped, and out-of-bound model ids stay rejected', () => {
  for (const { why, value } of REJECTED) {
    it(`rejects ${why}`, () => {
      expect(isProviderModelId(value)).toBe(false);
      expect(accepts(value)).toBe(false);
    });
  }

  it('rejects a non-string', () => {
    for (const value of [null, undefined, 42, {}, ['openai/gpt-oss-20b']]) {
      expect(isProviderModelId(value)).toBe(false);
    }
  });

  it('accepts a model id at exactly the length bound and rejects one past it', () => {
    const atBound = `a/${'b'.repeat(MAX_PROVIDER_MODEL_ID_LENGTH - 2)}`;
    expect(atBound).toHaveLength(MAX_PROVIDER_MODEL_ID_LENGTH);
    expect(isProviderModelId(atBound)).toBe(true);
    expect(isProviderModelId(`${atBound}c`)).toBe(false);
  });
});

describe('the mirrored grammar is provably identical to the canonical gateway grammar', () => {
  const canonicalSource = readFileSync(
    fileURLToPath(new URL(CANONICAL_SOURCE_PATH, REPO_ROOT)),
    'utf8',
  );

  /** Reconstruct the canonical pattern from its source literal, without importing the package. */
  function canonicalPattern(): RegExp {
    const match = /export const PROVIDER_MODEL_ID_PATTERN = \/(.+)\/;/.exec(canonicalSource);
    expect(match).not.toBeNull();
    return new RegExp(match?.[1] ?? '(?!)');
  }

  function canonicalMaxLength(): number {
    const match = /export const MAX_PROVIDER_MODEL_ID_LENGTH = (\d+);/.exec(canonicalSource);
    expect(match).not.toBeNull();
    return Number.parseInt(match?.[1] ?? '-1', 10);
  }

  it('the pattern source string is byte-for-byte equal', () => {
    expect(PROVIDER_MODEL_ID_PATTERN.source).toBe(canonicalPattern().source);
    expect(PROVIDER_MODEL_ID_PATTERN.source).toBe('^[A-Za-z0-9._:-]+(?:\\/[A-Za-z0-9._:-]+)*$');
    expect(PROVIDER_MODEL_ID_PATTERN.flags).toBe('');
  });

  it('the length bound is equal', () => {
    expect(MAX_PROVIDER_MODEL_ID_LENGTH).toBe(canonicalMaxLength());
    expect(MAX_PROVIDER_MODEL_ID_LENGTH).toBe(128);
  });

  it('both grammars agree behaviourally across the whole corpus', () => {
    const canonical = canonicalPattern();
    const max = canonicalMaxLength();
    const canonicalAccepts = (value: string): boolean =>
      value.length >= 1 && value.length <= max && canonical.test(value);

    for (const value of [...ACCEPTED, ...REJECTED.map((r) => r.value)]) {
      expect({ value, local: isProviderModelId(value) }).toEqual({
        value,
        local: canonicalAccepts(value),
      });
    }
  });

  it('the evaluation binding agrees with the canonical grammar too', () => {
    const canonical = canonicalPattern();
    const max = canonicalMaxLength();
    for (const value of [...ACCEPTED, ...REJECTED.map((r) => r.value)]) {
      const canonicalAccepts = value.length >= 1 && value.length <= max && canonical.test(value);
      expect({ value, viaBinding: accepts(value) }).toEqual({
        value,
        viaBinding: canonicalAccepts,
      });
    }
  });

  it('this package still depends on zod alone — no dependency was added in either direction', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    expect(Object.keys(manifest.devDependencies ?? {})).toEqual([]);
    // And no source file reaches for the gateway.
    for (const file of ['contracts/model-id.ts', 'contracts/binding.ts']) {
      expect(
        readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8'),
      ).not.toContain('@qf-jarvis/model-gateway');
    }
  });
});

describe('generic identifiers in this package did NOT learn to accept a slash', () => {
  const NAMESPACED = 'openai/gpt-oss-20b';

  for (const field of ['releaseId', 'providerId', 'modelVersion'] as const) {
    it(`release.${field} still rejects a slash`, () => {
      expect(() =>
        createEvaluationBinding({
          evaluationSuiteId: 'suite.connectivity',
          evaluationSuiteVersion: 1,
          fixtureManifestId: 'fixtures.connectivity',
          fixtureManifestVersion: 1,
          evaluatorImplId: 'evaluator.deterministic',
          evaluatorImplVersion: 1,
          release: {
            releaseId: 'rel.groq.staging.1',
            providerId: 'groq',
            modelId: 'llama-3.3-70b-versatile',
            modelVersion: '2026-07',
            configDigest: 'abcdef01',
            executionClass: 'HOSTED',
            [field]: NAMESPACED,
          },
          promptFamily: 'qfj.s1a.synthetic.smoke',
          promptVersion: 1,
          promptDigest: SYNTHETIC_PROMPT_DIGEST,
          capabilityProfileRef: 'cap.groq.reply.v1',
          policyContractRevision: 'policy.v1',
          createdAt: '2026-07-28T00:00:00.000Z',
        }),
      ).toThrow();
    });
  }

  for (const field of [
    'evaluationSuiteId',
    'fixtureManifestId',
    'evaluatorImplId',
    'promptFamily',
    'capabilityProfileRef',
    'policyContractRevision',
  ] as const) {
    it(`${field} still rejects a slash`, () => {
      const base = {
        evaluationSuiteId: 'suite.connectivity',
        evaluationSuiteVersion: 1,
        fixtureManifestId: 'fixtures.connectivity',
        fixtureManifestVersion: 1,
        evaluatorImplId: 'evaluator.deterministic',
        evaluatorImplVersion: 1,
        release: {
          releaseId: 'rel.groq.staging.1',
          providerId: 'groq',
          modelId: 'llama-3.3-70b-versatile',
          modelVersion: '2026-07',
          configDigest: 'abcdef01',
          executionClass: 'HOSTED' as const,
        },
        promptFamily: 'qfj.s1a.synthetic.smoke',
        promptVersion: 1,
        promptDigest: SYNTHETIC_PROMPT_DIGEST,
        capabilityProfileRef: 'cap.groq.reply.v1',
        policyContractRevision: 'policy.v1',
        createdAt: '2026-07-28T00:00:00.000Z',
      };
      expect(() => createEvaluationBinding({ ...base, [field]: NAMESPACED })).toThrow();
    });
  }

  it('the generic charset literal is still present in the binding contract', () => {
    const binding = readFileSync(
      fileURLToPath(new URL('../contracts/binding.ts', import.meta.url)),
      'utf8',
    );
    expect(binding).toContain('/^[A-Za-z0-9._:-]+$/');
  });
});

describe('public API and repository invariants', () => {
  it('(8) this package’s public API is UNCHANGED — the grammar stays internal', () => {
    // The validator is deliberately not re-exported: the barrel lock in containment.test.ts is the
    // authority on this surface, and this repair adds nothing to it.
    const surface = barrel as unknown as Record<string, unknown>;
    for (const name of [
      'PROVIDER_MODEL_ID_PATTERN',
      'MAX_PROVIDER_MODEL_ID_LENGTH',
      'providerModelIdSchema',
      'isProviderModelId',
    ]) {
      expect(surface[name]).toBeUndefined();
    }
    // The authoritative key-for-key lock lives in containment.test.ts and is untouched by this
    // repair; this is the count guard that would catch an accidental re-export from here.
    expect(Object.keys(barrel)).toHaveLength(33);
  });

  it('(9) the model-gateway canonical export surface is still intact', () => {
    const gatewayBarrel = readFileSync(
      fileURLToPath(new URL('packages/model-gateway/src/index.ts', REPO_ROOT)),
      'utf8',
    );
    for (const name of [
      'PROVIDER_MODEL_ID_PATTERN',
      'MAX_PROVIDER_MODEL_ID_LENGTH',
      'providerModelIdSchema',
      'isProviderModelId',
    ]) {
      expect(gatewayBarrel).toContain(name);
    }
  });

  it('(10) the groq staging smoke config still binds the approved model id', () => {
    const smokeConfig = readFileSync(
      fileURLToPath(new URL('packages/groq-staging-smoke/src/config.ts', REPO_ROOT)),
      'utf8',
    );
    expect(smokeConfig).toContain(
      "import { providerModelIdSchema } from '@qf-jarvis/model-gateway'",
    );
    expect(smokeConfig).toContain('modelId: EXACT_MODEL_ID');
    expect(isProviderModelId('openai/gpt-oss-20b')).toBe(true);
  });

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
    '0008_conversation_control_persistence.sql':
      'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
    '0009_durable_approval_queue.sql':
      'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
  };

  it('(11, 12) migrations 0001-0009 are byte-identical and 0010 is absent', () => {
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
    expect(sql.some((name) => name.startsWith('0010'))).toBe(false);
  });

  it('(13) the event-backbone root API lock remains 39', () => {
    expect(
      readFileSync(
        fileURLToPath(new URL('packages/event-backbone/src/tests/public-api.test.ts', REPO_ROOT)),
        'utf8',
      ),
    ).toContain('toHaveLength(39)');
  });

  it('(14) no source touched by this repair references the protected directory', () => {
    for (const file of [
      'packages/model-evaluation/src/contracts/model-id.ts',
      'packages/model-evaluation/src/contracts/binding.ts',
    ]) {
      expect(readFileSync(fileURLToPath(new URL(file, REPO_ROOT)), 'utf8')).not.toContain(
        'qfj-managed-reconciliation',
      );
    }
  });
});
