/**
 * Bounded migration targeting — argument parsing, target resolution, and selection planning.
 *
 * This module is **pure**: it opens no connection, reads no environment, and executes no SQL. It
 * exists separately from `migrate-cli.ts` precisely because that file is an executable (importing
 * it runs it), and the parsing/selection rules are exactly the part that must be unit-testable
 * without a database.
 *
 * ### Why a bound exists at all
 *
 * "Apply everything pending" is a fine default for a laptop and a bad one for a managed database:
 * the reviewed plan and the executed plan drift apart the moment a new migration lands in the
 * repository. `--through <version>` makes the intended end-state part of the command, so the
 * version an operator reviewed is the version the migrator stops at.
 *
 * The bound is **inclusive** (`--through 0005` applies 0005) and must resolve to **exactly one**
 * repository migration — a target that names nothing is a typo, not an instruction.
 *
 * Nothing here is exported from the package root; the barrel's runtime surface is unchanged.
 */

import { MigrationTargetInvalidError, MigrationTargetUnknownError } from './migration-errors.js';
import type { MigrationFile } from './migration-types.js';

/** The option token that carries the bound. */
export const MIGRATION_THROUGH_OPTION = '--through';

/** A version token is 1–10 digits; `0005` and `5` both denote version 5. */
const VERSION_TOKEN_PATTERN = /^\d{1,10}$/;

/** A token safe to quote back: a short option-shaped word. Anything else is described, not echoed. */
const SAFE_ECHO_PATTERN = /^--?[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;

/**
 * Describe an offending argument WITHOUT echoing arbitrary caller input.
 *
 * A mistyped invocation can put anything in argv — including a connection string. Reflecting the
 * raw token into stderr would turn a typo into a credential disclosure in a deploy log, so only a
 * short, option-shaped token is quoted; everything else is described generically.
 */
function describeToken(token: string): string {
  return SAFE_ECHO_PATTERN.test(token) ? `"${token}"` : 'the supplied value';
}

/**
 * Parse `--through <version>` (or `--through=<version>`) out of CLI arguments.
 *
 * Returns `null` when the option is absent — an unbounded run, which the CLI then permits only for
 * a local loopback target. Throws {@link MigrationTargetInvalidError} for a missing value, a
 * malformed value, a repeated option, or any unrecognised argument: an invocation nobody can read
 * is an invocation nobody should run against a database.
 */
export function parseMigrationThroughOption(argv: readonly string[]): number | null {
  let target: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    // The POSIX end-of-options separator. `pnpm db:migrate -- --through 0005` forwards a literal
    // `--` ahead of the real arguments, so skipping it is what makes the documented command work.
    if (token === '--') continue;

    let rawValue: string | undefined;

    if (token === MIGRATION_THROUGH_OPTION) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new MigrationTargetInvalidError(
          `"${MIGRATION_THROUGH_OPTION}" is missing its value.`,
        );
      }
      rawValue = next;
      index += 1;
    } else if (token.startsWith(`${MIGRATION_THROUGH_OPTION}=`)) {
      rawValue = token.slice(MIGRATION_THROUGH_OPTION.length + 1);
      if (rawValue.length === 0) {
        throw new MigrationTargetInvalidError(
          `"${MIGRATION_THROUGH_OPTION}" is missing its value.`,
        );
      }
    } else {
      throw new MigrationTargetInvalidError(`unrecognised argument ${describeToken(token)}.`);
    }

    if (target !== null) {
      throw new MigrationTargetInvalidError(
        `"${MIGRATION_THROUGH_OPTION}" was supplied more than once.`,
      );
    }
    if (!VERSION_TOKEN_PATTERN.test(rawValue)) {
      throw new MigrationTargetInvalidError(
        `${describeToken(rawValue)} is not a migration version (expected digits, for example 0005).`,
      );
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new MigrationTargetInvalidError(
        `${describeToken(rawValue)} is not a migration version (expected digits, for example 0005).`,
      );
    }
    target = parsed;
  }

  return target;
}

/**
 * Resolve a target version to the single repository migration it names.
 *
 * Throws {@link MigrationTargetUnknownError} when no migration provides that version. Duplicate
 * versions are impossible here: `loadMigrationFiles` already fails closed on them.
 */
export function resolveMigrationTarget(
  files: readonly MigrationFile[],
  targetVersion: number,
): MigrationFile {
  const match = files.find((file) => file.version === targetVersion);
  if (match === undefined) {
    throw new MigrationTargetUnknownError(
      targetVersion,
      files.map((file) => file.version),
    );
  }
  return match;
}

/** The sanitized selection plan: what will run, and what the bound deliberately leaves out. */
export interface MigrationSelectionPlan {
  /** The inclusive target, or `null` for an unbounded (local-only) run. */
  readonly targetVersion: number | null;
  /** Versions the database already records as applied. */
  readonly appliedVersions: readonly number[];
  /** Repository migrations that are unapplied AND within the bound — these will run, in order. */
  readonly selected: readonly MigrationFile[];
  /** Repository migrations excluded because they are beyond the bound. */
  readonly excluded: readonly MigrationFile[];
}

/**
 * Plan the selection: unapplied migrations at or below the target, in version order.
 *
 * The bound narrows only which **pending** migrations run. It deliberately does not narrow the
 * reconciliation set — checksum verification, missing-file detection, and out-of-order detection
 * still consider every applied record against every repository file, so bounding an application
 * can never weaken the guarantees that protect the history.
 */
export function planMigrationSelection(
  files: readonly MigrationFile[],
  appliedVersions: ReadonlySet<number>,
  targetVersion: number | null,
): MigrationSelectionPlan {
  const withinBound = (file: MigrationFile): boolean =>
    targetVersion === null || file.version <= targetVersion;

  const pending = files.filter((file) => !appliedVersions.has(file.version));

  return {
    targetVersion,
    appliedVersions: [...appliedVersions].sort((a, b) => a - b),
    selected: pending.filter(withinBound),
    excluded: files.filter((file) => !withinBound(file)),
  };
}
