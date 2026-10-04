#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL('../../' + path, import.meta.url), 'utf8');

const [
  josDocker,
  josCompose,
  gatewayDocker,
  gatewayCompose,
  workerDocker,
  workerCompose,
  aarohiCompose,
  workerConfig,
  spool,
  ciWorkflow,
] = await Promise.all([
  read('deploy/jarvis-os/Dockerfile'),
  read('deploy/jarvis-os/compose.production.yml'),
  read('deploy/quickfurno-gateway/Dockerfile'),
  read('deploy/quickfurno-gateway/compose.production.yml'),
  read('deploy/quickfurno-worker/Dockerfile'),
  read('deploy/quickfurno-worker/compose.production.yml'),
  read('deploy/aarohi-phase2/compose.production.yml'),
  read('apps/api/src/quickfurno-whatsapp/production-worker-config.ts'),
  read('apps/quickfurno-gateway/src/durable-turn-spool.ts'),
  read('.github/workflows/ci.yml'),
]);

const digest = 'sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d';
const checks = [];

const add = (name, ok) => checks.push([name, Boolean(ok)]);
const occurrences = (text, pattern) => (text.match(pattern) ?? []).length;

for (const [name, dockerfile] of [
  ['jarvis-os', josDocker],
  ['gateway', gatewayDocker],
  ['worker', workerDocker],
]) {
  add(name + ' base image pinned by digest', dockerfile.includes(digest));
  add(name + ' exact revision OCI label', dockerfile.includes('org.opencontainers.image.revision'));
  add(name + ' non-root runtime', /USER\s+1000[123](?::1000[1232])?/u.test(dockerfile));
  add(name + ' runtime npm removed', dockerfile.includes('/usr/local/bin/npm'));
}

for (const [name, compose] of [
  ['jarvis-os', josCompose],
  ['gateway', gatewayCompose],
  ['worker', workerCompose],
  ['aarohi', aarohiCompose],
]) {
  add(name + ' read-only rootfs', compose.includes('read_only: true'));
  add(name + ' no-new-privileges', compose.includes('no-new-privileges:true'));
  add(
    name + ' drops all Linux capabilities',
    compose.includes('cap_drop:') && compose.includes('ALL'),
  );
  add(name + ' bounded resources', compose.includes('resources:') && compose.includes('limits:'));
  add(name + ' bounded logs', compose.includes('max-size:') && compose.includes('max-file:'));
}

add('jarvis-os liveness exists', josDocker.includes('HEALTHCHECK'));
add('gateway liveness exists', gatewayDocker.includes('HEALTHCHECK'));
add('gateway stays private by default', gatewayCompose.includes("traefik.enable: 'false'"));
add(
  'worker stays private',
  workerCompose.includes("traefik.enable: 'false'") && !workerCompose.includes('ports:'),
);
add(
  'worker durable turn spool remains explicit writable state',
  workerCompose.includes('/var/lib/qfj-turns') && workerCompose.includes('read_only: false'),
);
add(
  'gateway durable turn spool remains explicit writable state',
  gatewayCompose.includes('/var/lib/qfj-turns') && gatewayCompose.includes('read_only: false'),
);

add(
  'SINGLE_OWNER safety lock preserved',
  workerConfig.includes("deploymentMode: z.literal('SINGLE_OWNER')") &&
    workerConfig.includes("readonly deploymentMode: 'SINGLE_OWNER'"),
);
add(
  'filesystem spool remains explicitly classified',
  spool.includes('createFileDurableTurnSpool') && spool.includes('rename(from, to)'),
);

add(
  'Aarohi reuses certified worker artifact',
  aarohiCompose.includes("image: 'qf-jarvis-whatsapp-worker:") &&
    aarohiCompose.includes('QFJ_WORKER_IMAGE_TAG'),
);
add(
  'Aarohi role selected by explicit command',
  aarohiCompose.includes('run-aarohi-phase2-worker.js') &&
    aarohiCompose.includes('/run/secrets/aarohi-phase2-worker.json'),
);
add('Aarohi requires explicit profile', aarohiCompose.includes("profiles: ['aarohi-phase2']"));
add(
  'Aarohi does not restart a deliberately disabled process',
  aarohiCompose.includes('restart: on-failure:5'),
);
add(
  'Aarohi has no ingress or public ports',
  aarohiCompose.includes("traefik.enable: 'false'") && !aarohiCompose.includes('ports:'),
);
add(
  'Aarohi config and signing key are read-only mounts',
  aarohiCompose.includes('/run/secrets/aarohi-phase2-worker.json') &&
    aarohiCompose.includes('/run/secrets/quickfurno-signing.key') &&
    occurrences(aarohiCompose, /read_only: true/gu) >= 3,
);
add(
  'CI certifies the actual PR source head, not the synthetic merge SHA',
  ciWorkflow.includes('QFJ_CERT_SHA: ${{ github.event.pull_request.head.sha || github.sha }}') &&
    ciWorkflow.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}') &&
    !ciWorkflow.includes('GIT_SHA="${GITHUB_SHA}"'),
);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  process.stdout.write((ok ? 'PASS ' : 'FAIL ') + name + '\n');
}
if (failed.length > 0) {
  process.stderr.write(
    'Jarvis container contract failed: ' + String(failed.length) + ' check(s)\n',
  );
  process.exit(1);
}
process.stdout.write(
  'Jarvis container contract PASS (' + String(checks.length) + '/' + String(checks.length) + ')\n',
);
