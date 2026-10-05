#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireFromEventBackbone = createRequire(
  new URL('../../packages/event-backbone/package.json', import.meta.url),
);
const { Pool } = requireFromEventBackbone('pg');
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://qf_phase08:phase08local@127.0.0.1:15434/qf_jarvis_phase09';
const pool = new Pool({ connectionString, max: 6 });

async function count(relation, where = 'true') {
  const result = await pool.query('select count(*)::int as n from ' + relation + ' where ' + where);
  return result.rows[0].n;
}

try {
  await pool.query(`
    drop schema if exists qf_jarvis cascade;
    create schema qf_jarvis;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='qf_jarvis_runtime') then
        create role qf_jarvis_runtime noinherit;
      end if;
      if not exists(select 1 from pg_roles where rolname='qf_jarvis_maintenance') then
        create role qf_jarvis_maintenance noinherit;
      end if;
    end $$;

    create table qf_jarvis.event(
      sequence bigint generated always as identity primary key,
      event_id uuid not null unique,
      accepted_at timestamptz not null
    );

    create table qf_jarvis.quickfurno_turn_spool(
      inbound_message_id uuid primary key,
      accepted_at timestamptz not null,
      state varchar(16) not null,
      processing_started_at timestamptz,
      finalized_at timestamptz
    );

    grant usage on schema qf_jarvis to qf_jarvis_runtime,qf_jarvis_maintenance;
    grant select,insert,update on qf_jarvis.quickfurno_turn_spool to qf_jarvis_runtime;
  `);

  const migration = await readFile(
    new URL(
      '../../packages/event-backbone/src/persistence/migrations/0018_scale_phase09_data_lifecycle.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(migration);

  await pool.query(`
    insert into qf_jarvis.event(event_id,accepted_at)
    select md5('event-'||g)::uuid, now()-interval '800 days'
    from generate_series(1,25) g;

    insert into qf_jarvis.quickfurno_turn_spool(
      inbound_message_id,accepted_at,state,processing_started_at,finalized_at
    )
    select md5('old-terminal-'||g)::uuid,now()-interval '90 days',
      case when g%2=0 then 'COMPLETED' else 'FAILED' end,
      now()-interval '89 days',now()-interval '88 days'
    from generate_series(1,1200) g;

    insert into qf_jarvis.quickfurno_turn_spool(
      inbound_message_id,accepted_at,state,processing_started_at,finalized_at
    )
    select md5('recent-terminal-'||g)::uuid,now()-interval '5 days','COMPLETED',
      now()-interval '4 days',now()-interval '3 days'
    from generate_series(1,100) g;

    insert into qf_jarvis.quickfurno_turn_spool(
      inbound_message_id,accepted_at,state,processing_started_at,finalized_at
    )
    select md5('pending-'||g)::uuid,now()-interval '90 days','PENDING',null,null
    from generate_series(1,100) g;
  `);

  const runtime = await pool.connect();
  try {
    await runtime.query('set role qf_jarvis_runtime');
    let denied = false;
    try {
      await runtime.query(
        "select qf_jarvis.prune_finalized_turn_spool(now()-interval '30 days',100)",
      );
    } catch {
      denied = true;
    }
    assert.equal(denied, true, 'runtime role unexpectedly has lifecycle delete authority');
  } finally {
    runtime.release(true);
  }

  const maintenance1 = pool.query(
    "set local role qf_jarvis_maintenance; select qf_jarvis.prune_finalized_turn_spool(now()-interval '30 days',500) as n",
  );
  const maintenance2 = pool.query(
    "set local role qf_jarvis_maintenance; select qf_jarvis.prune_finalized_turn_spool(now()-interval '30 days',500) as n",
  );
  const [m1, m2] = await Promise.all([maintenance1, maintenance2]);
  const firstDeleted = Number(m1[1].rows[0].n) + Number(m2[1].rows[0].n);
  assert.equal(firstDeleted, 1000);

  const m3 = await pool.query(
    "set local role qf_jarvis_maintenance; select qf_jarvis.prune_finalized_turn_spool(now()-interval '30 days',500) as n",
  );
  assert.equal(Number(m3[1].rows[0].n), 200);

  assert.equal(await count('qf_jarvis.quickfurno_turn_spool'), 200);
  assert.equal(await count('qf_jarvis.quickfurno_turn_spool', "state='PENDING'"), 100);
  assert.equal(await count('qf_jarvis.event'), 25);

  const indexes = await pool.query(
    "select indexname from pg_indexes where schemaname='qf_jarvis' order by indexname",
  );
  const names = indexes.rows.map((row) => row.indexname);
  assert.ok(names.includes('event_accepted_at_brin'));
  assert.ok(names.includes('quickfurno_turn_spool_finalized_retention_idx'));

  console.log('Jarvis Phase 09 lifecycle PostgreSQL certification PASS');
  console.log(
    JSON.stringify(
      {
        terminalRowsPruned: 1200,
        terminalRecentRetained: 100,
        pendingRetained: 100,
        canonicalEventsRetained: 25,
        runtimeDeleteAuthority: false,
        maintenanceOnlyPrune: true,
        maxBatch: 1000,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
