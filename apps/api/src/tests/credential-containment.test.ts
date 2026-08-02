/**
 * QFJ-S2-D-B — containment for the credential process boundary (ADR-0064 §4, §7, §12).
 *
 * This is the slice that first makes `apps/api` capable of holding a real secret, so the envelope is
 * asserted rather than assumed: no environment read, `node:fs` confined to ONE designated adapter, no
 * network, no shell, no terminal, no logger, no timer, no raw-secret fixture — and every `packages/**`
 * API and dependency lock still exactly where S2-C-B left it.
 *
 * Scans read CODE, not documentation: these modules describe what they refuse to do, and a raw-text
 * scan would flag the description as the violation. Every test is offline — file reads and pure
 * functions only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));

function readRepo(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
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

const normalise = (p: string): string => p.replace(/\\/g, '/');

/**
 * Every TypeScript file in apps/api EXCEPT this scanner.
 *
 * This spec necessarily names every string it forbids — `process` `.env`, the staging-smoke package,
 * the protected directory. Scanning itself would flag the prohibition as the violation, which is the
 * recurring false positive in this repository's containment suites. Excluding the scanner keeps the
 * check honest: it still covers all production source and the behavioural spec.
 */
const SCANNER = 'src/tests/credential-containment.test.ts';
const allFiles = (): string[] =>
  walk(join(APP_DIR, 'src')).filter((f) => !normalise(f).endsWith(`/${SCANNER}`));
/** Production source only — the specs are held to their own, narrower rules below. */
const productionFiles = (): string[] => allFiles().filter((f) => !normalise(f).includes('/tests/'));

/**
 * THE two files permitted to import `node:fs`, each with a single narrow job.
 *
 * S2-D-B allowed exactly one, for the CREDENTIAL. S2-E-B adds exactly one more, for the NON-SECRET run
 * configuration and evidence artifact (ADR-0065 §5). They are separate modules deliberately: the
 * credential reader enforces a 514-byte ceiling and POSIX mode bits, the JSON reader does not, and
 * merging them would let a non-secret path inherit secret-file handling or the reverse.
 */
const DESIGNATED_FS_ADAPTERS: readonly string[] = Object.freeze([
  'src/secrets/credential-file-reader.ts',
  'src/shadow/shadow-json-reader.ts',
]);
const isDesignatedAdapter = (f: string): boolean =>
  DESIGNATED_FS_ADAPTERS.some((a) => normalise(f).endsWith(`/${a}`));

/**
 * The files permitted to touch `process` at all, and the exact member each may touch.
 *
 * `process.env` is never in this table: no file in `apps/api` may read the environment (ADR-0064 §7,
 * ADR-0065 §12), asserted separately and unconditionally below.
 */
const PROCESS_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // The credential reader asks the platform whether POSIX mode bits are meaningful. Nothing else.
  'src/secrets/credential-file-reader.ts': ['process.platform'],
  // The two bin entries are the ONLY modules that read argv or set an exit code.
  'src/bin/run-shadow-once.ts': ['process.exitCode', 'process.argv'],
  'src/bin/generate-shadow-evidence.ts': ['process.exitCode', 'process.argv'],
  // The default IO factories are the ONLY modules that touch a stream, and only for WRITING.
  'src/cli/run-shadow-once.ts': ['process.stdout'],
  'src/cli/generate-shadow-evidence.ts': ['process.stdout', 'process.stderr'],
});

/** THE one file permitted to arm a timer: the single hard run deadline (ADR-0065 §11). */
const DESIGNATED_TIMER_MODULE = 'src/shadow/create-controlled-shadow-runner.ts';

/**
 * THE one PRODUCTION file permitted to reach a database (QFJ-P08-B3, ADR-0078).
 *
 * QFJ-P08-B2 made a human takeover durable; nothing composed it, so on merged `main` the only
 * authoritative state a real runtime could receive was an in-process fake. This module is that seam.
 * It is named here, singular, so "apps/api can talk to PostgreSQL" stays a decision about one file
 * rather than a property the application quietly acquired.
 */
