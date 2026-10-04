#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const requireFromEventBackbone = createRequire(
  new URL('../../packages/event-backbone/package.json', import.meta.url),
);
const { Pool } = requireFromEventBackbone('pg');
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://qf_phase08:phase08local@127.0.0.1:15434/qf_jarvis_phase09';

const specs = [
  { name: 'qfj-p09-gateway-1', max: 3 },
  { name: 'qfj-p09-gateway-2', max: 3 },
  { name: 'qfj-p09-worker-1', max: 5 },
  { name: 'qfj-p09-worker-2', max: 5 },
];

const pools = specs.map(
  (spec) =>
    new Pool({
      connectionString,
      max: spec.max,
      application_name: spec.name,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 1000,
    }),
);
const admin = new Pool({
  connectionString,
  max: 1,
  application_name: 'qfj-p09-cert-admin',
});

let peak = 0;
let stopped = false;

async function sample() {
  while (!stopped) {
    const result = await admin.query(
      "select count(*)::int as n from pg_stat_activity where application_name like 'qfj-p09-%' and application_name <> 'qfj-p09-cert-admin'",
    );
    peak = Math.max(peak, result.rows[0].n);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

try {
  const sampling = sample();
  const work = [];
  for (let i = 0; i < pools.length; i += 1) {
    const spec = specs[i];
    const pool = pools[i];
    for (let n = 0; n < spec.max * 8; n += 1) {
      work.push(pool.query('select pg_sleep(0.08), $1::int as n', [n]));
    }
  }
  const results = await Promise.all(work);
  stopped = true;
  await sampling;

  assert.equal(results.length, (3 + 3 + 5 + 5) * 8);
  assert.ok(peak <= 16, 'application backend peak exceeded 16: ' + peak);
  assert.ok(peak >= 12, 'certification did not create enough concurrent pressure: ' + peak);

  const maxSetting = await admin.query('show max_connections');
  const maxConnections = Number(maxSetting.rows[0].max_connections);
  assert.ok(maxConnections >= 16);

  console.log('Jarvis Phase 09 connection-budget PostgreSQL certification PASS');
  console.log(
    JSON.stringify(
      {
        topology: '2 gateway x3 + 2 worker x5',
        applicationBudget: 16,
        peakObservedApplicationBackends: peak,
        postgresMaxConnections: maxConnections,
        requestsCompleted: results.length,
        poolQueueingAbsorbedExcessConcurrency: true,
      },
      null,
      2,
    ),
  );
} finally {
  stopped = true;
  await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
  await admin.end().catch(() => undefined);
}
