/**
 * **The public API is a boundary, and this is the test that makes it one.**
 *
 * The migration runner has two entry points that take the advisory lock and execute DDL with
 * **no preflight**: `runMigrations` and `runMigrationsOnClient`. Both were once exported from
 * the package root, alongside `migrateWithPreflight`.
 *
 * That is not a hypothetical hole. It is a **documented, supported, type-safe way to migrate a
 * managed database around the gate**, published next to the gate, with nothing marking it as
 * the unsafe one. The CLI happened to call the safe function. Nothing whatsoever obliged the
 * next caller to — and the next caller is the one nobody reviews.
 *
 * **A gate with a signposted path around it is not a gate.** So the bypass is removed from the
 * root barrel, and this test fails if it ever comes back.
 *
 * ### What this test does NOT claim
 *
 * It does **not** claim the functions do not exist. They do, in
 * `persistence/migration-runner.ts`, and that is deliberate: `migrate.ts` composes them into
 * the gate, and the runner's own integration tests must be able to exercise the runner in
 * isolation. **Internal existence is fine. Public reachability is not.** The assertions below
 * prove exactly that distinction, and would be dishonest if they pretended otherwise.
 *
 * These are unit tests. They touch no database.
 */

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import * as publicApi from '../index.js';
import * as migrationRunner from '../persistence/migration-runner.js';

/**
 * The functions that mutate a database **without a preflight**. Neither may be reachable from
 * the package root, now or ever.
 */
const BYPASS_EXPORTS = ['runMigrations', 'runMigrationsOnClient'] as const;

/** The one supported way to migrate. */
const REQUIRED_EXPORTS = ['migrateWithPreflight', 'PreflightFailedError'] as const;

async function readPackageManifest(): Promise<{
  readonly exports: Record<string, unknown>;
}> {
  const manifest = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
  return JSON.parse(manifest) as { readonly exports: Record<string, unknown> };
}

describe('the public package API exposes the migration GATE', () => {
  it.each(REQUIRED_EXPORTS)('exports %s', (name) => {
    expect(publicApi).toHaveProperty(name);
    expect(publicApi[name]).toBeTypeOf('function');
  });

  it('exports migrateWithPreflight as the only mutation path — and it is callable', () => {
    // A named export that is not a function would satisfy `toHaveProperty` and be useless.
    expect(typeof publicApi.migrateWithPreflight).toBe('function');
    expect(publicApi.PreflightFailedError.prototype).toBeInstanceOf(Error);
  });
});

describe('the public package API does NOT expose the preflight bypass', () => {
  it.each(BYPASS_EXPORTS)('does not export %s', (name) => {
    // If this fails, somebody has re-added an ungated migration path to the package root and a
    // consumer can now migrate a managed database with no preflight, no version check, no TLS
    // check and no superuser check. Do not "fix" this by updating the test.
    expect(publicApi).not.toHaveProperty(name);
  });

  it('does not export loadMigrationFiles — it mutates nothing, but nobody asked for it', () => {
    // Never a bypass: it reads a directory. Removed because a public surface is a promise, and
    // an unused promise is a maintenance cost with no beneficiary.
    expect(publicApi).not.toHaveProperty('loadMigrationFiles');
  });

  it('keeps the bypass functions INTERNAL rather than pretending they do not exist', () => {
    // The honest half of the claim. They are real, they are reachable from inside the package,
    // and `migrate.ts` composes them into the gate. The boundary — not the function — is what
    // this test defends, and a test that asserted their non-existence would simply be false.
    for (const name of BYPASS_EXPORTS) {
      expect(migrationRunner).toHaveProperty(name);
      expect(migrationRunner[name]).toBeTypeOf('function');
    }
  });
});

describe('no package export subpath can reach the migration runner', () => {
  it('publishes exactly one entry point, ".", and no deep subpaths', async () => {
    const { exports } = await readPackageManifest();

    // A single "." entry. A `"./*"` wildcard — or any explicit `./persistence/...` subpath —
    // would re-open the bypass through a deep import, silently, while this file's other
    // assertions all still passed.
    expect(Object.keys(exports)).toStrictEqual(['.']);
  });

  it('exposes no subpath mentioning persistence, migration-runner, or dist internals', async () => {
    const { exports } = await readPackageManifest();

    for (const subpath of Object.keys(exports)) {
      expect(subpath).not.toContain('persistence');
      expect(subpath).not.toContain('migration-runner');
      expect(subpath).not.toContain('*');
    }

    // The root must resolve to the barrel this test just checked, and not to anything deeper.
    expect(JSON.stringify(exports['.'])).toContain('./dist/index.js');
    expect(JSON.stringify(exports['.'])).not.toContain('migration-runner');
  });
});
