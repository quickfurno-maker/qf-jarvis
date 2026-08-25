/**
 * The JAO-3 PostgreSQL adapter (ADR-0117).
 *
 * ### Durability is the whole slice, so the database does the arbitrating
 *
 * Every mutating operation runs in ONE transaction that starts by locking the investigation
 * header with `SELECT ... FOR UPDATE`. That lock is what turns "check then write" into a single
 * decision: two resumed processes racing to append a checkpoint are serialised at the row, the
 * second one sees the revision the first committed, and its `expectedRevision` no longer matches.
 *
 * Underneath that, `UNIQUE (investigation_id, revision)` is the constraint that makes "no lost
 * update" a property of the database rather than of the code that happened to run. If every guard
 * in this file were deleted, two writers still could not both own revision 4.
 *
 * ### Connects to nothing on import, reads no environment
 *
 * The pool arrives as a parameter. There is no module-level pool, no singleton, no
 * `process.env`, no config file and no default connection: importing this module opens no socket
 * and knows no host. The one module in this slice that reads `DATABASE_URL` is the test harness,
 * which is excluded from the emitting build.
 *
 * ### Validate before, reconstruct after
 *
 * Input is parsed before any SQL runs, and what comes back out of the database is parsed again
 * before it becomes a domain object -- because a row is not a record until something has checked
 * that it still is one. A malformed persisted row fails closed as `PERSISTED_STATE_INVALID`
 * rather than being coerced into a plausible-looking result.
 *
 * ### The driver's error is classified and then discarded
 *
 * A `pg` error carries the failing SQL, the constraint, the table, the column, the bound
 * parameters, the host and often the user. None of that leaves this file. It is reduced by
 * SQLSTATE alone to one closed code, and -- the rule that matters most -- database uncertainty
 * NEVER becomes `INVESTIGATION_NOT_FOUND` or a success. "I could not look" and "it is not there"
 * are different facts, and only one of them is safe to act on.
 */
import { withClient, withTransaction } from '@qf-jarvis/event-backbone';
import type { DatabaseClient, DatabasePool } from '@qf-jarvis/event-backbone';

import {
  Jao3MemoryError,
  jao3AppendCheckpointInputSchema,
  jao3AppendOwnerCorrectionInputSchema,
  jao3CheckpointSchema,
  jao3CreateInvestigationInputSchema,
  jao3InvestigationSchema,
  jao3InvestigationViewSchema,
  jao3OwnerCorrectionSchema,
  jao3ResumeInvestigationInputSchema,
  jao3SupersedeInvestigationInputSchema,
  jao3TransitionInputSchema,
  JAO3_DEFAULT_BUDGET,
  type Jao3AppendCheckpointInput,
  type Jao3AppendOwnerCorrectionInput,
  type Jao3Checkpoint,
  type Jao3CreateInvestigationInput,
  type Jao3EvidenceRef,
  type Jao3Hypothesis,
  type Jao3Investigation,
  type Jao3InvestigationView,
  type Jao3OwnerCorrection,
  type Jao3ResumeInvestigationInput,
  type Jao3SupersedeInvestigationInput,
  type Jao3TransitionInput,
} from './contracts.js';
import {
  assertJao3CheckpointBudget,
  assertJao3CorrectionBudget,
  assertJao3EvidenceAndHypothesisBudget,
  assertJao3ExpectedRevision,
  assertJao3IdentityBinding,
  assertJao3ResumeBudget,
  assertJao3SupersessionTarget,
  assertJao3Writable,
  jao3InstantFromMs,
  jao3SemanticDigest,
} from './policy.js';
import type {
  Jao3CheckpointAppendResult,
  Jao3CorrectionAppendResult,
  Jao3InvestigationStore,
} from './store-port.js';

// ---------------------------------------------------------------------------
// SQL. Internal, fully schema-qualified, and parameterized without exception.
// ---------------------------------------------------------------------------
//
// Nothing below is exported, so the schema and table names are not part of any surface a caller
// can reach or depend on. No identifier is ever interpolated into a statement string, and no
// statement depends on `search_path`.

/** Instants come back in the canonical form the domain schema accepts, rendered by the server. */
const INSTANT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

const INVESTIGATION_COLUMNS = `
  investigation_id,
  root_run_id,
  current_run_id,
  revision,
  status,
  objective,
  workflow_state,
  to_char(created_at AT TIME ZONE 'UTC', ${INSTANT}) AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', ${INSTANT}) AS updated_at,
  to_char(expires_at AT TIME ZONE 'UTC', ${INSTANT}) AS expires_at,
  superseded_by_investigation_id,
  latest_checkpoint_id,
  checkpoint_count,
  owner_correction_count,
  resume_count,
  budget_max_checkpoints,
  budget_max_evidence_refs_per_checkpoint,
  budget_max_hypotheses_per_checkpoint,
  budget_max_owner_corrections,
  budget_max_resume_count,
  budget_max_lifetime_ms
`;

