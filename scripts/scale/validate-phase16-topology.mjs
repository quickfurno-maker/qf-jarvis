#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const [contractText, jos, gateway, worker, docs] = await Promise.all([
  read('contracts/qfj-phase16-topology-v1.json'),
  read('deploy/jarvis-os/compose.production.yml'),
  read('deploy/quickfurno-gateway/compose.production.yml'),
  read('deploy/quickfurno-worker/compose.production.yml'),
  read('deploy/phase16/README.md'),
]);
const c = JSON.parse(contractText);
const checks = [];
const add = (n, v) => checks.push([n, Boolean(v)]);

add('canonical Phase16 contract', c.contract === 'qfj.topology.phase16.v1');
add(
  'QuickFurno dedicated failure domain',
  c.currentPhysicalPlacement.quickfurno.placement === 'DEDICATED_VPS',
);
add(
  'Jarvis + AGNI larger-VPS placement locked',
  c.currentPhysicalPlacement.jarvisAgni.placement === 'SHARED_LARGER_VPS',
);
add('Jarvis remains multi-host ready', c.jarvis.multiHostReady === true);
add(
  'Jarvis failure domain stays separate from QuickFurno',
  c.jarvis.quickfurnoFailureDomainSeparated === true,
);
add(
  'business truth stays PostgreSQL/Supabase',
  c.authority.businessTruth === 'POSTGRESQL_SUPABASE',
);
add(
  'Jarvis OS has resource limits and no Docker socket',
  jos.includes('resources:') && jos.includes('memory: 1g') && !jos.includes('/var/run/docker.sock'),
);
add(
  'gateway has bounded resources and durable PostgreSQL turn store',
  gateway.includes('QFJ_GATEWAY_TURN_STORE: POSTGRES') &&
    gateway.includes('resources:') &&
    !gateway.includes('/var/run/docker.sock'),
);
add(
  'worker deployment remains resource bounded',
  worker.includes('resources:') && worker.includes('read_only: true'),
);
add(
  'host-local observation state is documented non-authoritative',
  docs.includes('non-authoritative operational snapshots only') &&
    docs.includes('correctness cannot depend on local observation files'),
);
add(
  'shared-host logical isolation is mandatory',
  c.logicalIsolation.separateContainers &&
    c.logicalIsolation.separateResourceLimits &&
    c.logicalIsolation.separateCredentialsAndSecrets &&
    c.logicalIsolation.separateReleaseManifests,
);
add(
  'no production cutover or authority expansion',
  c.phase16Safety.productionTrafficCutover === false &&
    c.phase16Safety.newProductionAuthority === false &&
    c.phase16Safety.productionDatabaseMigration === false,
);

for (const [n, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + ' ' + n);
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Jarvis Phase16 contract failed: ' + failed.length + ' check(s)');
  process.exit(1);
}
console.log('Jarvis Phase16 contract PASS (' + checks.length + '/' + checks.length + ')');
