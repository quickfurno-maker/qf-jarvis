#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const budget = read('packages/event-backbone/src/persistence/connection-budget.ts');
const lifecycle = read('packages/event-backbone/src/persistence/data-lifecycle.ts');
const dbConfig = read('packages/event-backbone/src/persistence/database-config.ts');
const gateway = read('apps/quickfurno-gateway/src/database-config.ts');
const worker = read('apps/api/src/quickfurno-whatsapp/production-worker-config.ts');
const migration = read(
  'packages/event-backbone/src/persistence/migrations/0018_scale_phase09_data_lifecycle.sql',
);
const workerExamples = [
  'deploy/quickfurno-worker/worker-config.example.json',
  'deploy/quickfurno-worker/worker-config.hybrid.example.json',
  'deploy/quickfurno-worker/worker-config.openai.example.json',
].map(read);

function check(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

check('observed 60-connection envelope is explicitly partitioned', () => {
  assert.match(budget, /observedMaxConnections:\s*60/);
  assert.match(budget, /platformReserve:\s*28/);
  assert.match(budget, /applicationBudget:\s*16/);
  assert.match(budget, /emergencyHeadroom:\s*16/);
  assert.match(budget, /targetReplicas:\s*2, maxConnectionsPerReplica:\s*3/);
  assert.match(budget, /targetReplicas:\s*2, maxConnectionsPerReplica:\s*5/);
});

check('gateway production config is hard-capped by role budget', () => {
  assert.match(gateway, /rolePoolLimit\('gateway'\)/);
  assert.match(gateway, /assertProductionDatabaseRoleBudget\('gateway'/);
});

check('worker production config is hard-capped and concurrency-coupled', () => {
  assert.match(worker, /rolePoolLimit\('worker'\)/);
  assert.match(worker, /assertProductionDatabaseRoleBudget\('worker'/);
  assert.match(worker, /assertWorkerTurnConcurrencyBudget/);
  assert.match(budget, /maxAdmittedTurnsPerWorkerDbConnection:\s*40/);
});

check('production worker examples use five-connection pools', () => {
  for (const example of workerExamples) {
    const parsed = JSON.parse(example);
    assert.equal(parsed.database.maxConnections, 5);
    assert.equal(parsed.concurrency.globalMaxConcurrentTurns, 200);
  }
});

check('transaction-mode pooler remains refused for session-state event backbone', () => {
  assert.match(dbConfig, /SUPAVISOR_TRANSACTION_PORT = '6543'/);
  assert.match(dbConfig, /UnsupportedConnectionModeError/);
  assert.match(dbConfig, /requires session state/i);
});

check('canonical event ledger is archive-before-delete and never auto-deleted', () => {
  assert.match(lifecycle, /relation:\s*'qf_jarvis\.event'/);
  assert.match(lifecycle, /archiveRequiredBeforeDelete:\s*true/);
  assert.match(lifecycle, /autoDeleteEnabled:\s*false/);
  assert.doesNotMatch(migration, /delete\s+from\s+qf_jarvis\.event/i);
});

check('turn-spool pruning is terminal-only, bounded and maintenance-only', () => {
  assert.match(migration, /state IN \('COMPLETED','FAILED'\)/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit,500\),1\),1000\)/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i);
  assert.match(migration, /REVOKE ALL[\s\S]*qf_jarvis_runtime/i);
  assert.match(migration, /qf_jarvis_maintenance/);
});

check('append-only event ledger is partition-ready without partitioning now', () => {
  assert.match(migration, /event_accepted_at_brin/);
  assert.match(migration, /USING brin/i);
  assert.doesNotMatch(migration, /PARTITION BY|ATTACH PARTITION|DETACH PARTITION/i);
});

check('read replicas are opt-in eventual-only', () => {
  assert.match(lifecycle, /PRIMARY_STRONG/);
  assert.match(lifecycle, /REPLICA_EVENTUAL/);
  assert.match(lifecycle, /event_ingestion/);
  assert.match(lifecycle, /turn_claim/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Jarvis Phase 09 database lifecycle contract PASS');
