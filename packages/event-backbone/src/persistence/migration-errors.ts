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
 * The `--through` option is missing its value, malformed, repeated, or accompanied by an
 * unknown argument.
 *
 * The message names the RULE that was broken and the offending **option token** only — never a
 * connection value. Parsing happens before any configuration is resolved and before any
 * connection is opened, so a bad invocation can never reach a database.
 */
export class MigrationTargetInvalidError extends MigrationError {
  public constructor(reason: string) {
    super(
      `Invalid migration target: ${reason} Expected exactly one "--through <version>" ` +
        `(for example: --through 0005). A bounded migration must name exactly one target version.`,
    );
    this.name = 'MigrationTargetInvalidError';
  }
}

/** `--through` names a version that no repository migration provides. */
export class MigrationTargetUnknownError extends MigrationError {
  public readonly version: number;

  public constructor(version: number, available: readonly number[]) {
    super(
      `Migration target ${String(version)} does not resolve to any repository migration. ` +
        `Available versions: ${available.map((v) => String(v)).join(', ')}. ` +
        `A target must resolve to exactly one migration.`,
    );
    this.name = 'MigrationTargetUnknownError';
    this.version = version;
  }
}

/**
 * The database is **ahead** of the requested target.
 *
 * Applying "through 0005" against a database that already recorded 0006 cannot mean anything
 * safe: the bound cannot un-apply what is already applied, and silently succeeding would
 * report a state the database is not in. Forward-only means the target may never be behind
 * history, so this fails closed before any migration SQL runs.
 */
export class MigrationTargetBehindHistoryError extends MigrationError {
  public readonly targetVersion: number;
  public readonly highestApplied: number;

  public constructor(targetVersion: number, highestApplied: number) {
    super(
      `Migration target ${String(targetVersion)} is behind the database: migration ` +
        `${String(highestApplied)} is already applied. Migrations are forward-only and a bound ` +
        `cannot un-apply history — refusing to continue.`,
    );
    this.name = 'MigrationTargetBehindHistoryError';
    this.targetVersion = targetVersion;
    this.highestApplied = highestApplied;
  }
}

/**
 * A **managed** target was asked to migrate without an explicit `--through` bound.
 *
 * A managed database is not a laptop: "apply everything pending" there is an unbounded,
 * unreviewed blast radius. Managed application must name the exact version it intends to reach,
 * so the reviewed plan and the executed plan are the same thing. Raised **before** any
 * migration SQL, any advisory lock, and any history write.
 */
export class UnboundedManagedMigrationError extends MigrationError {
  public constructor() {
    super(
      `Refusing to migrate a managed database without an explicit bound. ` +
        `Pass "--through <version>" (for example: pnpm db:migrate -- --through 0005). ` +
        `Unbounded application is permitted only for a local loopback database.`,
    );
    this.name = 'UnboundedManagedMigrationError';
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
