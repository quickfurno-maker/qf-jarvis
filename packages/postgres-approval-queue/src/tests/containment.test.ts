/**
 * QFJ-P08 — public API, dependency and side-effect containment (ADR-0081).
 *
 * The whole safety argument of this package is what it CANNOT do: it cannot approve, cannot call
 * Core, cannot hold a mutable authority flag, and cannot reach a transport. Each of those is
 * asserted against the source rather than against intent.
 *
 * The no-local-authority scan is the one that matters most. A `status` column or an `approved`
 * boolean is the single easiest thing to add to a queue, and it is exactly the piece of
 * authorization state ADR-0002 puts in Core and nowhere else.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const PKG_DIR = new URL('../../', import.meta.url);
const REPO_ROOT = new URL('../../../../', import.meta.url);
const MIGRATION = fileURLToPath(
  new URL(
    'packages/event-backbone/src/persistence/migrations/0009_durable_approval_queue.sql',
    REPO_ROOT,
  ),
);

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

/** Strip documentation so a scan reads CODE: these modules describe what they refuse to do. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/**
 * Strip SQL documentation, for the same reason.
 *
 * Both `--` lines AND `COMMENT ON … IS '…'` statements: the table comments in 0009 describe what the
 * schema refuses to hold ("there is no status, outcome or approved column"), and scanning them would
 * flag the prohibition as the violation — the recurring false positive in this repository's suites.
 */
function sqlCodeOnly(text: string): string {
  return text
    .replace(/COMMENT ON [\s\S]*?;/g, '')
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
}

