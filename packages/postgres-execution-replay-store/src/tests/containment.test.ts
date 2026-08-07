import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import { createPostgresExecutionReplayStore } from '../index.js';
import {
  POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES,
  PostgresExecutionReplayStoreError,
} from '../index.js';
// Deliberately a deep import of an INTERNAL module, and only from a test in the same package.
// `validateClaim` is where storage identity is decided, and the rule is worth proving without a
// database so a regression fails in milliseconds rather than only in the integration suite.
import { validateClaim } from '../internal/claim-input.js';

/**
 * Containment for the durable execution replay store (QFJ-P09.03, ADR-0091).
 *
 * The integration suite proves the store BEHAVES correctly against real PostgreSQL. These prove it
 * CANNOT DO the wrong things — that no future edit quietly turns a duplicate-prevention record into
 * a transport, an authority, a payload archive or a cleanup job.
 *
 * Scans read production source only (`src/tests/**` is excluded, and excluded from the emitting
 * build too), and they read CODE with comments stripped: this package necessarily NAMES the things
 * it refuses to be, so scanning the prose would report every prohibition as its own violation.
 */

const SRC = fileURLToPath(new URL('../', import.meta.url));
const MIGRATIONS = fileURLToPath(
  new URL('../../../event-backbone/src/persistence/migrations/', import.meta.url),
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block comments and whole-line `//` comments so a scan reads CODE, not documentation. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const productionCode = (): string =>
  walk(SRC)
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

/**
 * Migration 0010 as EXECUTABLE SQL: `--` comment lines and `COMMENT ON` statements both removed.
 *
 * A `COMMENT ON` is documentation that happens to be stored in the database, and this migration's
 * comments necessarily enumerate what the table refuses to hold — payload, recipient, credential,
 * provider result. Scanning them would report every prohibition as its own violation, exactly as
 * scanning the prose would. The prose is asserted separately, on the raw text, further down.
 */
const migrationCode = (): string =>
  readFileSync(join(MIGRATIONS, '0010_execution_replay_claim.sql'), 'utf8')
    .replace(/^COMMENT ON[\s\S]*?;\s*$/gmu, '')
    .split('\n')
    .filter((line) => !/^\s*--/u.test(line))
    .join('\n');

const migrationText = (): string =>
  readFileSync(join(MIGRATIONS, '0010_execution_replay_claim.sql'), 'utf8');

describe('the public surface is small and deliberate', () => {
  it('(A) exports exactly the approved runtime values', () => {
    // Locked from the day it lands. Three runtime symbols: the factory, the closed error-code set
    // and the error class. The SQL, the table name, the input validator, the error classifier and
    // the integration harness are all absent on purpose.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES',
      'PostgresExecutionReplayStoreError',
      'createPostgresExecutionReplayStore',
    ]);
  });

  it('(A) exports no SQL, table name, pool, validator or harness', () => {
    for (const forbidden of [
      'INSERT_CLAIM',
      'SELECT_COLLIDING_CLAIMS',
      'validateClaim',
      'classifyDatabaseError',
      'Pool',
      'PoolClient',
      'createTestPool',
      'resetAndMigrate',
      'requireTestDatabaseUrl',
      'EXECUTION_REPLAY_CLAIM_TABLE',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('(H) the store is exactly an ExecutionReplayGuard: one method, and it is frozen', () => {
    const store = createPostgresExecutionReplayStore({
      pool: { connect: () => Promise.reject(new Error('never called')) } as never,
    });
    expect(Object.keys(store)).toStrictEqual(['claim']);
    expect(typeof store.claim).toBe('function');
    expect(Object.isFrozen(store)).toBe(true);
  });

  it('(F) exposes no read, release, delete, prune or reset capability', () => {
    const store = createPostgresExecutionReplayStore({
      pool: { connect: () => Promise.reject(new Error('never called')) } as never,
    });
    for (const forbidden of [
      'has',
      'get',
      'find',
      'lookup',
      'list',
      'count',
      'release',
      'clear',
      'delete',
      'remove',
      'prune',
      'expire',
      'reset',
      'sweep',
      'cleanup',
    ]) {
      expect(Object.keys(store), forbidden).not.toContain(forbidden);
    }
  });

  it('carries no authority-shaped field anywhere in production code', () => {
    // None of these would be TRUE. A stored claim says one instruction already crossed the B4
    // boundary; it does not say anything may happen, and it does not say anything did.
    const code = productionCode();
    for (const forbidden of [
      'canExecute',
      'canSend',
      'isAuthorized',
      'consentValid',
      'communicationAllowed',
      'retryAllowed',
      'approved',
      'authorized',
      'delivered',
      'executed',
      'sent',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('(B) no transport, no provider, no credential', () => {
  it('contains no network client of any kind', () => {
    const code = productionCode();
    for (const forbidden of [
      'fetch(',
      'axios',
      'undici',
      'node-fetch',
      'got(',
      'XMLHttpRequest',
      'WebSocket',
      'node:http',
      'node:https',
      'node:net',
      'node:dgram',
      'node:tls',
      'createServer',
      'listen(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('names no endpoint, webhook, workflow, n8n or provider', () => {
    const code = productionCode();
    for (const forbidden of [
      'http://',
      'https://',
      'endpoint',
      'baseUrl',
      'webhook',
      'workflowId',
      'n8n',
      'whatsapp',
      'twilio',
      'graph.facebook',
      'messenger',
      'provider',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('names no credential, token or key material', () => {
    const code = productionCode();
    for (const forbidden of [
      'apiKey',
      'accessToken',
      'bearer',
      'authorization:',
      'privateKey',
      'secret',
      'password',
      'credential',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('(C) reads no environment and builds no connection: the pool is injected', () => {
    const code = productionCode();
    for (const forbidden of [
      'process.env',
      'DATABASE_URL',
      'connectionString',
      'new Pool',
      'new pg.Pool',
      'createDatabasePool',
      'connectionTimeoutMillis',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('(C) refuses a config that is not a pool', () => {
    for (const bad of [undefined, null, {}, { pool: null }, { pool: {} }, { pool: 7 }]) {
      expect(() => createPostgresExecutionReplayStore(bad as never)).toThrow(
        PostgresExecutionReplayStoreError,
      );
    }
  });

  it('reads no clock', () => {
    // `claimed_at` is the server's own default. A clock in this package would be a second opinion
    // about time at a boundary whose `now` is INJECTED one layer up.
    const code = productionCode();
    for (const forbidden of ['Date.now', 'new Date', 'performance.now', 'hrtime']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('(D) no executable intent payload is stored or exposed', () => {
  it('production code names no payload, parameter or contact field', () => {
    const code = productionCode();
    for (const forbidden of [
      'ExecutionIntentV1',
      'executionIntentV1Schema',
      'intent_payload',
      'intentPayload',
      'parameters',
      'recipient',
      'phoneNumber',
      'phone_number',
      'emailAddress',
      'messageBody',
      'templateId',
      'approvalDecisionId',
      'consent',
      'optOut',
      'quietHours',
      'attemptLimit',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('migration 0010 declares exactly five columns and no payload column', () => {
    const sql = migrationCode();
    for (const required of [
      'execution_intent_id',
      'idempotency_key',
      'body_digest_hex',
      'record_version',
      'claimed_at',
    ]) {
      expect(sql, required).toContain(required);
    }
    for (const forbidden of [
      'JSONB',
      'jsonb',
      'payload',
      'parameters',
      'recipient',
      'phone',
      'email',
      'message',
      'content',
      'consent',
      'credential',
      'webhook',
      'workflow',
      'provider',
      'approval',
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it('migration 0010 creates exactly one table and no payload table', () => {
    const sql = migrationCode();
    const created = sql.match(/CREATE TABLE/gu) ?? [];
    expect(created).toHaveLength(1);
    expect(sql).toContain('CREATE TABLE qf_jarvis.execution_replay_claim');
    // A foreign key to an intent payload table would require such a table to exist.
    expect(sql).not.toContain('REFERENCES');
  });
});

describe('(E) no tenant scope is invented', () => {
  it('neither the package nor migration 0010 names a tenant identity', () => {
    const code = productionCode();
    const sql = migrationCode();
    for (const forbidden of [
      'tenant',
      'tenantId',
      'tenant_id',
      'organizationId',
      'organization_id',
      'workspaceId',
      'workspace_id',
      'accountId',
      'account_id',
    ]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('(F) no retention, TTL, cleanup or deletion capability exists', () => {
  it('production code contains no delete or expiry statement', () => {
    const code = productionCode();
    for (const forbidden of [
      'DELETE',
      'TRUNCATE',
      'DROP',
      'UPDATE ',
      'setInterval',
      'setTimeout',
      'ttl',
      'TTL',
      'retention',
      'sweeper',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('migration 0010 defines no retention policy', () => {
    const sql = migrationCode();
    for (const forbidden of [
      'DELETE FROM',
      'PARTITION',
      'pg_cron',
      'INTERVAL',
      'ttl',
      'retention',
      'expire',
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });
});

describe('(G) no retry loop exists', () => {
  it('production code has no retry, backoff or loop around a claim', () => {
    const code = productionCode();
    for (const forbidden of [
      'retry',
      'Retry',
      'backoff',
      'attempts',
      'maxAttempts',
      'while (',
      'for (',
      'do {',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('does not raise the isolation level to buy a retry obligation', () => {
    const code = productionCode();
    expect(code).not.toContain('SERIALIZABLE');
    expect(code).not.toContain('REPEATABLE READ');
    expect(code).not.toContain('pg_advisory');
  });
});

describe('(I) errors are bounded and leak nothing', () => {
  it('the code set is closed and frozen', () => {
    expect([...POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES]).toStrictEqual([
      'invalid-input',
      'database-unavailable',
      'schema-incompatible',
      'repository-invariant',
    ]);
    expect(Object.isFrozen(POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES)).toBe(true);
  });

  it('there is no retryable code inviting a caller to try again', () => {
    for (const forbidden of ['retryable', 'retry', 'transient', 'try-again']) {
      expect([...POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES], forbidden).not.toContain(forbidden);
    }
  });

  it('every message is fixed, content-free and names nothing identifying', () => {
    for (const code of POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES) {
      const message = new PostgresExecutionReplayStoreError(code).message;
      expect(message.length).toBeGreaterThan(0);
      // Two errors of the same code are identical: the message is chosen BY the code, never built
      // from the input, the row or the driver.
      expect(new PostgresExecutionReplayStoreError(code).message).toBe(message);
      for (const forbidden of [
        'qf_jarvis',
        'execution_replay_claim',
        'SELECT',
        'INSERT',
        'localhost',
        '127.0.0.1',
        'postgres',
        'password',
        'sslmode',
        '@',
      ]) {
        expect(message, `${code}/${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('the claim outcome is never among the error codes', () => {
    // A store that could answer "unavailable" instead of throwing would let the dispatch boundary
    // read uncertainty as an outcome. ADR-0090 §7: it must throw so the boundary refuses.
    for (const outcome of ['first-seen', 'exact-replay', 'conflict']) {
      expect([...POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES], outcome).not.toContain(outcome);
    }
  });
});

describe('storage identity: exactly one field is canonicalized', () => {
  const UPPER = 'A1B2C3D4-1111-4000-8000-000000000001';
  const KEY = 'qf.exec.KEY-case-0001';
  const DIGEST = 'ab'.repeat(32);

  it('canonicalizes executionIntentId to lowercase', () => {
    // PostgreSQL's UUID column returns canonical lowercase text, so the value this adapter COMPARES
    // must be the value the database STORES. Without this, an uppercase id inserts fine and its own
    // byte-identical replay is then classified `conflict` instead of `exact-replay` -- a fail-closed
    // refusal of a legitimate redelivery.
    const validated = validateClaim({
      executionIntentId: UPPER,
      idempotencyKey: KEY,
      bodyDigestHex: DIGEST,
    });
    expect(validated.executionIntentId).toBe(UPPER.toLowerCase());
    expect(validated.executionIntentId).not.toBe(UPPER);

    // Both cases resolve to ONE identity.
    expect(
      validateClaim({
        executionIntentId: UPPER.toLowerCase(),
        idempotencyKey: KEY,
        bodyDigestHex: DIGEST,
      }).executionIntentId,
    ).toBe(validated.executionIntentId);
  });

  it('does NOT normalize the idempotency key: it is an opaque, case-sensitive token', () => {
    // The opposite rule. Folding `KEY-1` and `key-1` together would make two distinct claims
    // collide, which loses a legitimate dispatch rather than catching a duplicate.
    const validated = validateClaim({
      executionIntentId: UPPER,
      idempotencyKey: KEY,
      bodyDigestHex: DIGEST,
    });
    expect(validated.idempotencyKey).toBe(KEY);
    expect(validated.idempotencyKey).not.toBe(KEY.toLowerCase());
  });

  it('does NOT normalize the digest: an uppercase one is REFUSED, not lowercased', () => {
    // The digest is verifier output and is defined as lowercase hex, so an uppercase one did not
    // come from the verifier. Lowercasing it would silently accept something never produced.
    expect(() =>
      validateClaim({
        executionIntentId: UPPER,
        idempotencyKey: KEY,
        bodyDigestHex: DIGEST.toUpperCase(),
      }),
    ).toThrow(PostgresExecutionReplayStoreError);
    expect(
      validateClaim({ executionIntentId: UPPER, idempotencyKey: KEY, bodyDigestHex: DIGEST })
        .bodyDigestHex,
    ).toBe(DIGEST);
  });

  it('canonicalizes AFTER the shape check, so a malformed id is refused rather than repaired', () => {
    for (const bad of [
      'A1B2C3D4-1111-4000-8000-00000000000',
      'not-a-uuid',
      'ZZZZZZZZ-1111-4000-8000-000000000001',
    ]) {
      expect(() =>
        validateClaim({ executionIntentId: bad, idempotencyKey: KEY, bodyDigestHex: DIGEST }),
      ).toThrow(PostgresExecutionReplayStoreError);
    }
  });

  it('a throwing getter or Proxy becomes invalid-input and leaks nothing', () => {
    // The value a hostile object throws is the caller's, and may quote anything. It must not become
    // a channel out of this package.
    const hostile = {
      get executionIntentId(): string {
        throw new Error('replay store at /srv/secrets/store — token=abc123');
      },
      idempotencyKey: KEY,
      bodyDigestHex: DIGEST,
    };
    let thrown: unknown;
    try {
      validateClaim(hostile);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PostgresExecutionReplayStoreError);
    const error = thrown as PostgresExecutionReplayStoreError;
    expect(error.code).toBe('invalid-input');
    expect(error.message).not.toContain('abc123');
    expect(error.message).not.toContain('/srv/secrets');

    const proxy = new Proxy(
      {},
      {
        get(): never {
          throw new Error('proxy trap — host=10.0.0.1 password=hunter2');
        },
      },
    );
    expect(() => validateClaim(proxy)).toThrow(PostgresExecutionReplayStoreError);
  });

  it('reads each field exactly once, so a value cannot change after it was checked', () => {
    let reads = 0;
    const counting = {
      get executionIntentId(): string {
        reads += 1;
        // A second read would return a DIFFERENT id, so any re-read is visible in the result.
        return reads === 1 ? UPPER : 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      },
      idempotencyKey: KEY,
      bodyDigestHex: DIGEST,
    };
    const validated = validateClaim(counting);
    expect(reads).toBe(1);
    expect(validated.executionIntentId).toBe(UPPER.toLowerCase());
  });
});

describe('migration 0010 storage invariants', () => {
  it('makes uniqueness INDEPENDENT on both identities', () => {
    const sql = migrationCode();
    // The primary key alone, or one composite key, would accept two of the three smuggling routes
    // ADR-0090 §7 names. Both constraints are load-bearing.
    expect(sql).toContain('PRIMARY KEY (execution_intent_id)');
    expect(sql).toContain('UNIQUE (idempotency_key)');
    expect(sql).not.toContain('PRIMARY KEY (execution_intent_id, idempotency_key)');
  });

  it('constrains the digest to lowercase SHA-256 hex and the key to an opaque token', () => {
    const sql = migrationCode();
    expect(sql).toContain("body_digest_hex ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain("idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'");
  });

  it('is append-only and grants no UPDATE, DELETE or TRUNCATE', () => {
    const sql = migrationCode();
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON qf_jarvis.execution_replay_claim');
    expect(sql).toContain('REVOKE ALL ON qf_jarvis.execution_replay_claim FROM PUBLIC');
    expect(sql).toContain('GRANT SELECT, INSERT ON qf_jarvis.execution_replay_claim');
    expect(sql).not.toMatch(/GRANT[^;]*UPDATE[^;]*execution_replay_claim/u);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/u);
    expect(sql).not.toMatch(/GRANT[^;]*TRUNCATE/u);
    expect(sql).not.toMatch(/GRANT[^;]*ALL[^;]*execution_replay_claim/u);
  });

  it('records in prose that it is local/CI only and that the protocol stays PROPOSED', () => {
    // The migration is the artefact an operator reads before applying anything. It must say what it
    // is not, in the file itself, rather than only in an ADR they may not have open.
    const text = migrationText();
    expect(text).toContain('LOCAL/CI only');
    expect(text).toContain('still carries only 0001');
    expect(text).toContain('This migration was not applied to it');
    expect(text).toContain('PROPOSED');
    expect(text).toContain('NO RETENTION');
    expect(text).toContain('NO TENANT COLUMN');
  });
});

describe('the migration set is exactly 0001-0011', () => {
  it('adds 0010 and nothing beyond it', () => {
    const files = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toStrictEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
      '0007_subject_activity_projection.sql',
      '0008_conversation_control_persistence.sql',
      '0009_durable_approval_queue.sql',
      '0010_execution_replay_claim.sql',
      '0011_riya_conversation_continuity.sql',
    ]);
    expect(files.some((name) => name.startsWith('0012'))).toBe(false);
  });
});
