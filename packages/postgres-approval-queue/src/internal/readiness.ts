/**
 * Startup readiness (QFJ-P08, ADR-0081).
 *
 * INTERNAL. Answers one question before an application relies on the queue: is the database this
 * pool points at actually the schema migration 0009 describes, and may this principal use it?
 *
 * Strictly non-mutating. Every table probe carries `WHERE false`, so PostgreSQL resolves and
 * type-checks every column and returns nothing: no row is written, locked or created, and no
 * transaction is opened. Readiness that changed what it checked would be a migration under another
 * name.
 *
 * It does not consult `schema_migration` and needs no privilege on it. That is migration-tooling
 * state; requiring it would grant a deployment principal visibility it has no operational need for,
 * and would make a *recorded* migration rather than the *actual* schema the thing startup trusts.
 */
import type { Pool } from 'pg';

import { PostgresApprovalQueueError, classifyDatabaseError } from '../contracts/errors.js';

const PROBE_REQUEST_COLUMNS = `
  SELECT sequence, approval_request_id, recommendation_id, proposed_action_id, action_fingerprint,
         created_at, expires_at, request_payload, source_snapshot, recorded_at
    FROM qf_jarvis.approval_request_record
   WHERE false
`;

const PROBE_SLOT_COLUMNS = `
  SELECT recommendation_id, proposed_action_id, active_approval_request_id
    FROM qf_jarvis.approval_active_slot
   WHERE false
`;

const PROBE_DECISION_COLUMNS = `
  SELECT sequence, decision_id, recommendation_id, decided_at, decision_payload, recorded_at
    FROM qf_jarvis.approval_decision_record
   WHERE false
`;

const PROBE_LINK_COLUMNS = `
  SELECT sequence, approval_request_id, decision_id, selected_action_decision, linked_at
    FROM qf_jarvis.approval_request_decision_link
   WHERE false
`;

const PROBE_AUDIT_COLUMNS = `
  SELECT sequence, event_type, approval_request_id, decision_id, recommendation_id,
         proposed_action_id, record_version, recorded_at
    FROM qf_jarvis.approval_queue_audit
   WHERE false
`;

const PROBE_CONSTRAINTS = `
  SELECT c.conname AS name, pg_catalog.pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'qf_jarvis'
     AND t.relname IN ('approval_request_record', 'approval_active_slot',
                       'approval_decision_record', 'approval_request_decision_link',
                       'approval_queue_audit')
`;

const PROBE_TRIGGERS = `
  SELECT t.tgname AS name, t.tgenabled AS enabled
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'qf_jarvis'
     AND c.relname IN ('approval_request_record', 'approval_active_slot',
                       'approval_decision_record', 'approval_request_decision_link',
                       'approval_queue_audit')
     AND NOT t.tgisinternal
`;

/**
 * The MINIMUM privileges the adapter needs, asked of the CURRENT principal.
 *
 * A minimum, not an exact match: startup does not refuse a principal that happens to hold more.
 * Least privilege is proved by the migration's own tests against the grants 0009 issues, and
 * re-litigating it here would make an owner-run local database fail to start for a reason that is
 * not a readiness problem.
 */
const PROBE_PRIVILEGES = `
  SELECT
    has_table_privilege(current_user, 'qf_jarvis.approval_request_record', 'SELECT') AS req_select,
    has_table_privilege(current_user, 'qf_jarvis.approval_request_record', 'INSERT') AS req_insert,
    has_table_privilege(current_user, 'qf_jarvis.approval_active_slot', 'SELECT') AS slot_select,
    has_table_privilege(current_user, 'qf_jarvis.approval_active_slot', 'INSERT') AS slot_insert,
    has_column_privilege(current_user, 'qf_jarvis.approval_active_slot', 'active_approval_request_id', 'UPDATE') AS slot_update_pointer,
    has_table_privilege(current_user, 'qf_jarvis.approval_decision_record', 'SELECT') AS dec_select,
    has_table_privilege(current_user, 'qf_jarvis.approval_decision_record', 'INSERT') AS dec_insert,
    has_table_privilege(current_user, 'qf_jarvis.approval_request_decision_link', 'SELECT') AS link_select,
    has_table_privilege(current_user, 'qf_jarvis.approval_request_decision_link', 'INSERT') AS link_insert,
    has_table_privilege(current_user, 'qf_jarvis.approval_queue_audit', 'SELECT') AS audit_select,
    has_table_privilege(current_user, 'qf_jarvis.approval_queue_audit', 'INSERT') AS audit_insert
`;

