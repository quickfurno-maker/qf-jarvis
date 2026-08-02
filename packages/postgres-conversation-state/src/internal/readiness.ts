/**
 * Startup readiness (QFJ-P08-B3, ADR-0078).
 *
 * INTERNAL. Answers one question before an application is allowed to build a runtime: **is the
 * database this pool points at actually the schema migration 0008 describes, and may this principal
 * use it?**
 *
 * The alternative is discovering the answer on the first inbound turn, which is the worst possible
 * moment: a real conversation is waiting, the failure surfaces as a refusal rather than a startup
 * error, and an operator sees an outage that looks like a bug in the conversation logic. B2 already
 * fails closed on every path — but failing closed one message at a time, in production, is not the
 * same as refusing to start.
 *
 * ### It is strictly non-mutating
 *
 * Every probe is a `SELECT`. The table probes carry `WHERE false`, so they resolve every column and
 * return zero rows without reading, locking or touching one. No row is inserted, updated, deleted or
 * locked; no conversation is provisioned; no control command is applied. There is no `FOR UPDATE`,
 * no transaction, and no advisory lock. Readiness that changed the thing it was checking would be a
 * migration wearing a different name.
 *
 * ### It does not consult `schema_migration`
 *
 * Deliberately. That table is migration-tooling state, and requiring the runtime role to read it
 * would grant a deployment principal visibility it has no operational need for — and would make a
 * *recorded* migration, rather than the *actual* schema, the thing startup trusts. What matters is
 * whether the objects and privileges this adapter uses exist right now. A hand-repaired database
 * with an intact ledger row is exactly the case a checksum row cannot catch.
 */
import type { Pool } from 'pg';

import { PostgresConversationStateError, classifyDatabaseError } from '../contracts/errors.js';

/**
 * Zero-row column probes.
 *
 * Naming every column the adapter reads or writes means a dropped or renamed column fails HERE, with
 * a bounded `schema-incompatible`, rather than mid-transaction on a live command. `WHERE false` is
 * what keeps it free: PostgreSQL still resolves and type-checks every column, and returns nothing.
 */
const PROBE_STATE_COLUMNS = `
  SELECT tenant_id, conversation_id, revision, party_type, data_class,
         cancelled, subject_status, subject_ref, human_takeover, ai_paused, observed_at
    FROM qf_jarvis.conversation_runtime_state
   WHERE false
`;

/**
 * `sequence` and `recorded_at` are included although the adapter names only the former: `sequence`
 * is its `RETURNING` column, and `recorded_at` is the DATABASE-stamped audit time the append-only
 * contract depends on. An insert would still succeed without `recorded_at` — and would silently
 * produce an audit row with no independent record of when it was written.
 */
const PROBE_LEDGER_COLUMNS = `
  SELECT sequence, tenant_id, command_id, conversation_id, control_version, expected_revision,
         action, operator_ref, reason_ref, issued_at, outcome, reason,
         observed_revision, resulting_revision, resulting_human_takeover,
         resulting_ai_paused, record_version, recorded_at
    FROM qf_jarvis.conversation_control_command
   WHERE false
`;

const PROBE_CONSTRAINTS = `
  SELECT c.conname AS name, pg_catalog.pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'qf_jarvis'
     AND t.relname IN ('conversation_runtime_state', 'conversation_control_command')
`;

const PROBE_TRIGGERS = `
  SELECT t.tgname AS name, t.tgenabled AS enabled
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'qf_jarvis'
     AND c.relname IN ('conversation_runtime_state', 'conversation_control_command')
     AND NOT t.tgisinternal
`;

/**
 * The MINIMUM privileges the adapter needs, asked of the CURRENT principal.
 *
 * Deliberately a minimum, not an exact match: startup does not refuse a principal that happens to
 * hold more. Least privilege is proved by the migration's own tests against the grants 0008 issues;
 * re-litigating it here would make an owner-run local database — the ordinary development case —
 * fail to start for a reason that is not a readiness problem.
 */
const PROBE_PRIVILEGES = `
  SELECT
    has_table_privilege(current_user, 'qf_jarvis.conversation_runtime_state', 'SELECT') AS state_select,
    has_table_privilege(current_user, 'qf_jarvis.conversation_runtime_state', 'INSERT') AS state_insert,
    has_column_privilege(current_user, 'qf_jarvis.conversation_runtime_state', 'revision', 'UPDATE') AS state_update_revision,
    has_column_privilege(current_user, 'qf_jarvis.conversation_runtime_state', 'human_takeover', 'UPDATE') AS state_update_human_takeover,
    has_column_privilege(current_user, 'qf_jarvis.conversation_runtime_state', 'ai_paused', 'UPDATE') AS state_update_ai_paused,
    has_column_privilege(current_user, 'qf_jarvis.conversation_runtime_state', 'observed_at', 'UPDATE') AS state_update_observed_at,
    has_table_privilege(current_user, 'qf_jarvis.conversation_control_command', 'SELECT') AS ledger_select,
    has_table_privilege(current_user, 'qf_jarvis.conversation_control_command', 'INSERT') AS ledger_insert
`;

