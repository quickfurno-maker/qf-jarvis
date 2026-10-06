#!/usr/bin/env node
import { readFile } from "node:fs/promises";
const root = new URL("../../", import.meta.url);
const read=(p)=>readFile(new URL(p,root),"utf8");
const [contractText,docs,assurance,dbBudget,phase11,phase12,soak]=await Promise.all([
  read("contracts/qfj-phase18-load-chaos-v1.json"),
  read("deploy/phase18-load-soak-chaos.md"),
  read(".github/workflows/assurance-drills.yml"),
  read("scripts/scale/certify-db-connection-budget-postgres.mjs"),
  read("scripts/scale/validate-phase11-contract.mjs"),
  read("scripts/scale/validate-phase12-horizontal-workers.mjs"),
  read("scripts/scale/certify-phase18-soak.mjs")
]);
const c=JSON.parse(contractText); const checks=[]; const add=(n,v)=>checks.push([n,Boolean(v)]);
add("canonical Phase18 contract",c.contract==="qfj.phase18.cert.v1");
add("isolated safety boundary",c.safety.isolatedCertificationOnly && c.safety.productionLoadTestForbidden && !c.safety.newAgniAuthority);
add("provider failures are required",c.failureInjection.providerTimeout && c.failureInjection.providerRateLimit && c.failureInjection.jarvisUnavailable);
add("Redis loss fallback is required",c.failureInjection.redisUnavailable && c.auditScenarios.redisNotificationLossWithDurableWork && c.auditScenarios.adaptivePollingDuringRedisOutage);
add("N/N-1 compatibility required",c.auditScenarios.rollingNAndNMinus1);
add("at least ten idle workers required",c.auditScenarios.idleWorkersAtLeast>=10);
add("assurance drills exercise provider queue worker failures",assurance.includes("Exercise provider, queue and worker failure paths"));
add("connection budget is explicitly bounded",dbBudget.includes("applicationBudget") && dbBudget.includes("peakObservedApplicationBackends"));
add("cross-system contract remains signed/idempotent",phase11.toLowerCase().includes("idempot") || phase11.toLowerCase().includes("signed"));
add("horizontal worker validator retained",phase12.toLowerCase().includes("worker") && phase12.toLowerCase().includes("postgres"));
add("soak covers bounded pool and duplicate/reorder",soak.includes("peakDb") && soak.includes("massDuplicateReorderModeled"));
add("docs preserve QuickFurno business truth",docs.includes("QuickFurno business state") && docs.includes("PostgreSQL-backed"));
for(const [n,ok] of checks) console.log((ok?"PASS":"FAIL")+" "+n);
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){console.error("Jarvis Phase18 failed: "+failed.length);process.exit(1);}
console.log("Jarvis Phase18 contract PASS ("+checks.length+"/"+checks.length+")");
