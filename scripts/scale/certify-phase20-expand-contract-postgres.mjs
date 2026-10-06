#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const requireFromEventBackbone = createRequire(
  new URL('../../packages/event-backbone/package.json', import.meta.url),
);
const { Pool } = requireFromEventBackbone('pg');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const u = new URL(connectionString);
if (
  !['127.0.0.1', 'localhost', '::1'].includes(u.hostname) &&
  process.env.PHASE20_ALLOW_REMOTE_REHEARSAL !== '1'
)
  throw new Error('Phase20 expand/contract rehearsal REFUSED non-loopback database');
const pool = new Pool({ connectionString, max: 4 });
const scalar = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
try {
  await pool.query(
    'drop schema if exists phase20_rehearsal cascade; create schema phase20_rehearsal',
  );
  await pool.query(`
    create table phase20_rehearsal.turn_state(
      id bigint generated always as identity primary key,
      legacy_state text not null check (legacy_state in ('pending','complete')),
      payload text not null
    );
    insert into phase20_rehearsal.turn_state(legacy_state,payload)
    select case when g%4=0 then 'complete' else 'pending' end, 'turn-'||g
    from generate_series(1,2000) g;
  `);
  const before = await scalar(
    `select count(*)::int n, md5(string_agg(id||':'||legacy_state||':'||payload,',' order by id)) digest from phase20_rehearsal.turn_state`,
  );
  await pool.query(`
    alter table phase20_rehearsal.turn_state add column state_v2 text;
    create view phase20_rehearsal.turn_state_compat as
      select id,coalesce(state_v2,legacy_state) as state,payload from phase20_rehearsal.turn_state;
  `);
  let total = 0;
  while (true) {
    const r = await pool.query(`
      with batch as (
        select id from phase20_rehearsal.turn_state where state_v2 is null
        order by id limit 137 for update skip locked
      )
      update phase20_rehearsal.turn_state t set state_v2=t.legacy_state
      from batch b where t.id=b.id returning t.id
    `);
    total += r.rowCount;
    if (r.rowCount === 0) break;
  }
  assert.equal(total, 2000);
  assert.equal(
    (
      await scalar(
        'select count(*)::int n from phase20_rehearsal.turn_state where state_v2 is distinct from legacy_state',
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await scalar(
        "select count(*)::int n from phase20_rehearsal.turn_state_compat where state in ('pending','complete')",
      )
    ).n,
    2000,
  );
  await pool.query(
    'create table phase20_rehearsal.rollback_checkpoint as table phase20_rehearsal.turn_state',
  );
  await pool.query(`
    drop view phase20_rehearsal.turn_state_compat;
    alter table phase20_rehearsal.turn_state alter column state_v2 set not null;
    alter table phase20_rehearsal.turn_state add constraint turn_state_v2_valid check (state_v2 in ('pending','complete')) not valid;
    alter table phase20_rehearsal.turn_state validate constraint turn_state_v2_valid;
    alter table phase20_rehearsal.turn_state drop column legacy_state;
    alter table phase20_rehearsal.turn_state rename column state_v2 to state;
  `);
  const after = await scalar(
    `select count(*)::int n, md5(string_agg(id||':'||state||':'||payload,',' order by id)) digest from phase20_rehearsal.turn_state`,
  );
  assert.equal(after.n, before.n);
  assert.equal(after.digest, before.digest);
  console.log('Jarvis Phase20 expand/backfill/compatibility/contract rehearsal PASS');
  console.log(
    JSON.stringify(
      {
        rows: before.n,
        batches: Math.ceil(total / 137),
        semanticDigestPreserved: true,
        rollbackCheckpoint: true,
        productionMutation: false,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.query('drop schema if exists phase20_rehearsal cascade').catch(() => undefined);
  await pool.end();
}