const INSERT_INVESTIGATION = `
  INSERT INTO qf_jarvis_jao3.investigation (
    investigation_id, root_run_id, current_run_id, revision, status, objective, workflow_state,
    created_at, updated_at, expires_at, superseded_by_investigation_id, latest_checkpoint_id,
    checkpoint_count, owner_correction_count, resume_count,
    budget_max_checkpoints, budget_max_evidence_refs_per_checkpoint,
    budget_max_hypotheses_per_checkpoint, budget_max_owner_corrections,
    budget_max_resume_count, budget_max_lifetime_ms
  )
  VALUES ($1, $2, $2, 1, 'OPEN', $3, $4, $5, $5, $6, NULL, NULL, 0, 0, 0,
          $7, $8, $9, $10, $11, $12)
  ON CONFLICT DO NOTHING
  RETURNING ${INVESTIGATION_COLUMNS}
`;

const SELECT_INVESTIGATION = `
  SELECT ${INVESTIGATION_COLUMNS}
  FROM qf_jarvis_jao3.investigation
  WHERE investigation_id = $1
`;

const SELECT_INVESTIGATION_FOR_UPDATE = `${SELECT_INVESTIGATION} FOR UPDATE`;

/**
 * The compare-and-set. `AND revision = $2` is the predicate that decides a race.
 *
 * A zero-row result here cannot mean "no such investigation": the row was located and locked
 * moments earlier in the same transaction. It means someone else wrote first.
 */
const UPDATE_FOR_CHECKPOINT = `
  UPDATE qf_jarvis_jao3.investigation
  SET revision = revision + 1,
      updated_at = $3,
      workflow_state = $4,
      latest_checkpoint_id = $5,
      checkpoint_count = checkpoint_count + 1
  WHERE investigation_id = $1 AND revision = $2
  RETURNING ${INVESTIGATION_COLUMNS}
`;

const UPDATE_FOR_CORRECTION = `
  UPDATE qf_jarvis_jao3.investigation
  SET revision = revision + 1,
      updated_at = $3,
      owner_correction_count = owner_correction_count + 1
  WHERE investigation_id = $1 AND revision = $2
  RETURNING ${INVESTIGATION_COLUMNS}
`;

const UPDATE_FOR_RESUME = `
  UPDATE qf_jarvis_jao3.investigation
  SET revision = revision + 1,
      updated_at = $3,
      current_run_id = $4,
      resume_count = resume_count + 1,
      status = 'OPEN'
  WHERE investigation_id = $1 AND revision = $2
  RETURNING ${INVESTIGATION_COLUMNS}
`;

const UPDATE_STATUS = `
  UPDATE qf_jarvis_jao3.investigation
  SET revision = revision + 1,
      updated_at = $3,
      status = $4
  WHERE investigation_id = $1 AND revision = $2
  RETURNING ${INVESTIGATION_COLUMNS}
`;

const UPDATE_FOR_SUPERSEDE = `
  UPDATE qf_jarvis_jao3.investigation
  SET revision = revision + 1,
      updated_at = $3,
      status = 'SUPERSEDED',
      superseded_by_investigation_id = $4
  WHERE investigation_id = $1 AND revision = $2
  RETURNING ${INVESTIGATION_COLUMNS}
`;

const INSERT_CHECKPOINT = `
  INSERT INTO qf_jarvis_jao3.checkpoint
    (checkpoint_id, investigation_id, revision, run_id, workflow_state, summary,
     next_objective, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

const INSERT_EVIDENCE_REF = `
  INSERT INTO qf_jarvis_jao3.evidence_ref
    (checkpoint_id, ordinal, evidence_ref, kind, source_class, observed_at)
  VALUES ($1, $2, $3, $4, $5, $6)
`;

const INSERT_HYPOTHESIS = `
  INSERT INTO qf_jarvis_jao3.hypothesis
    (checkpoint_id, ordinal, statement, epistemic_status, authority)
  VALUES ($1, $2, $3, $4, 'NONE')
`;

const INSERT_OWNER_CORRECTION = `
  INSERT INTO qf_jarvis_jao3.owner_correction
    (correction_id, investigation_id, revision, target_type, target_id,
     correction_statement, actor, supersedes_target, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, 'FOUNDER', TRUE, $7)
