#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures.push({ name, detail });
  }
}

const contract = await readFile(
  resolve(ROOT, 'packages/coordination-contract/src/index.ts'),
  'utf8',
);
const adapter = await readFile(resolve(ROOT, 'packages/redis-coordination/src/index.ts'), 'utf8');
const adapterPackage = JSON.parse(
  await readFile(resolve(ROOT, 'packages/redis-coordination/package.json'), 'utf8'),
);
const integration = await readFile(
  resolve(ROOT, 'packages/redis-coordination/src/tests/coordination.integration.test.ts'),
  'utf8',
);
const production = await readFile(
  resolve(ROOT, 'deploy/coordination/compose.production.yml'),
  'utf8',
);
const gatewayBase = await readFile(
  resolve(ROOT, 'deploy/quickfurno-gateway/compose.production.yml'),
  'utf8',
);
const gatewayOverlay = await readFile(
  resolve(ROOT, 'deploy/quickfurno-gateway/compose.coordination.yml'),
  'utf8',
);
const workerBase = await readFile(
  resolve(ROOT, 'deploy/quickfurno-worker/compose.production.yml'),
  'utf8',
);
const workerOverlay = await readFile(
  resolve(ROOT, 'deploy/quickfurno-worker/compose.coordination.yml'),
  'utf8',
);
const devCompose = await readFile(resolve(ROOT, 'compose.yml'), 'utf8');

check(
  'provider-neutral coordination contract exists',
  contract.includes('export interface CoordinationPort') &&
    !contract.includes("from 'redis'") &&
    !contract.includes('createClient('),
  'business/runtime code must depend on a provider-neutral contract',
);
check(
  'Redis adapter is isolated behind the contract',
  adapter.includes("from 'redis'") &&
    adapter.includes("from '@qf-jarvis/coordination-contract'") &&
    adapter.includes('implements CoordinationPort'),
  'node-redis must stay inside the adapter package',
);
check(
  'Redis is optional at runtime',
  adapter.includes('if (!url) return null'),
  'absence of Redis must not become a Jarvis boot dependency',
);
check(
  'coordination key material is opaque',
  adapter.includes("createHash('sha256')") &&
    adapter.includes('opaque(input.subject)') &&
    adapter.includes('opaque(input.resource)') &&
    adapter.includes('opaque(key)'),
  'client/lead/conversation identifiers must not appear in Redis key names',
);
check(
  'cache and rate-limit entries are TTL bounded',
  adapter.includes('MAX_CACHE_TTL_MS') &&
    adapter.includes('{ PX: ttlMs }') &&
    adapter.includes('MAX_RATE_WINDOW_MS') &&
    adapter.includes('PEXPIRE'),
  'ephemeral coordination data must expire',
);
check(
  'locks have ownership, TTL and fencing',
  adapter.includes('PSETEX') &&
    adapter.includes('FENCE_RETENTION_MS') &&
    adapter.includes("status: 'not-owner'") &&
    adapter.includes('fence'),
  'stale lock holders must be detectable',
);
check(
  'outages are explicit unavailable results',
  (adapter.match(/status: 'unavailable'/g) ?? []).length >= 6,
  'coordination failure must never be fabricated as success',
);
check(
  'Valkey production image is digest pinned',
  production.includes(
    'valkey/valkey@sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507',
  ),
  'production coordination runtime must be reproducible',
);
check(
  'Valkey production persistence is disabled',
  production.includes('--appendonly') &&
    production.includes("- 'no'") &&
    production.includes('--save') &&
    production.includes("- ''"),
  'Redis/Valkey may not become durable business truth',
);
check(
  'Valkey memory is bounded with TTL-aware eviction',
  production.includes('--maxmemory') &&
    production.includes('256mb') &&
    production.includes('volatile-ttl'),
  'ephemeral coordination needs a defined memory/eviction policy',
);
check(
  'Valkey has no public host port',
  !/\n\s+ports\s*:/u.test(production),
  'production coordination must stay private',
);
check(
  'Valkey storage is disposable',
  production.includes('read_only: true') && production.includes('/data:rw,noexec,nosuid,nodev'),
  'coordination data must not depend on host persistence',
);
check(
  'gateway base deployment does not require Redis',
  !gatewayBase.includes('QFJ_COORDINATION_REDIS_URL') && !gatewayBase.includes('depends_on:'),
  'Jarvis gateway must boot without Redis',
);
check(
  'worker base deployment does not require Redis',
  !workerBase.includes('QFJ_COORDINATION_REDIS_URL') && !workerBase.includes('depends_on:'),
  'Jarvis worker must boot without Redis',
);
check(
  'gateway coordination overlay is explicit and removable',
  gatewayOverlay.includes('QFJ_COORDINATION_REDIS_URL') &&
    gatewayOverlay.includes('external: true') &&
    gatewayOverlay.includes('qf-jarvis-coordination'),
  'Redis wiring must be an infrastructure overlay, not a runtime authority',
);
check(
  'worker coordination overlay is explicit and removable',
  workerOverlay.includes('QFJ_COORDINATION_REDIS_URL') &&
    workerOverlay.includes('external: true') &&
    workerOverlay.includes('qf-jarvis-coordination'),
  'Redis wiring must be an infrastructure overlay, not a runtime authority',
);
check(
  'local Valkey is loopback-only',
  devCompose.includes("'127.0.0.1:56379:6379'"),
  'developer coordination service must not bind publicly',
);
check(
  'node-redis dependency is exact',
  adapterPackage.dependencies?.redis === '6.3.0',
  'adapter dependency must be pinned',
);
check(
  'integration test proves 2 web + 2 worker replicas',
  integration.includes('const web1') &&
    integration.includes('const web2') &&
    integration.includes('const worker1') &&
    integration.includes('const worker2'),
  'Phase 06 exit gate requires four-replica concurrency coverage',
);
check(
  'integration test proves outage safety',
  integration.includes('redis://127.0.0.1:63991') &&
    integration.includes('durableBusinessTruth') &&
    integration.includes("status: 'unavailable'"),
  'Redis outage must not mutate durable authority',
);
check(
  'integration test proves rate limit, invalidation and fencing',
  integration.includes('rateLimit') &&
    integration.includes('invalidateTag') &&
    integration.includes('toBeGreaterThan(winner.fence)'),
  'Phase 06 exit gate requires distributed coordination behavior',
);
check(
  'wake-up remains best effort',
  contract.includes('wake-up outage => durable DB polling/recovery') &&
    adapter.includes('publishWakeup'),
  'Redis wake-up may accelerate durable work but may not own it',
);

if (failures.length > 0) {
  console.error('Jarvis Phase 06 coordination contract FAILED');
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.detail}`);
  }
  process.exit(1);
}

console.log(`Jarvis Phase 06 coordination contract PASS (${22 - failures.length}/22)`);
