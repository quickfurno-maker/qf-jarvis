/**
 * The durable PostgreSQL conversation-state adapter (QFJ-P08-B2, ADR-0077).
 *
 * The first production implementation of ADR-0075's writable authoritative-state boundary. It is the
 * ATOMIC application point that contract requires: read + decide + write happen inside one
 * transaction, so an `APPLIED` control state is authoritative before the promise resolves, and the
 * very next `read` — in this process or another — observes it.
 *
 * What it deliberately is not:
 *
 * - it does NOT implement `readOperationsProjection`. No governed writer exists for the six
 *   supplemental fields (ADR-0076 §9), and fabricating tokens to make an interface light up is worse
 *   than the composition's honest `operations-unavailable`;
 * - it does NOT synchronise Core-derived facts. The schema can carry a future same-revision update,
 *   but the runtime role has no UPDATE privilege on those columns, so the capability does not exist
 *   by accident;
 * - it stores no consent, opt-out, suppression, approval, communication-authorization or business
 *   data, and no message, prompt, model, provider or free-text content anywhere.
 *
 * It creates no pool, reads no environment and starts nothing on import. The caller injects a `pg`
 * Pool and owns its lifecycle.
 */
import { applyConversationControlCommand } from '@qf-jarvis/conversation-control';
import type {
  ConversationControlCommand,
  ConversationControlDecision,
} from '@qf-jarvis/conversation-control';
import type {
  ConversationControlState,
  ConversationStateKey,
  WritableAuthoritativeConversationStatePort,
} from '@qf-jarvis/jarvis-runtime';
import type { Pool, PoolClient } from 'pg';

import { PostgresConversationStateError, classifyDatabaseError } from '../contracts/errors.js';
import {
  canonicalizeCommandRow,
  canonicalizeStateRow,
  controlFragmentOf,
  isSameCommand,
} from '../internal/rows.js';
import {
  INSERT_COMMAND,
  INSERT_STATE,
  SELECT_COMMAND,
  SELECT_STATE,
  SELECT_STATE_FOR_UPDATE,
  UPDATE_STATE_CONTROL,
  withControlTransaction,
} from '../internal/sql.js';
import {
  DATA_CLASSES,
  PARTY_TYPES,
  SUBJECT_STATUSES,
  isExactIdentifier,
  isMember,
  isPlainRecord,
  isSafeReference,
} from '../internal/validation.js';

/**
 * What a TRUSTED provisioner supplies to create one conversation's runtime state.
 *
 * `revision`, `humanTakeover` and `aiPaused` are deliberately absent: the adapter stamps 0 / false /
 * false, and the database trigger refuses anything else. Importing an already-controlled conversation
 * is a different operation with different authority, and ADR-0076 §6 does not authorise it here.
 *
 * Every Core-derived fact is REQUIRED with no default. A default `partyType` or `dataClass` would be
 * this adapter inventing a business fact, which is precisely why an operator command may not
 * provision: it does not carry them.
 */
export interface TrustedConversationStateProvisioningInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly partyType: string;
  readonly dataClass: string;
  readonly cancelled: boolean;
  readonly subjectStatus: string;
  readonly subjectRef?: string;
  readonly observedAt: string;
}

/**
 * The outcome of provisioning.
 *
 * `ALREADY_PROVISIONED` returns the CURRENT row, not the offered facts — provisioning is not
 * synchronisation, and a caller must see what actually exists.
 */
export interface TrustedConversationStateProvisioningResult {
  readonly outcome: 'CREATED' | 'ALREADY_PROVISIONED';
  readonly state: ConversationControlState;
}

/**
 * The adapter: the writable authoritative-state port plus trusted provisioning.
 *
 * It does NOT extend `OperationsProjectingAuthoritativeConversationStatePort`, so the composition's
 * capability detection correctly reports `operations-unavailable` rather than a fabricated snapshot.
 */
export interface PostgresConversationStateAdapter extends WritableAuthoritativeConversationStatePort {
  provision(
    input: TrustedConversationStateProvisioningInput,
  ): Promise<TrustedConversationStateProvisioningResult>;
}

/** A private sentinel: a concurrent duplicate claimed this command id while we were deciding. */
const DUPLICATE_RACE = Symbol('duplicate-race');
class DuplicateRace extends Error {
  readonly marker = DUPLICATE_RACE;
}

function invalidInput(): never {
  throw new PostgresConversationStateError('invalid-input');
}

