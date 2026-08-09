/**
 * Projection containment proofs (no database).
 *
 * Originally Stage 3.4.5B, these bound the projection slice's envelope. They have been extended as
 * later slices landed: QFJ-P03.07C added migration `0006`; QFJ-P03.09 (ADR-0044) added migration `0007`
 * and the third production projection `subject-activity` writing `qf_jarvis.rm_subject_activity`;
 * QFJ-P08-B2 (ADR-0077) added migration `0008`, and the QFJ-P08 durable approval queue (ADR-0081)
 * adds `0009`. Neither introduces a projection at all — both are written by separate packages, and by
 * no projection in this one.
 *
 * The still-load-bearing properties they protect are unchanged:
 *   - NO production projection source performs a destructive read-model operation
 *     (`TRUNCATE`/`DELETE FROM`/`DROP TABLE`) — rebuild/reset destroy remains a trusted admin/test
 *     operation, and the projection role holds no `DELETE`/`TRUNCATE` grant (migrations 0004/0007);
 *   - the migration set is bounded and gap-free;
 *   - the package-root exports map stays narrow (no wildcard, nothing reaching persistence/migration).
 *
 * The destructive-operation scan **discovers all production projection source recursively** (not a
 * hardcoded file list), so a newly-added file cannot evade it.
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

/**
 * The DESTRUCTIVE read-model statements no production projection source may contain. A version-bump
 * rebuild destroys derived state, but ONLY through a trusted admin/test capability outside production
 * source (QFJ-P03.08). Note: the subject-activity reducer legitimately WRITES `rm_subject_activity`
 * (INSERT/UPSERT and NULL-clears on a tombstone), which is not destructive and is not scanned here.
 */
const PROHIBITED_SQL = [/\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bDROP\s+TABLE\b/i];

describe('destructive/reset operations are absent from ALL production projection source', () => {
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
    expect(asNames.some((p) => p.endsWith('/projections/handlers/subject-activity.ts'))).toBe(true);
  });

  it('the guard actually fires — a destructive statement in ANY file would be caught (positive control)', () => {
    const wouldBeAddedFile =
      "await client.query('TRUNCATE TABLE qf_jarvis.rm_event_type_activity');";
    expect(PROHIBITED_SQL.some((re) => re.test(wouldBeAddedFile))).toBe(true);
    expect(
      PROHIBITED_SQL.some((re) => re.test('DELETE FROM qf_jarvis.rm_daily_event_acceptance')),
    ).toBe(true);
    expect(PROHIBITED_SQL.some((re) => re.test('DROP TABLE qf_jarvis.rm_subject_activity'))).toBe(
      true,
    );
  });

  it('no production projection source contains TRUNCATE / DELETE FROM / DROP TABLE', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of PROHIBITED_SQL) {
        expect({ file, matched: pattern.test(text) }).toEqual({ file, matched: false });
      }
    }
  });
});

// The migration set grew as authorized slices landed: 0006 (QFJ-P03.07C), 0007 (QFJ-P03.09), 0008
// (QFJ-P08-B2), 0009 (QFJ-P08 durable approval queue) and now 0010 (QFJ-P09.03 durable execution
// replay claim). This guard bounds it at 0001–0011.
describe('migrations are bounded at 0001–0012 with no 0013', () => {
  it('the migrations directory holds EXACTLY the twelve approved SQL files', () => {
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
      '0007_subject_activity_projection.sql',
      '0008_conversation_control_persistence.sql',
      '0009_durable_approval_queue.sql',
      '0010_execution_replay_claim.sql',
      '0011_riya_conversation_continuity.sql',
      // RWC-P8 (ADR-0104): the ONE authorized addition, repository and LOCAL/CI only.
      '0012_riya_logical_turn_idempotency.sql',
    ]);
  });

  it('no migration numbered 0013 or higher exists', () => {
    // Compared NUMERICALLY rather than by prefix. The previous form was `/^0010|^0[1-9]\d\d/`,
    // which named 0010 and 0100–0999 but silently missed everything from 0011 to 0099 — the exact
    // range the very next migration would land in. Moving the bound is the moment to close that.
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'));
    // RWC-P8 (ADR-0104): the bound moves to 0012, the ONE owner-authorized addition. The lock
    // still says exactly what it said -- no unauthorized migration exists.
    const beyond = files.filter((name) => Number.parseInt(name.slice(0, 4), 10) > 12);
    expect(beyond).toEqual([]);
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
  it('registers exactly the three approved projections, including subject-activity (QFJ-P03.09)', () => {
    const names = createProductionProjectionRegistry()
      .list()
      .map((d) => d.name);
    expect(names).toEqual(['daily-event-acceptance', 'event-type-activity', 'subject-activity']);
  });
});