const DESIGNATED_DATABASE_MODULE = 'src/runtime/durable-jarvis-runtime.ts';
const isDesignatedDatabaseModule = (f: string): boolean =>
  normalise(f).endsWith(`/${DESIGNATED_DATABASE_MODULE}`);

/**
 * THE one file permitted to read the environment, and it is TEST-ONLY (QFJ-P08-B3, ADR-0078).
 *
 * The durable composition tests need a real PostgreSQL, which needs a connection string, which has
 * to come from somewhere. It is confined to a single harness that `tsconfig.build.json` excludes
 * from the emitting build, exactly as `@qf-jarvis/postgres-conversation-state` confines its own.
 *
 * PRODUCTION source still reads NOTHING — that rule is unchanged and asserted unconditionally below.
 */
const DESIGNATED_TEST_ENV_MODULE = 'src/tests/durable-database-harness.ts';

function allowlistFor(file: string): readonly string[] {
  const key = Object.keys(PROCESS_ALLOWLIST).find((k) => normalise(file).endsWith(`/${k}`));
  return key === undefined ? [] : (PROCESS_ALLOWLIST[key] ?? []);
}

/**
 * Strip documentation so a containment scan reads CODE.
 *
 * Block comments and whole-line `//` comments go; a trailing comment stays, so nothing on a code line
 * can hide behind one.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('(67) the process boundary reads no environment', () => {
  it('no PRODUCTION file in apps/api touches process.env', () => {
    for (const file of productionFiles()) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/process\s*\.\s*env/);
    }
  });

  it('exactly one TEST-ONLY module reads the environment, and only DATABASE_URL', () => {
    const readers = allFiles().filter((file) =>
      /process\s*\.\s*env/.test(readFileSync(file, 'utf8')),
    );
    expect(readers.map((f) => normalise(f).split('/apps/api/')[1] ?? '')).toEqual([
      DESIGNATED_TEST_ENV_MODULE,
    ]);

    // Exactly one read, of exactly one variable. Not a general environment reader.
    const harness = readFileSync(readers[0] ?? '', 'utf8');
    expect(harness.match(/process\s*\.\s*env\s*\[[^\]]*\]/g)).toEqual([
      "process.env['DATABASE_URL']",
    ]);
    expect(harness).not.toMatch(/process\s*\.\s*env\s*\./);

    // And it cannot reach dist: the emitting build excludes the whole test tree.
    expect(readFileSync(join(APP_DIR, 'tsconfig.build.json'), 'utf8')).toContain(
      '"exclude": ["src/tests/**"]',
    );
  });

  it('every `process` access is on the allowlist, and only in its designated file', () => {
    const seen = new Set<string>();
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const allowed = allowlistFor(file);
      for (const raw of code.match(/process\s*\.\s*[A-Za-z]+/g) ?? []) {
        const use = raw.replace(/\s/g, '');
        expect(allowed).toContain(use);
        seen.add(`${normalise(file).split('/src/')[1] ?? ''}:${use}`);
      }
    }
    // Every entry in the allowlist is actually used: a stale permission cannot linger unnoticed.
    const declared = Object.entries(PROCESS_ALLOWLIST).flatMap(([f, uses]) =>
      uses.map((u) => `${f.replace('src/', '')}:${u}`),
    );
    expect([...seen].sort()).toEqual([...declared].sort());
  });

  it('no file reads a stream — argv and exit codes are written, never stdin', () => {
    for (const file of allFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/process\s*\.\s*stdin/);
      expect(code).not.toMatch(/\bprompt\s*\(|setRawMode|createInterface/);
    }
  });
});

describe('(68) node:fs is confined to one designated adapter', () => {
  it('only the designated adapter imports a filesystem module', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      if (isDesignatedAdapter(file)) {
        expect(code).toMatch(/from 'node:fs\/promises'/);
        continue;
      }
      expect(code).not.toMatch(/from ['"]node:fs(\/promises)?['"]/);
    }
  });

  it('the designated adapters exist and are exactly the two declared files', () => {
    expect(productionFiles().filter(isDesignatedAdapter)).toHaveLength(
      DESIGNATED_FS_ADAPTERS.length,
    );
    expect(DESIGNATED_FS_ADAPTERS).toHaveLength(2);
  });

  it('neither adapter writes, deletes or changes a file', () => {
    for (const adapter of productionFiles().filter(isDesignatedAdapter)) {
      const code = codeOnly(readFileSync(adapter, 'utf8'));
      // Read-only by construction: `open` in the default 'r' mode, `lstat`, and nothing else.
      expect(code).toMatch(/import \{ open, lstat \} from 'node:fs\/promises'/);
      for (const mutation of [
        'writeFile',
        'appendFile',
        'unlink',
        'rm(',
        'rmdir',
        'mkdir',
        'rename',
        'chmod',
        'chown',
        'copyFile',
        'createWriteStream',
        'truncate',
      ]) {
        expect(code).not.toContain(mutation);
      }
    }
  });
});

describe('(69, 70) no network, shell, terminal, store, logger, timer or watcher', () => {
  const FORBIDDEN_MODULES =
    /from ['"]node:(net|http|https|dns|tls|dgram|child_process|readline|repl|worker_threads|cluster)['"]/;

  it('production source imports no network, shell or terminal module', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(FORBIDDEN_MODULES);
      // The one live HTTP call a SHADOW run makes is issued by the gateway's Groq transport inside
      // `packages/model-gateway`. `apps/api` supplies the credential and the composition; it never
      // opens a socket itself.
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/\bexec\w*\s*\(|\bspawn\w*\s*\(/);
    }
  });

  it('production source contains no clipboard, keychain, cloud-secret or Docker access', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'clipboard',
        'keychain',
        'keytar',
        'secretsmanager',
        'keyvault',
        'secretmanager',
        'dotenv',
        'vault',
        'dockerode',
        // Supabase is the DEPLOYMENT target and is never named in source, B3 included.
        'supabase',
        'groq-sdk',
        'openai',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
      // `postgres` is permitted in EXACTLY ONE module (QFJ-P08-B3), and forbidden everywhere else.
      if (!isDesignatedDatabaseModule(file)) {
        expect(code, file).not.toContain('postgres');
      }
    }
  });

  it('exactly one production module reaches a database, and it opens no connection of its own', () => {
    const touching = productionFiles().filter((file) => {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      return (
        code.includes('postgres') ||
        code.includes('event-backbone') ||
        code.includes('conversation-state')
      );
    });
    expect(touching.map((f) => normalise(f).split('/apps/api/')[1] ?? '')).toEqual([
      DESIGNATED_DATABASE_MODULE,
    ]);

    // And it reaches the database ONLY through the public workspace APIs: no `pg` import, no raw
    // pool, no SQL, no migration, no connection string handling, and no HTTP surface.
    const code = codeOnly(readFileSync(touching[0] ?? '', 'utf8'));
    expect(code).not.toMatch(/from ['"]pg['"]/);
    expect(code).not.toMatch(/\bnew\s+Pool\b/);
    expect(code).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/);
    expect(code).not.toMatch(/migrat/i);
    expect(code).not.toMatch(/connectionString/);
    expect(code).not.toMatch(/createServer|express|fastify/i);
  });

  it('production source creates no watcher or polling loop, and logs nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/setInterval|setImmediate/);
      expect(code).not.toMatch(/watchFile|fs\.watch|\bwatch\s*\(/);
      expect(code).not.toMatch(/console\s*\./);
      // No logging library is imported, and no error is serialised for output.
      expect(code).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
    }
  });

  it('exactly one module arms a timer, and it clears it', () => {
    const timerFiles = productionFiles().filter((file) =>
      codeOnly(readFileSync(file, 'utf8')).includes('setTimeout'),
    );
    expect(timerFiles.map((f) => normalise(f).split('/apps/api/')[1] ?? '')).toEqual([
      DESIGNATED_TIMER_MODULE,
    ]);
    const code = codeOnly(readFileSync(timerFiles[0] ?? '', 'utf8'));
    // One arm, one clear — the single hard deadline, released on every path.
    expect(code.match(/setTimeout/g)).toHaveLength(1);
    expect(code.match(/clearTimeout/g)).toHaveLength(1);
    // Not a repeating or rescheduling timer.
    expect(code).not.toMatch(/setInterval|refresh\s*\(\s*\)/);
  });
});

describe('the staging smoke stays out of the production boundary', () => {
  it('apps/api never imports groq-staging-smoke or the masked-TTY resolver', () => {
    for (const file of allFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toContain('@qf-jarvis/groq-staging-smoke');
      expect(text).not.toContain('createNodeMaskedSecretSource');
      expect(text).not.toContain('createMaskedTtyCredentialResolver');
    }
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // S2-E-B promotes the composition to a RUNTIME dependency: the controlled SHADOW runner is
    // production source that composes the real gateway (ADR-0065 §6). `zod` is the schema validator
    // already pinned by nine other workspace packages — no new third-party resolution (ADR-0065 §14).
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      // QFJ-P08-B3 (ADR-0078): the three -- and only three -- new production edges the durable
      // composition needs, to create a pool, build the durable adapter, and compose the runtime.
      // Still an EXACT set match, and still no new third-party resolution.
      '@qf-jarvis/event-backbone',
      '@qf-jarvis/jarvis-runtime',
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/model-gateway-composition',
      '@qf-jarvis/postgres-conversation-state',
      // QFJ-S3-I-B (ADR-0073): the SHADOW runner's fixed synthetic prompt is now a real
      // `PromptDefinition`, so its identity and its bytes cannot drift apart. Still an EXACT set.
      '@qf-jarvis/prompt-registry',
      'zod',
    ]);
    // QFJ-P08-B3: dev dependencies exist now, and are EXACTLY the three test-only fixture packages
    // the durable composition proof needs. An EXACT set, not merely a superset.
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/conversation-control',
      '@qf-jarvis/core-decision-adapter',
      '@qf-jarvis/model-reply-adapter',
    ]);
    // `pg` is absent from BOTH lists: the app composes a pool through event-backbone's public API
    // and never touches the driver.
    expect(manifest.dependencies?.['pg']).toBeUndefined();
    expect(manifest.devDependencies?.['pg']).toBeUndefined();
    expect(manifest.dependencies?.['zod']).toBe('4.4.3');
  });

  it('the composition is reached only through its declared entry points', () => {
    // Production source may import the composition root and the ONE internal subpath ADR-0065 §5
    // authorises. A deep `dist/` or `src/` reach-around would bypass the package boundary.
    const ALLOWED = new Set([
      '@qf-jarvis/model-gateway-composition',
      '@qf-jarvis/model-gateway-composition/internal/evidence-registry',
    ]);
    for (const file of allFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const specifier of text.match(/@qf-jarvis\/[a-z-]+(?:\/[A-Za-z0-9/_.-]+)?/g) ?? []) {
        if (!specifier.startsWith('@qf-jarvis/model-gateway-composition')) {
          continue;
        }
        expect(ALLOWED.has(specifier)).toBe(true);
      }
      expect(text).not.toMatch(/@qf-jarvis\/[a-z-]+\/(dist|src)\//);
    }
  });
});

describe('no raw-secret fixture is committed', () => {
  it('every credential-shaped literal is an unmistakable synthetic fake', () => {
    for (const file of allFiles()) {
      const text = readFileSync(file, 'utf8');
      // A real Groq key is `gsk_` followed by a long opaque run. Nothing of that shape may exist.
      expect(text).not.toMatch(/gsk_[A-Za-z0-9]{8,}/);
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(text).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      // Any fixture that looks like a credential must announce itself.
      // Only a credential-LENGTH literal must announce itself; a short probe like a bare prefix used
      // to assert ABSENCE is not credential-shaped and needs no marker.
      for (const literal of text.match(/'FAKE[A-Z0-9_]{20,}'/g) ?? []) {
        expect(literal).toContain('DO_NOT_USE');
      }
    }
  });

  it('no source file carries a literal control byte', () => {
    // Built numerically so this assertion does not itself contain one.
    // eslint-disable-next-line no-control-regex -- detecting control bytes IS this scan's purpose.
    const control = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f]');
    for (const file of allFiles()) {
      expect(control.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});

describe('(71-77) package API and dependency locks are untouched', () => {
  it('(71, 72) leaf package dependencies are unchanged', () => {
    for (const pkg of ['model-gateway', 'model-evaluation']) {
      const manifest = JSON.parse(readRepo(`packages/${pkg}/package.json`)) as {
        dependencies?: Record<string, string>;
      };
      expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    }
    const composition = JSON.parse(readRepo('packages/model-gateway-composition/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(composition.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/model-gateway',
      '@qf-jarvis/model-reply-adapter',
    ]);
  });

  it('(73-77) every package-root runtime API count is unchanged', async () => {
    const expected: Readonly<Record<string, number>> = {
      'model-evaluation': 33,
      'model-gateway': 71,
      'model-gateway-composition': 2,
      'groq-staging-smoke': 24,
      'event-backbone': 39,
      // QFJ-S3-D-A (ADR-0070): the new Anisha behaviour package, locked from the day it lands.
      'anisha-agent': 14,
      // QFJ-S3-I-A (ADR-0072): the prompt registry foundation, locked from the day it lands.
      'prompt-registry': 7,
      // QFJ-P08-A (ADR-0074): the conversation control foundation, locked from the day it lands.
      'conversation-control': 9,
      // QFJ-P08-B2 (ADR-0077): the durable adapter, locked from the day it lands.
      'postgres-conversation-state': 3,
      // QFJ-P05.05 (ADR-0079): the governed recommendation runtime, locked from the day it lands.
      'recommendation-runtime': 4,
      // QFJ-P08 (ADR-0080): the approval runtime foundation, locked from the day it lands.
      'approval-runtime': 3,
      // QFJ-P08 (ADR-0081): the durable approval queue, locked from the day it lands.
      'postgres-approval-queue': 3,
      // QFJ-P08-A (ADR-0075): agent-runtime 45 -> 46 (the operations snapshot constructor) and
      // jarvis-runtime unchanged at 6. Both are named here so the composition phase that touched
      // them is locked centrally, not only in their own packages.
      'agent-runtime': 46,
      'jarvis-runtime': 6,
    };
    for (const [pkg, count] of Object.entries(expected)) {
      const barrel = (await import(
        `../../../../packages/${pkg}/dist/index.js`
      )) as unknown as Record<string, unknown>;
      expect(Object.keys(barrel)).toHaveLength(count);
    }
  });

  it('apps/api adds no package-root runtime export of its own', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(barrel)).toHaveLength(0);
  });
});

describe('(78, 79, 80, 81) repository invariants', () => {
  it('(78, 79) migrations 0001-0009 are byte-identical and 0010 is absent', () => {
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
        '1927f32aff3b3b42a987fe6ff0c53f1caa2403040377c3effbba88817a1d2257',
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
    expect(sql.some((name) => name.startsWith('0010'))).toBe(false);
  });

  it('(80) no source references the protected reconciliation directory', () => {
    for (const file of allFiles()) {
      expect(readFileSync(file, 'utf8')).not.toContain('qfj-managed-reconciliation');
    }
  });

  it('(81) the specs import nothing database-, container- or network-capable', () => {
    const dir = join(APP_DIR, 'src', 'tests');
    const specs = readdirSync(dir).filter((name) => name.endsWith('.ts'));
    expect(specs.length).toBeGreaterThan(0);
    for (const name of specs) {
      const text = readFileSync(join(dir, name), 'utf8');
      // Anchored to line starts: unanchored, `import` also matches `import.meta.url`.
      const statements = text.match(/^import[\s\S]*?from\s*['"][^'"]+['"]/gm) ?? [];
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement).not.toMatch(/node:(net|http|https|dns|tls|dgram|child_process)/);
        expect(statement).not.toMatch(/\b(pg|postgres|supabase|dockerode|groq-sdk|openai)\b/);
      }
      expect(text).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
