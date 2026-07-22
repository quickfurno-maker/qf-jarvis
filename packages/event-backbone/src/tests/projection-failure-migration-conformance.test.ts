/**
 * QFJ-P03.07C — the SQL vocabulary in migration 0006 must EXACTLY match the TypeScript persistence
 * vocabulary (ADR-0040). Database-free: it parses the migration file and the TS constants.
 *
 * This is the guard that keeps the CHECK-constrained closed vocabularies in
 * `0006_projection_failure_operations.sql` set-equal to the closed vocabularies in
 * `projection-failure-persistence.ts` — no missing value, no extra value, no duplicate literal.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PROJECTION_FAILURE_CATEGORIES } from '../projections/projection-failure-taxonomy.js';
import {
  PROJECTION_FAILURE_ACTION_TYPES,
  PROJECTION_FAILURE_ACTOR_TYPES,
  PROJECTION_FAILURE_STATUSES,
  PROJECTION_PERSISTED_FAILURE_CODES,
  PROJECTION_REPLAY_ATTEMPT_STATES,
  PROJECTION_REPLAY_AUTHORIZATION_STATES,
} from '../projections/projection-failure-persistence.js';

const MIGRATION_SQL = readFileSync(
  new URL('../persistence/migrations/0006_projection_failure_operations.sql', import.meta.url),
  'utf8',
);

/** The literal set of the FIRST `IN ( … )` after a named CHECK constraint (lists are flat, no nesting). */
function inListAfter(constraintName: string): string[] {
  const anchor = MIGRATION_SQL.indexOf(constraintName);
  expect(anchor, `constraint ${constraintName} exists`).toBeGreaterThan(-1);
  const region = MIGRATION_SQL.slice(anchor);
  const open = region.indexOf('IN (');
  expect(open).toBeGreaterThan(-1);
  const close = region.indexOf(')', open);
  const body = region.slice(open + 'IN ('.length, close);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

function expectSetEqual(sql: string[], ts: readonly string[]): void {
  expect(sql.length, 'no duplicate SQL literal').toBe(new Set(sql).size);
  expect([...sql].sort()).toEqual([...ts].sort());
}

describe('migration 0006 CHECK vocabularies match the TypeScript persistence vocabularies', () => {
  it('failure category', () => {
    expectSetEqual(inListAfter('projection_failure_category_known'), PROJECTION_FAILURE_CATEGORIES);
  });
  it('failure diagnostic code', () => {
    expectSetEqual(
      inListAfter('projection_failure_code_known'),
      PROJECTION_PERSISTED_FAILURE_CODES,
    );
  });
  it('failure lifecycle status', () => {
    expectSetEqual(inListAfter('projection_failure_status_known'), PROJECTION_FAILURE_STATUSES);
  });
  it('action type', () => {
    expectSetEqual(
      inListAfter('projection_failure_action_type_known'),
      PROJECTION_FAILURE_ACTION_TYPES,
    );
  });
  it('actor type', () => {
    expectSetEqual(
      inListAfter('projection_failure_action_actor_type_known'),
      PROJECTION_FAILURE_ACTOR_TYPES,
    );
  });
  it('replay authorization state', () => {
    expectSetEqual(
      inListAfter('projection_replay_authorization_state_known'),
      PROJECTION_REPLAY_AUTHORIZATION_STATES,
    );
  });
  it('replay attempt state', () => {
    expectSetEqual(
      inListAfter('projection_replay_attempt_state_known'),
      PROJECTION_REPLAY_ATTEMPT_STATES,
    );
  });
  it('replay attempt outcome code', () => {
    expectSetEqual(
      inListAfter('projection_replay_attempt_outcome_code_known'),
      PROJECTION_PERSISTED_FAILURE_CODES,
    );
  });
});

describe('migration 0006 is projection-failure-only and self-consistent', () => {
  it('creates exactly the four failure-persistence tables', () => {
    const created = [...MIGRATION_SQL.matchAll(/CREATE TABLE qf_jarvis\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([
      'projection_failure',
      'projection_failure_action',
      'projection_replay_attempt',
      'projection_replay_authorization',
    ]);
  });

  it('contains no out-of-scope (MVP/Post-MVP) schema', () => {
    // Scan only the SQL BODY (strip `--` comment lines): the migration's own exclusion comment
    // legitimately names the out-of-scope concepts. Word-boundary matching so that e.g. "storage"
    // does not trip the "rag" check.
    const sqlBody = MIGRATION_SQL.split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .toLowerCase();
    for (const forbidden of [
      'rag',
      'pgvector',
      'vector',
      'whatsapp',
      'groq',
      'riya',
      'anisha',
      'model_gateway',
      'payment',
      'refund',
      'subject_activity',
      'analytics',
    ]) {
      expect(sqlBody, `must not mention "${forbidden}"`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
  });

  it('every table is fully qualified in qf_jarvis and grants nothing to PUBLIC', () => {
    expect(MIGRATION_SQL).toContain(
      'REVOKE ALL ON qf_jarvis.projection_failure               FROM PUBLIC;',
    );
    expect(MIGRATION_SQL).not.toMatch(/GRANT[^;]*TO\s+PUBLIC/i);
  });
});
