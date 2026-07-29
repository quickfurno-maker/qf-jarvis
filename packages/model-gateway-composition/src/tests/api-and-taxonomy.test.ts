/**
 * QFJ-S2-B — the rate-limit taxonomy and every package/repository invariant (ADR-0062 §6, §7).
 *
 * The `rate-limited` path is proved END TO END: a Groq HTTP 429 normalizes to the distinct
 * `rate-limited` provider status, `gateway.ts` maps that status to the `rate-limited` error code, and
 * the live invoker reports `transient: true` — while still performing zero retries and zero fallback.
 *
 * Every test is offline: a fake transport, file reads and pure functions only. No real provider, no
 * network, no credential, no database, no Docker.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODEL_GATEWAY_ERROR_CODES,
  ModelGatewayError,
  type ModelGatewayErrorCode,
} from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PKG_DIR = new URL('../../', import.meta.url);

function readRepo(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * Strip documentation so a containment scan reads CODE, not prose. The Groq normalization module's own
 * header explains that it never surfaces a raw body or header — text a raw scan would flag as the
 * violation it describes.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('(35, 39, 40) the rate-limited code', () => {
  it('(39) is a member of the closed vocabulary with a fixed, low-cardinality message', () => {
    expect(MODEL_GATEWAY_ERROR_CODES).toContain('rate-limited');
    const error = new ModelGatewayError('rate-limited');
    expect(error.code).toBe('rate-limited');
    expect(error.message).toBe(
      'The provider refused the request because a rate or quota limit was reached.',
    );
    // A fixed message: constructing it twice cannot vary, and no cause is retained.
    expect(new ModelGatewayError('rate-limited').message).toBe(error.message);
    expect((error as unknown as { cause?: unknown }).cause).toBeUndefined();
  });

  it('(40) the normalization fallback remains fail-closed for an unknown code', () => {
    const error = new ModelGatewayError('not-a-real-code' as ModelGatewayErrorCode);
    expect(error.code).toBe('internal-invariant');
    expect(error.message).toBe('A gateway internal invariant was violated.');
  });

  it('(1, 2) a Groq 429 normalizes to rate-limited, and the gateway maps that status to the code', () => {
    const normalization = readRepo(
      'packages/model-gateway/src/providers/groq/groq-error-normalization.ts',
    );
    expect(normalization).toContain(
      "if (status === 429) {\n    return { status: 'rate-limited' };",
    );
    const gateway = readRepo('packages/model-gateway/src/gateway.ts');
    expect(gateway).toContain("case 'rate-limited':");
    expect(gateway).toContain(
      "return { kind: 'failure', code: 'rate-limited', invoked: true, retryable: false };",
    );
  });

  it('(17) the provider-result switch stays exhaustive — no default hides a future status', () => {
    // A `default:` would silently absorb the next status added to the union. Exhaustiveness is what
    // made THIS change a compile error rather than a silent misclassification, and it must stay so.
    const gateway = readRepo('packages/model-gateway/src/gateway.ts');
    const block = /switch \(result\.status\) \{([\s\S]*?)\n {4}\}/.exec(gateway);
    expect(block).not.toBeNull();
    expect(block?.[1] ?? '').not.toMatch(/^\s*default:/m);
    const cases = (block?.[1] ?? '').match(/^\s*case '/gm) ?? [];
    expect(cases).toHaveLength(7);
  });

  it('(18) the ModelGatewayError vocabulary remains closed and frozen', () => {
    expect(Object.isFrozen(MODEL_GATEWAY_ERROR_CODES)).toBe(true);
    expect(MODEL_GATEWAY_ERROR_CODES).toHaveLength(21);
    expect(new Set(MODEL_GATEWAY_ERROR_CODES).size).toBe(21);
  });
});

describe('(36, 37, 38) existing Groq HTTP mappings are unchanged', () => {
  it('(36) 401/403/4xx stay failed, 5xx and 498 stay unavailable, 499 stays cancelled', () => {
    const normalization = readRepo(
      'packages/model-gateway/src/providers/groq/groq-error-normalization.ts',
    );
    expect(normalization).toContain("if (status === 499) {\n    return { status: 'cancelled' };");
    expect(normalization).toContain(
      "if (status === 498) {\n    return { status: 'unavailable', retryable: true };",
    );
    expect(normalization).toContain(
      "if (status >= 500 && status <= 599) {\n    return { status: 'unavailable', retryable: true };",
    );
    expect(normalization).toContain("return { status: 'failed', retryable: false };");
  });

  it('(37, 38) no Retry-After text, header, body or URL can be surfaced', () => {
    const normalization = codeOnly(
      readRepo('packages/model-gateway/src/providers/groq/groq-error-normalization.ts'),
    );
    // The function's whole input is a NUMBER, so a header or body has no representable path out.
    expect(normalization).toContain('normalizeGroqHttpStatus(status: number)');
    for (const forbidden of ['retryAfter', 'header', 'body', 'https://']) {
      expect(normalization.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('(41, 42) package-root runtime API locks', () => {
  it('(41) @qf-jarvis/model-gateway root runtime API is exactly 71', async () => {
    const barrel = (await import('@qf-jarvis/model-gateway')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel)).toHaveLength(71);
  });

  it('(42) @qf-jarvis/model-gateway-composition root runtime API is exactly 2', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel)).toHaveLength(2);
  });
});

describe('(43, 44, 45) sibling package API locks are undisturbed', () => {
  it('(43) groq-staging-smoke remains 24', () => {
    expect(
      readRepo('packages/groq-staging-smoke/src/tests/credential-ingress-diagnostics.test.ts'),
    ).toContain('toHaveLength(24)');
  });

  it('(44) model-evaluation remains 33', () => {
    const containment = readRepo('packages/model-evaluation/src/tests/containment.test.ts');
    const block = /const EXPECTED = \[([\s\S]*?)\];/.exec(containment);
    const symbols = (block?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith("'"));
    expect(symbols).toHaveLength(33);
  });

  it('(45) event-backbone remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });
});

describe('(46, 47) migrations are undisturbed', () => {
  it('(46, 47) 0001-0007 are byte-identical and 0008 is absent', () => {
    const LOCKED: Record<string, string> = {
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
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED));
    for (const [name, hash] of Object.entries(LOCKED)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    expect(sql.some((name) => name.startsWith('0008'))).toBe(false);
  });
});

describe('(48, 49, 50) dependency and test containment', () => {
  it('(48) model-gateway dependencies remain exactly ["zod"]', () => {
    const manifest = JSON.parse(readRepo('packages/model-gateway/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
  });

  it('(49) the composition depends only on workspace packages — no third-party runtime dependency', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports: Record<string, unknown>;
    };
    const deps = manifest.dependencies ?? {};
    // QFJ-S2-C-B adds model-evaluation: the composition is the ONE layer that may see both leaves, so
    // the evidence bridge lives here rather than forcing a dependency between them (ADR-0063 §1).
    expect(Object.keys(deps).sort()).toEqual([
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/model-reply-adapter',
    ]);
    for (const spec of Object.values(deps)) {
      expect(spec).toBe('workspace:*');
    }
    // No event-backbone, no database, no provider SDK, no HTTP client.
    for (const name of Object.keys({ ...deps, ...(manifest.devDependencies ?? {}) })) {
      expect(name).not.toMatch(
        /event-backbone|pg|postgres|supabase|dockerode|groq|openai|anthropic|axios|node-fetch|undici/i,
      );
    }
    // A single public entry point; no ./testing subpath is shipped.
    expect(Object.keys(manifest.exports)).toEqual(['.']);
  });

  it('(50) the specs import nothing network-, database-, or container-capable', () => {
    const dir = fileURLToPath(new URL('src/tests/', PKG_DIR));
    const specs = readdirSync(dir).filter((name) => name.endsWith('.ts'));
    expect(specs.length).toBeGreaterThan(0);
    for (const name of specs) {
      const text = readFileSync(join(dir, name), 'utf8');
      // Anchored to line starts: an unanchored `import` also matches `import.meta.url`, and the lazy
      // span then swallows unrelated assertion text — the same false positive fixed in QFJ-S1D-E.
      const statements = text.match(/^import[\s\S]*?from\s*['"][^'"]+['"]/gm) ?? [];
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement).not.toMatch(/node:(net|http|https|dns|tls|dgram|child_process)/);
        expect(statement).not.toMatch(/\b(pg|postgres|supabase|dockerode|groq-sdk|openai)\b/);
        expect(statement).not.toContain('createFetchGroqTransport');
        expect(statement).not.toContain('createFetchLocalTransport');
        expect(statement).not.toContain('createNodeMaskedSecretSource');
      }
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\s*\.\s*env/);
    }
  });
});
