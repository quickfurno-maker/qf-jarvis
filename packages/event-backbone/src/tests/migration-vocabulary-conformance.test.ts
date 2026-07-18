/**
 * The SQL vocabulary in migration 0003 must EXACTLY match the TypeScript persistence vocabulary
 * (Stage 3.3.3, ADR-0031).
 *
 * The `rejection-reason-conformance` test (in `@qf-jarvis/event-ingestion`) proves the TypeScript
 * persistence constants match the reasons the ingestion layer emits. This test closes the other
 * half: it reads the actual `0003_ingestion_rejection_and_event_conflict.sql`, extracts the literal
 * sets from the two named `CHECK` constraints, and proves they are set-equal to
 * `INGESTION_REJECTION_REASON_CODES` / `INGESTION_REJECTION_ISSUE_CODES` — in both directions, with
 * no missing code, no extra code, and no duplicate literal. Database-free: it parses a file.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { INGESTION_REJECTION_ISSUE_CODES, INGESTION_REJECTION_REASON_CODES } from '../index.js';

const MIGRATION_SQL = readFileSync(
  new URL(
    '../persistence/migrations/0003_ingestion_rejection_and_event_conflict.sql',
    import.meta.url,
  ),
  'utf8',
);

/** Extract every single-quoted literal from a SQL fragment. */
function literals(fragment: string): string[] {
  return [...fragment.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

/**
 * The body of `reason_code IN ( … )` inside the named reason-code CHECK. Anchored on the constraint
 * name so an unrelated `IN (...)` elsewhere cannot be picked up, and bounded to the first closing
 * paren (the literal list contains no nested parens).
 */
function reasonCheckLiterals(): string[] {
  const anchor = MIGRATION_SQL.indexOf('ingestion_rejection_reason_code_is_known');
  expect(anchor).toBeGreaterThan(-1);
  const region = MIGRATION_SQL.slice(anchor);
  const match = /reason_code IN \(([\s\S]*?)\)/.exec(region);
  if (match?.[1] === undefined) {
    throw new Error('Could not extract the reason_code CHECK literal list');
  }
  return literals(match[1]);
}

/** The body of `issue_codes <@ ARRAY[ … ]` inside the named safe-issue-code CHECK. */
function issueCodeCheckLiterals(): string[] {
  const anchor = MIGRATION_SQL.indexOf('ingestion_rejection_issue_codes_are_safe');
  expect(anchor).toBeGreaterThan(-1);
  const region = MIGRATION_SQL.slice(anchor);
  const match = /issue_codes <@ ARRAY\[([\s\S]*?)\]/.exec(region);
  if (match?.[1] === undefined) {
    throw new Error('Could not extract the issue_codes CHECK literal list');
  }
  return literals(match[1]);
}

function assertExactSetEquality(sqlLiterals: string[], tsCodes: readonly string[]): void {
  // No duplicate literal in the SQL.
  expect(sqlLiterals.length).toBe(new Set(sqlLiterals).size);

  const sqlSet = new Set(sqlLiterals);
  const tsSet = new Set(tsCodes);

  // No missing SQL code (every TS code is in the SQL).
  for (const code of tsSet) {
    expect(sqlSet.has(code)).toBe(true);
  }
  // No extra SQL code (every SQL code is in TS).
  for (const code of sqlSet) {
    expect(tsSet.has(code)).toBe(true);
  }
  // Exact size equality clinches set-equality in both directions.
  expect(sqlSet.size).toBe(tsSet.size);
}

describe('migration 0003 reason-code CHECK matches INGESTION_REJECTION_REASON_CODES exactly', () => {
  it('is set-equal in both directions, with no duplicate literal', () => {
    assertExactSetEquality(reasonCheckLiterals(), INGESTION_REJECTION_REASON_CODES);
  });

  it('explicitly contains unsupported-algorithm and key-expired', () => {
    const sql = new Set(reasonCheckLiterals());
    expect(sql.has('unsupported-algorithm')).toBe(true);
    expect(sql.has('key-expired')).toBe(true);
  });

  it('explicitly EXCLUDES duplicate-conflict (a conflict is not a rejection)', () => {
    expect(new Set(reasonCheckLiterals()).has('duplicate-conflict')).toBe(false);
    expect(new Set<string>(INGESTION_REJECTION_REASON_CODES).has('duplicate-conflict')).toBe(false);
  });
});

describe('migration 0003 issue-code CHECK matches INGESTION_REJECTION_ISSUE_CODES exactly', () => {
  it('is set-equal in both directions, with no duplicate literal', () => {
    assertExactSetEquality(issueCodeCheckLiterals(), INGESTION_REJECTION_ISSUE_CODES);
  });
});
