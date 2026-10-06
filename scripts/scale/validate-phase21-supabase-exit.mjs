#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (p) => readFile(join(ROOT, p), 'utf8');
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name + ' - ' + error.message);
    process.exitCode = 1;
  }
}

const contractText = await read('contracts/qfj-phase21-supabase-exit-v1.json');
const contract = JSON.parse(contractText);
const snap = JSON.parse(await read('docs/scale/phase21-live-supabase-snapshot.json'));
const migration = await read(
  'packages/event-backbone/src/persistence/migrations/0001_event_log.sql',
);
const preflight = await read('packages/event-backbone/src/persistence/preflight.ts');
const compose = await read('compose.yml');

check('canonical Phase21 contract', () =>
  assert.equal(contract.contract, 'qfj.phase21.supabase-exit.v1'),
);
check('exact Phase20 Jarvis baseline', () =>
  assert.equal(contract.phase20Baselines.jarvis, '473dac5fb0ec8ac0d428c2f050f80b8495c1eede'),
);
check('live qf_jarvis shape captured', () => {
  assert.equal(snap.catalog.schema, 'qf_jarvis');
  assert.equal(snap.catalog.tables, 2);
  assert.equal(snap.catalog.eventRows, 0);
  assert.equal(snap.catalog.schemaMigrationRows, 1);
});
check('live migration checksum equals repository', () => {
  const actual = createHash('sha256').update(migration).digest('hex');
  assert.equal(actual, snap.migrationLedger[0].checksumSha256);
  assert.equal(actual, contract.jarvisSource.migrationSha256);
});
check('Jarvis requires PostgreSQL major 17', () =>
  assert.match(preflight, /REQUIRED_POSTGRES_MAJOR_VERSION = 17/),
);
check('managed preflight is database-enforced read only', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(preflight, /ROLLBACK/);
});
check('local reconstruction is provider-neutral PostgreSQL', () => {
  assert.match(compose, /PostgreSQL 17/);
  assert.doesNotMatch(compose, /SUPABASE_URL|SUPABASE_SERVICE_ROLE/i);
});
check('Jarvis has no Supabase Auth/Storage/Realtime payload', () => {
  assert.equal(snap.authUsers, 0);
  assert.equal(snap.storageObjects, 0);
  assert.deepEqual(snap.realtimeTables, []);
});
check('Vault is unused by Jarvis runtime schema', () =>
  assert.equal(snap.vaultPublicRuntimeReferences, 0),
);
check('no Core authority migration', () =>
  assert.match(contract.authority.jarvis, /event_and_operational_state/),
);
check('no production mutation/cutover', () => {
  assert.equal(contract.certification.noProductionMutation, true);
  assert.equal(contract.exit.productionDatabaseMigrated, false);
});
check('AGNI authority remains unchanged', () =>
  assert.equal(contract.exit.agniAuthorityExpanded, false),
);

const sha = createHash('sha256').update(contractText).digest('hex');
console.log(
  'Jarvis Phase21 ' +
    (process.exitCode ? 'FAILED' : 'PASS') +
    ' (' +
    passed +
    '/12) contractSha256=' +
    sha,
);
if (process.exitCode) process.exit(process.exitCode);
