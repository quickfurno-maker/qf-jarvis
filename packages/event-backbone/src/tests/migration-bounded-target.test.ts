/**
 * Bounded managed migration targeting — `--through <version>` (unit, DB-free).
 *
 * Proves the parsing rules, the target-resolution rules, and the selection plan that makes
 * `pnpm db:migrate -- --through 0005` apply exactly 0002–0005 and exclude 0006 — without a
 * database, without a connection string, and without touching a migration file. The managed
 * unbounded rejection and the database-ahead fail-closed are proven through their typed errors and
 * the runner's own contract; the applied/no-op/ahead behaviours against real PostgreSQL are proven
 * by the existing migration integration suites in CI.
 */
import { describe, expect, it } from 'vitest';

import {
  MigrationTargetBehindHistoryError,
  MigrationTargetInvalidError,
  MigrationTargetUnknownError,
  UnboundedManagedMigrationError,
} from '../persistence/migration-errors.js';
import {
  MIGRATION_THROUGH_OPTION,
  parseMigrationThroughOption,
  planMigrationSelection,
  resolveMigrationTarget,
} from '../persistence/migration-target.js';
import type { MigrationFile } from '../persistence/migration-types.js';

/** The repository's six migrations, as the loader would present them (content is irrelevant here). */
const FILES: readonly MigrationFile[] = [
  [1, '0001_event_log.sql'],
  [2, '0002_event_runtime_grants.sql'],
  [3, '0003_ingestion_rejection_and_event_conflict.sql'],
  [4, '0004_projection_foundation.sql'],
  [5, '0005_projection_event_positions.sql'],
  [6, '0006_projection_failure_operations.sql'],
].map(([version, filename]) => ({
  version: version as number,
  filename: filename as string,
  absolutePath: `/migrations/${String(filename)}`,
  checksum: Buffer.alloc(32, version as number),
  sql: '-- not executed by this test',
}));

const versionsOf = (files: readonly MigrationFile[]): number[] => files.map((f) => f.version);

// --- Option parsing --------------------------------------------------------------------------

describe('--through parsing', () => {
  it('accepts the exact operational form "--through 0005"', () => {
    expect(parseMigrationThroughOption([MIGRATION_THROUGH_OPTION, '0005'])).toBe(5);
  });

  it('accepts an unpadded version and the "=" form', () => {
    expect(parseMigrationThroughOption(['--through', '5'])).toBe(5);
    expect(parseMigrationThroughOption(['--through=0005'])).toBe(5);
  });

  it('returns null when the option is absent (unbounded)', () => {
    expect(parseMigrationThroughOption([])).toBeNull();
  });

  it('skips the POSIX "--" separator that pnpm forwards', () => {
    // This is exactly what `pnpm db:migrate -- --through 0005` delivers to the CLI.
    expect(parseMigrationThroughOption(['--', '--through', '0005'])).toBe(5);
    expect(parseMigrationThroughOption(['--'])).toBeNull();
  });

  it('rejects a missing value', () => {
    expect(() => parseMigrationThroughOption(['--through'])).toThrow(MigrationTargetInvalidError);
    expect(() => parseMigrationThroughOption(['--through', '--other'])).toThrow(
      MigrationTargetInvalidError,
    );
    expect(() => parseMigrationThroughOption(['--through='])).toThrow(MigrationTargetInvalidError);
  });

  it('rejects a malformed value', () => {
    for (const bad of ['abc', '5.0', '-5', '0', '0x5', '5;DROP', ' 5']) {
      expect(() => parseMigrationThroughOption(['--through', bad])).toThrow(
        MigrationTargetInvalidError,
      );
    }
  });

  it('rejects a duplicated option', () => {
    expect(() => parseMigrationThroughOption(['--through', '0005', '--through', '0004'])).toThrow(
      MigrationTargetInvalidError,
    );
  });

  it('rejects an unknown option or stray positional', () => {
    expect(() => parseMigrationThroughOption(['--force'])).toThrow(MigrationTargetInvalidError);
    expect(() => parseMigrationThroughOption(['0005'])).toThrow(MigrationTargetInvalidError);
  });

  it('never echoes a connection value in its message', () => {
    const caught = (() => {
      try {
        parseMigrationThroughOption(['--through', 'postgres://u:p@host/db']);
        return null;
      } catch (error) {
        return error as Error;
      }
    })();
    expect(caught).toBeInstanceOf(MigrationTargetInvalidError);
    expect(caught?.message).not.toContain('@host');
    expect(caught?.message).not.toContain('p@');
  });
});