describe('public API', () => {
  it('exports exactly three root runtime symbols and no default', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'POSTGRES_APPROVAL_QUEUE_ERROR_CODES',
      'PostgresApprovalQueueError',
      'createPostgresApprovalQueue',
    ]);
    expect((barrel as unknown as Record<string, unknown>)['default']).toBeUndefined();
  });

  it('keeps every statement, canonicalizer and readiness probe internal', () => {
    const b = barrel as unknown as Record<string, unknown>;
    for (const internal of [
      'withQueueTransaction',
      'canonicalizeSource',
      'assertFaithfulRequest',
      'deepEquals',
      'assertQueueReady',
      'SELECT_REQUEST',
      'INSERT_REQUEST',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('locks the public type set at nine', () => {
    const source = readFileSync(fileURLToPath(new URL('src/index.ts', PKG_DIR)), 'utf8');
    const typeNames = new Set(
      [...source.matchAll(/export type \{([^}]*)\}/g)].flatMap((match) =>
        (match[1] ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      ),
    );
    expect([...typeNames].sort()).toEqual([
      'ApprovalQueueActiveEntry',
      'ApprovalQueueAuditRecord',
      'ApprovalQueueEnqueueInput',
      'ApprovalQueueEnqueueResult',
      'ApprovalQueueRecordDecisionInput',
      'ApprovalQueueRecordDecisionResult',
      'ApprovalQueueRequestRecord',
      'PostgresApprovalQueue',
      'PostgresApprovalQueueErrorCode',
    ]);
  });

  it('exposes exactly seven methods, and nothing that approves, sends or mutates a slot', () => {
    const queue = barrel.createPostgresApprovalQueue({
      pool: { query: () => undefined } as never,
    });
    expect(Object.keys(queue).sort()).toEqual([
      'assertReady',
      'enqueueRequest',
      'listActiveRequests',
      'readAuditForRequest',
      'readDecisionForRequest',
      'readRequest',
      'recordDecision',
    ]);
    expect(Object.isFrozen(queue)).toBe(true);
    const surface = queue as unknown as Record<string, unknown>;
    for (const forbidden of [
      'approve',
      'reject',
      'decide',
      'setStatus',
      'clearSlot',
      'setActive',
      'execute',
      'send',
      'deliver',
      'dispatch',
      'emit',
      'callCore',
      'pool',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it('exposes exactly ten error codes with fixed, content-free messages', () => {
    expect([...barrel.POSTGRES_APPROVAL_QUEUE_ERROR_CODES].sort()).toEqual([
      'active-request-conflict',
      'binding-invalid',
      'database-unavailable',
      'decision-conflict',
      'invalid-input',
      'repository-invariant',
      'request-already-decided',
      'request-conflict',
      'request-not-found',
      'schema-incompatible',
    ]);
    expect(Object.isFrozen(barrel.POSTGRES_APPROVAL_QUEUE_ERROR_CODES)).toBe(true);
    for (const code of barrel.POSTGRES_APPROVAL_QUEUE_ERROR_CODES) {
      const error = new barrel.PostgresApprovalQueueError(code);
      expect(error.name).toBe('PostgresApprovalQueueError');
      expect(error.code).toBe(code);
      // The message says WHAT went wrong, never with which value.
      expect(error.message).not.toMatch(/[{}[\]]/);
    }
  });
});

describe('dependencies', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };

  it('declares exactly the three workspace edges plus pg, and event-backbone only as dev', () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/approval-runtime',
      '@qf-jarvis/contracts',
      '@qf-jarvis/recommendation-runtime',
      'pg',
    ]);
    // `event-backbone` is DEV only: the integration harness needs its migration tooling, and a
    // production edge would put the event log inside the approval path.
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual([
      '@qf-jarvis/event-backbone',
      '@types/pg',
    ]);
    expect(Object.keys(manifest.exports)).toEqual(['.']);
  });

  it('imports nothing else in production, and never reaches past a package boundary', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const specifier of code.match(/from '([^']+)'/g) ?? []) {
        const name = specifier.slice(6, -1);
        if (name.startsWith('.')) {
          continue;
        }
        expect(
          [
            '@qf-jarvis/contracts',
            '@qf-jarvis/approval-runtime',
            '@qf-jarvis/recommendation-runtime',
            'pg',
          ],
          `${file}: ${name}`,
        ).toContain(name);
      }
      expect(code, file).not.toMatch(/@qf-jarvis\/[a-z-]+\/(dist|src|internal)\//);
      expect(code, file).not.toContain('@qf-jarvis/event-backbone');
    }
  });

  it('is imported by no lower package, and named by an application only as a TYPE', () => {
    for (const relative of [
      'packages/jarvis-runtime/package.json',
      'packages/agent-runtime/package.json',
      'packages/approval-runtime/package.json',
      'packages/recommendation-runtime/package.json',
      'packages/core-decision-adapter/package.json',
      'packages/postgres-conversation-state/package.json',
    ]) {
      const text = readFileSync(fileURLToPath(new URL(relative, REPO_ROOT)), 'utf8');
      expect(text, relative).not.toContain('@qf-jarvis/postgres-approval-queue');
    }

    // QFJ-P08 (ADR-0082): the authenticated operator boundary composes this queue -- but receives it
    // already built and names it with `import type`, which the compiler erases. So `apps/api`
    // declares the edge (its emitted declarations reference the shapes) while executing no line of
    // this package and constructing no pool. The assertion narrowed to that exact claim; it did not
    // relax to "an application may import it now".
    const api = JSON.parse(
      readFileSync(fileURLToPath(new URL('apps/api/package.json', REPO_ROOT)), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(api.dependencies ?? {})).toContain('@qf-jarvis/postgres-approval-queue');

    const runtimeDir = fileURLToPath(new URL('apps/api/src/runtime/', REPO_ROOT));
    const namers = readdirSync(runtimeDir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) =>
        readFileSync(join(runtimeDir, name), 'utf8').includes('@qf-jarvis/postgres-approval-queue'),
      );
    expect(namers).toEqual(['approval-operator-service.ts']);
    const service = readFileSync(join(runtimeDir, 'approval-operator-service.ts'), 'utf8');
    expect(service).toMatch(/import type \{[\s\S]*?\} from '@qf-jarvis\/postgres-approval-queue';/);
    expect(service).not.toMatch(/^import \{[^}]*\} from '@qf-jarvis\/postgres-approval-queue'/m);
  });
});

