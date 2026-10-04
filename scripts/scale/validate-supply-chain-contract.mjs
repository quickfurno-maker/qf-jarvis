#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = (p) => readFile(path.join(root, p), 'utf8');

const [workflow, osCompose, gatewayCompose, workerCompose, aarohiCompose] = await Promise.all([
  read('.github/workflows/oci-supply-chain.yml'),
  read('deploy/jarvis-os/compose.production.yml'),
  read('deploy/quickfurno-gateway/compose.production.yml'),
  read('deploy/quickfurno-worker/compose.production.yml'),
  read('deploy/aarohi-phase2/compose.production.yml'),
]);

const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

add('GHCR is the OCI registry', workflow.includes('ghcr.io/'));
add(
  'Buildx action is pinned',
  workflow.includes('docker/setup-buildx-action@e468171a9de216ec08956ac3ada2f0791b6bd435'),
);
add(
  'unprivileged build job exists',
  workflow.includes('build-certify:') && workflow.includes('permissions:\n      contents: read'),
);
add(
  'separate privileged publish job exists',
  workflow.includes('packages: write') &&
    workflow.includes('id-token: write') &&
    workflow.includes('attestations: write'),
);
add(
  'three canonical image families are built',
  workflow.includes('qfj-os-candidate') &&
    workflow.includes('qfj-gateway-candidate') &&
    workflow.includes('qfj-worker-candidate'),
);
add('Aarohi reuses shared worker image family', aarohiCompose.includes('QFJ_WORKER_IMAGE_REF'));
add(
  'build-once artifact handoff exists',
  workflow.includes('docker save') &&
    workflow.includes('docker load') &&
    workflow.includes('download-artifact'),
);
add(
  'Trivy vulnerability gates are pinned',
  (workflow.match(/aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25/gu) ?? [])
    .length >= 6,
);
add(
  'CycloneDX SBOMs cover all image families',
  workflow.includes('qfj-os-sbom.cdx.json') &&
    workflow.includes('qfj-gateway-sbom.cdx.json') &&
    workflow.includes('qfj-worker-sbom.cdx.json'),
);
add(
  'Cosign is pinned',
  workflow.includes('sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6'),
);
add(
  'all three digests are keyless-signed',
  (workflow.match(/cosign sign --yes/gu) ?? []).length >= 3,
);
add(
  'manual publish is restricted to main',
  workflow.includes('manual publish is allowed only from main') &&
    workflow.includes('"\${REF_NAME}" != "main"'),
);
add(
  'CycloneDX SBOMs are cryptographically attested',
  (workflow.match(/cosign attest --yes --type cyclonedx/gu) ?? []).length >= 3 &&
    workflow.includes('cosign verify-attestation') &&
    workflow.includes('--type cyclonedx'),
);
add(
  'all three digests receive provenance',
  (
    workflow.match(/actions\/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8/gu) ??
    []
  ).length >= 3,
);
add('no latest release authority', !workflow.match(/(?:image:|tag:|docker tag).*:latest\b/iu));
add(
  'Jarvis OS compose uses immutable ref',
  osCompose.includes('QFJ_OS_IMAGE_REF') && !osCompose.includes('JOS_IMAGE_TAG'),
);
add(
  'gateway compose uses immutable ref',
  gatewayCompose.includes('QFJ_GATEWAY_IMAGE_REF') &&
    !gatewayCompose.includes('QFJ_GATEWAY_IMAGE_TAG'),
);
add(
  'worker compose uses immutable ref',
  workerCompose.includes('QFJ_WORKER_IMAGE_REF') && !workerCompose.includes('QFJ_WORKER_IMAGE_TAG'),
);
add(
  'Aarohi compose uses same immutable worker ref',
  aarohiCompose.includes('QFJ_WORKER_IMAGE_REF') && !aarohiCompose.includes('QFJ_WORKER_IMAGE_TAG'),
);

const workflowDir = path.join(root, '.github', 'workflows');
const files = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/iu.test(name));
const floating = [];
for (const file of files) {
  const body = await read(path.join('.github', 'workflows', file));
  for (const match of body.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const ref = match[1];
    if (ref.startsWith('./')) continue;
    const at = ref.lastIndexOf('@');
    if (at < 1) {
      floating.push(`${file}:${ref}`);
      continue;
    }
    const version = ref.slice(at + 1);
    if (!/^[0-9a-f]{40}$/u.test(version)) floating.push(`${file}:${ref}`);
  }
}
add('all external GitHub Actions are pinned to immutable commits', floating.length === 0);

for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (floating.length) {
  console.error('Floating action refs:');
  for (const item of floating) console.error(`- ${item}`);
}
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(`Jarvis supply-chain contract failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log(`Jarvis supply-chain contract PASS (${checks.length}/${checks.length})`);
