import { randomUUID } from 'node:crypto';

import {
  closeDatabasePool,
  createDatabaseConfig,
  createDatabasePool,
  defaultMigrationsDirectory,
  migrateWithPreflight,
  withClient,
  type DatabaseConfig,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresDurableTurnSpool } from '../postgres-durable-turn-spool.js';
import type { WhatsAppTurnV1 } from '../whatsapp-turn-protocol.js';

const RUNTIME_ROLE = 'qf_jarvis_runtime';
const RUNTIME_PASSWORD = randomUUID();

function guardedTestConfig(): DatabaseConfig {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined || raw.trim() === '') {
    throw new Error('DATABASE_URL is required for durable turn spool integration tests');
  }
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//u, '');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!allowedHosts.has(url.hostname) || !/(^|[_-])test($|[_-])|test$/iu.test(database)) {
    throw new Error('refusing non-loopback or non-test database');
  }
  const target = url.hostname + '/' + database;
  if (/(supabase|quickfurno|prod|production|live)/iu.test(target)) {
    throw new Error('refusing production-shaped database');
  }
  return createDatabaseConfig({
    connectionString: raw,
    maxConnections: 8,
    applicationName: 'qf-turn-spool-integration-admin',
  });
}

const adminConfig = guardedTestConfig();
const adminPool = createDatabasePool(adminConfig);
let runtimePool: DatabasePool | undefined;

function runtimeConnectionString(): string {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined) throw new Error('DATABASE_URL missing');
  const url = new URL(raw);
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  return url.toString();
}

async function ensureRoles(): Promise<void> {
  await withClient(adminPool, async (client) => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await client.query(
        "DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '" +
          role +
          "') THEN CREATE ROLE " +
          role +
          ' NOLOGIN; END IF; END $role$;',
      );
    }
    await client.query(
      "DO $runtime$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '" +
        RUNTIME_ROLE +
        "') THEN CREATE ROLE " +
        RUNTIME_ROLE +
        ' LOGIN; END IF; END $runtime$;',
    );
    const statement = await client.query<{ sql: string }>(
      "SELECT format('ALTER ROLE " + RUNTIME_ROLE + " WITH LOGIN PASSWORD %L', $1::text) AS sql",
      [RUNTIME_PASSWORD],
    );
    const sql = statement.rows[0]?.sql;
    if (sql === undefined) throw new Error('runtime role password statement missing');
    await client.query(sql);
  });
}

function turn(overrides: Partial<WhatsAppTurnV1> = {}): WhatsAppTurnV1 {
  return {
    protocol: 'qfj.whatsapp.turn',
    version: 1,
    caller: 'quickfurno-core',
    audience: 'qf-jarvis',
    requestId: '11111111-1111-4111-8111-111111111111',
    issuedAt: '2026-09-18T12:00:00.000Z',
    conversationId: '22222222-2222-4222-8222-222222222222',
    conversationRevision: 4,
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: '2026-09-18T12:00:00.000Z',
    assignedActor: 'RIYA',
    subjectType: 'client',
    normalizedText: 'must never be stored in the durable spool',
    ...overrides,
  };
}

beforeAll(async () => {
  await withClient(adminPool, (client) => client.query('DROP SCHEMA IF EXISTS qf_jarvis CASCADE'));
  await ensureRoles();
  await migrateWithPreflight(adminPool, adminConfig, defaultMigrationsDirectory());
  runtimePool = createDatabasePool(
    createDatabaseConfig({
      connectionString: runtimeConnectionString(),
      maxConnections: 6,
      applicationName: 'qf-turn-spool-integration-runtime',
    }),
  );
});

beforeEach(async () => {
  await withClient(adminPool, (client) =>
    client.query('TRUNCATE TABLE qf_jarvis.quickfurno_turn_spool'),
  );
});

afterAll(async () => {
  if (runtimePool !== undefined) await closeDatabasePool(runtimePool);
  await closeDatabasePool(adminPool);
});

function runtime(): DatabasePool {
  if (runtimePool === undefined) throw new Error('runtime pool not initialized');
  return runtimePool;
}

