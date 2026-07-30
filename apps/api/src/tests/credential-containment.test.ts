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

/** THE one file permitted to import `node:fs`. */
const DESIGNATED_FS_ADAPTER = 'src/secrets/credential-file-reader.ts';
const isDesignatedAdapter = (f: string): boolean =>
  normalise(f).endsWith(`/${DESIGNATED_FS_ADAPTER}`);

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
  it('no file in apps/api touches process.env', () => {
    for (const file of allFiles()) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/process\s*\.\s*env/);
    }
  });

  it('the only `process` access anywhere is the platform predicate', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      const uses = code.match(/process\s*\.\s*[A-Za-z]+/g) ?? [];
      for (const use of uses) {
        expect(use.replace(/\s/g, '')).toBe('process.platform');
      }
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

  it('the designated adapter exists and is exactly one file', () => {
    const designated = productionFiles().filter(isDesignatedAdapter);
    expect(designated).toHaveLength(1);
  });
});

describe('(69, 70) no network, shell, terminal, store, logger, timer or watcher', () => {
  const FORBIDDEN_MODULES =
    /from ['"]node:(net|http|https|dns|tls|dgram|child_process|readline|repl|worker_threads|cluster)['"]/;

  it('production source imports no network, shell or terminal module', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(FORBIDDEN_MODULES);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/\bexec\w*\s*\(|\bspawn\w*\s*\(/);
      expect(code).not.toMatch(/process\s*\.\s*(stdin|stdout|stderr)/);
      expect(code).not.toMatch(/setRawMode|createInterface/);
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
        'supabase',
        'postgres',
        'groq-sdk',
        'openai',
      ]) {
        expect(code).not.toContain(forbidden);
      }
    }
  });

  it('production source creates no timer, watcher or polling loop, and logs nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/setInterval|setTimeout|setImmediate/);
      expect(code).not.toMatch(/watchFile|fs\.watch|\bwatch\s*\(/);
      expect(code).not.toMatch(/console\s*\./);
      // No logging library is imported, and no error is serialised for output.
      expect(code).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
    }
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
    // Production depends on the gateway alone. The composition is a TEST-ONLY dependency, present
    // solely so the OFF-only activation-safety spec can drive the real composition — production source
    // never imports it, asserted immediately below.
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@qf-jarvis/model-gateway']);
    expect(Object.keys(manifest.devDependencies ?? {})).toEqual([
      '@qf-jarvis/model-gateway-composition',
    ]);
    for (const file of productionFiles()) {
      expect(readFileSync(file, 'utf8')).not.toContain('model-gateway-composition');
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
  it('(78, 79) migrations 0001-0007 are byte-identical and 0008 is absent', () => {
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
