/**
 * QFJ-S1A — containment and repository guardrails (ADR-0061 §B, §C, §I, §J).
 *
 * Matrix: production source performs no network/database/n8n/WhatsApp/Core/Jarvis-runtime access, reads
 * no environment variable, writes no file, and holds no control byte or sync-over-async primitive; the
 * package depends only on @qf-jarvis/model-gateway and zod and exposes only the root plus `./testing`;
 * the public API surface is locked; the fixed Groq endpoint is unchanged and the gateway stays the only
 * router with no second adapter; no test performs a live request; there is no SQL, schema, or migration
 * 0011 and migrations 0001-0011 stay byte-exact; the event-backbone root API lock remains 39; RAG stays
 * disabled and the Conversation Operations Center is still absent; and the protected reconciliation
 * report directory is untouched.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GROQ_CHAT_COMPLETIONS_ENDPOINT } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import * as testingBarrel from '../testing/index.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const PKG_DIR = new URL('../../', import.meta.url);

function repoPath(relative: string): string {
  return fileURLToPath(new URL(relative, REPO_ROOT));
}
function readRepo(relative: string): string {
  return readFileSync(repoPath(relative), 'utf8');
}
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const SRC_DIR = fileURLToPath(new URL('src', PKG_DIR));
const productionFiles = (): string[] =>
  walk(SRC_DIR).filter((file) => !file.replace(/\\/g, '/').includes('/tests/'));
const allFiles = (): string[] => walk(SRC_DIR);

// eslint-disable-next-line no-control-regex
const CONTROL_BYTE = new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f]');

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

describe('containment — the harness reaches nothing it must not reach', () => {
  it('(48, 42) production source performs no direct network, DB, n8n, WhatsApp, or Core access', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      // QFJ-S1D-B: exactly ONE production module may name `fetch` — the instrumented transport, whose
      // whole purpose is to own the wire call so header/body phases become observable. Everywhere else
      // the only network capability is still the transport handed in at composition.
      if (!file.replace(/\\/g, '/').endsWith('/instrumented-transport.ts')) {
        expect(text).not.toMatch(/\bfetch\s*\(/);
      }
      expect(text).not.toMatch(/\bXMLHttpRequest\b/);
      expect(text).not.toMatch(
        /from ['"]node:(net|http|http2|https|dns|tls|dgram|child_process|worker_threads)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|axios|undici|node-fetch|whatsapp-web\.js|@whiskeysockets\/baileys|n8n)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"]@qf-jarvis\/(core-decision-adapter|jarvis-runtime|agent-runtime|event-backbone|event-ingestion|governed-knowledge|rag-provisioning|model-evaluation|model-reply-adapter)['"]/,
      );
    }
  });

  it('(QFJ-S1D-B) the one fetch call site is confined, guarded, and single-shot', () => {
    const transport = readFileSync(
      fileURLToPath(new URL('src/instrumented-transport.ts', PKG_DIR)),
      'utf8',
    );
    // `fetch` appears exactly once, inside the injectable seam — never in the send path directly.
    expect(transport.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(transport).toContain('export function createSystemFetchLike()');
    // One delegation per send, and no loop that could produce a second.
    expect(transport.match(/await deps\.fetchLike\(/g)).toHaveLength(1);
    expect(transport).not.toMatch(/\b(while|for)\s*\(/);
    // The SSRF guard and the fixed endpoint come from the gateway, not from a local literal.
    expect(transport).toContain('GROQ_CHAT_COMPLETIONS_ENDPOINT');
    expect(transport).toContain('Refusing a Groq request to a non-official endpoint.');
    expect(transport).toContain("redirect: 'error'");
    // The original error is rethrown unchanged; only a closed enum class is recorded.
    expect(transport.match(/throw error;/g)).toHaveLength(2);
    // No REQUEST header value is ever read or copied. Checked against the code with comments stripped,
    // so the prose that documents this guarantee cannot be mistaken for a violation of it.
    const code = transport
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/authorization/i);
    expect(code).not.toMatch(/headers\s*\[/);
    // The only header read anywhere is the RESPONSE `retry-after`, matching the gateway's own rule.
    expect(code.match(/headers\.get\(/g)).toHaveLength(1);
    expect(code).toContain("headers.get('retry-after')");
    // Request headers are spread through untouched.
    expect(code).toContain('headers: { ...request.headers }');
  });

  it('(12) production source reads no environment variable', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/process\s*\.\s*env/);
      expect(text).not.toMatch(/import\s*\.\s*meta\s*\.\s*env/);
      expect(text).not.toMatch(/from ['"]dotenv['"]/);
    }
  });

  it('(13) production source writes no file — the configuration is read-only', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bwriteFile(Sync)?\b/);
      expect(text).not.toMatch(/\bappendFile(Sync)?\b/);
      expect(text).not.toMatch(/\bcreateWriteStream\b/);
      expect(text).not.toMatch(/\bmkdir(Sync)?\b/);
      expect(text).not.toMatch(/\brm(Sync)?\b/);
    }
    // node:fs is imported exactly once, for the read-only configuration load.
    const withFs = productionFiles().filter((file) =>
      /from ['"]node:fs['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(withFs.map((file) => file.replace(/\\/g, '/').split('/').pop())).toEqual(['config.ts']);
  });

  it('(49, 50) there is no SQL, schema, or migration anywhere in this package', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|INSERT INTO|SELECT .* FROM)\b/i);
      expect(text).not.toMatch(/\bmigration\b/i);
    }
    // Nor any SQL asset, nor a migrations directory, anywhere under the package.
    expect(existsSync(fileURLToPath(new URL('migrations', PKG_DIR)))).toBe(false);
    expect(walkAny(SRC_DIR).filter((file) => file.endsWith('.sql'))).toEqual([]);
  });

  it('(53, 54) RAG stays disabled and the Operations Center is not implemented here', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const forbidden of ['embedding', 'vector', 'retrieval-augmented', 'pgvector', 'kimi']) {
        expect(text).not.toContain(forbidden);
      }
    }
    for (const name of Object.keys(barrel)) {
      expect(name.toLowerCase()).not.toContain('operationscenter');
    }
  });

  it('(59) production source contains no NUL/control byte', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });

  it('(60, ADR-0058 §5) production source uses no sync-over-async blocking primitive', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/Atomics\s*\.\s*wait\b/);
      expect(text).not.toMatch(/\b(execSync|spawnSync|deasync)\b/);
      expect(text).not.toMatch(/from ['"]deasync['"]/);
    }
  });
});

describe('dependency graph, exports, and the locked public API', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as { dependencies?: Record<string, string>; exports: Record<string, unknown> };

  it('(57) depends only on @qf-jarvis/model-gateway and zod — a leaf, so the graph stays acyclic', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/model-gateway',
      'zod',
    ]);
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('(57) nothing in the workspace depends on this package, so it cannot close a cycle', () => {
    const packagesDir = repoPath('packages');
    const appsDir = repoPath('apps');
    const dependants: string[] = [];
    for (const dir of [packagesDir, appsDir]) {
      for (const entry of readdirSync(dir)) {
        const manifestPath = join(dir, entry, 'package.json');
        if (!existsSync(manifestPath)) {
          continue;
        }
        const other = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          name?: string;
          dependencies?: Record<string, string>;
        };
        if (
          other.name !== '@qf-jarvis/groq-staging-smoke' &&
          Object.keys(other.dependencies ?? {}).includes('@qf-jarvis/groq-staging-smoke')
        ) {
          dependants.push(other.name ?? entry);
        }
      }
    }
    expect(dependants).toEqual([]);
  });

  it('(55) locks the root barrel surface', () => {
    const EXPECTED = [
      'CREDENTIAL_PROMPT_LABEL',
      'MAX_CREDENTIAL_LENGTH',
      'MAX_SMOKE_TIMEOUT_MS',
      'MIN_CREDENTIAL_LENGTH',
      'MIN_SMOKE_TIMEOUT_MS',
      'SMOKE_FAILURE_REASONS',
      'SMOKE_PROMPT_FAMILY',
      'SMOKE_PROMPT_VERSION',
      'SMOKE_SCHEMA_REVISION',
      'SMOKE_SUCCESS_REASON',
      'SYNTHETIC_SMOKE_JSON_SCHEMA',
      'SYNTHETIC_SMOKE_MESSAGES',
      'createMaskedTtyCredentialResolver',
      'createNodeMaskedSecretSource',
      'createSystemSmokeTimer',
      'formatSanitizedPreRunFailure',
      'formatSanitizedSmokeResult',
      'isSmokeReason',
      'isSyntheticSmokeResponse',
      'loadSmokeConfig',
      'parseSmokeArgv',
      'parseSmokeConfig',
      'runGroqStagingSmokeOnce',
      'runSmokeCli',
    ];
    expect(Object.keys(barrel).sort()).toEqual([...EXPECTED].sort());
  });

  it('(55) the deterministic fakes never leak into the root barrel', () => {
    const rootSurface = barrel as unknown as Record<string, unknown>;
    for (const testOnly of Object.keys(testingBarrel)) {
      expect(rootSurface[testOnly]).toBeUndefined();
    }
    expect(rootSurface['FAKE_SMOKE_SENTINEL_CREDENTIAL']).toBeUndefined();
  });

  it('(56) the emitting build excludes the specs, so dist stays production-only', () => {
    const buildConfig = readFileSync(
      fileURLToPath(new URL('tsconfig.build.json', PKG_DIR)),
      'utf8',
    );
    expect(buildConfig).toContain('"exclude": ["src/tests/**"]');
    const distDir = fileURLToPath(new URL('dist', PKG_DIR));
    if (existsSync(distDir)) {
      for (const file of walkAny(distDir)) {
        const relative = file.replace(/\\/g, '/');
        expect(relative).not.toMatch(/\/tests\//);
        expect(relative).not.toMatch(/\.test\./);
        // The obvious sentinel is test support; it may live under dist/testing (the shipped
        // `./testing` subpath) but never anywhere else in the emitted output.
        if (!relative.includes('/dist/testing/')) {
          expect(readFileSync(file, 'utf8')).not.toContain('FAKE-STAGING-SENTINEL');
        }
      }
    }
  });
});

function walkAny(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkAny(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('the S1 safety contract is preserved, not re-implemented', () => {
  it('(45) the fixed Groq endpoint is unchanged', () => {
    expect(GROQ_CHAT_COMPLETIONS_ENDPOINT).toBe('https://api.groq.com/openai/v1/chat/completions');
    const transport = readRepo('packages/model-gateway/src/providers/groq/groq-transport.ts');
    expect(transport).toContain(
      "export const GROQ_CHAT_COMPLETIONS_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';",
    );
    expect(transport).toContain("redirect: 'error'");
    expect(transport).toContain('Refusing a Groq request to a non-official endpoint.');
  });

  it('(46, 47) the gateway stays the only router and no second adapter is introduced', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      // No routing, selection, failover, or provider-registry logic lives in this package.
      expect(text).not.toMatch(/\bcreateModelGateway\b/);
      expect(text).not.toMatch(/\bHybridRoutingPolicy\b/);
      expect(text).not.toMatch(/\bcreateProviderRolloutController\b/);
      expect(text).not.toMatch(/\bimplements ModelProvider\b/);
      expect(text).not.toMatch(/\bclass \w*ModelProvider\b/);
    }
    // The one provider used is constructed BY the gateway's own staging binding.
    expect(readPackageSource('src/run-once.ts')).toContain('bindGroqStagingProvider');
  });

  it('(48) no spec performs a live request — every transport in the suite is injected', () => {
    const specs = allFiles().filter((file) => file.replace(/\\/g, '/').includes('/tests/'));
    expect(specs.length).toBeGreaterThan(0);
    for (const file of specs) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      // A spec may ASSERT on the name as a string, but it must never IMPORT the real transport — an
      // unimported symbol cannot be called, so no spec can open a socket.
      //
      // QFJ-S1D-E: anchored to line starts. Unanchored, `import` also matched `import.meta.url`, and
      // the lazy span then swallowed unrelated assertion text — a false positive. Real import
      // statements are line-initial, so anchoring drops only the false matches.
      const importStatements = text.match(/^import[\s\S]*?from\s*['"][^'"]+['"]/gm) ?? [];
      for (const statement of importStatements) {
        expect(statement).not.toContain('createFetchGroqTransport');
      }
      // And no spec ever wires the REAL terminal into a run; every run injects a scripted source.
      expect(text).not.toMatch(/credentialSource:\s*createNodeMaskedSecretSource/);
    }
    // The one real transport call site is the executable composition root, which no spec imports.
    // Since QFJ-S1D-B it composes the instrumented transport over the platform fetch seam.
    expect(readPackageSource('src/bin.ts')).toContain('createInstrumentedGroqTransport({');
    expect(readPackageSource('src/bin.ts')).toContain('createSystemFetchLike()');
    for (const file of specs) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"][./]*bin\.js['"]/);
    }
  });
});

function readPackageSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, PKG_DIR)), 'utf8');
}

describe('repository invariants that this slice must not move', () => {
  it('(51, 50) migrations 0001-0012 are byte-exact and there is no 0013', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
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
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((name) => name.startsWith('0013'))).toBe(false);
  });

  it('(52) the event-backbone public-api lock remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });

  it('(58) the protected reconciliation report directory is untouched', () => {
    const protectedDir = repoPath('docs/reports/qfj-managed-reconciliation-0002-0005');

    // The directory is deliberately UNTRACKED, so it is absent from a fresh checkout (CI) and present
    // on the owner's machine. The invariant is therefore not "it exists" — it is that this slice
    // neither commits it nor changes it. Where it exists, its single file must be unchanged.
    if (existsSync(protectedDir)) {
      expect(readdirSync(protectedDir).sort()).toEqual(['01-read-only-live-reconciliation.md']);
    }

    // And this slice writes its own reports to its OWN directory, never inside the protected one.
    const ourReports = repoPath('docs/reports/qfj-s1a-groq-smoke-activation-enablement');
    expect(existsSync(ourReports)).toBe(true);
    expect(readdirSync(ourReports).every((name) => name.endsWith('.md'))).toBe(true);
  });
});
