#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const config = read('apps/api/src/quickfurno-whatsapp/production-worker-config.ts');
const scheduler = read('apps/api/src/quickfurno-whatsapp/parallel-turn-scheduler.ts');
const spool = read('apps/quickfurno-gateway/src/postgres-durable-turn-spool.ts');
const migration = read(
  'packages/event-backbone/src/persistence/migrations/0019_scale_phase12_horizontal_worker_ordering.sql',
);
const router = read('packages/agent-runtime/src/router/assign-agent.ts');
const processor = read('apps/api/src/quickfurno-whatsapp/turn-processor.ts');

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push([name, true]);
    console.log('PASS', name);
  } catch (e) {
    checks.push([name, false]);
    console.error('FAIL', name, e instanceof Error ? e.message : String(e));
  }
}

check('MULTI_REPLICA is explicit and Postgres-only', () => {
  assert.match(config, /deploymentMode: z\.enum\(\['SINGLE_OWNER', 'MULTI_REPLICA'\]\)/);
  assert.match(config, /multi-replica workers require the PostgreSQL durable turn store/);
});
check('agent lanes are explicit, unique and selectable', () => {
  assert.match(config, /agentLanes: agentLanesSchema/);
  assert.match(scheduler, /readonly agents\?: readonly QuickFurnoWhatsAppAgent\[\]/);
  assert.match(scheduler, /allowedActors: \[agent\]/);
});
check('database enforces one PROCESSING turn per conversation', () => {
  assert.match(migration, /quickfurno_turn_spool_one_processing_per_conversation/);
  assert.match(migration, /where state = 'PROCESSING'/i);
});
check('claim query blocks earlier pending or processing turns in the same conversation', () => {
  assert.match(spool, /prior\.conversation_id = turn\.conversation_id/);
  assert.match(spool, /prior\.state = 'PROCESSING'/);
  assert.match(spool, /prior\.state = 'PENDING'/);
  assert.match(spool, /FOR UPDATE OF turn SKIP LOCKED/);
});
check('claim query preserves deterministic turn order', () => {
  for (const field of ['accepted_at', 'received_at', 'conversation_revision', 'inbound_message_id'])
    assert.ok(spool.includes(field));
});
check('scheduler still has bounded global and per-agent admission', () => {
  assert.match(scheduler, /globalMaxConcurrentTurns/);
  assert.match(scheduler, /maxConcurrentByAgent/);
});
check('human takeover remains fail-closed in routing', () => {
  assert.match(router, /humanTakeover/);
  assert.match(router, /return 'HUMAN'/);
});
check('subject routing remains deterministic', () => {
  assert.match(router, /case 'CLIENT':[\s\S]*return 'RIYA'/);
  assert.match(router, /case 'VENDOR':[\s\S]*return 'ANISHA'/);
  assert.match(router, /case 'PROSPECT':[\s\S]*return 'AAROHI'/);
});
check(
  'turn processing re-reads QuickFurno material and rejects stale/mismatched authority before effect',
  () => {
    assert.match(processor, /config\.materialReader\.read/);
    assert.match(processor, /stale-revision/);
    assert.match(processor, /materialMatches\(ref, material\)/);
    assert.ok(
      processor.indexOf('materialMatches(ref, material)') <
        processor.indexOf('config.specialistRuntime.process'),
    );
  },
);

const failed = checks.filter(([, ok]) => !ok);
console.log(`\nPhase 12 Jarvis contract: ${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
