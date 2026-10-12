import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eraseAnishaVendorMemoryWithFence, purgeExpiredGovernedMemory } from '../store.js';
import { rearmAnishaMemoryAfterFreshCoreGrant } from '../rearm-anisha-memory.js';

const connection = process.env['ANISHA_MEMORY_CERT_DATABASE_URL'];
const cert = connection ? new URL(connection) : null;
const isolated =
  cert?.hostname === '127.0.0.1' &&
  cert.port === '55439' &&
  cert.pathname === '/anisha_memory_cert';
const testSuite = isolated ? describe : describe.skip;

testSuite('AN-A2c actual isolated PostgreSQL 17 physical deletion certification', () => {
  const pool = new Pool({ connectionString: connection, max: 3, connectionTimeoutMillis: 3000 });
  const vendorA = '77777777-7777-4777-8777-777777777777';
  const vendorB = '88888888-8888-4888-8888-888888888888';
  const purgeA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const purgeB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  async function insert(id: string, vendor: string) {
    await pool.query(
      `INSERT INTO qf_jarvis_memory.agent_memory_record
       (memory_record_id, owner_agent, subject_keys, record_json, created_at, updated_at, expires_at)
       VALUES ($1, 'anisha', $2::text[], '{}'::jsonb, now(), now(), now()+interval '30 days')`,
      [id, ['vendor|' + vendor]],
    );
  }
  async function count(sql: string, id: string): Promise<number> {
    const r = await pool.query<{ count: string }>(sql, [id]);
    return Number(r.rows[0]?.count);
  }

  beforeAll(async () => {
    // Explicit local-only, disposable PG cluster: reset only synthetic
    // certification data so repeated failure-drill executions are idempotent.
    await pool.query(
      "DELETE FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id LIKE 'cert-%'",
    );
    await pool.query(
      'DELETE FROM qf_jarvis_memory.anisha_erasure_fence WHERE vendor_subject_key = ANY($1::text[])',
      [
        [
          vendorA,
          vendorB,
          '99999999-9999-4999-8999-999999999999',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        ].map((v) => 'vendor|' + v),
      ],
    );
  });
  afterAll(async () => {
    await pool.end();
  });
  it('physically deletes vendor A, persists fence and preserves other subjects', async () => {
    await insert('cert-a-' + purgeA, vendorA);
    await insert('cert-b-' + purgeB, vendorB);
    await expect(
      eraseAnishaVendorMemoryWithFence(pool, { vendorId: vendorA, purgeId: purgeA }),
    ).resolves.toEqual({ deletedCount: 1 });
    expect(
      await count(
        `SELECT count(*)::text AS count FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id=$1`,
        'cert-a-' + purgeA,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id=$1`,
        'cert-b-' + purgeB,
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM qf_jarvis_memory.anisha_erasure_fence WHERE vendor_subject_key=$1`,
        'vendor|' + vendorA,
      ),
    ).toBe(1);
    await expect(insert('cert-late-' + purgeA, vendorA)).rejects.toThrow(
      /anisha-memory-erasure-fence/,
    );
    await expect(
      eraseAnishaVendorMemoryWithFence(pool, { vendorId: vendorA, purgeId: purgeA }),
    ).resolves.toEqual({ deletedCount: 0 });
  });

  it('database rollback retains memory when a delete fails; retry succeeds', async () => {
    const id = 'cert-b-' + purgeB;
    const wrapped = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (...args: Parameters<typeof client.query>) => {
            if (String(args[0]).startsWith('DELETE '))
              throw new Error('injected-db-delete-failure');
            return client.query(...args);
          },
          release: () => client.release(),
        };
      },
    } as unknown as Pool;
    await expect(
      eraseAnishaVendorMemoryWithFence(wrapped, { vendorId: vendorB, purgeId: purgeB }),
    ).rejects.toThrow('anisha-memory-purge-unavailable');
    expect(
      await count(
        `SELECT count(*)::text AS count FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id=$1`,
        id,
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM qf_jarvis_memory.anisha_erasure_fence WHERE vendor_subject_key=$1`,
        'vendor|' + vendorB,
      ),
    ).toBe(0);
    await expect(
      eraseAnishaVendorMemoryWithFence(pool, { vendorId: vendorB, purgeId: purgeB }),
    ).resolves.toEqual({ deletedCount: 1 });
  });

  it('serializes an in-flight Anisha write with a concurrent vendor deletion', async () => {
    const vendorC = '99999999-9999-4999-8999-999999999999';
    const purgeC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const recordC = 'cert-concurrent-' + purgeC;
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO qf_jarvis_memory.agent_memory_record
        (memory_record_id, owner_agent, subject_keys, record_json, created_at, updated_at, expires_at)
        VALUES ($1,'anisha',$2::text[],'{}'::jsonb,now(),now(),now()+interval '30 days')`,
        [recordC, ['vendor|' + vendorC]],
      );
      let finished = false;
      const purging = eraseAnishaVendorMemoryWithFence(pool, {
        vendorId: vendorC,
        purgeId: purgeC,
      }).then((r) => {
        finished = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 130));
      expect(finished).toBe(false);
      await writer.query('COMMIT');
      await expect(purging).resolves.toEqual({ deletedCount: 1 });
      expect(
        await count(
          `SELECT count(*)::text AS count FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id=$1`,
          recordC,
        ),
      ).toBe(0);
      await expect(insert('cert-resurrection-' + purgeC, vendorC)).rejects.toThrow(
        /anisha-memory-erasure-fence/,
      );
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      writer.release();
    }
  });

  it('purges genuinely expired records while preserving non-expired ones', async () => {
    const expiredId = 'cert-expired-' + purgeB;
    const currentId = 'cert-nonexpired-' + purgeB;
    await pool.query(
      `INSERT INTO qf_jarvis_memory.agent_memory_record
        (memory_record_id,owner_agent,subject_keys,record_json,created_at,updated_at,expires_at)
        VALUES ($1,'riya',ARRAY['vendor|66666666-6666-4666-8666-666666666666'],
          '{}'::jsonb,now()-interval '60 days',now()-interval '60 days',
          now()-interval '30 days')`,
      [expiredId],
    );
    await pool.query(
      `INSERT INTO qf_jarvis_memory.agent_memory_record
        (memory_record_id,owner_agent,subject_keys,record_json,created_at,updated_at,expires_at)
        VALUES ($1,'riya',ARRAY['vendor|66666666-6666-4666-8666-666666666666'],
          '{}'::jsonb,now(),now(),now()+interval '30 days')`,
      [currentId],
    );
    const result = await purgeExpiredGovernedMemory(pool, {
      asOf: new Date().toISOString(),
      limit: 100,
    });
    expect(result.invalidatedCount).toBeGreaterThanOrEqual(1);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id=$1`,
        expiredId,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::text AS count FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id=$1`,
        currentId,
      ),
    ).toBe(1);
  });
  it('requires a fresh Core grant after the fence, then allows a new preference', async () => {
    const vendorD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const purgeD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await insert('cert-rearm-old', vendorD);
    await expect(
      eraseAnishaVendorMemoryWithFence(pool, { vendorId: vendorD, purgeId: purgeD }),
    ).resolves.toEqual({ deletedCount: 1 });
    const common = {
      vendorId: vendorD,
      consentRevision: 4,
      ownerApprovalRef: 'owner.approved.rearm.v1',
    };
    const now = new Date().toISOString();
    await expect(
      rearmAnishaMemoryAfterFreshCoreGrant(pool, {
        ...common,
        consentUpdatedAt: new Date(Date.now() - 3600000).toISOString(),
        consentObservedAt: now,
        now,
      }),
    ).rejects.toThrow('anisha-memory-rearm-unavailable');
    expect(
      await count(
        'SELECT count(*)::text AS count FROM qf_jarvis_memory.anisha_erasure_fence WHERE vendor_subject_key=$1',
        'vendor|' + vendorD,
      ),
    ).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fresh = new Date().toISOString();
    await expect(
      rearmAnishaMemoryAfterFreshCoreGrant(pool, {
        ...common,
        consentUpdatedAt: fresh,
        consentObservedAt: fresh,
        now: fresh,
      }),
    ).resolves.toEqual({ cleared: true });
    await insert('cert-rearm-new', vendorD);
    expect(
      await count(
        'SELECT count(*)::text AS count FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id=$1',
        'cert-rearm-new',
      ),
    ).toBe(1);
  });
});