/** Validate a key before any SQL runs. A wildcard is not a query a database should interpret. */
function validKey(key: unknown): ConversationStateKey {
  if (
    !isPlainRecord(key) ||
    !isExactIdentifier(key['tenantId']) ||
    !isExactIdentifier(key['conversationId'])
  ) {
    return invalidInput();
  }
  return Object.freeze({ tenantId: key['tenantId'], conversationId: key['conversationId'] });
}

/** Validate a materialized command. It is a structural interface; the type is not evidence. */
function validCommand(command: unknown): ConversationControlCommand {
  if (
    !isPlainRecord(command) ||
    command['controlVersion'] !== 1 ||
    !isExactIdentifier(command['commandId']) ||
    !isExactIdentifier(command['conversationId']) ||
    !isExactIdentifier(command['operatorRef']) ||
    typeof command['expectedRevision'] !== 'number' ||
    !Number.isSafeInteger(command['expectedRevision']) ||
    command['expectedRevision'] < 0 ||
    typeof command['action'] !== 'string' ||
    typeof command['issuedAt'] !== 'string' ||
    (command['reasonRef'] !== undefined && !isExactIdentifier(command['reasonRef']))
  ) {
    return invalidInput();
  }
  return command as unknown as ConversationControlCommand;
}

async function readStateRow(
  client: PoolClient,
  key: ConversationStateKey,
  statement: string,
): Promise<ConversationControlState | undefined> {
  const result = await client.query(statement, [key.tenantId, key.conversationId]);
  const row: unknown = result.rows[0];
  return row === undefined ? undefined : canonicalizeStateRow(row);
}

