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
import * as conflictStore from '../persistence/conflict-store.js';
import * as migrationRunner from '../persistence/migration-runner.js';

/**
 * The functions that mutate a database **without a preflight**. Neither may be reachable from
 * the package root, now or ever.
 */
const BYPASS_EXPORTS = ['runMigrations', 'runMigrationsOnClient'] as const;

/** The one supported way to migrate. */
const REQUIRED_EXPORTS = ['migrateWithPreflight', 'PreflightFailedError'] as const;

/**
 * The COMPLETE package-root export surface, as of Stage 3.4.1.
 *
 * Stage 3.4.2 adds the projection registry entirely behind this boundary, so this list must not
 * change. A failure here means a slice widened (or narrowed) the public API — which is an ADR-level
 * decision, not an incidental edit. Update this snapshot only alongside the ADR that authorises it.
 */
const EXPECTED_ROOT_SURFACE = [
  'ConflictingEventDigestError',
  'DATABASE_CONFIG_BOUNDS',
  'DATABASE_CONFIG_DEFAULTS',
  'DatabaseConfigError',
  'DatabaseTlsError',
  'DuplicateMigrationVersionError',
  'EventPersistenceConsistencyError',
  'INGESTION_REJECTION_ISSUE_CODES',
  'INGESTION_REJECTION_REASON_CODES',
  'MAX_INGESTION_REJECTION_ISSUES',
  'MIGRATION_ADVISORY_LOCK_KEY',
  'MIGRATION_FILENAME_PATTERN',
  'MIGRATION_SCHEMA',
  'MIGRATION_TABLE',
  'MalformedMigrationFilenameError',
  'MigrationChecksumMismatchError',
  'MigrationError',
  'MigrationExecutionError',
  'MigrationFileMissingError',
  'OutOfOrderMigrationError',
  'PreflightFailedError',
  'REQUIRED_POSTGRES_MAJOR_VERSION',
  'UnsupportedConnectionModeError',
  'assertCaCertificateBundle',
  'assertConnectionUrlIsSupported',
  'closeDatabasePool',
  'createDatabaseConfig',
  'createDatabasePool',
  'defaultMigrationsDirectory',
  'describeConnectionTarget',
  'describeTls',
  'isLoopbackConnectionTarget',
  'migrateWithPreflight',
  'recordIngestionRejection',
  'runPreflight',
  'runPreflightOnClient',
  'storeValidatedEvent',
  'withClient',
  'withTransaction',
] as const;

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

describe('the Stage 3.3.3 rejection repository is public; the conflict repository is INTERNAL', () => {
  it('exports recordIngestionRejection and its vocabulary from the package root', () => {
    // The rejection repository is a trusted low-level append primitive a future ingest composition
    // may call; it is a supported public surface.
    expect(publicApi).toHaveProperty('recordIngestionRejection');
    expect(publicApi.recordIngestionRejection).toBeTypeOf('function');
    expect(publicApi).toHaveProperty('INGESTION_REJECTION_REASON_CODES');
    expect(publicApi).toHaveProperty('INGESTION_REJECTION_ISSUE_CODES');
    expect(publicApi).toHaveProperty('MAX_INGESTION_REJECTION_ISSUES');
  });

  it('does NOT export recordEventConflict — only storeValidatedEvent may record a conflict', () => {
    // A conflict record must only ever be written by the store that just detected the conflict, in
    // the same transaction. There is no external append-a-conflict path, and there must not be one.
    expect(publicApi).not.toHaveProperty('recordEventConflict');
  });

  it('keeps recordEventConflict INTERNAL rather than pretending it does not exist', () => {
    // The honest half: it is real and reachable inside the package (storeValidatedEvent calls it),
    // it is just not reachable from the package root.
    expect(conflictStore).toHaveProperty('recordEventConflict');
    expect(conflictStore.recordEventConflict).toBeTypeOf('function');
  });
});

