#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const [contractText, docs, gateway, worker, phase15, phase16] = await Promise.all([
  read('contracts/qfj-phase17-dr-v1.json'),
  read('deploy/phase17/README.md'),
  read('deploy/quickfurno-gateway/compose.production.yml'),
  read('deploy/quickfurno-worker/compose.production.yml'),
  read('scripts/scale/validate-phase15-cicd.mjs'),
  read('scripts/scale/validate-phase16-topology.mjs'),
]);
const c = JSON.parse(contractText);
const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

add('canonical Phase17 DR contract', c.contract === 'qfj.dr.phase17.v1');
add(
  'single write region remains locked',
  c.strategy.authoritativeWriteRegions === 1 &&
    c.strategy.activeActiveTransactionalWrites === false,
);
add(
  'database RPO/RTO policy matches canonical target',
  c.postgres.productionTransactionRpoSeconds === 120 &&
    c.postgres.productionTransactionRtoSeconds === 3600,
);
add(
  'logical backup remains provider independent',
  c.postgres.logicalBackupOffsiteRequired === true && c.postgres.logicalBackupRetentionDays >= 30,
);
add(
  'future replication slots are recreated rather than assumed durable',
  c.postgres.replicationSlotsRecreatedAfterRestore === true &&
    c.postgres.walRetentionAndSlotLagMustBeMonitoredBeforeCdc === true,
);
add(
  'host-local config is non-authoritative',
  c.sourceAndConfig.hostLocalConfigAuthoritative === false,
);
add(
  'Jarvis recovery uses immutable signed images',
  c.images.immutableDigestRequired === true &&
    c.images.signatureVerificationRequired === true &&
    c.images.minimumRetainedSignedReleases >= 10,
);
add(
  'plaintext secret backup is forbidden',
  c.secrets.plaintextBackupForbidden === true &&
    c.secrets.valuesMustBeReissuedOrRotatedDuringRecovery === true,
);
add(
  'gateway keeps PostgreSQL durable turn store',
  gateway.includes('QFJ_GATEWAY_TURN_STORE: POSTGRES') && !gateway.includes('/var/run/docker.sock'),
);
add(
  'worker remains bounded and read-only',
  worker.includes('read_only: true') && worker.includes('resources:'),
);
add(
  'runbook classifies observations as non-authoritative',
  docs.includes(
    'Host-local observations must never be used as a disaster-recovery source of truth.',
  ),
);
add(
  'runbook restores QuickFurno before Jarvis',
  docs.includes('Restore and validate QuickFurno Core.') && docs.includes('Restore AGNI last.'),
);
add(
  'runbook requires exact signed Jarvis digests',
  docs.includes('exact signed Jarvis OS, gateway and worker digests'),
);
add(
  'Phase17 has no production mutation',
  c.phase17Safety.productionRestore === false &&
    c.phase17Safety.productionDatabaseMutation === false &&
    c.phase17Safety.productionTrafficCutover === false &&
    c.phase17Safety.productionSecretRotation === false &&
    c.phase17Safety.newAgniAuthority === false,
);
add(
  'Phase15 immutable controls remain present',
  phase15.includes('all three exact digests share one signed Phase 15 release manifest'),
);
add(
  'Phase16 failure-domain separation remains present',
  phase16.includes('Jarvis failure domain stays separate from QuickFurno'),
);

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Jarvis Phase17 DR contract failed: ' + failed.length + ' check(s)');
  process.exit(1);
}
console.log('Jarvis Phase17 DR contract PASS (' + checks.length + '/' + checks.length + ')');
