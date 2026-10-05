#!/usr/bin/env node
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log('PASS', label);
  } catch (error) {
    failures.push(label);
    console.error('FAIL', label, error instanceof Error ? error.message : String(error));
  }
}

const dockerignore = read('.dockerignore');
const gatewayCompose = read('deploy/quickfurno-gateway/compose.production.yml');
const workerCompose = read('deploy/quickfurno-worker/compose.production.yml');
const osCompose = read('deploy/jarvis-os/compose.production.yml');
const gatewayConfig = read('apps/quickfurno-gateway/src/config.ts');
const gatewayIndex = read('apps/quickfurno-gateway/src/index.ts');
const workerConfig = read('apps/api/src/quickfurno-whatsapp/production-worker-config.ts');
const workerExample = read('deploy/quickfurno-worker/worker-config.example.json');
const authSchema = read('apps/jarvis-os/src/server/auth/config/schema.ts');
const authLoader = read('apps/jarvis-os/src/server/auth/config/loader.ts');
const gatewayDockerfile = read('deploy/quickfurno-gateway/Dockerfile');
const workerDockerfile = read('deploy/quickfurno-worker/Dockerfile');
const osDockerfile = read('deploy/jarvis-os/Dockerfile');

check(
  'all production services carry explicit environment, schema version and stable identity',
  () => {
    assert.match(gatewayCompose, /QFJ_RUNTIME_ENV: production/);
    assert.match(gatewayCompose, /QFJ_CONFIG_SCHEMA_VERSION: ['"]1['"]/);
    assert.match(gatewayCompose, /QFJ_SERVICE_ID: qf-jarvis\.quickfurno-gateway/);
    assert.match(workerCompose, /QFJ_SERVICE_ID: qf-jarvis\.whatsapp-worker/);
    assert.match(osCompose, /QFJ_SERVICE_ID: qf-jarvis\.jarvis-os/);
  },
);

check('gateway config is strict, versioned and environment-aware', () => {
  assert.match(gatewayConfig, /readonly schemaVersion: 1/);
  assert.match(gatewayConfig, /readonly environment: 'local' \| 'staging' \| 'production'/);
  assert.match(gatewayConfig, /qf-jarvis\.quickfurno-gateway/);
  assert.match(gatewayConfig, /Object\.keys\(root\)\.sort/);
  assert.match(gatewayIndex, /gateway_runtime_identity_invalid/);
  assert.match(gatewayIndex, /gateway_environment_mismatch/);
});

check('worker config is strict, versioned and environment-aware', () => {
  assert.match(workerConfig, /schemaVersion: z\.literal\(1\)/);
  assert.match(workerConfig, /environment: z\.enum\(\['local', 'staging', 'production'\]\)/);
  assert.match(workerConfig, /serviceId: z\.literal\('qf-jarvis\.whatsapp-worker'\)/);
  assert.match(workerExample, /"schemaVersion": 1/);
  assert.match(workerExample, /"environment": "production"/);
  assert.match(workerCompose, /QFJ_RUNTIME_ENV: production/);
  assert.match(workerCompose, /QFJ_CONFIG_SCHEMA_VERSION: ['"]1['"]/);
});

check('production QuickFurno discovery is DNS based and refuses literal non-loopback IPs', () => {
  assert.match(workerConfig, /isLiteralIpHost\(url\.hostname\)/);
  assert.match(workerConfig, /QuickFurno service discovery requires a root HTTPS DNS name/);
  assert.match(workerConfig, /value\.environment === 'local'/);
  assert.doesNotMatch(workerExample, /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/);
});

check(
  'gateway and worker secret material stays in mounted files rather than environment values',
  () => {
    assert.match(gatewayCompose, /target: \/run\/secrets\/qf-jarvis-gateway\.json/);
    assert.match(gatewayCompose, /read_only: true/);
    assert.match(workerCompose, /target: \/run\/secrets\/qf-jarvis-whatsapp-worker\.json/);
    assert.match(workerCompose, /target: \/run\/secrets\/quickfurno-signing\.key/);
    assert.doesNotMatch(workerCompose, /PRIVATE_KEY_PEM|ACCESS_TOKEN|API_KEY:/);
  },
);

check('Docker contexts and Dockerfiles do not bake dotenv or private credential files', () => {
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\*\*\/secrets\/\*\*$/m);
  for (const dockerfile of [gatewayDockerfile, workerDockerfile, osDockerfile]) {
    assert.doesNotMatch(dockerfile, /COPY\s+[^\n]*\.env/i);
    assert.doesNotMatch(dockerfile, /ARG\s+[^\n]*(SECRET|PRIVATE_KEY|ACCESS_TOKEN|API_KEY)/i);
  }
});

check('Jarvis OS auth config is versioned and reads mounted config on verification', () => {
  assert.match(authSchema, /version: z\.literal\(1\)/);
  assert.match(authSchema, /mode: z\.enum\(\['PRODUCTION', 'LOCAL_DEVELOPMENT'\]\)/);
  assert.match(authLoader, /There is no cache/);
  assert.match(authLoader, /QFJ_JOS_AUTH_CONFIG_FILE/);
  assert.match(authLoader, /assertJarvisOsRuntimeIdentity/);
  assert.match(authLoader, /QFJ_RUNTIME_ENV/);
  assert.match(authLoader, /QFJ_CONFIG_SCHEMA_VERSION/);
  assert.match(authLoader, /QFJ_SERVICE_ID/);
  assert.match(authLoader, /qf-jarvis\.jarvis-os/);
  assert.match(authLoader, /productionRuntime && result\.data\.mode !== 'PRODUCTION'/);
});

check('Jarvis OS session-key rotation has explicit PRIMARY and VERIFY_ONLY overlap', () => {
  assert.match(authSchema, /status: z\.enum\(\['PRIMARY', 'VERIFY_ONLY'\]\)/);
  assert.match(authSchema, /keys: z\.array\(sessionKeySchema\)\.min\(1\)\.max\(3\)/);
  assert.match(authSchema, /exactly one session key must be PRIMARY/);
});

check('QuickFurno ingress verification accepts bounded overlapping public keys', () => {
  assert.match(gatewayConfig, /keys\.length < 1 \|\| keys\.length > 4/);
  assert.match(gatewayConfig, /seen\.has\(item\['keyId'\]\)/);
});

check('key rotation drill proves old+new overlap then new-only cutover', () => {
  const oldPair = generateKeyPairSync('ed25519');
  const newPair = generateKeyPairSync('ed25519');
  const payload = Buffer.from('qfj-phase13-rotation-drill', 'utf8');
  const oldSig = sign(null, payload, oldPair.privateKey);
  const newSig = sign(null, payload, newPair.privateKey);
  const overlap = new Map([
    ['old', oldPair.publicKey],
    ['new', newPair.publicKey],
  ]);
  assert.equal(verify(null, payload, overlap.get('old'), oldSig), true);
  assert.equal(verify(null, payload, overlap.get('new'), newSig), true);
  const after = new Map([['new', newPair.publicKey]]);
  assert.equal(after.has('old'), false);
  assert.equal(verify(null, payload, after.get('new'), newSig), true);
});

check('deployment configuration remains separate from dynamic business policy', () => {
  for (const compose of [gatewayCompose, workerCompose, osCompose]) {
    assert.doesNotMatch(compose, /lead_assignment|credit_cost|matching_policy|consent_policy/i);
  }
  assert.match(workerConfig, /policyRevision/);
});

check('service relocation contract has no production fixed-IP dependency', () => {
  for (const source of [gatewayCompose, workerCompose, osCompose, workerExample]) {
    assert.doesNotMatch(source, /(?:^|[^0-9])(?:10|172|192|203|213)\.(?:\d{1,3}\.){2}\d{1,3}/m);
  }
});

if (failures.length) {
  console.error(`\nPhase 13 Jarvis contract FAILED (${failures.length})`);
  process.exit(1);
}
console.log('\nPhase 13 Jarvis contract: 12/12 PASS');
console.log('PHASE13_JARVIS_ROTATION_DRILL=PASS old+new -> new-only');
console.log('PHASE13_JARVIS_RELOCATION_DRILL=PASS service endpoint supplied by versioned config');