describe('the Stage 3.4.1 projection foundation is INTERNAL — no root export yet', () => {
  it('exports no Stage 3.4 projection symbol from the package root', () => {
    // Stage 3.4.1 ships schema, vocabulary and the checkpoint/attempt repositories, all internal.
    // No public runtime surface is added in this slice (ADR-0034 §12).
    for (const symbol of [
      'toProjectionName',
      'isProjectionName',
      'ProjectionName',
      'PROJECTION_STATUSES',
      'PROJECTION_ATTEMPT_OUTCOMES',
      'MAX_PROJECTION_ATTEMPTS',
      'PROJECTION_SAFE_ERROR_CODES',
      'assertProjectionSafeErrorCode',
      'createCheckpointIfAbsent',
      'readCheckpoint',
      'readCheckpointForUpdate',
      'advanceCheckpointOnSuccess',
      'recordCheckpointRetryPending',
      'recordCheckpointBlocked',
      'appendAttempt',
      'appendSucceededAttempt',
      'appendFailedAttempt',
      'readAttemptsForEvent',
    ]) {
      expect(publicApi).not.toHaveProperty(symbol);
    }
  });

  it('exposes no projection role name, password, or secret at the package root', () => {
    const serialized = JSON.stringify(Object.keys(publicApi));
    expect(serialized).not.toContain('qf_jarvis_projection_runtime');
    expect(serialized.toLowerCase()).not.toContain('password');
    expect(serialized.toLowerCase()).not.toContain('secret');
  });
});

describe('the Stage 3.4.2 projection registry is INTERNAL — still no root export', () => {
  it('exports no Stage 3.4.2 registry or definition symbol from the package root', () => {
    // Stage 3.4.2 adds the immutable projection registry and its definition vocabulary. Like the
    // Stage 3.4.1 foundation, all of it stays internal: no public runtime surface is added by this
    // slice either (ADR-0035 §7). The root surface is unchanged from Stage 3.4.1.
    for (const symbol of [
      'createProjectionRegistry',
      'ProjectionRegistry',
      'ProjectionRegistryError',
      'PROJECTION_REGISTRY_ERROR_CODES',
      'defineProjection',
      'ProjectionDefinition',
      'ProjectionDefinitionError',
      'PROJECTION_DEFINITION_ERROR_CODES',
      'ProjectionEvent',
      'ProjectionHandler',
      'toCanonicalInstant',
      'isCanonicalInstant',
      'CanonicalInstant',
      'CANONICAL_INSTANT_PATTERN',
      'isProjectionVersion',
      'MAX_PROJECTION_VERSION',
    ]) {
      expect(publicApi).not.toHaveProperty(symbol);
    }
  });

  it('exposes no registry or handler vocabulary under any root key', () => {
    const rootKeys = Object.keys(publicApi);
    expect(rootKeys.filter((key) => key.toLowerCase().includes('registry'))).toEqual([]);
    expect(rootKeys.filter((key) => key.toLowerCase().includes('projection'))).toEqual([]);
  });

  it('leaves the Stage 3.4.1 root surface byte-identical — no symbol added or removed', () => {
    // The registry is a pure addition BEHIND the boundary. If this snapshot ever changes, a slice
    // has widened the public API without an ADR saying so.
    expect(Object.keys(publicApi).sort()).toEqual(EXPECTED_ROOT_SURFACE);
  });
});

