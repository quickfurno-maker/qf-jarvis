/**
 * RWC-P8 — containment for `@qf-jarvis/postgres-riya-turn-coordinator` (ADR-0104).
 *
 * The integration suite proves what the coordinator does against a real database. This proves what it
 * cannot do at all, and two of the properties are the ones that would be easiest to lose quietly:
 *
 * - **no message text, and no fingerprint of message text, anywhere.** A SHA-256 of a sentence is
 *   still a durable record of what a person wrote, and a ledger built to stop duplicate work has no
 *   business being able to answer "did they say exactly this?".
 * - **no SQL transaction held across the model call.** A `BEGIN` opened at claim time and closed at
 *   finalization would pin a connection and hold locks for the length of an inference; the fact that
 *   there is none is a property of the source, not of a comment.
 *
 * Scans read production source with comments stripped: this package necessarily NAMES the things it
 * refuses to be, so scanning the prose would report every prohibition as its own violation.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MIGRATION = join(
  REPO_ROOT,
  'packages/event-backbone/src/persistence/migrations/0012_riya_logical_turn_idempotency.sql',
);

function walk(dir: string, skip: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skip.includes(entry)) continue;
      out.push(...walk(full, skip));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const productionCode = (): string =>
  walk(SRC, ['tests'])
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

const forbid = (code: string, values: readonly string[]): void => {
  for (const forbidden of values) {
    expect({
      forbidden,
      present: code.toLowerCase().includes(forbidden.toLowerCase()),
    }).toStrictEqual({ forbidden, present: false });
  }
};

describe('it holds no message, and no fingerprint of one', () => {
  it('production source names no client text of any kind', () => {
    // `normalizedText` appears EXACTLY once, and only as the guard that REFUSES it: the port has no
    // such field, and a caller that adds one anyway must not have it silently ignored -- silence is
    // indistinguishable from the field being honoured. It is never read, digested or stored.
    const code = productionCode();
    expect(code.match(/normalizedText/gu) ?? []).toHaveLength(1);
    expect(code).toContain("'normalizedText' in");
    forbid(productionCode(), [
      'normalized_text',
      'messageBody',
      'transcript',
      'replyBody',
      'authorizedReply',
      'rollingSummary',
      'conversationHistory',
    ]);
  });

  it('the ONLY hashed things are the two non-content identities', () => {
    const identity = codeOnly(readFileSync(join(SRC, 'internal/identity.ts'), 'utf8'));
    // TWO call sites: the shared `sha256Hex` helper behind both identity digests, and the
    // conversation lock key. Nothing else in this package hashes anything.
    expect(identity.match(/createHash\(/gu) ?? []).toHaveLength(2);
    // `normalizedText` is not even a PARAMETER of either digest function, so it cannot be folded in
    // by accident.
    expect(identity).not.toContain('normalizedText');
    // ...and nowhere else in production hashes anything at all.
    const rest = walk(SRC, ['tests'])
      .filter((file) => !file.endsWith('identity.ts'))
      .map((file) => codeOnly(readFileSync(file, 'utf8')))
      .join('\n');
    // `.digest('hex')` specifically -- the digest FUNCTION names legitimately appear at their call
    // sites, and banning the substring would ban the thing being called rather than the hashing.
    forbid(rest, ['createHash', 'node:crypto', ".digest('hex')"]);
  });

  it('neither preimage includes a volatile or transport input', () => {
    const identity = codeOnly(readFileSync(join(SRC, 'internal/identity.ts'), 'utf8'));
    for (const forbidden of [
      'requestId',
      'issuedAt',
      'continuityRevision',
      'snapshotRef',
      'taxonomyVersion',
      'promptFamily',
      'nonce',
      'Date.now',
      'new Date',
      'Math.random',
      'randomUUID',
    ]) {
      expect(identity, forbidden).not.toContain(forbidden);
    }
  });

  it('the raw channel reference is digested, never stored', () => {
    const sql = codeOnly(readFileSync(join(SRC, 'internal/sql.ts'), 'utf8'));
    // The INSERT names its columns explicitly; `channel_turn_ref` is not among them, and no column
    // exists for it.
    expect(sql).not.toContain('channel_turn_ref');
    expect(sql).not.toContain('provider_message_ref');
    expect(sql).not.toContain('subject_ref');
    expect(readFileSync(MIGRATION, 'utf8')).not.toContain('channel_turn_ref VARCHAR');
  });
});

describe('no transaction is held across the model call', () => {
  it('the SQL surface opens none', () => {
    const sql = codeOnly(readFileSync(join(SRC, 'internal/sql.ts'), 'utf8'));
    for (const forbidden of [
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'SERIALIZABLE',
      'FOR UPDATE',
      'FOR SHARE',
      'LOCK TABLE',
      'SET TRANSACTION',
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
    // The serialization primitive is a SESSION advisory lock, non-blocking.
    expect(sql).toContain('pg_try_advisory_lock');
    expect(sql).toContain('pg_advisory_unlock');
    expect(sql).not.toContain('pg_advisory_lock(');
    expect(sql).not.toContain('pg_advisory_xact_lock');
  });

  it('the adapter takes the lock on a DEDICATED client, never through the pool', () => {
    const adapter = codeOnly(readFileSync(join(SRC, 'adapter/create-coordinator.ts'), 'utf8'));
    // A lock taken through `pool.query` and work continued elsewhere would put the lock and the
    // statements relying on it on different connections -- invisible until production load.
    expect(adapter).toContain('pool.connect()');
    expect(adapter).not.toMatch(/pool\.query\s*\(/u);
    // An unlock that is not provably clean DESTROYS the connection rather than returning it.
    expect(adapter).toContain('client.release(true)');
  });

  it('there is no retry, loop or sleep anywhere', () => {
    const code = productionCode();
    expect(code).not.toMatch(/\bwhile\s*\(|\bfor\s*\(|\bdo\s*\{/u);
    forbid(code, ['setTimeout', 'setInterval', 'retry', 'attempts', 'backoff']);
  });
});

describe('it reaches nothing and composes nothing', () => {
  it('holds no transport, provider, environment read or QuickFurno reference', () => {
    forbid(productionCode(), [
      'fetch(',
      'node:http',
      'node:https',
      'undici',
      'axios',
      'https://',
      'process.env',
      'DATABASE_URL',
      'connectionString',
      'new Pool',
      'createPool',
      'quickfurno',
      'supabase',
      'service_role',
      'n8n',
      'webhook',
      'whatsappClient',
      'metaClient',
      'accessToken',
      'phoneNumberId',
      'openai',
      'anthropic',
      'model-gateway',
      'jarvis-runtime',
      'agent-runtime',
    ]);
  });

  it('writes no business truth and can delete nothing', () => {
    const sql = codeOnly(readFileSync(join(SRC, 'internal/sql.ts'), 'utf8'));
    for (const forbidden of ['DELETE', 'TRUNCATE', 'DROP', 'ALTER']) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
    forbid(productionCode(), [
      'consent',
      'canSubmit',
      'leadRef',
      'vendorId',
      'price',
      'package',
      'discovery',
      'continuityRevision',
    ]);
  });

  it('depends on exactly the port package and pg', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
      readonly exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/riya-web-conversation-service',
      'pg',
    ]);
    // `event-backbone` is a DEV dependency only, supplying migration tooling to the integration
    // harness. A production import of it would create an edge from a coordinator to the event
    // backbone, and the build reference deliberately does not exist.
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/event-backbone',
      '@types/pg',
    ]);
    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
    expect(productionCode()).not.toContain('event-backbone');
  });

  it('exposes exactly six runtime values, and no SQL, table or lock internal', () => {
    // RWC-P9 (ADR-0105): 3 -> 6. Three OBSERVABILITY values -- the closed event vocabulary, the
    // closed discard-reason vocabulary and the no-op default. The SQL, the digests, the lock key,
    // the table and the session release helper all remain internal.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'NOOP_POSTGRES_RIYA_TURN_COORDINATOR_OBSERVABILITY',
      'POSTGRES_RIYA_TURN_COORDINATOR_DISCARD_REASONS',
      'POSTGRES_RIYA_TURN_COORDINATOR_ERROR_CODES',
      'POSTGRES_RIYA_TURN_COORDINATOR_EVENT_TYPES',
      'PostgresRiyaTurnCoordinatorError',
      'createPostgresRiyaTurnCoordinator',
    ]);
    const values = barrel as Record<string, unknown>;
    for (const internal of [
      'sourceTurnDigest',
      'turnIdentityDigest',
      'conversationLockKey',
      'INSERT_PROCESSING_CLAIM',
      'FINALIZE_CLAIM',
      'TRY_LOCK',
      'SELECT_CANDIDATE_CLAIMS',
    ]) {
      expect(values[internal], internal).toBeUndefined();
    }
  });

  it('nothing in the repository composes it', () => {
    const importers: string[] = [];
    for (const root of ['packages', 'apps']) {
      for (const entry of readdirSync(join(REPO_ROOT, root))) {
        if (entry === 'postgres-riya-turn-coordinator') continue;
        let files: string[];
        try {
          files = walk(join(REPO_ROOT, root, entry, 'src'), []);
        } catch {
          continue;
        }
        for (const file of files) {
          if (
            readFileSync(file, 'utf8').includes("from '@qf-jarvis/postgres-riya-turn-coordinator'")
          ) {
            importers.push(entry);
          }
        }
      }
    }
    // Declaring the adapter is not deploying it. The final composition is the QuickFurno handshake's,
    // and until then importing this package connects nowhere.
    expect([...new Set(importers)]).toStrictEqual([]);
  });
});

describe('migration 0012 is the ONE authorized addition', () => {
  it('is byte-exact, and 0011 is untouched', () => {
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toHaveLength(12);
    expect(sql.some((name) => Number.parseInt(name.slice(0, 4), 10) > 12)).toBe(false);
    expect(
      createHash('sha256')
        .update(readFileSync(join(dir, '0011_riya_conversation_continuity.sql')))
        .digest('hex'),
    ).toBe('80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93');
    expect(
      createHash('sha256')
        .update(readFileSync(join(dir, '0012_riya_logical_turn_idempotency.sql')))
        .digest('hex'),
    ).toBe('5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e');
  });

  it('adds exactly one table, and no column that could hold a message', () => {
    const migration = readFileSync(MIGRATION, 'utf8');
    expect(migration.match(/CREATE TABLE/gu) ?? []).toHaveLength(1);
    expect(migration).toContain('qf_jarvis.riya_logical_turn_claims');
    for (const forbidden of [
      'normalized_text',
      'message_text',
      'body ',
      'transcript',
      'reply',
      'subject_ref',
      'phone',
      'email',
      'request_id',
      'signature',
      'consent',
      'lead_id',
      'price',
    ]) {
      expect(migration.toLowerCase(), forbidden).not.toContain(`  ${forbidden.toLowerCase()}`);
    }
    // No DELETE or TRUNCATE grant: a deletable claim is a re-runnable message.
    expect(migration).not.toMatch(/GRANT[^;]*DELETE/u);
    expect(migration).not.toMatch(/GRANT[^;]*TRUNCATE/u);
  });

  it('leaves the continuity table channel-free', () => {
    const continuity = readFileSync(
      join(
        REPO_ROOT,
        'packages/event-backbone/src/persistence/migrations/0011_riya_conversation_continuity.sql',
      ),
      'utf8',
    );
    // RWC-P8 adds a CLAIM ledger, not a channel column. A channel in the continuity row would be the
    // beginning of a second Riya.
    expect(continuity).not.toContain('channel VARCHAR');
    expect(continuity).not.toContain('last_channel');
    expect(continuity).not.toContain('message_id');
  });
});
