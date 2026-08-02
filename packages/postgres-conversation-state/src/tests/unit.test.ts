/**
 * QFJ-P08-B2 — the adapter's pure boundaries (ADR-0077).
 *
 * Everything here runs without a database: error classification and redaction, input validation, row
 * canonicalization, and the vocabulary conformance that keeps this package's private copies honest.
 *
 * The durability, concurrency and idempotency claims are proven against a real PostgreSQL in
 * `postgres.integration.test.ts` — they cannot be proven here, and nothing in this file pretends to.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  RUNTIME_DATA_CLASSES,
  RUNTIME_PARTY_TYPES,
  RUNTIME_SUBJECT_STATUSES,
} from '@qf-jarvis/agent-runtime';
import {
  CONVERSATION_CONTROL_ACTIONS_FROZEN,
  CONVERSATION_CONTROL_OUTCOMES_FROZEN,
  CONVERSATION_CONTROL_REASONS_FROZEN,
} from '@qf-jarvis/conversation-control';

import * as barrel from '../index.js';
import {
  POSTGRES_CONVERSATION_STATE_ERROR_CODES,
  PostgresConversationStateError,
  createPostgresConversationStateAdapter,
} from '../index.js';
import { classifyDatabaseError } from '../contracts/errors.js';
import { canonicalizeCommandRow, canonicalizeStateRow, isSameCommand } from '../internal/rows.js';
import {
  DATA_CLASSES,
  PARTY_TYPES,
  SUBJECT_STATUSES,
  isCanonicalInstant,
  parseBigintRevision,
  toCanonicalInstant,
} from '../internal/validation.js';

const PKG_DIR = new URL('../../', import.meta.url);
const REPO_ROOT = new URL('../../../../', import.meta.url);
const AT = '2026-08-01T00:00:00.000Z';

function stateRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: 'tenant.a',
    conversation_id: 'conv.1',
    revision: '3',
    party_type: 'CLIENT',
    data_class: 'HOSTED_ALLOWED',
    human_takeover: false,
    ai_paused: false,
    cancelled: false,
    subject_status: 'clear',
    subject_ref: null,
    observed_at: '2026-07-25T00:00:00Z',
    ...over,
  };
}

function commandRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: 'tenant.a',
    command_id: 'ctrl.1',
    conversation_id: 'conv.1',
    control_version: 1,
    expected_revision: '3',
    action: 'TAKE_OWNERSHIP',
    operator_ref: 'op.1',
    reason_ref: null,
    issued_at: new Date(AT),
    outcome: 'APPLIED',
    reason: 'applied',
    observed_revision: '3',
    resulting_revision: '4',
    resulting_human_takeover: true,
    resulting_ai_paused: true,
    record_version: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Vocabulary conformance — the private copies must not drift.
// ---------------------------------------------------------------------------

describe('private vocabularies match their governed originals', () => {
  it('mirrors the agent-runtime party, data-class and subject-status vocabularies exactly', () => {
    // These are duplicated so the package keeps no PRODUCTION dependency on agent-runtime. That is
    // only safe if drift fails loudly, which is what this asserts.
    expect([...PARTY_TYPES]).toEqual([...RUNTIME_PARTY_TYPES]);
    expect([...DATA_CLASSES]).toEqual([...RUNTIME_DATA_CLASSES]);
    expect([...SUBJECT_STATUSES]).toEqual([...RUNTIME_SUBJECT_STATUSES]);
  });

  it('the migration CHECK constraints name exactly those vocabularies', () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          'packages/event-backbone/src/persistence/migrations/0008_conversation_control_persistence.sql',
          REPO_ROOT,
        ),
      ),
      'utf8',
    );
    for (const value of [
      ...RUNTIME_PARTY_TYPES,
      ...RUNTIME_DATA_CLASSES,
      ...RUNTIME_SUBJECT_STATUSES,
    ]) {
      expect(sql).toContain(`'${value}'`);
    }
    for (const value of [
      ...CONVERSATION_CONTROL_ACTIONS_FROZEN,
      ...CONVERSATION_CONTROL_OUTCOMES_FROZEN,
      ...CONVERSATION_CONTROL_REASONS_FROZEN,
    ]) {
      expect(sql).toContain(`'${value}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

describe('the error contract', () => {
  it('exposes exactly seven codes with fixed, content-free messages', () => {
    expect([...POSTGRES_CONVERSATION_STATE_ERROR_CODES]).toEqual([
      'invalid-input',
      'state-not-found',
      'provisioning-conflict',
      'command-conflict',
      'repository-invariant',
      'database-unavailable',
      'schema-incompatible',
    ]);
    expect(Object.isFrozen(POSTGRES_CONVERSATION_STATE_ERROR_CODES)).toBe(true);
    for (const code of POSTGRES_CONVERSATION_STATE_ERROR_CODES) {
      const message = new PostgresConversationStateError(code).message;
      expect(message.length).toBeGreaterThan(0);
      // No identifier, no SQL, no driver vocabulary.
      expect(message).not.toMatch(/select|insert|update|constraint|relation|column|pg_|tenant\./i);
    }
  });

  it('classifies SQLSTATEs without ever surfacing the driver error', () => {
    const cases: readonly [string, string][] = [
      ['08006', 'database-unavailable'],
      ['08003', 'database-unavailable'],
      ['53300', 'database-unavailable'],
      ['57P01', 'database-unavailable'],
      ['40001', 'database-unavailable'],
      ['40P01', 'database-unavailable'],
      ['42P01', 'schema-incompatible'],
      ['42703', 'schema-incompatible'],
      ['42883', 'schema-incompatible'],
      ['23514', 'repository-invariant'],
      ['23503', 'repository-invariant'],
      ['23505', 'repository-invariant'],
    ];
    for (const [sqlState, expected] of cases) {
      const raw = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
        code: sqlState,
        table: 'conversation_runtime_state',
        constraint: 'conversation_runtime_state_pk',
        detail: 'Key (tenant_id, conversation_id)=(tenant.secret, conv.secret) already exists.',
      });
      const classified = classifyDatabaseError(raw);
      expect(classified.code, sqlState).toBe(expected);
      // The whole point: nothing from the driver reaches the message.
      expect(classified.message).not.toContain('tenant.secret');
      expect(classified.message).not.toContain('conversation_runtime_state');
      expect(classified.message).not.toContain('duplicate key');
    }
  });

  it('passes an adapter error through rather than re-classifying it', () => {
    const original = new PostgresConversationStateError('command-conflict');
    expect(classifyDatabaseError(original)).toBe(original);
  });

  it('treats an unrecognised throw as database-unavailable', () => {
    expect(classifyDatabaseError(new Error('socket hang up')).code).toBe('database-unavailable');
    expect(classifyDatabaseError('nope').code).toBe('database-unavailable');
  });
});

// ---------------------------------------------------------------------------
// Value parsing.
// ---------------------------------------------------------------------------

describe('BIGINT and TIMESTAMPTZ handling', () => {
  it('parses only revisions a JavaScript number represents exactly', () => {
    // `pg` returns BIGINT as a STRING precisely because the range exceeds a safe integer. Coercing
    // blindly would round a revision, and a revision that rounds compares equal when it should not.
    expect(parseBigintRevision('0')).toBe(0);
    expect(parseBigintRevision('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseBigintRevision(7)).toBe(7);
    for (const bad of ['9007199254740993', '-1', '1.5', 'x', '', null, undefined, 1.5, -1]) {
      expect(parseBigintRevision(bad), String(bad)).toBeUndefined();
    }
  });

  it('renders a TIMESTAMPTZ back to the exact canonical UTC millisecond form', () => {
    expect(toCanonicalInstant(new Date(AT))).toBe(AT);
    expect(isCanonicalInstant(toCanonicalInstant(new Date(AT)) ?? '')).toBe(true);
    for (const bad of [AT, '2026-08-01', 7, null, undefined, new Date('nope')]) {
      expect(toCanonicalInstant(bad)).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Row canonicalization.
// ---------------------------------------------------------------------------

describe('state row canonicalization', () => {
  it('rebuilds a frozen state and maps SQL NULL subject_ref to undefined', () => {
    const state = canonicalizeStateRow(stateRow());
    expect(Object.isFrozen(state)).toBe(true);
    expect(state.revision).toBe(3);
    expect(state.subjectRef).toBeUndefined();
    expect(state.observedAt).toBe('2026-07-25T00:00:00Z');
    expect(canonicalizeStateRow(stateRow({ subject_ref: 'subject.opaque' })).subjectRef).toBe(
      'subject.opaque',
    );
  });

  it('refuses a row that could not have come from migration 0008', () => {
    // "The CHECK constraints prevent that" is a claim about a schema this process did not verify.
    const bad: readonly [string, Record<string, unknown>][] = [
      ['unsafe revision', stateRow({ revision: '9007199254740993' })],
      ['negative revision', stateRow({ revision: '-1' })],
      ['unknown party', stateRow({ party_type: 'SUPPLIER' })],
      ['unknown data class', stateRow({ data_class: 'PUBLIC' })],
      ['unknown subject status', stateRow({ subject_status: 'fine' })],
      ['non-boolean flag', stateRow({ human_takeover: 'yes' })],
      ['wildcard tenant', stateRow({ tenant_id: '*' })],
      ['prose observed_at', stateRow({ observed_at: 'last tuesday' })],
      ['prose subject_ref', stateRow({ subject_ref: 'Jane Smith' })],
    ];
    for (const [label, row] of bad) {
      expect(() => canonicalizeStateRow(row), label).toThrow(PostgresConversationStateError);
    }
    expect(() => canonicalizeStateRow(null)).toThrow(PostgresConversationStateError);
  });
});

describe('command row canonicalization', () => {
  it('rebuilds a frozen decision and audit record', () => {
    const record = canonicalizeCommandRow(commandRow());
    expect(Object.isFrozen(record.decision)).toBe(true);
    expect(Object.isFrozen(record.decision.nextState)).toBe(true);
    expect(Object.isFrozen(record.decision.auditRecord)).toBe(true);
    expect(record.decision.outcome).toBe('APPLIED');
    expect(record.decision.nextState.revision).toBe(4);
    expect(record.decision.auditRecord.issuedAt).toBe(AT);
    expect('reasonRef' in record.decision.auditRecord).toBe(false);
  });

  it('carries reasonRef only when the stored row had one', () => {
    const withRef = canonicalizeCommandRow(commandRow({ reason_ref: 'reason.x' }));
    expect(withRef.decision.auditRecord.reasonRef).toBe('reason.x');
    expect(withRef.identity.reasonRef).toBe('reason.x');
    expect(canonicalizeCommandRow(commandRow()).identity.reasonRef).toBeUndefined();
  });

  it('refuses durable evidence that contradicts itself', () => {
    const bad: readonly [string, Record<string, unknown>][] = [
      ['wrong outcome/reason pair', commandRow({ reason: 'already-satisfied' })],
      ['APPLIED without a bump', commandRow({ resulting_revision: '3' })],
      ['APPLIED post-state a TAKE cannot produce', commandRow({ resulting_human_takeover: false })],
      [
        'RELEASE that resumed AI',
        commandRow({
          action: 'RELEASE_OWNERSHIP',
          resulting_human_takeover: false,
          resulting_ai_paused: false,
        }),
      ],
      [
        'mismatch while revisions agree',
        commandRow({ outcome: 'REFUSED', reason: 'revision-mismatch', resulting_revision: '3' }),
      ],
      [
        'takeover-active on a non-RESUME action',
        commandRow({
          outcome: 'REFUSED',
          reason: 'human-takeover-active',
          resulting_revision: '3',
          resulting_human_takeover: true,
          resulting_ai_paused: true,
        }),
      ],
      [
        'exhausted below the ceiling',
        commandRow({
          outcome: 'REFUSED',
          reason: 'revision-exhausted',
          resulting_revision: '3',
        }),
      ],
      ['foreign control version', commandRow({ control_version: 2 })],
      ['foreign record version', commandRow({ record_version: 2 })],
      ['non-canonical issued_at', commandRow({ issued_at: AT })],
    ];
    for (const [label, row] of bad) {
      expect(() => canonicalizeCommandRow(row), label).toThrow(PostgresConversationStateError);
    }
  });

  it('accepts every legitimate outcome/reason pairing', () => {
    const MAX = String(Number.MAX_SAFE_INTEGER);
    const good: readonly Record<string, unknown>[] = [
      commandRow(),
      commandRow({
        outcome: 'NO_CHANGE',
        reason: 'already-satisfied',
        resulting_revision: '3',
      }),
      commandRow({
        outcome: 'REFUSED',
        reason: 'revision-mismatch',
        observed_revision: '9',
        resulting_revision: '9',
        resulting_human_takeover: false,
        resulting_ai_paused: false,
      }),
      commandRow({
        action: 'RESUME_AI',
        outcome: 'REFUSED',
        reason: 'human-takeover-active',
        resulting_revision: '3',
        resulting_human_takeover: true,
        // Deliberately NOT paused: ADR-0074 accepts takeover-without-pause and RESUME still refuses.
        resulting_ai_paused: false,
      }),
      commandRow({
        outcome: 'REFUSED',
        reason: 'revision-exhausted',
        expected_revision: MAX,
        observed_revision: MAX,
        resulting_revision: MAX,
        resulting_human_takeover: false,
        resulting_ai_paused: false,
      }),
    ];
    for (const row of good) {
      expect(() => canonicalizeCommandRow(row)).not.toThrow();
    }
  });
});

describe('exact-duplicate identity comparison', () => {
  const command = {
    controlVersion: 1 as const,
    commandId: 'ctrl.1',
    conversationId: 'conv.1',
    expectedRevision: 3,
    action: 'TAKE_OWNERSHIP' as const,
    operatorRef: 'op.1',
    issuedAt: AT,
  };

  it('treats an absent reasonRef and a supplied one as different commands', () => {
    // Different intents, not a formatting difference.
    const stored = canonicalizeCommandRow(commandRow()).identity;
    expect(isSameCommand(stored, command)).toBe(true);
    expect(isSameCommand(stored, { ...command, reasonRef: 'reason.x' })).toBe(false);

    const storedWithRef = canonicalizeCommandRow(commandRow({ reason_ref: 'reason.x' })).identity;
    expect(isSameCommand(storedWithRef, command)).toBe(false);
    expect(isSameCommand(storedWithRef, { ...command, reasonRef: 'reason.x' })).toBe(true);
    expect(isSameCommand(storedWithRef, { ...command, reasonRef: 'reason.y' })).toBe(false);
  });

  it('compares every other pure command field', () => {
    const stored = canonicalizeCommandRow(commandRow()).identity;
    for (const over of [
      { conversationId: 'conv.OTHER' },
      { expectedRevision: 4 },
      { action: 'PAUSE_AI' as const },
      { operatorRef: 'op.other' },
      { issuedAt: '2026-08-02T00:00:00.000Z' },
    ]) {
      expect(isSameCommand(stored, { ...command, ...over })).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Input validation — nothing reaches the database.
// ---------------------------------------------------------------------------

describe('input validation happens before any SQL', () => {
  /** A pool that fails the test if it is ever touched. */
  const forbiddenPool = {
    query: () => {
      throw new Error('the database must not be reached for invalid input');
    },
    connect: () => {
      throw new Error('the database must not be reached for invalid input');
    },
  } as unknown as Parameters<typeof createPostgresConversationStateAdapter>[0]['pool'];

  const adapter = createPostgresConversationStateAdapter({ pool: forbiddenPool });

  it('rejects an invalid key on read', async () => {
    for (const key of [
      { tenantId: '', conversationId: 'conv.1' },
      { tenantId: '*', conversationId: 'conv.1' },
      { tenantId: 'latest', conversationId: 'conv.1' },
      { tenantId: 'has space', conversationId: 'conv.1' },
      { tenantId: 'tenant.a', conversationId: '' },
      { tenantId: 'tenant.a', conversationId: 'a'.repeat(129) },
    ]) {
      await expect(adapter.read(key)).rejects.toMatchObject({ code: 'invalid-input' });
    }
    await expect(
      adapter.read(undefined as unknown as { tenantId: string; conversationId: string }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('rejects invalid provisioning input, including a defaulted Core fact', async () => {
    const base = {
      tenantId: 'tenant.a',
      conversationId: 'conv.1',
      partyType: 'CLIENT',
      dataClass: 'HOSTED_ALLOWED',
      cancelled: false,
      subjectStatus: 'clear',
      observedAt: AT,
    };
    for (const over of [
      { partyType: 'SUPPLIER' },
      { dataClass: 'PUBLIC' },
      { subjectStatus: 'fine' },
      { cancelled: 'no' as unknown as boolean },
      { observedAt: 'last tuesday' },
      { subjectRef: 'Jane Smith' },
      { tenantId: '*' },
    ]) {
      await expect(adapter.provision({ ...base, ...over })).rejects.toMatchObject({
        code: 'invalid-input',
      });
    }
  });

  it('rejects a command whose conversation disagrees with the key', async () => {
    await expect(
      adapter.applyControlCommand(
        { tenantId: 'tenant.a', conversationId: 'conv.1' },
        {
          controlVersion: 1,
          commandId: 'ctrl.1',
          conversationId: 'conv.OTHER',
          expectedRevision: 0,
          action: 'TAKE_OWNERSHIP',
          operatorRef: 'op.1',
          issuedAt: AT,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });
});

// ---------------------------------------------------------------------------
// API surface and containment.
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}
const productionFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').includes('/tests/'),
  );

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('API surface, dependencies and containment', () => {
  it('publishes exactly three root runtime symbols and no default export', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'POSTGRES_CONVERSATION_STATE_ERROR_CODES',
      'PostgresConversationStateError',
      'createPostgresConversationStateAdapter',
    ]);
    expect(Object.keys(barrel)).toHaveLength(3);
    expect('default' in barrel).toBe(false);
  });

  it('locks the type-export count at four', () => {
    const source = readFileSync(fileURLToPath(new URL('src/index.ts', PKG_DIR)), 'utf8');
    const names = [...source.matchAll(/export type \{([\s\S]*?)\}/g)].flatMap((match) =>
      (match[1] ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
    expect([...new Set(names)].sort()).toEqual([
      'PostgresConversationStateAdapter',
      'PostgresConversationStateErrorCode',
      'TrustedConversationStateProvisioningInput',
      'TrustedConversationStateProvisioningResult',
    ]);
  });

  it('declares exactly the intended production and dev dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    // PRODUCTION: the reducer, the M5 type contracts, and the driver. Nothing else.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/conversation-control',
      '@qf-jarvis/jarvis-runtime',
      'pg',
    ]);
    // DEV only: vocabulary conformance and the real-DB migration harness.
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/event-backbone',
      '@types/pg',
    ]);
    expect(manifest.dependencies?.['pg']).toBe('8.22.0');
  });

  it('imports no dev-only package from production source', () => {
    // The build config already omits them as project references; this makes the rule visible.
    for (const file of productionFiles()) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/from '@qf-jarvis\/event-backbone/);
      expect(code).not.toMatch(/from '@qf-jarvis\/agent-runtime/);
    }
  });

  it('reads no environment and starts nothing in production source', () => {
    for (const file of productionFiles()) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      // DATABASE_URL lives in the test harness alone.
      expect(code).not.toMatch(/process\.env/);
      expect(code).not.toMatch(/DATABASE_URL/);
      expect(code).not.toMatch(/new\s+Pool\s*\(/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
      expect(code).not.toMatch(/setInterval|setTimeout/);
      expect(code).not.toMatch(/Date\.now|Math\.random/);
      // No module-level store.
      const topLevel = code.split('\n').filter((line) => /^[A-Za-z]/.test(line));
      expect(topLevel.some((line) => /=\s*new\s+(Map|Set|WeakMap|WeakSet)/.test(line))).toBe(false);
    }
  });

  it('exposes no operations projection, Core synchronization, consent or approval surface', () => {
    for (const file of productionFiles()) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/readOperationsProjection/);
      expect(code).not.toMatch(
        /\b(consent|optOut|suppression|approval|entitlement|payment|refund)\b/i,
      );
      expect(code).not.toMatch(/\bn8n\b|whatsapp|groq/i);
      expect(code).not.toMatch(/\b(send|deliver|execute|authorize|dispatch)\s*\(/);
    }
    expect(
      'readOperationsProjection' in
        createPostgresConversationStateAdapter({
          pool: { query: () => undefined } as unknown as Parameters<
            typeof createPostgresConversationStateAdapter
          >[0]['pool'],
        }),
    ).toBe(false);
  });

  it('exposes exactly the three port methods', () => {
    const adapter = createPostgresConversationStateAdapter({
      pool: { query: () => undefined } as unknown as Parameters<
        typeof createPostgresConversationStateAdapter
      >[0]['pool'],
    });
    expect(Object.keys(adapter).sort()).toEqual(['applyControlCommand', 'provision', 'read']);
    expect(Object.isFrozen(adapter)).toBe(true);
  });

  it('adds exactly one migration: 0001-0008, and no 0009', () => {
    const dir = fileURLToPath(
      new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
    );
    expect(
      readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort(),
    ).toEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
      '0007_subject_activity_projection.sql',
      '0008_conversation_control_persistence.sql',
    ]);
  });

  it('the migration grants no UPDATE on any Core-derived column', () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          'packages/event-backbone/src/persistence/migrations/0008_conversation_control_persistence.sql',
          REPO_ROOT,
        ),
      ),
      'utf8',
    );
    // The column-level UPDATE grant names exactly the four operator-owned columns. A future Core
    // synchronization path needs its own separately governed grant.
    expect(sql).toContain('GRANT UPDATE (revision, human_takeover, ai_paused, observed_at)');
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*party_type/);
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*data_class/);
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*subject_/);
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*cancelled/);
    expect(sql).not.toMatch(/GRANT (DELETE|TRUNCATE)|,\s*DELETE|,\s*TRUNCATE/);
    // No conversation-only unique index would silently re-impose global uniqueness.
    expect(sql).not.toMatch(/UNIQUE\s*\(\s*conversation_id\s*\)/);
  });
});
