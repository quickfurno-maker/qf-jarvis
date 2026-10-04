#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../../' + path, import.meta.url), 'utf8');
const [osOverlay, gatewayOverlay, workerOverlay, aarohiOverlay, workflow] = await Promise.all([
  read('deploy/jarvis-os/compose.registry.yml'),
  read('deploy/quickfurno-gateway/compose.registry.yml'),
  read('deploy/quickfurno-worker/compose.registry.yml'),
  read('deploy/aarohi-phase2/compose.registry.yml'),
  read('.github/workflows/scale-container-supply-chain.yml'),
]);

const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

add('Jarvis OS overlay requires immutable image reference', osOverlay.includes('JOS_IMAGE_REF:?'));
add(
  'gateway overlay requires immutable image reference',
  gatewayOverlay.includes('QFJ_GATEWAY_IMAGE_REF:?'),
);
add(
  'worker overlay requires immutable image reference',
  workerOverlay.includes('QFJ_WORKER_IMAGE_REF:?'),
);
add(
  'Aarohi reuses the exact worker digest reference',
  aarohiOverlay.includes('QFJ_WORKER_IMAGE_REF:?'),
);
add(
  'workflow binds PR certification to reviewed source head',
  workflow.includes('github.event.pull_request.head.sha || github.sha') &&
    workflow.includes('git rev-parse HEAD'),
);
add(
  'publication is guarded to main push or explicit manual proof',
  workflow.includes('workflow_dispatch:') &&
    workflow.includes('publish:') &&
    workflow.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'") &&
    workflow.includes("github.event_name == 'workflow_dispatch' && inputs.publish == true"),
);
add(
  'no mutable latest image tag is published',
  !workflow.match(/ghcr\.io\/[^\s"'\x60]+:latest\b/i) &&
    !workflow.match(/docker\s+tag[^\n]*:latest\b/i),
);
add(
  'three exact images are built once and transferred',
  workflow.includes('qfj-os-candidate') &&
    workflow.includes('qfj-gateway-candidate') &&
    workflow.includes('qfj-worker-candidate') &&
    workflow.includes('docker save') &&
    workflow.includes('actions/upload-artifact') &&
    workflow.includes('actions/download-artifact'),
);
add(
  'all published digests are signed',
  workflow.includes('qf-jarvis-os') &&
    workflow.includes('qf-jarvis-gateway') &&
    workflow.includes('qf-jarvis-worker') &&
    workflow.includes('cosign sign'),
);
add(
  'SBOM and provenance are part of the release contract',
  workflow.includes('spdx-json') &&
    workflow.includes('cosign attest') &&
    workflow.includes('actions/attest-build-provenance'),
);

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
if (failed.length) {
  console.error('Jarvis artifact contract failed: ' + failed.length + ' check(s)');
  process.exit(1);
}
console.log('Jarvis Phase 04 artifact contract PASS (' + checks.length + '/' + checks.length + ')');
