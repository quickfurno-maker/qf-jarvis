#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function text(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
const contract = JSON.parse(await text('../../contracts/qfj-phase20-launch-cert-v1.json'));
const doc = await text('../../docs/scale/phase-20-final-launch-certification.md');
const phase09 = await text('../../docs/scale/phase-09-connection-retention-lifecycle.md');
const budget = await text('./certify-db-connection-budget-postgres.mjs');
const phase12 = await text('./validate-phase12-horizontal-workers.mjs');
const container = await text('./validate-container-contract.mjs');
const pkg = JSON.parse(await text('../../package.json'));

const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push([name, true]);
  } catch (e) {
    checks.push([name, false, e instanceof Error ? e.message : String(e)]);
  }
};

check('canonical contract identity', () =>
  assert.equal(contract.contract, 'qfj.phase20.launch-cert.v1'),
);
check('Jarvis has no business authority', () =>
  assert.match(contract.authority.jarvis, /no_business_authority/),
);
check('launch does not require AWS/Kubernetes', () => {
  assert.equal(contract.launchTopology.awsRequired, false);
  assert.equal(contract.launchTopology.kubernetesRequired, false);
});
check('16-connection application ceiling locked', () => {
  assert.equal(contract.databaseGate.jarvisApplicationConnectionCeiling, 16);
  assert.match(phase09, /application pool budget: \*\*16\*\*/);
  assert.match(budget, /peak <= 16/);
  assert.match(budget, /2 gateway x3 \+ 2 worker x5/);
});
check('horizontal ownership gate retained', () => {
  assert.match(phase12, /scheduler|lane|replica/i);
  assert.equal(contract.schedulerGate.distributedOwnershipRequired, true);
});
check('container hardening validator retained', () => {
  assert.match(container, /non-root|read.only|capabil|privileg/i);
});
check('expand-contract rehearsal wired', () => {
  assert.equal(
    pkg.scripts['test:scale:phase20:expand-contract'],
    'node scripts/scale/certify-phase20-expand-contract-postgres.mjs',
  );
});
check('Phase 20 included in root check', () => {
  assert.match(pkg.scripts.check, /check:scale:phase20/);
});
check('production mutation forbidden', () => {
  assert.equal(contract.migrationGate.productionSchemaMutationAllowed, false);
  assert.match(doc, /synthetic|disposable/i);
});
check('future identity comes from signed Core contract', () =>
  assert.match(doc, /stable signed Core contracts/),
);

for (const p of [
  '../../contracts/qfj-scale-contract-v1.json',
  '../../contracts/qfj-observability-phase14-v1.json',
  '../../contracts/qfj-phase16-topology-v1.json',
  '../../contracts/qfj-phase17-dr-v1.json',
  '../../contracts/qfj-phase18-load-chaos-v1.json',
  '../../contracts/qfj-phase19-kubernetes-v1.json',
])
  await readFile(new URL(p, import.meta.url));

for (const [name, ok, detail] of checks)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log(`Jarvis Phase 20 final launch contract PASS (${checks.length}/${checks.length})`);