/** Build a durable adapter over an injected pool. The caller owns the pool. */
export function createPostgresConversationStateAdapter(config: {
  readonly pool: Pool;
}): PostgresConversationStateAdapter {
  // Typed `unknown` at the check: the declared parameter says a pool is present, but this is a
  // package boundary and an untyped caller -- or a bare Pool passed instead of `{ pool }` -- would
  // otherwise reach the first query as `undefined`.
  const supplied: unknown = config;
  if (
    !isPlainRecord(supplied) ||
    supplied['pool'] === undefined ||
    supplied['pool'] === null ||
    typeof (supplied['pool'] as { query?: unknown }).query !== 'function'
  ) {
    return invalidInput();
  }
  const pool = supplied['pool'] as Pool;

  async function read(key: ConversationStateKey): Promise<ConversationControlState> {
    const scoped = validKey(key);
    let state: ConversationControlState | undefined;
    try {
      const result = await pool.query(SELECT_STATE, [scoped.tenantId, scoped.conversationId]);
      const row: unknown = result.rows[0];
      state = row === undefined ? undefined : canonicalizeStateRow(row);
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    if (state === undefined) {
      // Never lazily provisioned: a read has even less business inventing business facts than a
      // control command does.
      throw new PostgresConversationStateError('state-not-found');
    }
    return state;
  }

  async function provision(
    input: TrustedConversationStateProvisioningInput,
  ): Promise<TrustedConversationStateProvisioningResult> {
    if (
      !isPlainRecord(input) ||
      !isExactIdentifier(input.tenantId) ||
      !isExactIdentifier(input.conversationId) ||
      !isMember(PARTY_TYPES, input.partyType) ||
      !isMember(DATA_CLASSES, input.dataClass) ||
      typeof input.cancelled !== 'boolean' ||
      !isMember(SUBJECT_STATUSES, input.subjectStatus) ||
      (input.subjectRef !== undefined && !isExactIdentifier(input.subjectRef)) ||
      !isSafeReference(input.observedAt)
    ) {
      return invalidInput();
    }
    const subjectRef = input.subjectRef ?? null;

    try {
      const inserted = await pool.query(INSERT_STATE, [
        input.tenantId,
        input.conversationId,
        input.partyType,
        input.dataClass,
        input.cancelled,
        input.subjectStatus,
        subjectRef,
        input.observedAt,
      ]);
      const createdRow: unknown = inserted.rows[0];
      if (createdRow !== undefined) {
        return Object.freeze({
          outcome: 'CREATED' as const,
          state: canonicalizeStateRow(createdRow),
        });
      }

      // A row already exists. Provisioning is idempotent on the CORE-DERIVED facts only: the
      // operational columns (revision, takeover, pause, observedAt) are expected to have moved on,
      // and treating that as a conflict would make a harmless retry look like a contradiction.
      const existingResult = await pool.query(SELECT_STATE, [input.tenantId, input.conversationId]);
      const existingRow: unknown = existingResult.rows[0];
      if (existingRow === undefined) {
        // Inserted nothing and found nothing: the row vanished between two statements, which nothing
        // in this schema permits.
        throw new PostgresConversationStateError('repository-invariant');
      }
      const existing = canonicalizeStateRow(existingRow);
      if (
        existing.partyType !== input.partyType ||
        existing.dataClass !== input.dataClass ||
        existing.cancelled !== input.cancelled ||
        existing.subjectStatus !== input.subjectStatus ||
        (existing.subjectRef ?? null) !== subjectRef
      ) {
        // Different Core-derived facts for the same conversation. Overwriting would make provisioning
        // a synchronisation path, which it is explicitly not.
        throw new PostgresConversationStateError('provisioning-conflict');
      }
      return Object.freeze({ outcome: 'ALREADY_PROVISIONED' as const, state: existing });
    } catch (error) {
      throw classifyDatabaseError(error);
    }
  }

  /**
   * Apply one operator control command atomically.
   *
   * Order, and why each step is where it is:
   *
   * 1. Look for the command id FIRST. An exact duplicate must return the ORIGINAL decision without
   *    re-deciding — that is the crash-recovery case, and re-evaluating would report
   *    `revision-mismatch` and lie about what happened.
   * 2. Lock the state row. This is what serialises concurrent commands for one conversation.
   * 3. Run the REAL reducer exactly once. The SQL constraints validate evidence; they are not a
   *    second decision engine, and this adapter defines no semantics of its own.
   * 4. Write the state only on APPLIED, touching only the four operator-owned columns.
   * 5. Append the ledger row in the SAME transaction, so state and audit commit together.
   */
  async function applyControlCommand(
    key: ConversationStateKey,
    command: ConversationControlCommand,
  ): Promise<ConversationControlDecision> {
    const scoped = validKey(key);
    const validated = validCommand(command);
    if (validated.conversationId !== scoped.conversationId) {
      return invalidInput();
    }

    try {
      return await withControlTransaction(pool, async (client) => {
        const priorResult = await client.query(SELECT_COMMAND, [
          scoped.tenantId,
          validated.commandId,
        ]);
        const priorRow: unknown = priorResult.rows[0];
        if (priorRow !== undefined) {
          const prior = canonicalizeCommandRow(priorRow);
          if (!isSameCommand(prior.identity, validated)) {
            throw new PostgresConversationStateError('command-conflict');
          }
          // Exact duplicate: the original decision, verbatim, even if the revision has since moved.
          return prior.decision;
        }

        const state = await readStateRow(client, scoped, SELECT_STATE_FOR_UPDATE);
        if (state === undefined) {
          throw new PostgresConversationStateError('state-not-found');
        }

        const decision = applyConversationControlCommand(controlFragmentOf(state), validated);

        if (decision.outcome === 'APPLIED') {
          const updated = await client.query(UPDATE_STATE_CONTROL, [
            scoped.tenantId,
            scoped.conversationId,
            decision.nextState.revision,
            decision.nextState.humanTakeover,
            decision.nextState.aiPaused,
            state.revision,
            validated.issuedAt,
          ]);
          if (updated.rowCount !== 1) {
            // The locked row did not accept the update. Nothing in this schema allows that.
            throw new PostgresConversationStateError('repository-invariant');
          }
        }

        const audit = decision.auditRecord;
        const appended = await client.query(INSERT_COMMAND, [
          scoped.tenantId,
          validated.commandId,
          scoped.conversationId,
          validated.expectedRevision,
          validated.action,
          validated.operatorRef,
          validated.reasonRef ?? null,
          validated.issuedAt,
          decision.outcome,
          decision.reason,
          audit.observedRevision,
          decision.nextState.revision,
          decision.nextState.humanTakeover,
          decision.nextState.aiPaused,
        ]);
        if (appended.rowCount !== 1) {
          // Another session claimed this command id after we started deciding. Roll the WHOLE
          // transaction back -- including any APPLIED state update -- and reconcile afterwards
          // against the row that actually won. Committing here would apply one command twice.
          throw new DuplicateRace();
        }
        return decision;
      });
    } catch (error) {
      if (!(error instanceof DuplicateRace)) {
        throw classifyDatabaseError(error);
      }
    }

    // Reconciliation after a rolled-back duplicate race. This is NOT a second application: nothing
    // is decided here, only read.
    let winnerRow: unknown;
    try {
      const result = await pool.query(SELECT_COMMAND, [scoped.tenantId, validated.commandId]);
      winnerRow = result.rows[0];
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    if (winnerRow === undefined) {
      throw new PostgresConversationStateError('repository-invariant');
    }
    const winner = canonicalizeCommandRow(winnerRow);
    if (!isSameCommand(winner.identity, validated)) {
      throw new PostgresConversationStateError('command-conflict');
    }
    return winner.decision;
  }

  return Object.freeze({ read, provision, applyControlCommand });
}
