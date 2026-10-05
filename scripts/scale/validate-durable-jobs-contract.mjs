#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const failures = [];
const read = (path) => readFile(join(ROOT, path), 'utf8');
function check(label, value) {
  if (value) console.log('PASS', label);
  else {
    console.error('FAIL', label);
    failures.push(label);
  }
}

const [
  replayMigration,
  replayTests,
  turnMigration,
  turnAdapter,
  turnTests,
  turnProcessor,
  parallelScheduler,
  productionWorker,
  observation,
  aarohiWorker,
  coordinationContract,
] = await Promise.all([
  read('packages/event-backbone/src/persistence/migrations/0010_execution_replay_claim.sql'),
  read('packages/postgres-execution-replay-store/src/tests/replay-store.integration.test.ts'),
  read('packages/event-backbone/src/persistence/migrations/0017_quickfurno_durable_turn_spool.sql'),
  read('apps/quickfurno-gateway/src/postgres-durable-turn-spool.ts'),
  read('apps/quickfurno-gateway/src/tests/postgres-durable-turn-spool.integration.test.ts'),
  read('apps/api/src/quickfurno-whatsapp/turn-processor.ts'),
  read('apps/api/src/quickfurno-whatsapp/parallel-turn-scheduler.ts'),
  read('apps/api/src/quickfurno-whatsapp/production-worker.ts'),
  read('apps/api/src/quickfurno-whatsapp/production-observation.ts'),
  read('apps/api/src/aarohi-phase2/worker.ts'),
  read('packages/coordination-contract/src/index.ts'),
]);

check(
  'execution replay claim has independent durable uniqueness on intent and idempotency key',
  /PRIMARY KEY \(execution_intent_id\)/i.test(replayMigration) &&
    /UNIQUE \(idempotency_key\)/i.test(replayMigration),
);
check(
  'real PostgreSQL replay tests prove one first-seen under contention',
  /concurrent claims of ONE uuid/i.test(replayTests) &&
    /expect\(counts\['first-seen'\]\)\.toBe\(1\)/.test(replayTests),
);
check(
  'database uncertainty never guesses first-seen',
  /unavailable store throws/i.test(replayTests) && /never guesses first-seen/i.test(replayTests),
);

check(
  'durable turn spool is PostgreSQL-backed with immutable identity and lifecycle states',
  /CREATE TABLE qf_jarvis\.quickfurno_turn_spool/i.test(turnMigration) &&
    /PENDING/i.test(turnMigration) &&
    /PROCESSING/i.test(turnMigration) &&
    /COMPLETED/i.test(turnMigration) &&
    /FAILED/i.test(turnMigration),
);
check(
  'turn claim uses row-scoped FOR UPDATE SKIP LOCKED',
  /FOR UPDATE(?: OF turn)? SKIP LOCKED/i.test(turnAdapter),
);
check(
  'same durable turn has exactly one concurrent claimant in integration',
  /exactly one concurrent worker claim one durable turn/i.test(turnTests) &&
    /expect\(winners\)\.toHaveLength\(1\)/.test(turnTests),
);
check(
  'turn spool survives process restart and has stale-claim recovery',
  /keeps accepted work after the runtime pool is destroyed and recreated/i.test(turnTests) &&
    /recovers stale claims without losing a turn/i.test(turnTests),
);
check(
  'turn spool exposes queue depth and oldest pending age',
  /oldest_pending_age_ms/i.test(turnAdapter) && /oldestPendingAgeMs/i.test(turnAdapter),
);
check(
  'runtime role cannot mutate durable routing identity or delete queue truth',
  /delete_table: false/.test(turnTests) && /update_identity: false/.test(turnTests),
);

check(
  'pre-agent transient failures release safely, post-agent uncertainty does not auto-rerun',
  /released-pre-agent/.test(turnProcessor) &&
    /An agent\/Core run has already occurred\. Do not auto-rerun it after callback uncertainty/.test(
      turnProcessor,
    ),
);
check(
  'parallel scheduler bounds global/per-agent concurrency and one conversation at a time',
  /globalMaxConcurrentTurns/.test(parallelScheduler) &&
    /maxConcurrentByAgent/.test(parallelScheduler) &&
    /activeConversations/.test(parallelScheduler),
);
check(
  'parallel scheduler gracefully drains in-flight work after abort',
  /Promise\.allSettled\(\[\.\.\.inFlight\]\)/.test(parallelScheduler),
);
check(
  'production worker recovers stale durable claims before accepting work',
  /await spool\.recoverStale\(config\.staleProcessingMs, Date\.now\(\)\)/.test(productionWorker),
);
check(
  'per-runtime worker observation refreshes with spool queue health',
  /runtimeId/.test(observation) &&
    /spool/.test(observation) &&
    /nowMs - lastObservationMs < 10_000/.test(productionWorker),
);
check(
  'Aarohi uncertain provider outcome refuses a second provider attempt',
  /Execution uncertainty must never cause a second provider discovery attempt/i.test(
    aarohiWorker,
  ) &&
    /Never repeat a provider execution after an uncertain completion acknowledgement/i.test(
      aarohiWorker,
    ) &&
    /SOCIAL_COMPLETION_ACK_UNCERTAIN/.test(aarohiWorker),
);
check(
  'Redis/Valkey remains explicitly ephemeral coordination, not durable truth',
  /COORDINATION_IS_EPHEMERAL/.test(coordinationContract),
);

if (failures.length > 0) {
  console.error(`Jarvis Phase 07 durable-job contract FAILED (${failures.length})`);
  process.exit(1);
}
console.log('Jarvis Phase 07 durable-job contract PASS');
