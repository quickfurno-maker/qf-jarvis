#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [
  supply,
  promote,
  rollback,
  reconcile,
  controller,
  slot,
  switcher,
  wrapper,
  bootstrap,
  schema,
  docs,
  workerDisable,
  workerActivate,
] = await Promise.all([
  read('.github/workflows/scale-container-supply-chain.yml'),
  read('.github/workflows/phase15-promote.yml'),
  read('.github/workflows/phase15-rollback.yml'),
  read('.github/workflows/phase15-reconcile-bootstrap.yml'),
  read('deploy/phase15/release.sh'),
  read('deploy/phase15/compose.jarvis-os-slot.yml'),
  read('deploy/phase15/qfj-phase15-switch'),
  read('deploy/phase15/qfj-phase15-release.wrapper'),
  read('deploy/phase15/bootstrap-production-host.sh'),
  read('contracts/qf-release-phase15-v1.schema.json'),
  read('docs/operations/phase15-immutable-cicd-bluegreen.md'),
  read('deploy/quickfurno-worker/disable.sh'),
  read('deploy/quickfurno-worker/activate.sh'),
]);

const workflowNames = (await readdir(new URL('.github/workflows/', root))).filter((x) =>
  /\.ya?ml$/u.test(x),
);
const workflowTexts = await Promise.all(
  workflowNames.map(async (x) => [x, await read('.github/workflows/' + x)]),
);
const mutableActions = [];
for (const [name, text] of workflowTexts) {
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*uses:\s*([^\s]+)@([^\s#]+)/u);
    if (match && !match[1].startsWith('./') && !/^[a-f0-9]{40}$/u.test(match[2])) {
      mutableActions.push(name + ': ' + line.trim());
    }
  }
}

const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

add('all GitHub Actions are commit-SHA pinned', mutableActions.length === 0);
add(
  'manual publication is restricted to main',
  supply.includes(
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.publish == true",
  ),
);
add(
  'all three exact digests share one signed Phase 15 release manifest',
  supply.includes('--system JARVIS') &&
    supply.includes('jarvis-os=$OS_IMAGE@$OS_DIGEST') &&
    supply.includes('jarvis-gateway=$GATEWAY_IMAGE@$GATEWAY_DIGEST') &&
    supply.includes('jarvis-worker=$WORKER_IMAGE@$WORKER_DIGEST') &&
    supply.includes('https://quickfurno.in/attestations/qf.release.phase15.v1'),
);
add(
  'SBOM, signature and GitHub provenance cover all three images',
  supply.match(/cosign sign --yes/g)?.length === 3 &&
    supply.match(/--type spdxjson/g)?.length >= 6 &&
    supply.match(/actions\/attest-build-provenance@/g)?.length === 3,
);
add(
  'promotion verifies all three refs and one manifest binds the digest set',
  promote.includes('for REF in "$OS_REF" "$GATEWAY_REF" "$WORKER_REF"') &&
    promote.includes('--arg os "$OS_REF"') &&
    promote.includes('--arg gateway "$GATEWAY_REF"') &&
    promote.includes('--arg worker "$WORKER_REF"') &&
    promote.includes('.role == "jarvis-os"') &&
    promote.includes('.role == "jarvis-gateway"') &&
    promote.includes('.role == "jarvis-worker"') &&
    promote.includes('--system JARVIS --promotable'),
);
add(
  'production apply is protected by cutover flag, environment approval and typed phrase',
  promote.includes("vars.PHASE15_PRODUCTION_CUTOVER_ENABLED == 'true'") &&
    promote.includes('environment: production') &&
    promote.includes('PROMOTE_EXACT_JARVIS_DIGESTS'),
);
add(
  'Jarvis OS inactive slot is private, loopback-only and health-proven before switch',
  slot.includes("traefik.enable: 'false'") &&
    slot.includes('127.0.0.1:${QFJ_PHASE15_HOST_PORT') &&
    controller.includes('blue) host_port=3201') &&
    controller.includes('green) host_port=3202') &&
    controller.includes('QFJ_PHASE15_HOST_PORT="$host_port"') &&
    controller.indexOf('wait_os "$target" "$STAGED_MANIFEST"') <
      controller.indexOf('switch_traffic "$target" "$STAGED_MANIFEST"'),
);
add(
  'Traefik switch is atomic, Cloudflare-only and release-identity proven',
  switcher.includes('--providers.file.directory=/dynamic') &&
    switcher.includes('127.0.0.1:$HOST_PORT') &&
    switcher.includes('qf-jarvis-phase15-cloudflare') &&
    switcher.includes('X-QFJ-Release') &&
    switcher.includes('EXPECTED_HEADER="x-qfj-release: $SOURCE_SHA"') &&
    switcher.includes('restore') &&
    switcher.includes('public route did not converge to requested Jarvis release'),
);
add(
  'Jarvis host bootstrap preserves traffic and enables watched dynamic routing without image drift',
  bootstrap.includes('TRAFFIC_UNCHANGED router=legacy-docker-provider') &&
    bootstrap.includes('--providers.file.directory=/dynamic') &&
    bootstrap.includes('--providers.file.watch=true') &&
    bootstrap.includes('BEFORE_IMAGE=') &&
    bootstrap.includes('AFTER_IMAGE=') &&
    bootstrap.includes('Traefik image changed during bootstrap') &&
    bootstrap.includes('/usr/local/sbin/qfj-phase15-switch') &&
    bootstrap.includes('QFJ_PHASE15_BOOTSTRAP_READY') &&
    !bootstrap.includes('docker pull traefik'),
);
add(
  'bootstrap reconcile is fail-closed and restores legacy routing before slot cleanup',
  controller.includes('reconcile-bootstrap) reconcile_bootstrap') &&
    controller.includes('bootstrap reconcile requires null release state') &&
    controller.includes('legacy_runtime_healthy') &&
    controller.includes('bootstrap-reconcile-route.yml') &&
    controller.includes("grep -qi '^x-qfj-release:'") &&
    controller.includes('legacy route did not recover; Phase-15 route restored') &&
    controller.includes('docker stop qf-jarvis-os-blue qf-jarvis-os-green') &&
    controller.includes('QFJ_PHASE15_BOOTSTRAP_RECONCILED route=legacy state=null'),
);
add(
  'bootstrap reconciliation is human gated through the production deployer',
  reconcile.includes('workflow_dispatch:') &&
    reconcile.includes('RECONCILE_FAILED_JARVIS_BOOTSTRAP') &&
    reconcile.includes('environment: production') &&
    reconcile.includes('runs-on: [self-hosted, Linux, X64, qfj-phase15-deployer]') &&
    reconcile.includes('sudo -n /usr/local/sbin/qfj-phase15-release reconcile-bootstrap') &&
    reconcile.includes('group: qf-jarvis-phase15-production'),
);
add(
  'durable consumers are rolling, not dual-active blue/green',
  controller.includes(
    'Stateful/durable consumers deliberately do NOT run blue/green concurrently',
  ) &&
    controller.includes('roll_gateway "$STAGED_MANIFEST"') &&
    controller.includes('roll_worker_disabled "$STAGED_MANIFEST"'),
);
add(
  'Phase 15 preserves Phase 14 observability on gateway and worker replacements',
  controller.includes('GATEWAY_INGRESS="$ROOT/deploy/quickfurno-gateway/compose.ingress.yml"') &&
    controller.includes('-f "$GATEWAY_INGRESS"') &&
    controller.includes(
      'GATEWAY_OBSERVABILITY="$ROOT/deploy/quickfurno-gateway/compose.observability.yml"',
    ) &&
    controller.includes('-f "$GATEWAY_OBSERVABILITY"') &&
    controller.includes(
      'WORKER_OBSERVABILITY="$ROOT/deploy/quickfurno-worker/compose.observability.yml"',
    ) &&
    controller.includes('-f "$WORKER_OBSERVABILITY"'),
);
add(
  'worker replacement reuses existing disable and evidence-gated activation authority',
  controller.includes('WORKER_DISABLE="$ROOT/deploy/quickfurno-worker/disable.sh"') &&
    controller.includes('WORKER_ACTIVATE="$ROOT/deploy/quickfurno-worker/activate.sh"') &&
    workerDisable.includes('DISABLE_MODEL') &&
    workerActivate.includes('qfj-whatsapp-worker READY'),
);
add(
  'rollback restores previous exact manifest and reuses rolling compatibility',
  rollback.includes('ROLLBACK_TO_PREVIOUS_SIGNED_JARVIS_RELEASE') &&
    controller.includes('roll_gateway "$PREVIOUS_MANIFEST"') &&
    controller.includes('roll_worker_disabled "$PREVIOUS_MANIFEST"') &&
    controller.includes('switch_traffic "$previous" "$PREVIOUS_MANIFEST"'),
);
add(
  'mixed-generation promotion failure self-heals to the current runtime',
  controller.includes('QFJ_PHASE15_CONSUMER_PROMOTION_FAILED') &&
    controller.includes('restore_runtime "$active" "$CURRENT_MANIFEST" || true'),
);
add(
  'rollback smoke or activation failure restores current runtime',
  controller.includes('QFJ_PHASE15_ROLLBACK_SMOKE_FAILED') &&
    controller.includes('QFJ_PHASE15_ROLLBACK_WORKER_ACTIVATION_FAILED') &&
    controller.includes('restore_runtime "$active" "$CURRENT_MANIFEST" || true'),
);
add(
  'release controller has no database migration path',
  !controller.match(/db:migrate|supabase\s+db|prisma\s+migrate/iu) &&
    supply.includes('--db-policy SOURCE_ONLY'),
);
add(
  'release contract forbids automatic production apply',
  schema.includes('"requireHumanApproval": { "const": true }') &&
    schema.includes('"automaticProductionApply": { "const": false }'),
);
add(
  'root wrapper refuses mutable release-control code and exposes only governed commands',
  wrapper.includes("CONTROL_ROOT='/srv/qf-jarvis/release-control'") &&
    wrapper.includes('must be root-owned') &&
    wrapper.includes('group/world writable') &&
    wrapper.includes('stage|promote|rollback|reconcile-bootstrap|status'),
);
add(
  'AGNI/OpenAI have no deployment-host authority',
  docs.includes(
    'AGNI and OpenAI receive no deployment-host credential or arbitrary shell authority',
  ),
);

if (mutableActions.length) {
  console.error('Mutable action references:');
  for (const item of mutableActions) console.error('  ' + item);
}
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
if (failed.length) {
  console.error('Jarvis Scale Phase 15 contract failed: ' + failed.length + ' check(s)');
  process.exit(1);
}
console.log('Jarvis Scale Phase 15 contract PASS (' + checks.length + '/' + checks.length + ')');