`;

const INSERT_OPERATION_REPLAY = `
  INSERT INTO qf_jarvis_jao3.operation_replay
    (operation_id, investigation_id, operation_kind, payload_digest_hex,
     result_revision, result_child_id, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

const SELECT_OPERATION_REPLAY = `
  SELECT operation_id, investigation_id, operation_kind, payload_digest_hex,
         result_revision, result_child_id
  FROM qf_jarvis_jao3.operation_replay
  WHERE operation_id = $1
`;

const CHECKPOINT_COLUMNS = `
  checkpoint_id, investigation_id, revision, run_id, workflow_state, summary, next_objective,
  to_char(created_at AT TIME ZONE 'UTC', ${INSTANT}) AS created_at
`;

const SELECT_CHECKPOINT = `
  SELECT ${CHECKPOINT_COLUMNS} FROM qf_jarvis_jao3.checkpoint WHERE checkpoint_id = $1
`;

const SELECT_CHECKPOINTS = `
  SELECT ${CHECKPOINT_COLUMNS}
  FROM qf_jarvis_jao3.checkpoint
  WHERE investigation_id = $1
  ORDER BY revision ASC
`;

const SELECT_EVIDENCE_REFS = `
  SELECT checkpoint_id, ordinal, evidence_ref, kind, source_class,
         to_char(observed_at AT TIME ZONE 'UTC', ${INSTANT}) AS observed_at
  FROM qf_jarvis_jao3.evidence_ref
  WHERE checkpoint_id = ANY($1::text[])
  ORDER BY checkpoint_id ASC, ordinal ASC
`;

const SELECT_HYPOTHESES = `
  SELECT checkpoint_id, ordinal, statement, epistemic_status, authority
  FROM qf_jarvis_jao3.hypothesis
  WHERE checkpoint_id = ANY($1::text[])
  ORDER BY checkpoint_id ASC, ordinal ASC
`;

const SELECT_OWNER_CORRECTIONS = `
  SELECT correction_id, investigation_id, revision, target_type, target_id,
         correction_statement, actor, supersedes_target,
         to_char(created_at AT TIME ZONE 'UTC', ${INSTANT}) AS created_at
  FROM qf_jarvis_jao3.owner_correction
  WHERE investigation_id = $1
  ORDER BY revision ASC
`;

// ---------------------------------------------------------------------------
// Error classification.
// ---------------------------------------------------------------------------

/**
 * Is this `code` a SQLSTATE, or a Node socket errno wearing the same property name?
 *
 * `pg` puts the server's five-character SQLSTATE on `error.code` -- but a connection that never
 * reached a server carries a Node errno there instead (`ECONNREFUSED`, `EPIPE`). Reading an errno
 * as a server rejection would report corrupt durable state when nothing was ever reached, which is
 * the opposite of the truth. (The rule established by the repository's other adapters.)
 */
function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && /^([0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/u.test(value);
}

/** Classes that mean "the database, not the request". */
function isUnavailableSqlState(code: string): boolean {
  return (
    code.startsWith('08') ||
    code.startsWith('53') ||
    code.startsWith('57P0') ||
    code === '40001' ||
    code === '40P01'
  );
}

/** Classes that mean the schema or the grants are not the ones this adapter expects. */
function isSchemaSqlState(code: string): boolean {
  return (
    code === '42P01' || code === '42703' || code === '42883' || code === '42501' || code === '3F000'
  );
}

/**
 * Reduce an unknown thrown value to one closed code, discarding everything else.
 *
 * A `Jao3MemoryError` passes through unchanged: it already carries the precise answer, and
 * re-classifying it would replace a specific refusal with a generic one.
 */
export function classifyJao3DatabaseError(error: unknown): Jao3MemoryError {
  if (error instanceof Jao3MemoryError) {
    return error;
  }
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (isSqlState(code)) {
    if (isUnavailableSqlState(code)) {
      return new Jao3MemoryError('DATABASE_UNAVAILABLE');
    }
    if (isSchemaSqlState(code)) {
      return new Jao3MemoryError('STORE_SCHEMA_INCOMPATIBLE');
    }
    // Anything else the server rejected -- a CHECK, a foreign key, a unique violation this
    // adapter did not anticipate -- means the durable state and this adapter disagree about what
    // is representable. An invariant breach, not a transient fault.
    return new Jao3MemoryError('PERSISTED_STATE_INVALID');
  }
  // Never reached a server, or threw something without a SQLSTATE at all. Unavailable is the only
  // honest answer: what is NOT available is "assume it is not there".
  return new Jao3MemoryError('DATABASE_UNAVAILABLE');
}

// ---------------------------------------------------------------------------
// Row reconstruction.
// ---------------------------------------------------------------------------
//
// Declared shapes, `readonly`, matching the repository's other PostgreSQL adapters. A row that
// arrives with a column this file does not name is simply not read: the reconstruction below
// projects named columns into a schema, so a schema drift shows up as a parse failure rather than
// as an extra property travelling silently into a domain object.

interface InvestigationRow {
  readonly investigation_id: string;
  readonly root_run_id: string;
  readonly current_run_id: string;
  readonly revision: number;
  readonly status: string;
  readonly objective: string;
  readonly workflow_state: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly expires_at: string;
  readonly superseded_by_investigation_id: string | null;
  readonly latest_checkpoint_id: string | null;
  readonly checkpoint_count: number;
  readonly owner_correction_count: number;
  readonly resume_count: number;
  readonly budget_max_checkpoints: number;
  readonly budget_max_evidence_refs_per_checkpoint: number;
  readonly budget_max_hypotheses_per_checkpoint: number;
  readonly budget_max_owner_corrections: number;
  readonly budget_max_resume_count: number;
  readonly budget_max_lifetime_ms: number;
}

interface CheckpointRow {
  readonly checkpoint_id: string;
  readonly investigation_id: string;
  readonly revision: number;
  readonly run_id: string;
  readonly summary: string;
  readonly workflow_state: string;
  readonly next_objective: string | null;
  readonly created_at: string;
}

interface EvidenceRefRow {
  readonly checkpoint_id: string;
  readonly ordinal: number;
  readonly evidence_ref: string;
  readonly kind: string;
  readonly source_class: string;
  readonly observed_at: string;
}

interface HypothesisRow {
  readonly checkpoint_id: string;
  readonly ordinal: number;
  readonly statement: string;
  readonly epistemic_status: string;
  readonly authority: string;
}

interface OwnerCorrectionRow {
  readonly correction_id: string;
  readonly investigation_id: string;
  readonly revision: number;
  readonly target_type: string;
  readonly target_id: string;
  readonly correction_statement: string;
  readonly actor: string;
  readonly supersedes_target: boolean;
  readonly created_at: string;
}

interface OperationReplayRow {
  readonly operation_id: string;
  readonly investigation_id: string;
  readonly operation_kind: string;
  readonly payload_digest_hex: string;
  readonly result_revision: number;
  readonly result_child_id: string;
}

/** A row becomes a record only once something has checked that it still is one. */
function toInvestigation(row: InvestigationRow): Jao3Investigation {
  const parsed = jao3InvestigationSchema.safeParse({
    investigationId: row.investigation_id,
    rootRunId: row.root_run_id,
    currentRunId: row.current_run_id,
    revision: row.revision,
    status: row.status,
    objective: row.objective,
    workflowState: row.workflow_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    supersededByInvestigationId: row.superseded_by_investigation_id,
    latestCheckpointId: row.latest_checkpoint_id,
    checkpointCount: row.checkpoint_count,
    ownerCorrectionCount: row.owner_correction_count,
    resumeCount: row.resume_count,
    budget: {
      maxCheckpoints: row.budget_max_checkpoints,
      maxEvidenceRefsPerCheckpoint: row.budget_max_evidence_refs_per_checkpoint,
      maxHypothesesPerCheckpoint: row.budget_max_hypotheses_per_checkpoint,
      maxOwnerCorrections: row.budget_max_owner_corrections,
      maxResumeCount: row.budget_max_resume_count,
      maxLifetimeMs: row.budget_max_lifetime_ms,
    },
    memoryClass: 'OPERATIONAL_NON_AUTHORITATIVE',
  });
  if (!parsed.success) {
    throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

function toCheckpoint(
  row: CheckpointRow,
  evidenceRefs: readonly Jao3EvidenceRef[],
  hypotheses: readonly Jao3Hypothesis[],
): Jao3Checkpoint {
  const parsed = jao3CheckpointSchema.safeParse({
    checkpointId: row.checkpoint_id,
    investigationId: row.investigation_id,
    revision: row.revision,
    runId: row.run_id,
    workflowState: row.workflow_state,
    summary: row.summary,
    evidenceRefs: [...evidenceRefs],
    hypotheses: [...hypotheses],
    nextObjective: row.next_objective,
    createdAt: row.created_at,
  });
  if (!parsed.success) {
    throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

function toOwnerCorrection(row: OwnerCorrectionRow): Jao3OwnerCorrection {
  const parsed = jao3OwnerCorrectionSchema.safeParse({
    correctionId: row.correction_id,
    investigationId: row.investigation_id,
    revision: row.revision,
    targetType: row.target_type,
    targetId: row.target_id,
    correctionStatement: row.correction_statement,
    actor: row.actor,
    supersedesTarget: row.supersedes_target,
    createdAt: row.created_at,
  });
  if (!parsed.success) {
    throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
  }
  return Object.freeze(parsed.data);
}

/** Group child rows by the checkpoint that owns them, preserving ordinal order. */
function groupByCheckpoint<Row extends { checkpoint_id: string }, Out>(
  rows: readonly Row[],
  convert: (row: Row) => Out,
): Map<string, Out[]> {
  const grouped = new Map<string, Out[]>();
  for (const row of rows) {
    const existing = grouped.get(row.checkpoint_id);
    if (existing === undefined) {
      grouped.set(row.checkpoint_id, [convert(row)]);
    } else {
      existing.push(convert(row));
    }
  }
  return grouped;
}

async function loadCheckpointById(
  client: DatabaseClient,
  checkpointId: string,
): Promise<Jao3Checkpoint> {
  const found = await client.query<CheckpointRow>(SELECT_CHECKPOINT, [checkpointId]);
  const row = found.rows[0];
  if (row === undefined) {
    // The header points at a checkpoint that is not there. That is durable state contradicting
    // itself, not an absence -- and trusting it would be worse than refusing.
    throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
  }
  // Sequential, not `Promise.all`: a `pg` client executes one statement at a time, so issuing
  // two at once is not parallelism -- it is two statements racing down one connection. `pg`
  // deprecates it and `pg@9` removes it.
  const evidenceRows = await client.query<EvidenceRefRow>(SELECT_EVIDENCE_REFS, [[checkpointId]]);
  const hypothesisRows = await client.query<HypothesisRow>(SELECT_HYPOTHESES, [[checkpointId]]);
  return toCheckpoint(
    row,
    evidenceRows.rows.map(toEvidenceRef),
    hypothesisRows.rows.map(toHypothesis),
  );
}

function toEvidenceRef(row: EvidenceRefRow): Jao3EvidenceRef {
  return {
    evidenceRef: row.evidence_ref,
    kind: row.kind,
    // Parsed by `jao3CheckpointSchema` a moment later; a value the closed vocabulary refuses
    // fails there rather than being narrowed by a cast here.
    sourceClass: row.source_class,
    observedAt: row.observed_at,
  } as unknown as Jao3EvidenceRef;
}

function toHypothesis(row: HypothesisRow): Jao3Hypothesis {
  return {
    statement: row.statement,
    epistemicStatus: row.epistemic_status,
    authority: row.authority,
  } as unknown as Jao3Hypothesis;
}

// ---------------------------------------------------------------------------
// Semantic digests. What makes a retried write recognisable as the same write.
// ---------------------------------------------------------------------------

function checkpointDigest(input: Jao3AppendCheckpointInput): string {
  return jao3SemanticDigest([
    'APPEND_CHECKPOINT',
    input.investigationId,
    input.runId,
    input.checkpointId,
    input.workflowState,
    input.summary,
    input.nextObjective ?? '',
    ...input.evidenceRefs.flatMap((one) => [
      one.evidenceRef,
      one.kind,
      one.sourceClass,
      one.observedAt,
    ]),
    ...input.hypotheses.flatMap((one) => [one.statement, one.epistemicStatus, one.authority]),
  ]);
}

function correctionDigest(input: Jao3AppendOwnerCorrectionInput): string {
  return jao3SemanticDigest([
    'APPEND_OWNER_CORRECTION',
    input.investigationId,
    input.runId,
    input.correctionId,
    input.targetType,
    input.targetId,
    input.correctionStatement,
    input.actor,
  ]);
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------

/** Parse an operation input, or refuse before a single statement runs. */
function parseInput<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new Jao3MemoryError('INPUT_INVALID');
  }
  return parsed.data;
}

async function loadForUpdate(
  client: DatabaseClient,
  investigationId: string,
): Promise<Jao3Investigation> {
  const found = await client.query<InvestigationRow>(SELECT_INVESTIGATION_FOR_UPDATE, [
    investigationId,
  ]);
  const row = found.rows[0];
  if (row === undefined) {
    throw new Jao3MemoryError('INVESTIGATION_NOT_FOUND');
  }
  return toInvestigation(row);
}

/**
 * The single revision-advancing write, and the only place a zero-row result is interpreted.
 *
 * The row was located and locked earlier in this transaction, so zero rows here can only mean the
 * revision moved: someone else wrote first.
 */
function applyCas(rows: readonly InvestigationRow[], rowCount: number | null): Jao3Investigation {
  const row = rows[0];
  if (rowCount !== 1 || row === undefined) {
    throw new Jao3MemoryError('REVISION_CONFLICT');
  }
  return toInvestigation(row);
}

/**
 * Build the durable operational memory store over an explicitly supplied pool.
 *
 * The caller owns the pool and closes it. Nothing is cached across calls, and nothing is held in
 * process between them: two stores built over two pools see exactly the same durable state,
 * because the durable state is the only state there is. That is what the restart proof measures.
 */
export function createJao3PostgresStore(pool: DatabasePool): Jao3InvestigationStore {
  return Object.freeze({
    async createInvestigation(
      rawInput: Jao3CreateInvestigationInput,
      nowMs: number,
    ): Promise<Jao3Investigation> {
      const input = parseInput(jao3CreateInvestigationInputSchema, rawInput);
      const createdAt = jao3InstantFromMs(nowMs);
      const expiresAt = jao3InstantFromMs(nowMs + input.lifetimeMs);
      const budget = { ...JAO3_DEFAULT_BUDGET, maxLifetimeMs: input.lifetimeMs };

      try {
        return await withClient(pool, async (client) => {
          const inserted = await client.query<InvestigationRow>(INSERT_INVESTIGATION, [
            input.investigationId,
            input.rootRunId,
            input.objective,
            input.workflowState,
            createdAt,
            expiresAt,
            budget.maxCheckpoints,
            budget.maxEvidenceRefsPerCheckpoint,
            budget.maxHypothesesPerCheckpoint,
            budget.maxOwnerCorrections,
            budget.maxResumeCount,
            budget.maxLifetimeMs,
          ]);
          const row = inserted.rows[0];
          if (row === undefined) {
            // `ON CONFLICT DO NOTHING` skipped: an investigation with that identity exists. Never
            // an overwrite -- a durable record is not a thing a second caller gets to replace.
            throw new Jao3MemoryError('INVESTIGATION_ALREADY_EXISTS');
          }
          return toInvestigation(row);
        });
      } catch (error) {
        throw classifyJao3DatabaseError(error);
      }
    },

    async readInvestigation(investigationId: string): Promise<Jao3Investigation> {
      try {
        return await withClient(pool, async (client) => {
          const found = await client.query<InvestigationRow>(SELECT_INVESTIGATION, [
            investigationId,
          ]);
          const row = found.rows[0];
          if (row === undefined) {
            throw new Jao3MemoryError('INVESTIGATION_NOT_FOUND');
          }
          return toInvestigation(row);
        });
      } catch (error) {
        throw classifyJao3DatabaseError(error);
      }
    },

    async readInvestigationView(investigationId: string): Promise<Jao3InvestigationView> {
      try {
        return await withClient(pool, async (client) => {
          const found = await client.query<InvestigationRow>(SELECT_INVESTIGATION, [
            investigationId,
          ]);
          const headerRow = found.rows[0];
          if (headerRow === undefined) {
            throw new Jao3MemoryError('INVESTIGATION_NOT_FOUND');
          }
          const investigation = toInvestigation(headerRow);

          const checkpointRows = await client.query<CheckpointRow>(SELECT_CHECKPOINTS, [
            investigationId,
          ]);
          const checkpointIds = checkpointRows.rows.map((row) => row.checkpoint_id);
          // One at a time, on one client. See `loadCheckpointById`.
          const evidenceRows = await client.query<EvidenceRefRow>(SELECT_EVIDENCE_REFS, [
            checkpointIds,
          ]);
          const hypothesisRows = await client.query<HypothesisRow>(SELECT_HYPOTHESES, [
            checkpointIds,
          ]);
          const correctionRows = await client.query<OwnerCorrectionRow>(SELECT_OWNER_CORRECTIONS, [
            investigationId,
          ]);
          const evidenceByCheckpoint = groupByCheckpoint(evidenceRows.rows, toEvidenceRef);
          const hypothesesByCheckpoint = groupByCheckpoint(hypothesisRows.rows, toHypothesis);

          const view = jao3InvestigationViewSchema.safeParse({
            investigation,
            checkpoints: checkpointRows.rows.map((row) =>
              toCheckpoint(
                row,
                evidenceByCheckpoint.get(row.checkpoint_id) ?? [],
                hypothesesByCheckpoint.get(row.checkpoint_id) ?? [],
              ),
            ),
            ownerCorrections: correctionRows.rows.map(toOwnerCorrection),
          });
          if (!view.success) {
            throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
          }
          return Object.freeze(view.data);
        });
      } catch (error) {
        throw classifyJao3DatabaseError(error);
      }
    },

    async appendCheckpoint(
      rawInput: Jao3AppendCheckpointInput,
      nowMs: number,
    ): Promise<Jao3CheckpointAppendResult> {
      const input = parseInput(jao3AppendCheckpointInputSchema, rawInput);
      const createdAt = jao3InstantFromMs(nowMs);
      const digest = checkpointDigest(input);

      try {
        return await withTransaction(pool, async (client) => {
          const investigation = await loadForUpdate(client, input.investigationId);

          // REPLAY FIRST, and deliberately before the writability guards. A caller that cannot
          // tell whether its previous attempt committed is asking "did this already happen" --
          // and if it did, it happened, whatever the investigation's status has become since.
          // Re-refusing a write that is already durable would leave the caller retrying forever.
          const replayed = await client.query<OperationReplayRow>(SELECT_OPERATION_REPLAY, [
            input.operationId,
          ]);
          const priorRow = replayed.rows[0];
          if (priorRow !== undefined) {
            if (
              priorRow.investigation_id !== input.investigationId ||
              priorRow.operation_kind !== 'APPEND_CHECKPOINT' ||
              priorRow.payload_digest_hex !== digest
            ) {
              // Same operation id, different write. Fail closed rather than let one id mean two
              // things in the history.
              throw new Jao3MemoryError('CHECKPOINT_CONFLICT');
            }
            return Object.freeze({
              investigation,
              checkpoint: await loadCheckpointById(client, priorRow.result_child_id),
              replayed: true,
            });
          }

          assertJao3Writable(investigation, nowMs);
          assertJao3IdentityBinding(investigation, {
            investigationId: input.investigationId,
            runId: input.runId,
          });
          assertJao3ExpectedRevision(investigation, input.expectedRevision);
          assertJao3CheckpointBudget(investigation);
          assertJao3EvidenceAndHypothesisBudget(investigation, {
            evidenceRefs: input.evidenceRefs.length,
            hypotheses: input.hypotheses.length,
          });

          const updated = await client.query<InvestigationRow>(UPDATE_FOR_CHECKPOINT, [
            input.investigationId,
            input.expectedRevision,
            createdAt,
            input.workflowState,
            input.checkpointId,
          ]);
          const nextInvestigation = applyCas(updated.rows, updated.rowCount);

          await client.query(INSERT_CHECKPOINT, [
            input.checkpointId,
            input.investigationId,
            nextInvestigation.revision,
            input.runId,
            input.workflowState,
            input.summary,
            input.nextObjective,
            createdAt,
          ]);
          for (const [ordinal, evidence] of input.evidenceRefs.entries()) {
            await client.query(INSERT_EVIDENCE_REF, [
              input.checkpointId,
              ordinal,
              evidence.evidenceRef,
              evidence.kind,
              evidence.sourceClass,
              evidence.observedAt,
            ]);
          }
          for (const [ordinal, hypothesis] of input.hypotheses.entries()) {
            await client.query(INSERT_HYPOTHESIS, [
              input.checkpointId,
              ordinal,
              hypothesis.statement,
              hypothesis.epistemicStatus,
            ]);
          }
          await client.query(INSERT_OPERATION_REPLAY, [
            input.operationId,
            input.investigationId,
            'APPEND_CHECKPOINT',
            digest,
            nextInvestigation.revision,
            input.checkpointId,
            createdAt,
          ]);

          // Read back what was actually stored rather than returning what was sent. A write that
          // reports the caller's own input has proved nothing about the database.
          return Object.freeze({
            investigation: nextInvestigation,
            checkpoint: await loadCheckpointById(client, input.checkpointId),
            replayed: false,
          });
        });
      } catch (error) {
        throw classifyJao3DatabaseError(error);
      }
    },

    async appendOwnerCorrection(
      rawInput: Jao3AppendOwnerCorrectionInput,
      nowMs: number,
    ): Promise<Jao3CorrectionAppendResult> {
      const input = parseInput(jao3AppendOwnerCorrectionInputSchema, rawInput);
      const createdAt = jao3InstantFromMs(nowMs);
      const digest = correctionDigest(input);

      try {
        return await withTransaction(pool, async (client) => {
          const investigation = await loadForUpdate(client, input.investigationId);

          const replayed = await client.query<OperationReplayRow>(SELECT_OPERATION_REPLAY, [
            input.operationId,
          ]);
          const priorRow = replayed.rows[0];
          if (priorRow !== undefined) {
            if (
              priorRow.investigation_id !== input.investigationId ||
              priorRow.operation_kind !== 'APPEND_OWNER_CORRECTION' ||
              priorRow.payload_digest_hex !== digest
            ) {
              throw new Jao3MemoryError('CORRECTION_CONFLICT');
            }
            const corrections = await client.query<OwnerCorrectionRow>(SELECT_OWNER_CORRECTIONS, [
              input.investigationId,
            ]);
            const prior = corrections.rows.find(
              (row) => row.correction_id === priorRow.result_child_id,
            );
            if (prior === undefined) {
              throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
            }
            return Object.freeze({
              investigation,
              correction: toOwnerCorrection(prior),
              replayed: true,
            });
          }

          assertJao3Writable(investigation, nowMs);
          assertJao3IdentityBinding(investigation, {
            investigationId: input.investigationId,
            runId: input.runId,
          });
          assertJao3ExpectedRevision(investigation, input.expectedRevision);
          assertJao3CorrectionBudget(investigation);

          const updated = await client.query<InvestigationRow>(UPDATE_FOR_CORRECTION, [
            input.investigationId,
            input.expectedRevision,
            createdAt,
          ]);
          const nextInvestigation = applyCas(updated.rows, updated.rowCount);

          await client.query(INSERT_OWNER_CORRECTION, [
            input.correctionId,
            input.investigationId,
            nextInvestigation.revision,
            input.targetType,
            input.targetId,
            input.correctionStatement,
            createdAt,
          ]);
          await client.query(INSERT_OPERATION_REPLAY, [
            input.operationId,
            input.investigationId,
            'APPEND_OWNER_CORRECTION',
            digest,
            nextInvestigation.revision,
            input.correctionId,
            createdAt,
          ]);

          const stored = await client.query<OwnerCorrectionRow>(SELECT_OWNER_CORRECTIONS, [
            input.investigationId,
          ]);
          const persisted = stored.rows.find((row) => row.correction_id === input.correctionId);
          if (persisted === undefined) {
            throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
          }
          return Object.freeze({
            investigation: nextInvestigation,
            correction: toOwnerCorrection(persisted),
            replayed: false,
          });
        });
      } catch (error) {
        throw classifyJao3DatabaseError(error);
      }
    },

    async resumeInvestigation(
      rawInput: Jao3ResumeInvestigationInput,
      nowMs: number,
    ): Promise<Jao3Investigation> {
      const input = parseInput(jao3ResumeInvestigationInputSchema, rawInput);
      const updatedAt = jao3InstantFromMs(nowMs);

      try {
        return await withTransaction(pool, async (client) => {
          const investigation = await loadForUpdate(client, input.investigationId);
          if (investigation.investigationId !== input.investigationId) {
            throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
          }

          // COMPLETED, SUPERSEDED and EXPIRED all stop here. Resume is not a way back.
          assertJao3Writable(investigation, nowMs);
          assertJao3ExpectedRevision(investigation, input.expectedRevision);
          assertJao3ResumeBudget(investigation);

          // `rootRunId` is not in this statement and not in any other: the run that opened an
          // investigation is a fact about it, and nothing in this adapter can change it.
          const updated = await client.query<InvestigationRow>(UPDATE_FOR_RESUME, [
            input.investigationId,
            input.expectedRevision,
            updatedAt,
            input.nextRunId,
          ]);
          const resumed = applyCas(updated.rows, updated.rowCount);
          if (resumed.rootRunId !== investigation.rootRunId) {
            throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
          }
          return resumed;
        });
      } catch (error) {
        throw classifyJao3DatabaseError(error);
      }
    },

    async pauseInvestigation(
      rawInput: Jao3TransitionInput,
      nowMs: number,
    ): Promise<Jao3Investigation> {
      return transitionStatus(pool, rawInput, nowMs, 'PAUSED');
    },

    async completeInvestigation(
      rawInput: Jao3TransitionInput,
      nowMs: number,
    ): Promise<Jao3Investigation> {
      return transitionStatus(pool, rawInput, nowMs, 'COMPLETED');
    },

    async supersedeInvestigation(
      rawInput: Jao3SupersedeInvestigationInput,
      nowMs: number,
    ): Promise<Jao3Investigation> {
      const input = parseInput(jao3SupersedeInvestigationInputSchema, rawInput);
      const updatedAt = jao3InstantFromMs(nowMs);

      try {
        return await withTransaction(pool, async (client) => {
          const investigation = await loadForUpdate(client, input.investigationId);
          assertJao3Writable(investigation, nowMs);
          assertJao3IdentityBinding(investigation, {
            investigationId: input.investigationId,
            runId: input.runId,
          });
          assertJao3ExpectedRevision(investigation, input.expectedRevision);
          assertJao3SupersessionTarget(investigation, input.supersededByInvestigationId);

          // Status and pointer move in ONE statement. Two investigations are never merged: the old
          // record keeps its own history and gains a pointer to what replaced it.
          const updated = await client.query<InvestigationRow>(UPDATE_FOR_SUPERSEDE, [
            input.investigationId,
            input.expectedRevision,
            updatedAt,
            input.supersededByInvestigationId,
          ]);
          return applyCas(updated.rows, updated.rowCount);
        });
      } catch (error) {
        throw classifyJao3DatabaseError(error);
      }
    },
  });
}

async function transitionStatus(
  pool: DatabasePool,
  rawInput: Jao3TransitionInput,
  nowMs: number,
  status: 'PAUSED' | 'COMPLETED',
): Promise<Jao3Investigation> {
  const input = parseInput(jao3TransitionInputSchema, rawInput);
  const updatedAt = jao3InstantFromMs(nowMs);

  try {
    return await withTransaction(pool, async (client) => {
      const investigation = await loadForUpdate(client, input.investigationId);
      assertJao3Writable(investigation, nowMs);
      assertJao3IdentityBinding(investigation, {
        investigationId: input.investigationId,
        runId: input.runId,
      });
      assertJao3ExpectedRevision(investigation, input.expectedRevision);

      const updated = await client.query<InvestigationRow>(UPDATE_STATUS, [
        input.investigationId,
        input.expectedRevision,
        updatedAt,
        status,
      ]);
      return applyCas(updated.rows, updated.rowCount);
    });
  } catch (error) {
    throw classifyJao3DatabaseError(error);
  }
}