describe('the Stage 3.4.5B real handlers, production registry, and worker CLI are INTERNAL', () => {
  it('exports no Stage 3.4.5B handler / production-registry / worker-composition symbol from the root', () => {
    // Stage 3.4.5B adds the two real read-model handlers, the production registry composition, and the
    // worker composition root — ALL kept off the barrel (ADR-0038 §9). The barrel's runtime surface is
    // unchanged at 39. apps/worker reaches ONLY `runProjectionWorkerCli`, through a narrowly scoped
    // internal subpath (asserted below), never through this root.
    for (const symbol of [
      'applyEventTypeActivity',
      'applyDailyEventAcceptance',
      'eventTypeActivityProjection',
      'dailyEventAcceptanceProjection',
      'createProductionProjectionRegistry',
      'runProjectionWorker',
      'runProjectionCycle',
      'runProjectionWorkerCli',
      'defaultProjectionWorkerCliDeps',
      'ProjectionWorkerError',
      'abortableSleep',
    ]) {
      expect(publicApi).not.toHaveProperty(symbol);
    }
  });

  it('leaves the package-root runtime surface at exactly 39 symbols (unchanged by Stage 3.4.5B)', () => {
    expect(EXPECTED_ROOT_SURFACE).toHaveLength(39);
    expect(Object.keys(publicApi).sort()).toEqual(EXPECTED_ROOT_SURFACE);
  });

  it('exposes no handler, registry, or worker vocabulary under any root key', () => {
    const rootKeys = Object.keys(publicApi);
    expect(rootKeys.filter((key) => key.toLowerCase().includes('worker'))).toEqual([]);
    expect(rootKeys.filter((key) => key.toLowerCase().includes('handler'))).toEqual([]);
    expect(rootKeys.some((key) => key.toLowerCase().includes('subject'))).toBe(false);
  });

  it('exposes runProjectionWorkerCli ONLY through the narrowly scoped internal subpath (not the root)', async () => {
    const { exports } = await readPackageManifest();
    // Exactly the root plus the two internal CLI subpaths — nothing else. QFJ-P03.07G added the
    // read-only inspection CLI here rather than to the root, so the 39-symbol barrel is untouched.
    expect(Object.keys(exports).sort()).toEqual([
      '.',
      './internal/projection-inspection-cli',
      './internal/projection-worker-cli',
    ]);
    // The subpath resolves to the compiled worker CLI (JS + types) — never the barrel or persistence.
    const subpath = JSON.stringify(exports['./internal/projection-worker-cli']);
    expect(subpath).toContain('./dist/projections/projection-worker-cli.js');
    expect(subpath).toContain('./dist/projections/projection-worker-cli.d.ts');
    expect(subpath).not.toContain('persistence');
    expect(subpath).not.toContain('index.js');
  });

  it('exposes the read-only inspection CLI through an equally narrow internal subpath', async () => {
    const { exports } = await readPackageManifest();
    const subpath = JSON.stringify(exports['./internal/projection-inspection-cli']);
    expect(subpath).toContain('./dist/projections/projection-inspection-cli.js');
    expect(subpath).toContain('./dist/projections/projection-inspection-cli.d.ts');
    expect(subpath).not.toContain('persistence');
    expect(subpath).not.toContain('index.js');
  });

  it('the inspection CLI module exposes NO mutating operator command', async () => {
    const cli = await import('../projections/projection-inspection-cli.js');
    // The command table is the enforcement point: an operator (or a script) cannot reach acknowledge,
    // quarantine, authorize, or replay through this surface, because those verbs are not in it.
    expect([...cli.INSPECTION_COMMANDS].sort()).toEqual([
      'divergence',
      'history',
      'inspect',
      'list',
    ]);
    for (const mutating of ['acknowledge', 'quarantine', 'authorize', 'replay', 'execute']) {
      expect(cli.isInspectionCommand(mutating)).toBe(false);
    }
    // It must not re-export the E/F mutating operations either.
    for (const forbidden of [
      'acknowledgeProjectionFailureOperation',
      'quarantineProjectionFailureOperation',
      'authorizeProjectionFailureReplay',
      'executeAuthorizedProjectionReplay',
    ]) {
      expect(cli).not.toHaveProperty(forbidden);
    }
  });

  it('the internal subpath module exposes ONLY the worker entry vocabulary — no handlers/registry/pool', async () => {
    const workerCli = await import('../projections/projection-worker-cli.js');
    expect(workerCli.runProjectionWorkerCli).toBeTypeOf('function');
    expect(workerCli.defaultProjectionWorkerCliDeps).toBeTypeOf('function');
    // It must NOT re-export handlers, the production registry factory, or pool objects.
    for (const forbidden of [
      'applyEventTypeActivity',
      'applyDailyEventAcceptance',
      'createProductionProjectionRegistry',
      'createDatabasePool',
    ]) {
      expect(workerCli).not.toHaveProperty(forbidden);
    }
  });
});

describe('no package export subpath can reach the migration runner', () => {
  it('publishes the root plus exactly one narrowly-scoped internal worker subpath — and no bypass path', async () => {
    const { exports } = await readPackageManifest();

    // The root, plus the authorized internal subpaths (the worker composition root that apps/worker
    // imports in-process, and the QFJ-P03.07G read-only inspection CLI). A `"./*"` wildcard — or any
    // `./persistence/...` / migration-runner subpath — would re-open the migration bypass through a
    // deep import; the next assertion forbids exactly that.
    expect(Object.keys(exports).sort()).toStrictEqual([
      '.',
      './internal/projection-inspection-cli',
      './internal/projection-worker-cli',
    ]);
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
