/**
 * RWC-P8 — the durable turn coordinator, against a real PostgreSQL (ADR-0104).
 *
 * Every property this package exists for is a property of a DATABASE plus a SESSION, so almost none
 * of it can be proved in memory. In particular:
 *
 * - one in-flight turn per conversation holds across INDEPENDENT coordinator instances over separate
 *   pools — which is the only honest model of two replicas;
 * - a claim found `PROCESSING` by a later lock holder means its owner is gone, and gets marked
 *   `INDETERMINATE` rather than re-run;
 * - an advisory lock is released, and a session whose unlock is not provably clean is destroyed
 *   rather than handed back to the pool.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  RiyaTurnCoordinatorBeginInput,
  RiyaTurnCoordinatorPort,
} from '@qf-jarvis/riya-web-conversation-service';

import { createPostgresRiyaTurnCoordinator } from '../index.js';
import {
  closeDatabasePool,
  createTestPool,
  ensureLoginRole,
  resetAndMigrate,
  testDatabaseConfig,
  testDatabaseConfigAs,
  withClient,
  type DatabasePool,
} from './harness.js';
import { createDatabasePool } from '@qf-jarvis/event-backbone';

const APP = 'rwc-p8-integration';
const APP_B = 'rwc-p8-integration-b';
const RUNTIME_ROLE = 'qf_jarvis_runtime';
const LOCAL_ONLY_PASSWORD = 'local-rwc-p8-only';
const TABLE = 'qf_jarvis.riya_logical_turn_claims';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../packages/event-backbone/src/persistence/migrations/', import.meta.url),
);

let pool: DatabasePool;

const input = (
  over: Partial<RiyaTurnCoordinatorBeginInput> = {},
): RiyaTurnCoordinatorBeginInput => {
  const messageId = over.messageId ?? 'msg.1';
  return {
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    messageId,
    channel: 'WEB',
    channelTurnRef: `src.${messageId}`,
    receivedAt: '2026-08-01T09:00:00Z',
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  };
};

const coordinator = (): RiyaTurnCoordinatorPort => createPostgresRiyaTurnCoordinator({ pool });

beforeAll(async () => {
  pool = createTestPool(APP);
  await resetAndMigrate(pool, testDatabaseConfig(APP));
  await ensureLoginRole(pool, RUNTIME_ROLE, LOCAL_ONLY_PASSWORD);
  // The grants are conditional on the role existing, so they run only now.
  await resetAndMigrate(pool, testDatabaseConfig(APP));
});

afterAll(async () => {
  await closeDatabasePool(pool);
});

beforeEach(async () => {
  await withClient(pool, async (client) => {
    await client.query(`DELETE FROM ${TABLE}`);
  });
});

// ---------------------------------------------------------------------------
// The schema.
// ---------------------------------------------------------------------------

describe('migration 0012 is the ONE authorized addition, and it is not a transcript', () => {
  it('the migration set is exactly 0001-0012, with 0011 byte-identical and no 0013', () => {
    const sql = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toHaveLength(12);
    expect(sql[11]).toBe('0012_riya_logical_turn_idempotency.sql');
    expect(sql.some((name) => Number.parseInt(name.slice(0, 4), 10) > 12)).toBe(false);
    expect(
      createHash('sha256')
        .update(readFileSync(join(MIGRATIONS_DIR, '0011_riya_conversation_continuity.sql')))
        .digest('hex'),
    ).toBe('80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93');
    expect(
      createHash('sha256')
        .update(readFileSync(join(MIGRATIONS_DIR, '0012_riya_logical_turn_idempotency.sql')))
        .digest('hex'),
    ).toBe('5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e');
  });

  it('holds exactly the nine approved columns, and NOTHING that could be a message', async () => {
    const columns = await withClient(pool, (client) =>
      client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'qf_jarvis' AND table_name = 'riya_logical_turn_claims'
          ORDER BY column_name`,
      ),
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toStrictEqual([
      'channel',
      'claim_state',
      'conversation_id',
      'created_at',
      'finalized_at',
      'message_id',
      'source_turn_digest',
      'tenant_id',
      'turn_identity_digest',
    ]);
    // The absence IS the contract. Note `normalized_text_digest` in particular: a hash of a sentence
    // is still a durable fingerprint of what a person wrote.
    for (const forbidden of [
      'normalized_text',
      'normalized_text_digest',
      'message_digest',
      'body',
      'transcript',
      'reply',
      'authorized_reply',
      'channel_turn_ref',
      'provider_message_ref',
      'subject_ref',
      'phone',
      'email',
      'request_id',
      'signature',
      'token',
      'consent',
      'lead_id',
      'price',
    ]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it('keys on tenant+conversation+message, and scopes source uniqueness to the conversation', async () => {
    const indexes = await withClient(pool, (client) =>
      client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'qf_jarvis' AND tablename = 'riya_logical_turn_claims'
          ORDER BY indexname`,
      ),
    );
    const defs = indexes.rows.map((row) => row.indexdef).join('\n');
    expect(defs).toContain('(tenant_id, conversation_id, message_id)');
    expect(defs).toContain('(tenant_id, conversation_id, source_turn_digest)');
    // No GLOBAL uniqueness on any single column: a message id is not globally unique, and neither is
    // a conversation id (ADR-0076 s3).
    expect(defs).not.toMatch(/UNIQUE INDEX \w+ ON [\w.]+ USING btree \(message_id\)/u);
    expect(defs).not.toMatch(/USING btree \(source_turn_digest\)/u);
  });

  it('grants the runtime role no DELETE, no TRUNCATE and no identity UPDATE', async () => {
    const grants = await withClient(pool, (client) =>
      client.query<{ privilege_type: string; column_name: string | null }>(
        `SELECT privilege_type, column_name
           FROM information_schema.column_privileges
          WHERE table_schema = 'qf_jarvis'
            AND table_name = 'riya_logical_turn_claims'
            AND grantee = $1
          ORDER BY privilege_type, column_name`,
        [RUNTIME_ROLE],
      ),
    );
    const updatable = grants.rows
      .filter((row) => row.privilege_type === 'UPDATE')
      .map((row) => row.column_name)
      .sort();
    // Only the two finalization columns. A claim's identity is immutable as a PRIVILEGE as well as
    // by the trigger -- two independent guards rather than one the coordinator must be trusted with.
    expect(updatable).toStrictEqual(['claim_state', 'finalized_at']);
    const kinds = new Set(grants.rows.map((row) => row.privilege_type));
    expect(kinds.has('DELETE')).toBe(false);
    expect(kinds.has('TRUNCATE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The lifecycle.
// ---------------------------------------------------------------------------

const claimRow = async (messageId: string) =>
  withClient(pool, (client) =>
    client.query<{ claim_state: string; finalized_at: string | null }>(
      `SELECT claim_state, finalized_at FROM ${TABLE}
        WHERE tenant_id = 'tenant.a' AND conversation_id = 'conv.1' AND message_id = $1`,
      [messageId],
    ),
  );

describe('a claim is written at startProcessing and never earlier', () => {
  it('begin acquires and writes NOTHING', async () => {
    const begun = await coordinator().begin(input());
    expect(begun.outcome).toBe('ACQUIRED');
    expect((await claimRow('msg.1')).rowCount).toBe(0);
    if (begun.outcome !== 'ACQUIRED') return;
    await begun.lease.releaseUnstarted();
    // Released unstarted: still no row, and the message stays presentable.
    expect((await claimRow('msg.1')).rowCount).toBe(0);
    const again = await coordinator().begin(input());
    expect(again.outcome).toBe('ACQUIRED');
    if (again.outcome === 'ACQUIRED') await again.lease.releaseUnstarted();
  });

  it('startProcessing writes PROCESSING, and complete finalizes it once', async () => {
    const begun = await coordinator().begin(input());
    if (begun.outcome !== 'ACQUIRED') throw new Error('expected ACQUIRED');
    await begun.lease.startProcessing();
    expect((await claimRow('msg.1')).rows[0]).toMatchObject({
      claim_state: 'PROCESSING',
      finalized_at: null,
    });
    await begun.lease.complete();
    const finalized = (await claimRow('msg.1')).rows[0];
    expect(finalized?.claim_state).toBe('COMPLETED');
    expect(finalized?.finalized_at).not.toBeNull();
    // Single-use: a second finalization is a lease misuse, not a second write.
    await expect(begun.lease.complete()).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('indeterminate finalizes the other way', async () => {
    const begun = await coordinator().begin(input());
    if (begun.outcome !== 'ACQUIRED') throw new Error('expected ACQUIRED');
    await begun.lease.startProcessing();
    await begun.lease.indeterminate();
    expect((await claimRow('msg.1')).rows[0]?.claim_state).toBe('INDETERMINATE');
  });
});

describe('classification under the lock', () => {
  const runOnce = async (over: Partial<RiyaTurnCoordinatorBeginInput> = {}): Promise<void> => {
    const begun = await coordinator().begin(input(over));
    if (begun.outcome !== 'ACQUIRED') throw new Error(`expected ACQUIRED, got ${begun.outcome}`);
    await begun.lease.startProcessing();
    await begun.lease.complete();
  };

  it('an exact repeat is REPLAYED', async () => {
    await runOnce();
    expect((await coordinator().begin(input())).outcome).toBe('REPLAYED');
  });

  it('a changed immutable field is a CONFLICT', async () => {
    await runOnce();
    for (const over of [
      { channelTurnRef: 'src.other' },
      { receivedAt: '2026-08-01T09:00:01Z' },
      { dataClass: 'LOCAL_ONLY' as const },
      { subjectRef: 'subject.9' },
      { channel: 'WHATSAPP' as const },
    ]) {
      expect((await coordinator().begin(input(over))).outcome, JSON.stringify(over)).toBe(
        'CONFLICT',
      );
    }
  });

  it('the same SOURCE under a new message id is a CONFLICT', async () => {
    await runOnce();
    expect(
      (await coordinator().begin(input({ messageId: 'msg.2', channelTurnRef: 'src.msg.1' })))
        .outcome,
    ).toBe('CONFLICT');
  });

  it('a different conversation, tenant or channel source is independent', async () => {
    await runOnce();
    for (const over of [
      { conversationId: 'conv.2' },
      { tenantId: 'tenant.b' },
      { messageId: 'msg.2' },
    ]) {
      const begun = await coordinator().begin(input(over));
      expect(begun.outcome, JSON.stringify(over)).toBe('ACQUIRED');
      if (begun.outcome === 'ACQUIRED') await begun.lease.releaseUnstarted();
    }
  });

  it('an ORPHANED PROCESSING claim becomes INDETERMINATE, and never re-runs', async () => {
    // The central crash rule, and the reason it is safe: if a later begin ACQUIRES the conversation
    // lock and still finds PROCESSING, the previous processor cannot be holding that lock -- a
    // SESSION advisory lock is released by the database when the session ends -- so it is gone. We
    // cannot know whether it reached a model, a Core decision or a durable write before it went.
    //
    // The durable state a vanished replica leaves behind is written directly here rather than by
    // killing a backend: it is the same row, and it does not make the assertion depend on the timing
    // of a connection teardown.
    const sha = (preimage: string): string =>
      createHash('sha256').update(preimage, 'utf8').digest('hex');
    const source = sha(JSON.stringify([1, 'WEB', 'src.msg.1']));
    const identity = sha(
      JSON.stringify([
        1,
        'WEB',
        'tenant.a',
        'conv.1',
        'msg.1',
        '2026-08-01T09:00:00Z',
        source,
        'HOSTED_ALLOWED',
        null,
      ]),
    );
    await withClient(pool, (client) =>
      client.query(
        `INSERT INTO ${TABLE}
           (tenant_id, conversation_id, message_id, channel, source_turn_digest,
            turn_identity_digest, claim_state)
         VALUES ('tenant.a', 'conv.1', 'msg.1', 'WEB', $1, $2, 'PROCESSING')`,
        [source, identity],
      ),
    );

    const next = await coordinator().begin(input());
    expect(next.outcome).toBe('INDETERMINATE');
    expect((await claimRow('msg.1')).rows[0]?.claim_state).toBe('INDETERMINATE');
    // And it stays that way, forever. No automatic rerun, on this replica or any other.
    expect((await coordinator().begin(input())).outcome).toBe('INDETERMINATE');
  });
});

// ---------------------------------------------------------------------------
// Cross-replica serialization.
// ---------------------------------------------------------------------------

describe('two INDEPENDENT coordinator instances serialize one conversation', () => {
  it('a second instance is told BUSY while the first holds the lease', async () => {
    const poolB = createDatabasePool(testDatabaseConfig(APP_B));
    try {
      const a = createPostgresRiyaTurnCoordinator({ pool });
      const b = createPostgresRiyaTurnCoordinator({ pool: poolB });

      const first = await a.begin(input({ messageId: 'msg.1' }));
      expect(first.outcome).toBe('ACQUIRED');
      if (first.outcome !== 'ACQUIRED') return;
      await first.lease.startProcessing();

      // A DIFFERENT message, a DIFFERENT process, the SAME conversation.
      expect((await b.begin(input({ messageId: 'msg.2' }))).outcome).toBe('BUSY');
      // And the same message from the other instance is BUSY too -- the lock is checked first.
      expect((await b.begin(input({ messageId: 'msg.1' }))).outcome).toBe('BUSY');

      await first.lease.complete();

      // Once released, the second instance may proceed -- and the first message is now spent.
      const second = await b.begin(input({ messageId: 'msg.2' }));
      expect(second.outcome).toBe('ACQUIRED');
      if (second.outcome === 'ACQUIRED') await second.lease.releaseUnstarted();
      expect((await b.begin(input({ messageId: 'msg.1' }))).outcome).toBe('REPLAYED');
    } finally {
      await closeDatabasePool(poolB);
    }
  });

  it('a different conversation is NOT blocked', async () => {
    const held = await coordinator().begin(input({ conversationId: 'conv.1' }));
    if (held.outcome !== 'ACQUIRED') throw new Error('expected ACQUIRED');
    const other = await coordinator().begin(input({ conversationId: 'conv.2' }));
    expect(other.outcome).toBe('ACQUIRED');
    if (other.outcome === 'ACQUIRED') await other.lease.releaseUnstarted();
    await held.lease.releaseUnstarted();
  });

  it('every lease exit releases its advisory lock', async () => {
    const locksHeld = async (): Promise<number> => {
      const result = await withClient(pool, (client) =>
        client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_locks WHERE locktype = 'advisory'`,
        ),
      );
      return Number.parseInt(result.rows[0]?.n ?? '0', 10);
    };
    const before = await locksHeld();
    for (const messageId of ['m.1', 'm.2', 'm.3']) {
      const begun = await coordinator().begin(input({ messageId }));
      if (begun.outcome !== 'ACQUIRED') throw new Error('expected ACQUIRED');
      await begun.lease.startProcessing();
      await begun.lease.complete();
    }
    const unstarted = await coordinator().begin(input({ messageId: 'm.4' }));
    if (unstarted.outcome === 'ACQUIRED') await unstarted.lease.releaseUnstarted();
    expect(await locksHeld()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Input discipline.
// ---------------------------------------------------------------------------

describe('the coordinator refuses what it must never store', () => {
  it('refuses a message carried on the input', async () => {
    // The port has no `normalizedText` field. A caller that added one anyway must not have it
    // silently ignored -- silence is indistinguishable from the field being honoured.
    await expect(
      coordinator().begin({ ...input(), normalizedText: 'my kitchen' } as never),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect((await claimRow('msg.1')).rowCount).toBe(0);
  });

  it('refuses a malformed identifier before it reaches the database', async () => {
    for (const over of [
      { tenantId: 'a@b.com' },
      { conversationId: 'has spaces' },
      { messageId: 'x'.repeat(129) },
      { channel: 'SMS' as never },
      { dataClass: 'PUBLIC' as never },
      { receivedAt: 'yesterday' },
      { channelTurnRef: '' },
    ]) {
      await expect(coordinator().begin(input(over)), JSON.stringify(over)).rejects.toMatchObject({
        code: 'invalid-input',
      });
    }
  });

  it('leaks no host, credential or SQL in its errors', async () => {
    let message = '';
    try {
      await coordinator().begin(input({ tenantId: 'a@b.com' }));
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    for (const forbidden of ['a@b.com', 'qf_jarvis', 'INSERT', 'SELECT', '127.0.0.1', 'password']) {
      expect(message, forbidden).not.toContain(forbidden);
    }
  });

  it('a runtime-role connection can read and claim, but never delete', async () => {
    const runtimePool = createDatabasePool(
      testDatabaseConfigAs(RUNTIME_ROLE, LOCAL_ONLY_PASSWORD, `${APP}-runtime`),
    );
    try {
      await withClient(runtimePool, async (client) => {
        await client.query(`SELECT count(*) FROM ${TABLE}`);
        await expect(client.query(`DELETE FROM ${TABLE}`)).rejects.toBeDefined();
      });
    } finally {
      await closeDatabasePool(runtimePool);
    }
  });
});
