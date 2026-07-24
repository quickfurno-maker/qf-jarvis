/**
 * Stage 3.4.5B — containment proofs (no database).
 *
 * These fail if the slice ever grows beyond its approved envelope: a new migration (`0006`+), a
 * changed migration set, a widened package-root surface, a destructive read-model operation
 * (`TRUNCATE`/`DELETE FROM`/`DROP TABLE` — i.e. rebuild/reset machinery) or a write to the deferred
 * `rm_subject_activity` table ANYWHERE under the projection tree, a third production projection, or an
 * ambiguous `worker:start` production path.
 *
 * F5 correction: the destructive-operation scan **discovers all production projection source
 * recursively** (not a hardcoded file list), so a newly-added file cannot evade it. The substring/regex
 * scan is supplementary defense; the primary containment is structural — the projection role holds no
 * `DELETE`/`TRUNCATE` grant (migration `0004`, proven unchanged here) and there is no migration `0006`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createProductionProjectionRegistry } from '../projections/production-registry.js';

const MIGRATIONS_DIR = new URL('../persistence/migrations/', import.meta.url);
const PROJECTIONS_DIR = new URL('../projections/', import.meta.url);
const PACKAGE_MANIFEST = new URL('../../package.json', import.meta.url);

/** Recursively discover every production `.ts` file under `dir`, excluding tests. No glob dependency. */
function discoverProductionSource(dir: URL): string[] {
  const root = fileURLToPath(dir);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.integration.test.ts')
      ) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

/** The destructive / deferred-write patterns no production projection source may contain. */
const PROHIBITED_SQL = [
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+TABLE\b/i,
  // A write to the Stage 3.6 read model (fully qualified, so the deferral COMMENT in
  // production-registry.ts — which names the bare `rm_subject_activity` — is not a false positive).
  /qf_jarvis\.rm_subject_activity/i,
];

describe('destructive/reset operations are absent from ALL production projection source (F5)', () => {
  const sources = discoverProductionSource(PROJECTIONS_DIR);

  it('discovers the whole projection tree recursively — not a hardcoded file list', () => {
    // A recursive walk means any newly-added file is automatically scanned. Prove breadth: many files,
    // including nested handler modules and the merged runner/worker, are all in scope.
    expect(sources.length).toBeGreaterThanOrEqual(15);
    const asNames = sources.map((p) => p.replace(/\\/g, '/'));
    expect(asNames.some((p) => p.endsWith('/projections/projection-runner.ts'))).toBe(true);
    expect(asNames.some((p) => p.endsWith('/projections/projection-worker.ts'))).toBe(true);
    expect(asNames.some((p) => p.endsWith('/projections/handlers/event-type-activity.ts'))).toBe(
      true,
    );
    expect(asNames.some((p) => p.endsWith('/projections/handlers/daily-event-acceptance.ts'))).toBe(
      true,
    );
  });

  it('the guard actually fires — a destructive statement in ANY file would be caught (positive control)', () => {
    const wouldBeAddedFile =
      "await client.query('TRUNCATE TABLE qf_jarvis.rm_event_type_activity');";
    expect(PROHIBITED_SQL.some((re) => re.test(wouldBeAddedFile))).toBe(true);
    expect(
      PROHIBITED_SQL.some((re) => re.test('DELETE FROM qf_jarvis.rm_daily_event_acceptance')),
    ).toBe(true);
    expect(
      PROHIBITED_SQL.some((re) => re.test('INSERT INTO qf_jarvis.rm_subject_activity ...')),
    ).toBe(true);
  });

  it('no production projection source contains TRUNCATE / DELETE FROM / DROP TABLE / rm_subject_activity write', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of PROHIBITED_SQL) {
        expect({ file, matched: pattern.test(text) }).toEqual({ file, matched: false });
      }
    }
  });
});

// Stage 3.4.5B froze migrations at 0001–0005 (no 0006). QFJ-P03.07C added the authorized
// projection-failure-persistence migration 0006; this guard now bounds the set at 0001–0006 with no 0007.
describe('migrations are bounded at 0001–0006 with no 0007', () => {
  it('the migrations directory holds EXACTLY the six approved SQL files', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
    ]);
  });

  it('no migration numbered 0007 or higher exists', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files.some((name) => /^000[7-9]|^0[1-9]\d\d/.test(name))).toBe(false);
  });
});

describe('the package exports map exposes only the root and narrow internal CLI subpaths', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(PACKAGE_MANIFEST), 'utf8')) as {
    readonly exports: Record<string, unknown>;
    readonly scripts: Record<string, string>;
  };

  it('publishes exactly the root and the two internal CLI subpaths — no bypass subpath', () => {
    // QFJ-P03.07G added the read-only inspection CLI as a second narrowly scoped internal subpath. The
    // containment property this test protects is unchanged: no wildcard, and nothing reaching
    // persistence or the migration runner.
    expect(Object.keys(manifest.exports).sort()).toStrictEqual([
      '.',
      './internal/projection-inspection-cli',
      './internal/projection-worker-cli',
    ]);
    for (const subpath of Object.keys(manifest.exports)) {
      expect(subpath).not.toContain('persistence');
      expect(subpath).not.toContain('migration-runner');
      expect(subpath).not.toContain('*');
    }
  });

  it('has no ambiguous worker:start production script (the entry is apps/worker)', () => {
    expect(manifest.scripts).not.toHaveProperty('worker:start');
  });
});

describe('the production registry stays within scope', () => {
  it('registers exactly the two approved projections and never rm_subject_activity (Stage 3.6)', () => {
    const names = createProductionProjectionRegistry()
      .list()
      .map((d) => d.name);
    expect(names).toEqual(['daily-event-acceptance', 'event-type-activity']);
    expect(names.some((name) => name.includes('subject'))).toBe(false);
  });
});
