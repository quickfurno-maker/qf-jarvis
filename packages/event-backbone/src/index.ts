/**
 * @qf-jarvis/event-backbone — the durable event backbone.
 *
 * **Stage 3.1 provides the persistence foundation, and nothing else.**
 *
 * What is here: a validated database configuration, a connection pool, a transaction
 * helper, a forward-only migration runner with checksum verification, and the immutable
 * canonical event log.
 *
 * ### What is deliberately absent
 *
 * There is **no ingestion function**, **no signature verification**, **no contract
 * parsing**, **no deduplication behaviour**, **no projection framework**, **no
 * checkpoints**, **no retries**, **no dead letters**, **no replay**, **no quarantine**,
 * **no read models**, **no test emitter**, **no metrics**, and **no worker loop**.
 *
 * Those are Stages 3.2 through 3.8, and each has an Accepted ADR describing it.
 *
 * The `UNIQUE (event_id)` constraint in migration `0001` lays the **foundation** for
 * eventId-based idempotency (ADR-0020). It is not the same thing as the Stage 3.3
 * ingestion behaviour that distinguishes a benign duplicate from a conflicting one, and
 * this package does not claim otherwise.
 *
 * ### Importing this package connects to nothing
 *
 * There is no module-level pool and no ambient configuration. `createDatabasePool` is a
 * function a caller invokes with an explicit config, and nothing reads `process.env`
 * except the migration CLI — which is an executable boundary, not library code.
 *
 * See docs/architecture/event-backbone.md and ADR-0019 through ADR-0022.
 */

export {
  assertCaCertificateBundle,
  assertConnectionUrlIsSupported,
  createDatabaseConfig,
  DATABASE_CONFIG_BOUNDS,
  DATABASE_CONFIG_DEFAULTS,
  DatabaseConfigError,
  DatabaseTlsError,
  describeConnectionTarget,
  describeTls,
  isLoopbackConnectionTarget,
  UnsupportedConnectionModeError,
  type DatabaseConfig,
  type DatabaseConfigInput,
  type TlsConfig,
} from './persistence/database-config.js';

export {
  REQUIRED_POSTGRES_MAJOR_VERSION,
  runPreflight,
  runPreflightOnClient,
  type PreflightCheck,
  type PreflightReport,
} from './persistence/preflight.js';

export {
  migrateWithPreflight,
  PreflightFailedError,
  type MigrateWithPreflightResult,
} from './persistence/migrate.js';

export {
  closeDatabasePool,
  createDatabasePool,
  type DatabaseClient,
  type DatabasePool,
} from './persistence/pool.js';

export { withClient, withTransaction } from './persistence/transaction.js';

export {
  loadMigrationFiles,
  runMigrations,
  runMigrationsOnClient,
} from './persistence/migration-runner.js';

export { defaultMigrationsDirectory } from './persistence/migrations-directory.js';

export {
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATION_FILENAME_PATTERN,
  MIGRATION_SCHEMA,
  MIGRATION_TABLE,
  type AppliedMigration,
  type MigrationFile,
  type MigrationResult,
} from './persistence/migration-types.js';

export {
  DuplicateMigrationVersionError,
  MalformedMigrationFilenameError,
  MigrationChecksumMismatchError,
  MigrationError,
  MigrationExecutionError,
  MigrationFileMissingError,
  OutOfOrderMigrationError,
} from './persistence/migration-errors.js';
