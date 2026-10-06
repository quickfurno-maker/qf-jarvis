#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const read = async (p) => readFile(new URL(p, root), 'utf8');
const c = JSON.parse(await read('contracts/qfj-phase20-final-launch-v1.json'));
const doc = await read('docs/scale/phase-20-final-launch-certification.md');
const budget = await read('scripts/scale/certify-db-connection-budget-postgres.mjs');
const p18 = await read('scripts/scale/validate-phase18-load-chaos.mjs');
const p19 = await read('scripts/scale/validate-phase19-kubernetes.mjs');
const workflow = await read('.github/workflows/phase20-final-launch.yml');
const checks = [];
const check = (n, f) => {
  try {
    assert.ok(f());
    checks.push([n, true]);
  } catch (e) {
    checks.push([n, false, e.message]);
  }
};
check(
  'canonical Phase20 contract',
  () => c.schema === 'qfj.phase20.final-launch.v1' && c.version === 1,
);
check(
  'no AWS/Kubernetes launch dependency',
  () =>
    !c.productionPolicy.awsRequiredAtLaunch &&
    !c.productionPolicy.kubernetesRequiredAtLaunch &&
    !c.productionPolicy.productionKubernetesAllowedByThisPhase,
);
check(
  'no production DB mutation',
  () => c.productionPolicy.productionDatabaseMutationAllowedByThisPhase === false,
);
check(
  'Jarvis connection budget is 16',
  () =>
    c.databaseBudgetGate.jarvis.applicationConnectionBudget === 16 &&
    c.databaseBudgetGate.jarvis.gatewayPoolMaxEach === 3 &&
    c.databaseBudgetGate.jarvis.workerPoolMaxEach === 5,
);
check(
  'real budget cert models 2x3 plus 2x5',
  () =>
    budget.includes("{ name: 'qfj-p09-gateway-1', max: 3 }") &&
    budget.includes("{ name: 'qfj-p09-worker-2', max: 5 }") &&
    budget.includes('peak <= 16'),
);
check(
  'Phase18 bounded load evidence stays required',
  () => c.finalEvidenceGate.phase18LoadSoakChaosEvidenceRequired && p18.includes('Phase18'),
);
check(
  'Phase19 Kubernetes evidence stays required',
  () =>
    c.finalEvidenceGate.phase19KubernetesEvidenceRequired &&
    p19.includes('no production Kubernetes operation'),
);
check(
  'migration rehearsal is disposable',
  () =>
    c.migrationGate.rehearsalDatabase === 'disposable-postgresql' &&
    !c.migrationGate.productionMutation,
);
check('Jarvis authority remains orchestration only', () =>
  doc.includes('never QuickFurno business authority'),
);
check('focused CI reruns DB budget', () =>
  workflow.includes('certify-db-connection-budget-postgres.mjs'),
);
check('focused CI rehearses expand-contract', () =>
  workflow.includes('certify-phase20-expand-contract-postgres.mjs'),
);
check(
  'post-merge full CI and supply chain mandatory',
  () =>
    c.finalEvidenceGate.postMergeFullCiRequired && c.finalEvidenceGate.postMergeSupplyChainRequired,
);
for (const [n, ok, d] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? `: ${d}` : ''}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log(`Jarvis Phase20 final launch contract PASS (${checks.length}/${checks.length})`);
