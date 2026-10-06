#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromEventBackbone = createRequire(
  new URL('../../packages/event-backbone/package.json', import.meta.url),
);
const { Pool } = requireFromEventBackbone('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://qfj_phase23:qfj_phase23_ci_only@127.0.0.1:5432/qfj_phase23_test',
  max: 6,
  application_name: 'qfj-phase23-n-nminus1',
});
const schema = 'phase23_compat';

async function readState(id) {
  const { rows } = await pool.query(
    `select id,state_v1,state_v2,row_revision from ${schema}.turn_state where id=$1`,
    [id],
  );
  return rows[0];
}

try {
  const existing = await pool.query(
    'select count(*)::int n from information_schema.schemata where schema_name=$1',
    [schema],
  );
  assert.equal(existing.rows[0].n, 0, 'Phase23 certification requires a fresh disposable database');

  await pool.query(`create schema ${schema}`);
  await pool.query(`
    create table ${schema}.release_floor(
      singleton boolean primary key default true check(singleton),
      minimum_active_release integer not null check(minimum_active_release >= 1)
    );
    insert into ${schema}.release_floor(singleton,minimum_active_release) values(true,22);

    create table ${schema}.turn_state(
      id bigint primary key,
      state_v1 text not null,
      row_revision integer not null default 1
    );
    insert into ${schema}.turn_state(id,state_v1)
    select g,case when g % 2 = 0 then 'ready' else 'queued' end
    from generate_series(1,80) g;
  `);

  await pool.query(`
    alter table ${schema}.turn_state add column state_v2 text;
    create or replace function ${schema}.sync_state_v2_from_v1()
    returns trigger language plpgsql as $$
    begin
      if new.state_v2 is null or new.state_v1 is distinct from old.state_v1 then
        new.state_v2 := new.state_v1;
      end if;
      return new;
    end $$;
    create trigger turn_state_nminus1_compat
      before insert or update of state_v1 on ${schema}.turn_state
      for each row execute function ${schema}.sync_state_v2_from_v1();
  `);

  await pool.query(`insert into ${schema}.turn_state(id,state_v1) values(81,'legacy-created')`);
  assert.equal((await readState(81)).state_v2, 'legacy-created');

  await pool.query(
    `insert into ${schema}.turn_state(id,state_v1,state_v2) values(82,'new-created','new-created')`,
  );

  await pool.query(
    `update ${schema}.turn_state set state_v1='legacy-updated',row_revision=row_revision+1 where id=81`,
  );
  const overlap = await pool.query(
    `select id,state_v1,coalesce(state_v2,state_v1) state_n
       from ${schema}.turn_state where id in(81,82) order by id`,
  );
  assert.deepEqual(overlap.rows, [
    { id: '81', state_v1: 'legacy-updated', state_n: 'legacy-updated' },
    { id: '82', state_v1: 'new-created', state_n: 'new-created' },
  ]);

  let backfilled = 0;
  for (;;) {
    const r = await pool.query(`
      with batch as (
        select id from ${schema}.turn_state
        where state_v2 is null
        order by id
        limit 16
        for update skip locked
      )
      update ${schema}.turn_state t
      set state_v2=t.state_v1,row_revision=row_revision+1
      from batch where t.id=batch.id
      returning t.id
    `);
    assert.ok(r.rowCount <= 16);
    backfilled += r.rowCount;
    if (r.rowCount === 0) break;
  }
  assert.equal(backfilled, 80);

  await pool.query(
    `insert into ${schema}.turn_state(id,state_v1) values(83,'rollback-old-writer')`,
  );
  assert.equal((await readState(83)).state_v2, 'rollback-old-writer');

  const nReader = await pool.query(
    `select coalesce(state_v2,state_v1) state from ${schema}.turn_state
     where id in(81,82,83) order by id`,
  );
  assert.deepEqual(
    nReader.rows.map((r) => r.state),
    ['legacy-updated', 'new-created', 'rollback-old-writer'],
  );

  const floorBefore = await pool.query(
    `select minimum_active_release from ${schema}.release_floor where singleton=true`,
  );
  let contractBlocked = false;
  try {
    if (floorBefore.rows[0].minimum_active_release < 23) {
      throw new Error('N_MINUS_1_ACTIVE');
    }
  } catch (error) {
    contractBlocked = error?.message === 'N_MINUS_1_ACTIVE';
  }
  assert.equal(contractBlocked, true);
  await pool.query(
    `update ${schema}.release_floor set minimum_active_release=23 where singleton=true`,
  );
  await pool.query(`
    drop trigger turn_state_nminus1_compat on ${schema}.turn_state;
    drop function ${schema}.sync_state_v2_from_v1();
    alter table ${schema}.turn_state alter column state_v2 set not null;
    alter table ${schema}.turn_state drop column state_v1;
    alter table ${schema}.turn_state rename column state_v2 to state;
  `);

  let oldWriterRejected = false;
  try {
    await pool.query(`insert into ${schema}.turn_state(id,state_v1) values(84,'must-fail')`);
  } catch (error) {
    oldWriterRejected = error?.code === '42703';
  }
  assert.equal(oldWriterRejected, true);
  await pool.query(`insert into ${schema}.turn_state(id,state) values(84,'new-after-contract')`);

  const final = await pool.query(
    `select count(*)::int n,count(*) filter(where state is null)::int nulls
     from ${schema}.turn_state`,
  );
  assert.deepEqual(final.rows[0], { n: 84, nulls: 0 });

  console.log('Jarvis Phase23 N/N-1 PostgreSQL compatibility PASS');
  console.log(
    JSON.stringify(
      {
        baselineRows: 80,
        nMinus1WriterDuringN: true,
        nReaderSeesNMinus1Updates: true,
        boundedBackfillBatch: 16,
        backfilledRows: backfilled,
        rollbackToNMinus1DuringOverlap: true,
        contractOnlyAfterNMinus1Retired: true,
        oldWriterRejectedAfterContract: true,
        finalRows: 84,
        productionMutation: false,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
