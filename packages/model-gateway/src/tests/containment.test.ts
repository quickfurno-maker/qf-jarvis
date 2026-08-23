/**
 * QFJ-P04.01A — containment proofs (ADR-0045).
 *
 * Prove the slice stays within its envelope: the new package depends only on zod (no network/provider
 * SDK/database/env); it exposes only the root and the `./testing` subpath; the FakeModelProvider is not
 * a production-root export; there is no real provider adapter; the event-backbone root API remains 39
 * and its barrel is untouched; migrations 0001–0012 are exact and there is no 0013; and Kimi appears
 * nowhere in the package. No database is used.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const PKG_DIR = new URL('../../', import.meta.url);

function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, REPO_ROOT));
}
function readRepo(rel: string): string {
  return readFileSync(repoPath(rel), 'utf8');
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkSource(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

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

describe('model-gateway package containment', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };

  it('depends only on zod — no network/provider-SDK/database dependency', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    const all = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
    for (const name of Object.keys(all)) {
      expect(name).not.toMatch(
        /pg|postgres|groq|openai|anthropic|ollama|llama|axios|node-fetch|undici/i,
      );
    }
  });

  it('exposes only the root and the ./testing subpath', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  /**
   * QFJ-S2-B (ADR-0062 §7): the package-root RUNTIME surface is frozen at 71.
   *
   * This package had no numeric count lock while its siblings did (groq-staging-smoke 24,
   * model-evaluation 33, event-backbone 39), so its 71-symbol surface could drift silently. Counting
   * the imported barrel counts runtime exports only — `export type` produces no runtime binding — so
   * adding a type costs nothing and adding a value is a deliberate, reviewed change.
   */
  it('freezes the package-root runtime API at exactly 80 symbols', async () => {
    // POST-RBD1 FORENSICS: 79 -> 80. `createGroqChatBestEffortDiagnosticProvider` -- the
    // DIAGNOSTIC-ONLY BEST-EFFORT `json_schema` adapter.
    //
    // ONE and no more. RLD1 and RBD1 both met `json_validate_failed` under `strict: true`, at 4,096
    // and at 8,192, so the open axis is the strict DECODING POSTURE. Production's non-strict branch
    // cannot express that question -- it returns `json_object`, dropping the schema name, the strict
    // flag and the schema body together -- and the candidate evidence operator is the only package
    // that can see both this gateway and the real Riya request.
    //
    // The body builder stays off the root and is asserted through a relative import, for the reason
    // every diagnostic body builder does: a caller that never needs to build one must not be handed
    // the means to. `buildResponseFormat` is untouched and its non-strict branch still returns
    // `json_object`; no production path can ask for `strict: false` with a schema, there is no
    // automatic best-effort fallback, and there is no retry-on-strict-failure.
    // POST-RSP20B2 FORENSICS: 77 -> 79. `createGroqChatReasoningDiagnosticProvider` and
    // `GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT` -- the DIAGNOSTIC-ONLY Chat Completions
    // reasoning-effort adapter, and the documented default the historical baseline is recorded
    // against.
    //
    // Two and no more. The closed effort vocabulary and the body builder stay off the root and are
    // asserted through a relative import: a caller passing `'low'` needs the TYPE, not the array.
    //
    // The production adapter is untouched and still sends no reasoning field of any spelling, which
    // the diagnostic's own spec asserts before it asserts anything about the diagnostic. Adding an
    // optional parameter to `GroqModelProvider` instead would have put a reasoning control one
    // argument away from every production invocation, which is the change that is NOT authorized.
    // POST-MD120B3: 74 -> 77. `GROQ_RESPONSES_ENDPOINT`, `createFetchGroqResponsesTransport` and
    // `createGroqResponsesDiagnosticProvider` — the DIAGNOSTIC-ONLY Groq Responses API surface.
    //
    // Widening this lock is a deliberate decision recorded here rather than a number that drifted.
    // MD120B3 established that the same neutral production Riya request under strict Chat Completions
    // is refused with `json_validate_failed` on BOTH governed GPT-OSS models, so the next diagnostic
    // has to move the OUTPUT CONTRACT — and the candidate evidence operator, which is the only package
    // that can see both this gateway and the real Riya request, cannot compose that from outside
    // without an endpoint, a transport pinned to it, and an adapter that speaks its envelope.
    //
    // Three and no more. The body builder, the payload decoder and the response schema are asserted
    // by this package's own specs through a relative import and stay off the root: a caller that never
    // needs to build a Responses body must not be handed the means to.
    //
    // None of the three is a production surface. Nothing here registers a provider, declares a
    // capability, or joins the routing table, and a spec below asserts that no production composition
    // in this repository builds either factory. Groq currently ships the Responses API as beta.
    // MVP-P2A.2 HF4-R7: 71 -> 74. `projectGroqStrictJsonSchema`, `renderStructuredJsonSchema` and
    // `GROQ_STRICT_PROJECTION_REASONS`. RUN S9's nine ordinary safety requests were all rejected with
    // HTTP 400 because the raw Zod rendering carried `$schema`, `const`, `minLength`, `maxLength`,
    // `pattern`, `minimum`, `maximum` and `maxItems` — none of which Groq's strict documentation
    // establishes — and nothing constrained the keyword set before the schema went on the wire.
    //
    // All three are pure functions or a closed vocabulary over a JSON Schema document: no credential,
    // no transport, no configuration, no mutation of the input. They are exported because the
    // candidate evidence operator is the ONLY package that can see both this gateway and the real Riya
    // schemas, and "the production schema projects into the documented subset" has to be asserted
    // against the real schema rather than a replica.
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel)).toHaveLength(80);
  });

  it('does not export FakeModelProvider from the production root', () => {
    const barrel = readRepo('packages/model-gateway/src/index.ts');
    // The barrel must not RE-EXPORT the fake provider or reach the ./testing subpath.
    expect(barrel).not.toMatch(/export\b[^;]*FakeModelProvider/);
    expect(barrel).not.toMatch(/from ['"][^'"]*testing/);
  });

  const productionFiles = (): string[] =>
    walkSource(fileURLToPath(new URL('src', PKG_DIR))).filter(
      (f) => !f.replace(/\\/g, '/').includes('/tests/'),
    );
  // The ONLY two designated network-egress files: the Groq hosted transport and the local transport.
  const isDesignatedTransport = (f: string): boolean => {
    const p = f.replace(/\\/g, '/');
    return (
      p.endsWith('/providers/groq/groq-transport.ts') ||
      p.endsWith('/providers/local-openai-compatible/local-transport.ts')
    );
  };

  it('performs no env / filesystem I/O and no provider SDK import in production source', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process)['"]/);
      expect(text).not.toMatch(/process\.env/);
      // No provider SDK dependency — the adapters use the platform fetch, not an SDK.
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|@anthropic-ai\/sdk|ollama|llama|vllm|localai|axios|undici)['"]/,
      );
    }
  });

  it('uses fetch ONLY in the two designated transport boundaries', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      if (isDesignatedTransport(file)) {
        continue;
      }
      expect(text).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('contains no unauthorized provider adapter and no Kimi reference in production source', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/kimi/i);
      // Groq (hosted) and the local OpenAI-compatible adapter are authorized; a direct hosted OpenAI
      // SaaS adapter and any other-vendor SDK adapter are not.
      expect(text).not.toMatch(/class\s+OpenAIProvider\b|class\s+AnthropicProvider\b/);
    }
  });
});

describe('cross-package invariants (QFJ-P04.01A must not disturb the event backbone)', () => {
  it('the event-backbone public-api lock remains 39', () => {
    const test = readRepo('packages/event-backbone/src/tests/public-api.test.ts');
    expect(test).toContain('toHaveLength(39)');
  });

  it('migrations 0001–0012 are byte-exact and there is no 0013', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED_MIGRATION_HASHES));
    for (const [name, hash] of Object.entries(LOCKED_MIGRATION_HASHES)) {
      const actual = createHash('sha256')
        .update(readFileSync(join(dir, name)))
        .digest('hex');
      expect(actual).toBe(hash);
    }
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((n) => n.startsWith('0013'))).toBe(false);
  });
});