describe('side-effect containment', () => {
  it('reads no environment, opens no socket of its own, and starts nothing', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/process\s*\.\s*env/);
      expect(code, file).not.toContain('DATABASE_URL');
      expect(code, file).not.toMatch(/\bfetch\s*\(/);
      expect(code, file).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|worker_threads|os|path|crypto)['"]/,
      );
      expect(code, file).not.toMatch(/from ['"](redis|ioredis|axios|undici|node-fetch)['"]/);
      expect(code, file).not.toMatch(/setTimeout|setInterval|setImmediate/);
      expect(code, file).not.toMatch(/console\s*\./);
      expect(code, file).not.toMatch(/from ['"](pino|winston|bunyan|debug|log4js)['"]/);
      // No clock and no randomness: every instant is caller-stated and every id is caller-supplied,
      // so a replayed sequence is deterministic.
      expect(code, file).not.toMatch(/\bnew\s+Date\b|Date\s*\.\s*now/);
      expect(code, file).not.toMatch(/Math\s*\.\s*random|randomUUID/);
      // The pool is INJECTED. Constructing one here would mean reading configuration.
      expect(code, file).not.toMatch(/\bnew\s+Pool\b|createDatabasePool/);
    }
  });

  it('names no Core client, transport, provider or execution capability', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
      for (const forbidden of [
        'n8n',
        'whatsapp',
        'webhook',
        'twilio',
        'groq',
        'openai',
        'supabase',
        'coredecisionport',
        'executionintent',
        'idempotencykey',
        'communicationauthorization',
        'consent',
        'optout',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('holds no local approval status, authority flag or RBAC list', () => {
    // The single easiest thing to add to a queue, and exactly the state ADR-0002 puts in Core.
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      for (const forbidden of [
        "'pending'",
        'isApproved',
        'isAuthorized',
        'canExecute',
        'canSend',
        'communicationAuthorized',
        'consentValid',
        'FOUNDER_IDS',
        'ADMIN_IDS',
        'roleLookup',
        'authorityCache',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('emits no canonical event: Core owns that', () => {
    for (const file of productionFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/qf\.approval|qf\.recommendation/);
      expect(code, file).not.toMatch(/storeValidatedEvent|eventBackbone/);
    }
  });

  it('holds no control byte in production source', () => {
    // eslint-disable-next-line no-control-regex
    const CONTROL_BYTE = new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f]');
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });
});

describe('migration 0009 carries no authority column', () => {
  const sql = sqlCodeOnly(readFileSync(MIGRATION, 'utf8'));

  it('declares no status, approved or authorized column, and no derivation trigger', () => {
    // A column named `status` is how "a request exists, a decision may exist" quietly becomes a
    // state machine Jarvis owns.
    for (const forbidden of [
      'status',
      'is_approved',
      'approved BOOLEAN',
      'authorized',
      'can_execute',
      'can_send',
      'communication_authorized',
      'consent',
      'pending',
    ]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('grants no DELETE or TRUNCATE, and no schema_migration privilege', () => {
    expect(sql).not.toMatch(/GRANT[^;]*\bDELETE\b/);
    expect(sql).not.toMatch(/GRANT[^;]*\bTRUNCATE\b/);
    expect(sql).not.toContain('schema_migration');
    // The only UPDATE granted anywhere is the single slot pointer column.
    const updateGrants = sql.match(/GRANT UPDATE[^;]*/g) ?? [];
    expect(updateGrants).toHaveLength(1);
    expect(updateGrants[0]).toContain('(active_approval_request_id)');
  });

  it('creates exactly the five approval tables and their append-only guards', () => {
    const tables = [...sql.matchAll(/CREATE TABLE qf_jarvis\.([a-z_]+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual([
      'approval_active_slot',
      'approval_decision_record',
      'approval_queue_audit',
      'approval_request_decision_link',
      'approval_request_record',
    ]);
    const triggers = [...sql.matchAll(/CREATE TRIGGER ([a-z_]+)/g)].map((m) => m[1]);
    expect(triggers.sort()).toEqual([
      'approval_active_slot_guard_trigger',
      'approval_decision_record_append_only_trigger',
      'approval_queue_audit_append_only_trigger',
      'approval_request_decision_link_append_only_trigger',
      'approval_request_record_append_only_trigger',
    ]);
  });

  it('references the slot pointer COMPOSITELY, over the action identity too', () => {
    // The one mutable column in the whole migration is `active_approval_request_id`, and the runtime
    // role holds UPDATE on it. A single-column reference would therefore let that role point action
    // A's slot at action B's request -- around the key-immutability trigger, through the one door it
    // deliberately leaves open. Asserted against the SQL, not only against a live database, because
    // this is the shape a future edit would quietly narrow.
    expect(sql).toContain(
      'FOREIGN KEY (recommendation_id, proposed_action_id, active_approval_request_id)',
    );
    expect(sql).toContain('UNIQUE (recommendation_id, proposed_action_id, approval_request_id)');
    expect(sql).not.toMatch(/FOREIGN KEY \(active_approval_request_id\)/);
  });

  it('leaves 0009 unchanged: the set is 0001-0010, with no 0011', () => {
    const dir = fileURLToPath(
      new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
    );
    const files = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(files).toHaveLength(10);
    expect(files[9]).toBe('0010_execution_replay_claim.sql');
    expect(files.some((n) => n.startsWith('0011'))).toBe(false);
  });
});
