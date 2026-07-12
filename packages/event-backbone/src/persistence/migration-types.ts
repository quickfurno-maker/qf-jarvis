/**
 * Migration types, and the two constants that define the mechanism.
 */

/** A migration file found on disk, with its checksum computed over the exact bytes. */
export interface MigrationFile {
  /** Parsed from the filename. Unique, and the ordering key. */
  readonly version: number;
  readonly filename: string;
  readonly absolutePath: string;
  /** SHA-256 over the **raw file bytes**, not over decoded text. */
  readonly checksum: Buffer;
  readonly sql: string;
}

/** A row of `schema_migration` — the record that a migration was applied. */
export interface AppliedMigration {
  readonly version: number;
  readonly filename: string;
  readonly checksum: Buffer;
  readonly appliedAt: Date;
}

/** What `runMigrations` did. */
export interface MigrationResult {
  /** Migrations applied by *this* run, in order. Empty when already up to date. */
  readonly applied: readonly MigrationFile[];
  /** Migrations that were already recorded as applied before this run. */
  readonly alreadyApplied: readonly AppliedMigration[];
}

/**
 * `NNNN_lowercase_description.sql` — a four-digit version, an underscore, then a
 * lowercase description whose words are separated by `_` or `-`.
 *
 * Strict on purpose. A filename **is** the version, and a version that can be written two
 * ways is a version that will eventually be written both ways — after which "which
 * migration is 0002?" has two answers. Anything that does not match is refused, before a
 * connection is even opened.
 *
 * Refused, for example: `1_thing.sql` (not four digits), `0001-thing.sql` (no underscore
 * after the version), `0001_Thing.sql` (uppercase), `0001_two words.sql` (a space).
 */
export const MIGRATION_FILENAME_PATTERN = /^(\d{4})_([a-z0-9]+(?:[_-][a-z0-9]+)*)\.sql$/;

/**
 * The advisory-lock key that serialises migrators.
 *
 * A fixed, arbitrary 64-bit constant. It is a *namespace*, not a secret: two processes
 * agreeing on this number is the entire mechanism by which they agree not to migrate
 * the same database at the same time.
 *
 * PostgreSQL advisory locks are **session-scoped**, so the lock is held on one dedicated
 * client and released in a `finally` — and released automatically if the process dies,
 * which is what stops a crashed migrator from wedging the database forever.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 4_657_120_349_871_265;

/**
 * **Every object QF Jarvis owns lives in this schema. Nothing lives in `public`.**
 *
 * `public` is a shared, world-facing default. On a managed provider it is the schema an
 * exposed Data API reaches for first, and on any PostgreSQL it is the schema every other
 * tool assumes it may write to. An immutable event log has no business living in a room
 * with an unlocked door.
 *
 * A private schema makes the access question answerable in one place: **revoke the schema,
 * and everything in it is unreachable** — regardless of what grants a provider hands out
 * to its own roles by default, now or in a future release.
 *
 * **Nothing here depends on `search_path`.** Every object is fully qualified, in the
 * migrations, in the runner, and in the tests. An ambient `search_path` is a global
 * variable set by whoever connected last, and correctness that depends on one is
 * correctness that fails on the day a pooler hands back a different session.
 */
export const MIGRATION_SCHEMA = 'qf_jarvis';

/** The migration-history table, **schema-qualified**. Bootstrapped idempotently before it is read. */
export const MIGRATION_TABLE = `${MIGRATION_SCHEMA}.schema_migration`;
