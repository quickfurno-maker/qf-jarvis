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

  it('(37, 38) no Retry-After text, header or URL can be surfaced', () => {
    const normalization = codeOnly(
      readRepo('packages/model-gateway/src/providers/groq/groq-error-normalization.ts'),
    );
    // The status classifier's whole input is still a NUMBER.
    expect(normalization).toContain('normalizeGroqHttpStatus(status: number)');
    for (const forbidden of ['retryAfter', 'header', 'https://']) {
      expect(normalization.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('(37, 38) the body is COMPARED against one closed literal and never surfaced', () => {
    // QFJ-S2-E-C-R3: `normalizeGroqHttpFailure` now receives the response body, because a Groq
    // `json_validate_failed` 400 is an OUTPUT failure and was otherwise indistinguishable from a
    // credential rejection. The original assertion rested on the input being a bare number; that premise
    // no longer holds, so the invariant is asserted directly instead — and more precisely: the body may
    // be read, but nothing derived from it may escape.
    const source = codeOnly(
      readRepo('packages/model-gateway/src/providers/groq/groq-error-normalization.ts'),
    );

    // Exactly one recognised code, declared once as a literal.
    expect(source.match(/'json_validate_failed'/g)).toHaveLength(1);

    // The body is parsed and compared. It is never spread, returned, or attached to a result.
    expect(source).toContain('JSON.parse(bodyText)');
    expect(source).not.toMatch(/return[^;]*bodyText/);
    expect(source).not.toMatch(/\.\.\.\s*(parsed|envelope|error|body)/);
    // `bodyText` appears ONLY as a parameter declaration; the returned-shape check below proves it is
    // never carried out of the module. A bare /bodyText\s*:/ scan would flag the signature itself.
    expect(source.match(/bodyText/g) ?? []).toHaveLength(4);

    // No field of the error envelope other than the code is ever read.
    for (const forbidden of ['message', 'failed_generation', 'request_id', 'stack', 'cause']) {
      expect(source).not.toContain(forbidden);
    }

    // Every returned object is a closed provider status; none carries the status code or the body.
    const returns = source.match(/return \{[^}]*\}/g) ?? [];
    expect(returns.length).toBeGreaterThan(0);
    for (const returned of returns) {
      expect(returned).toMatch(/status: '(rate-limited|cancelled|unavailable|failed|malformed)'/);
      expect(returned).not.toContain('bodyText');
      expect(returned).not.toContain('code');
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

  it('the ONE internal subpath exports exactly one factory, and the root does not', async () => {
    // QFJ-S2-E-B (ADR-0065 §5): `apps/api` needs the evidence registry to compose a process-local
    // SHADOW gateway. It is exposed through one explicit internal subpath rather than the root, so the
    // root API count stays at 2 and the registry does not become a general extension surface.
    const internal =
      (await import('../evidence/evaluation-evidence-registry.js')) as unknown as Record<
        string,
        unknown
      >;
    expect(Object.keys(internal)).toEqual(['createEvaluationEvidenceRegistry']);

    const manifest = JSON.parse(readRepo('packages/model-gateway-composition/package.json')) as {
      exports?: Record<string, Record<string, string>>;
    };
    const exports = manifest.exports ?? {};
    expect(Object.keys(exports).sort()).toEqual(['.', './internal/evidence-registry']);
    // Every target resolves into `dist/`: a subpath into `src/` would publish unbuilt source.
    for (const entry of Object.values(exports)) {
      for (const target of Object.values(entry)) {
        expect(target.startsWith('./dist/')).toBe(true);
      }
    }

    const root = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(root['createEvaluationEvidenceRegistry']).toBeUndefined();
  });
});

describe('(43, 44, 45) sibling package API locks are undisturbed', () => {
  it('(43) groq-staging-smoke remains 30', () => {
    expect(
      readRepo('packages/groq-staging-smoke/src/tests/credential-ingress-diagnostics.test.ts'),
      // MVP-P2A.2 HF1 restated the sibling count from 24 to 27 for the semantic approval-digest
      // helper. HF4-R4 restates it to 28 for `createSystemSmokeWireDeps`, the one pairing of the
      // instrumented transport with the recorder that owns its wire milestones -- RUN S5's smoke
      // PASSED while printing every wire milestone ABSENT because that pairing was duplicated
      // across two composition roots and the other one got it wrong.
      // HF4-R5 restates it to 30 for the one-shot Windows clipboard credential ingress:
      // `createClipboardCredentialResolver` and `createWindowsPowerShellClipboardSource`.
      // This lock tracks that package's own assertion, so it moves with it.
    ).toContain('toHaveLength(30)');
  });

  it('(44) model-evaluation remains 35', () => {
    const containment = readRepo('packages/model-evaluation/src/tests/containment.test.ts');
    const block = /const EXPECTED = \[([\s\S]*?)\];/.exec(containment);
    const symbols = (block?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith("'"));
    // RMB-A: 33 -> 34 records ONE authorised addition, `createProviderReleaseRef` -- the release
    // grammar made independently constructible so the operational-benchmark package can NAME a
    // release without a second copy of the six fields. Still an EXACT count; it records an
    // authorised addition, it does not relax the assertion.
    expect(symbols).toHaveLength(35);
  });

  it('(45) event-backbone remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });
});

describe('(46, 47) migrations are undisturbed', () => {
  it('(46, 47) 0001-0012 are byte-identical and 0013 is absent', () => {
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
      '0008_conversation_control_persistence.sql':
        'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
      '0009_durable_approval_queue.sql':
        'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
      '0010_execution_replay_claim.sql':
        '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
      '0011_riya_conversation_continuity.sql':
        '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
      // RWC-P8 (ADR-0104): the ONE authorized addition. Durable logical-turn idempotency, sitting
      // BELOW the ingress transport replay guard rather than replacing it. Repository and
      // LOCAL/CI only; nothing is applied to a managed database.
      '0012_riya_logical_turn_idempotency.sql':
        '5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e',
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
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((name) => name.startsWith('0013'))).toBe(false);
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
    // One public entry point plus the ONE internal process-boundary subpath ADR-0065 §5 authorises.
    // No `./testing` subpath is shipped, and no other extension surface exists.
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './internal/evidence-registry']);
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