/** Constraints whose absence would let the store hold something the adapter cannot trust. */
const REQUIRED_CHECK_CONSTRAINTS: readonly string[] = Object.freeze([
  'approval_request_record_expires_after_created',
  'approval_request_record_fingerprint_is_lowercase_sha256',
  'approval_request_record_payload_is_object',
  'approval_request_record_source_is_object',
  'approval_request_record_columns_match_payload',
  'approval_decision_record_payload_is_object',
  'approval_decision_record_columns_match_payload',
  // The one fact that makes a decision authoritative at all.
  'approval_decision_record_issuer_is_core',
  'approval_decision_record_outcome_known',
  'approval_request_decision_link_verdict_known',
  'approval_queue_audit_event_type_known',
  'approval_queue_audit_record_version_is_one',
  'approval_queue_audit_decision_id_pairing',
]);

/**
 * The constraints whose DEFINITION matters, not merely their name.
 *
 * A slot primary key on `recommendation_id` alone would satisfy an existence check and silently
 * collapse every action of a recommendation into one coordination slot. A link unique on
 * `decision_id` instead of `approval_request_id` would forbid the legitimate one-decision-answers-
 * two-actions case while allowing a request to be answered twice — the exact inversion of the rule.
 */
const REQUIRED_CONSTRAINT_DEFINITIONS: Readonly<Record<string, string>> = Object.freeze({
  approval_active_slot_pk: 'PRIMARY KEY (recommendation_id, proposed_action_id)',
});

/** Foreign keys, matched by prefix so a later ON DELETE clause does not break readiness. */
const REQUIRED_FOREIGN_KEYS: Readonly<Record<string, string>> = Object.freeze({
  approval_active_slot_request_fk: 'FOREIGN KEY (active_approval_request_id) REFERENCES',
  approval_request_decision_link_request_fk: 'FOREIGN KEY (approval_request_id) REFERENCES',
  approval_request_decision_link_decision_fk: 'FOREIGN KEY (decision_id) REFERENCES',
  approval_queue_audit_request_fk: 'FOREIGN KEY (approval_request_id) REFERENCES',
});

/** Append-only enforcement, plus the slot key guard. A disabled guard is worse than a missing one. */
const REQUIRED_TRIGGERS: readonly string[] = Object.freeze([
  'approval_request_record_append_only_trigger',
  'approval_decision_record_append_only_trigger',
  'approval_request_decision_link_append_only_trigger',
  'approval_queue_audit_append_only_trigger',
  'approval_active_slot_guard_trigger',
]);

/** `O` origin and `A` always. `D` is disabled; `R` fires only on a replica, which here is the same. */
const FIRING_TRIGGER_STATES: readonly string[] = Object.freeze(['O', 'A']);

function incompatible(): never {
  throw new PostgresApprovalQueueError('schema-incompatible');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Verify the runtime-visible 0009 storage contract. Resolves on success; mutates nothing. */
export async function assertQueueReady(pool: Pool): Promise<void> {
  let constraintRows: unknown[];
  let triggerRows: unknown[];
  let privilegeRow: unknown;

  try {
    for (const probe of [
      PROBE_REQUEST_COLUMNS,
      PROBE_SLOT_COLUMNS,
      PROBE_DECISION_COLUMNS,
      PROBE_LINK_COLUMNS,
      PROBE_AUDIT_COLUMNS,
    ]) {
      await pool.query(probe);
    }
    constraintRows = (await pool.query(PROBE_CONSTRAINTS)).rows;
    triggerRows = (await pool.query(PROBE_TRIGGERS)).rows;
    privilegeRow = (await pool.query(PROBE_PRIVILEGES)).rows[0];
  } catch (error) {
    // Includes 42501 insufficient_privilege, which the classifier maps to schema-incompatible: a
    // principal that cannot read its own tables has the wrong grants, not a transient fault.
    throw classifyDatabaseError(error);
  }

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
  for (const [name, prefix] of Object.entries(REQUIRED_FOREIGN_KEYS)) {
    if (!definitions.get(name)?.startsWith(prefix)) {
      return incompatible();
    }
  }
  // The uniques that carry the one-answer-per-ask rule and the request identity.
  for (const [name, definition] of Object.entries({
    approval_request_record_approval_request_id_key: 'UNIQUE (approval_request_id)',
    approval_decision_record_decision_id_key: 'UNIQUE (decision_id)',
    approval_request_decision_link_approval_request_id_key: 'UNIQUE (approval_request_id)',
  })) {
    if (definitions.get(name) !== definition) {
      return incompatible();
    }
  }

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

  if (!isRecord(privilegeRow)) {
    return incompatible();
  }
  for (const key of [
    'req_select',
    'req_insert',
    'slot_select',
    'slot_insert',
    'slot_update_pointer',
    'dec_select',
    'dec_insert',
    'link_select',
    'link_insert',
    'audit_select',
    'audit_insert',
  ]) {
    if (privilegeRow[key] !== true) {
      return incompatible();
    }
  }
}