// --- Target resolution -----------------------------------------------------------------------

describe('target resolution', () => {
  it('resolves to exactly one repository migration', () => {
    expect(resolveMigrationTarget(FILES, 5).filename).toBe('0005_projection_event_positions.sql');
  });

  it('rejects an unknown target', () => {
    expect(() => resolveMigrationTarget(FILES, 7)).toThrow(MigrationTargetUnknownError);
    expect(() => resolveMigrationTarget(FILES, 99)).toThrow(MigrationTargetUnknownError);
  });
});

// --- Selection planning ----------------------------------------------------------------------

describe('selection plan', () => {
  it('applied 0001 + target 0005 selects exactly 0002, 0003, 0004, 0005 and excludes 0006', () => {
    const plan = planMigrationSelection(FILES, new Set([1]), 5);
    expect(versionsOf(plan.selected)).toEqual([2, 3, 4, 5]);
    expect(versionsOf(plan.excluded)).toEqual([6]);
    expect(plan.appliedVersions).toEqual([1]);
    expect(plan.targetVersion).toBe(5);
  });

  it('the target is inclusive', () => {
    expect(versionsOf(planMigrationSelection(FILES, new Set([1]), 2).selected)).toEqual([2]);
    expect(versionsOf(planMigrationSelection(FILES, new Set(), 1).selected)).toEqual([1]);
  });

  it('excludes 0006 for every target below it', () => {
    for (const target of [1, 2, 3, 4, 5]) {
      const plan = planMigrationSelection(FILES, new Set(), target);
      expect(versionsOf(plan.selected)).not.toContain(6);
      expect(versionsOf(plan.excluded)).toContain(6);
    }
  });

  it('a database already at the target selects nothing (verified no-op)', () => {
    const plan = planMigrationSelection(FILES, new Set([1, 2, 3, 4, 5]), 5);
    expect(plan.selected).toHaveLength(0);
    expect(versionsOf(plan.excluded)).toEqual([6]);
  });

  it('a database behind the target selects only the gap, in order', () => {
    const plan = planMigrationSelection(FILES, new Set([1, 2]), 5);
    expect(versionsOf(plan.selected)).toEqual([3, 4, 5]);
  });

  it('an unbounded plan selects every pending migration (local-only behaviour)', () => {
    const plan = planMigrationSelection(FILES, new Set([1]), null);
    expect(versionsOf(plan.selected)).toEqual([2, 3, 4, 5, 6]);
    expect(plan.excluded).toHaveLength(0);
  });
});

// --- Fail-closed contracts --------------------------------------------------------------------

describe('fail-closed contracts', () => {
  it('database-ahead is a distinct, sanitized error', () => {
    const error = new MigrationTargetBehindHistoryError(5, 6);
    expect(error).toBeInstanceOf(MigrationTargetBehindHistoryError);
    expect(error.targetVersion).toBe(5);
    expect(error.highestApplied).toBe(6);
    expect(error.message).toContain('forward-only');
    expect(error.message).not.toMatch(/postgres:|@|password/i);
  });

  it('managed unbounded rejection names the rule and no connection value', () => {
    const error = new UnboundedManagedMigrationError();
    expect(error.message).toContain('--through');
    expect(error.message).toContain('managed');
    expect(error.message).not.toMatch(/postgres:|@|password/i);
  });

  it('an unknown target names only versions', () => {
    const error = new MigrationTargetUnknownError(7, [1, 2, 3, 4, 5, 6]);
    expect(error.message).toContain('7');
    expect(error.message).not.toMatch(/postgres:|@|password/i);
  });
});