/** Constraints whose ABSENCE would let the database store something the adapter cannot trust. */
const REQUIRED_CHECK_CONSTRAINTS: readonly string[] = Object.freeze([
  // The state row: identity grammar, revision bounds, and the three closed Core vocabularies.
  'conversation_runtime_state_tenant_is_exact_identifier',
  'conversation_runtime_state_conversation_is_exact_identifier',
  'conversation_runtime_state_revision_in_safe_range',
  'conversation_runtime_state_party_type_known',
  'conversation_runtime_state_data_class_known',
  'conversation_runtime_state_subject_status_known',
  // The ledger: the action vocabulary, the outcome/reason pairing, the reducer's arithmetic, and the
  // ADR-0075 §8a action postconditions. Without these the audit is no longer self-validating.
  'conversation_control_command_action_known',
  'conversation_control_command_outcome_reason_pairing',
  'conversation_control_command_applied_advances_one',
  'conversation_control_command_no_change_holds_revision',
  'conversation_control_command_applied_post_state',
  'conversation_control_command_no_change_post_state',
  'conversation_control_command_exhausted_needed_a_change',
]);

/**
 * The two constraints whose DEFINITION matters, not merely their name.
 *
 * A primary key named `…_pk` that keyed on `conversation_id` alone would satisfy an existence check
 * and silently re-impose the global-uniqueness assumption ADR-0076 removed. Likewise a
 * `…_identity_unique` on `command_id` alone would make command ids global and collide across
 * tenants. These are exactly the two places where a plausible wrong schema is worse than a missing
 * one, so the definition is compared verbatim.
 */
const REQUIRED_CONSTRAINT_DEFINITIONS: Readonly<Record<string, string>> = Object.freeze({
  conversation_runtime_state_pk: 'PRIMARY KEY (tenant_id, conversation_id)',
  conversation_control_command_identity_unique: 'UNIQUE (tenant_id, command_id)',
});

/** The foreign key that makes "no lazy row creation from an operator command" a storage property. */
const REQUIRED_FOREIGN_KEY = 'conversation_control_command_state_fk';

/** Both row triggers, which enforce what no CHECK can express. */
const REQUIRED_TRIGGERS: readonly string[] = Object.freeze([
  'conversation_runtime_state_guard_trigger',
  'conversation_control_command_append_only_trigger',
]);

/**
 * `tgenabled` states in which a trigger actually fires for ordinary traffic.
 *
 * `O` origin and `A` always. `D` is disabled; `R` fires only on a replica, which for this process is
 * indistinguishable from disabled — and a disabled guard trigger is strictly more dangerous than a
 * missing one, because the table still looks correct.
 */
const FIRING_TRIGGER_STATES: readonly string[] = Object.freeze(['O', 'A']);

function incompatible(): never {
  throw new PostgresConversationStateError('schema-incompatible');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Verify the runtime-visible B2 storage contract. Resolves on success; never mutates anything.
 *
 * Every failure is one of the adapter's existing bounded codes — no new code, and nothing from the
 * driver, the catalog, the connection or the principal reaches the message.
 */
export async function assertStorageReady(pool: Pool): Promise<void> {
  let constraintRows: unknown[];
  let triggerRows: unknown[];
  let privilegeRow: unknown;

  try {
    // 1 & 2. The tables exist and every column the adapter uses is selectable. A missing relation is
    // 42P01 and a missing column 42703, both of which the classifier already calls schema-incompatible.
    await pool.query(PROBE_STATE_COLUMNS);
    await pool.query(PROBE_LEDGER_COLUMNS);

    const constraints = await pool.query(PROBE_CONSTRAINTS);
    constraintRows = constraints.rows;
    const triggers = await pool.query(PROBE_TRIGGERS);
    triggerRows = triggers.rows;
    const privileges = await pool.query(PROBE_PRIVILEGES);
    privilegeRow = privileges.rows[0];
  } catch (error) {
    // Includes 42501 insufficient_privilege, which the classifier maps to schema-incompatible: a
    // principal that cannot read its own tables is not a transient fault, it is the wrong grants.
    throw classifyDatabaseError(error);
  }

  // 3 & 4. Constraints.
  const definitions = new Map<string, string>();
  for (const row of constraintRows) {
    if (
      !isRecord(row) ||
      typeof row['name'] !== 'string' ||
      typeof row['definition'] !== 'string'
    ) {
      return incompatible();
    }
    definitions.set(row['name'], row['definition']);
  }
  for (const name of REQUIRED_CHECK_CONSTRAINTS) {
    if (!definitions.has(name)) {
      return incompatible();
    }
  }
  for (const [name, definition] of Object.entries(REQUIRED_CONSTRAINT_DEFINITIONS)) {
    if (definitions.get(name) !== definition) {
      return incompatible();
    }
  }
  if (
    !definitions.get(REQUIRED_FOREIGN_KEY)?.startsWith('FOREIGN KEY (tenant_id, conversation_id)')
  ) {
    return incompatible();
  }

  // 5. Triggers exist AND fire.
  const triggerStates = new Map<string, string>();
  for (const row of triggerRows) {
    if (!isRecord(row) || typeof row['name'] !== 'string' || typeof row['enabled'] !== 'string') {
      return incompatible();
    }
    triggerStates.set(row['name'], row['enabled']);
  }
  for (const name of REQUIRED_TRIGGERS) {
    const state = triggerStates.get(name);
    if (state === undefined || !FIRING_TRIGGER_STATES.includes(state)) {
      return incompatible();
    }
  }

  // 6. Minimum privileges for the current principal.
  if (!isRecord(privilegeRow)) {
    return incompatible();
  }
  for (const key of [
    'state_select',
    'state_insert',
    'state_update_revision',
    'state_update_human_takeover',
    'state_update_ai_paused',
    'state_update_observed_at',
    'ledger_select',
    'ledger_insert',
  ]) {
    if (privilegeRow[key] !== true) {
      return incompatible();
    }
  }
}
