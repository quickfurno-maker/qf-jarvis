/**
 * Migration failures — each one is a distinct, named class, because each one means
 * something different is wrong and each one wants a different response.
 *
 * Every message names the **file, the version, or the digest** — never the SQL, and
 * never a connection string.
 */

/**
 * Base class, so a caller can catch every migration failure without catching everything.
 *
 * Accepts `ErrorOptions` so that subclasses can attach the original PostgreSQL error as
 * `cause`. The SQLSTATE and message from the database are what a human actually needs;
 * wrapping without them would be throwing away the answer.
 */
export class MigrationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

/** A file in the migrations directory does not match `NNNN_description.sql`. */
export class MalformedMigrationFilenameError extends MigrationError {
  public readonly filename: string;

  public constructor(filename: string) {
    super(
      `Migration filename "${filename}" is malformed. Expected NNNN_lowercase-description.sql — ` +
        `a filename is a version, and a version that can be written two ways will eventually be written both ways.`,
    );
    this.name = 'MalformedMigrationFilenameError';
    this.filename = filename;
  }
}

/** Two files claim the same version number. */
export class DuplicateMigrationVersionError extends MigrationError {
  public readonly version: number;

  public constructor(version: number, first: string, second: string) {
    super(
      `Migration version ${String(version)} is claimed by two files: "${first}" and "${second}". ` +
        `A version identifies exactly one migration.`,
    );
    this.name = 'DuplicateMigrationVersionError';
    this.version = version;
  }
}

/**
 * A migration that was already applied has been **edited since**.
 *
 * This is the failure that matters most. An applied migration is history: the database
 * has already been changed by the bytes that were there at the time. Editing the file
 * afterwards does not change the database — it changes the *record* of what the database
 * is, which is how staging and production silently diverge while every checksum in the
 * repository looks fine.
 *
 * So it fails startup. Loudly, and before anything else runs.
 */
export class MigrationChecksumMismatchError extends MigrationError {
  public readonly version: number;

  public constructor(version: number, filename: string, applied: Buffer, current: Buffer) {
    super(
      `Migration ${String(version)} ("${filename}") has changed since it was applied. ` +
        `Applied checksum ${applied.toString('hex')}, current checksum ${current.toString('hex')}. ` +
        `An applied migration is history and must never be edited — fix forward with a new migration.`,
    );
    this.name = 'MigrationChecksumMismatchError';
    this.version = version;
  }
}

/**
 * The database records a migration whose file no longer exists locally.
 *
 * Usually this means the code is *older* than the database — a deploy rolled back, or a
 * branch is behind. Applying further migrations from here would interleave them with
 * history the code cannot see, so it refuses.
 */
export class MigrationFileMissingError extends MigrationError {
  public readonly version: number;

  public constructor(version: number, filename: string) {
    super(
      `Migration ${String(version)} ("${filename}") is recorded as applied in the database, ` +
        `but no such file exists locally. The code is behind the database — refusing to continue.`,
    );
    this.name = 'MigrationFileMissingError';
    this.version = version;
  }
}

/**
 * A new migration has been inserted *below* a version already applied.
 *
 * Forward-only means forward-only. If 0003 is applied and someone adds 0002, applying it
 * now would run it against a schema that already contains 0003's changes — an order that
 * was never tested and that a fresh database would never reproduce.
 */
export class OutOfOrderMigrationError extends MigrationError {
  public readonly version: number;

  public constructor(version: number, filename: string, highestApplied: number) {
    super(
      `Migration ${String(version)} ("${filename}") is new, but migration ${String(highestApplied)} is already applied. ` +
        `Migrations are forward-only: a fresh database would never apply these in this order, so neither will this one.`,
    );
    this.name = 'OutOfOrderMigrationError';
    this.version = version;
  }
}

/**
 * A migration's SQL failed. The transaction was rolled back; nothing was recorded.
 *
 * The original database error is preserved as `cause` — the SQLSTATE and the message
 * from PostgreSQL are what a human actually needs, and wrapping without them would be
 * throwing away the answer.
 */
export class MigrationExecutionError extends MigrationError {
  public readonly version: number;

  public constructor(version: number, filename: string, cause: unknown) {
    super(
      `Migration ${String(version)} ("${filename}") failed and was rolled back. Nothing was recorded as applied.`,
      { cause },
    );
    this.name = 'MigrationExecutionError';
    this.version = version;
  }
}