describe('Postgres durable turn spool', () => {
  it('stores only opaque routing identity and converges replay/duplicate/conflict', async () => {
    const spool = createPostgresDurableTurnSpool(runtime());
    const accepted = await spool.accept(turn(), '2026-09-18T12:00:01.000Z');
    expect(accepted.outcome).toBe('accepted');
    expect((await spool.accept(turn(), '2026-09-18T12:00:02.000Z')).outcome).toBe('replay');
    expect(
      (
        await spool.accept(
          turn({ requestId: '44444444-4444-4444-8444-444444444444' }),
          '2026-09-18T12:00:03.000Z',
        )
      ).outcome,
    ).toBe('duplicate');
    expect(
      (await spool.accept(turn({ conversationRevision: 5 }), '2026-09-18T12:00:04.000Z')).outcome,
    ).toBe('conflict');

    const serialized = await withClient(adminPool, async (client) => {
      const result = await client.query<{ value: string }>(
        `SELECT row_to_json(t)::text AS value
           FROM qf_jarvis.quickfurno_turn_spool AS t
          WHERE inbound_message_id = $1`,
        [turn().inboundMessageId],
      );
      return result.rows[0]?.value ?? '';
    });
    expect(serialized).not.toContain('must never be stored');
    expect(serialized).not.toContain('normalizedText');
  });

  it('claims distinct pending turns atomically through separate runtime pools', async () => {
    const producer = createPostgresDurableTurnSpool(runtime());
    const poolA = createDatabasePool(
      createDatabaseConfig({
        connectionString: runtimeConnectionString(),
        maxConnections: 2,
        applicationName: 'qf-turn-spool-worker-a',
      }),
    );
    const poolB = createDatabasePool(
      createDatabaseConfig({
        connectionString: runtimeConnectionString(),
        maxConnections: 2,
        applicationName: 'qf-turn-spool-worker-b',
      }),
    );
    const spoolA = createPostgresDurableTurnSpool(poolA);
    const spoolB = createPostgresDurableTurnSpool(poolB);
    try {
      const a = turn({
        requestId: randomUUID(),
        inboundMessageId: randomUUID(),
        conversationId: randomUUID(),
      });
      const b = turn({
        requestId: randomUUID(),
        inboundMessageId: randomUUID(),
        conversationId: randomUUID(),
      });
      await producer.accept(a, '2026-09-18T12:01:00.000Z');
      await producer.accept(b, '2026-09-18T12:01:01.000Z');

      const [first, second] = await Promise.all([spoolA.claimNext(), spoolB.claimNext()]);
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first?.inboundMessageId).not.toBe(second?.inboundMessageId);
      expect(new Set([first?.inboundMessageId, second?.inboundMessageId])).toEqual(
        new Set([a.inboundMessageId, b.inboundMessageId]),
      );

      if (first !== null) await spoolA.complete(first.inboundMessageId);
      if (second !== null) await spoolB.complete(second.inboundMessageId);
    } finally {
      await closeDatabasePool(poolA);
      await closeDatabasePool(poolB);
    }
  });

  it('keeps accepted work after the runtime pool is destroyed and recreated', async () => {
    const firstPool = createDatabasePool(
      createDatabaseConfig({
        connectionString: runtimeConnectionString(),
        maxConnections: 2,
        applicationName: 'qf-turn-spool-runtime-before-restart',
      }),
    );
    const item = turn({
      requestId: randomUUID(),
      inboundMessageId: randomUUID(),
      conversationId: randomUUID(),
    });
    try {
      const beforeRestart = createPostgresDurableTurnSpool(firstPool);
      expect((await beforeRestart.accept(item, '2026-09-18T12:01:30.000Z')).outcome).toBe(
        'accepted',
      );
    } finally {
      await closeDatabasePool(firstPool);
    }

    const secondPool = createDatabasePool(
      createDatabaseConfig({
        connectionString: runtimeConnectionString(),
        maxConnections: 2,
        applicationName: 'qf-turn-spool-runtime-after-restart',
      }),
    );
    try {
      const afterRestart = createPostgresDurableTurnSpool(secondPool);
      expect((await afterRestart.claimNext())?.inboundMessageId).toBe(item.inboundMessageId);
      await afterRestart.complete(item.inboundMessageId);
    } finally {
      await closeDatabasePool(secondPool);
    }
  });

  it('releases and recovers stale claims without losing a turn', async () => {
    const spool = createPostgresDurableTurnSpool(runtime());
    const item = turn({
      requestId: randomUUID(),
      inboundMessageId: randomUUID(),
      conversationId: randomUUID(),
    });
    await spool.accept(item, '2026-09-18T12:02:00.000Z');
    expect((await spool.claimNext())?.inboundMessageId).toBe(item.inboundMessageId);
    await spool.release(item.inboundMessageId);
    expect((await spool.claimNext())?.inboundMessageId).toBe(item.inboundMessageId);

    expect(await spool.recoverStale(60_000, Date.now() + 120_000)).toBe(1);
    expect((await spool.claimNext())?.inboundMessageId).toBe(item.inboundMessageId);
    await spool.fail(item.inboundMessageId);
  });

  it('grants runtime only the lifecycle privileges it needs', async () => {
    const grants = await withClient(adminPool, async (client) => {
      const result = await client.query<{
        select_table: boolean;
        insert_table: boolean;
        delete_table: boolean;
        truncate_table: boolean;
        update_state: boolean;
        update_identity: boolean;
      }>(
        `SELECT
           has_table_privilege($1, 'qf_jarvis.quickfurno_turn_spool', 'SELECT') AS select_table,
           has_table_privilege($1, 'qf_jarvis.quickfurno_turn_spool', 'INSERT') AS insert_table,
           has_table_privilege($1, 'qf_jarvis.quickfurno_turn_spool', 'DELETE') AS delete_table,
           has_table_privilege($1, 'qf_jarvis.quickfurno_turn_spool', 'TRUNCATE') AS truncate_table,
           has_column_privilege($1, 'qf_jarvis.quickfurno_turn_spool', 'state', 'UPDATE')
             AS update_state,
           has_column_privilege($1, 'qf_jarvis.quickfurno_turn_spool', 'conversation_id', 'UPDATE')
             AS update_identity`,
        [RUNTIME_ROLE],
      );
      return result.rows[0];
    });

    expect(grants).toEqual({
      select_table: true,
      insert_table: true,
      delete_table: false,
      truncate_table: false,
      update_state: true,
      update_identity: false,
    });

    await expect(
      withClient(runtime(), (client) =>
        client.query('DELETE FROM qf_jarvis.quickfurno_turn_spool'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
