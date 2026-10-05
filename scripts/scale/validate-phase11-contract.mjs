import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const contract = JSON.parse(read('contracts/qfj-scale-contract-v1.json'));
const scaleContract = read('packages/cross-system-scale-contract/src/contract.ts');
const isolation = read('packages/cross-system-scale-contract/src/isolation.ts');
const nodeHttp = read('packages/cross-system-scale-contract/src/node-http.ts');
const coreTransport = read('packages/core-decision-http-transport/src/transport.ts');
const workerHttp = read('apps/api/src/quickfurno-whatsapp/quickfurno-http.ts');
const productionNetwork = read('apps/api/src/quickfurno-whatsapp/production-network.ts');
const gateway = read('apps/quickfurno-gateway/src/server.ts');
const riyaIngress = read('apps/api/src/private-riya-web-ingress/create-handler.ts');
const osRead = read(
  'apps/jarvis-os/src/server/control-plane/sources/quickfurno-operator-source.ts',
);
const osCommand = read('apps/jarvis-os/src/server/operator/quickfurno-command.ts');

const checks = [];
function check(name, fn) {
  fn();
  checks.push(name);
  console.log('PASS ' + name);
}

check('canonical version and coexistence window are locked', () => {
  assert.equal(contract.protocol, 'qfj.scale.http');
  assert.equal(contract.version, 1);
  assert.deepEqual(contract.acceptedVersions, [0, 1]);
  assert.equal(contract.legacyRemovalNotBefore, '2027-01-05T00:00:00Z');
  assert.match(scaleContract, /QFJ_SCALE_LEGACY_REMOVAL_NOT_BEFORE = '2027-01-05T00:00:00Z'/);
});

check('request metadata and error vocabulary are complete', () => {
  for (const name of [
    'version',
    'requestId',
    'idempotencyKey',
    'correlationId',
    'traceId',
    'actor',
    'expectedRevision',
    'deadlineAt',
    'signature',
    'keyId',
  ])
    assert.equal(typeof contract.requestHeaders[name], 'string');
  for (const name of [
    'QFJ_CONTRACT_INVALID',
    'QFJ_AUTHENTICATION_FAILED',
    'QFJ_DEADLINE_EXCEEDED',
    'QFJ_BACKPRESSURE',
    'QFJ_CIRCUIT_OPEN',
    'QFJ_UPSTREAM_TIMEOUT',
    'QFJ_UPSTREAM_UNAVAILABLE',
  ])
    assert.equal(typeof contract.errors[name], 'boolean');
});

check('resilience budget is fail-fast, queue-free, and retry-free', () => {
  assert.equal(contract.resilience.defaultTimeoutMs, 2500);
  assert.equal(contract.resilience.maxTimeoutMs, 5000);
  assert.equal(contract.resilience.maxConcurrentPerProcess, 8);
  assert.equal(contract.resilience.maxQueued, 0);
  assert.equal(contract.resilience.maxSocketsPerOrigin, 8);
  assert.equal(contract.resilience.inlineRetries, 0);
  assert.match(isolation, /this\.inFlight >= this\.config\.maxConcurrent/);
  assert.match(isolation, /QFJ_BACKPRESSURE/);
  assert.match(isolation, /QFJ_CIRCUIT_OPEN/);
});

check('bounded Node transport uses dedicated socket pools and deadline cancellation', () => {
  assert.match(nodeHttp, /maxSockets: QFJ_SCALE_DEFAULTS\.maxSockets/);
  assert.match(nodeHttp, /maxTotalSockets: QFJ_SCALE_DEFAULTS\.maxSockets/);
  assert.match(nodeHttp, /maxFreeSockets: QFJ_SCALE_DEFAULTS\.maxFreeSockets/);
  assert.match(nodeHttp, /AbortSignal\.any/);
  assert.doesNotMatch(nodeHttp, /\bwhile\s*\(/u);
  assert.doesNotMatch(nodeHttp, /\bfor\s*\([^)]*attempt/iu);
});

check('Core decision lane carries business idempotency, correlation, revision, and actor', () => {
  assert.match(coreTransport, /executeQfjScaleRequest/);
  assert.match(coreTransport, /idempotencyKey: identity\.idempotencyKey/);
  assert.match(coreTransport, /correlationId: identity\.correlationId/);
  assert.match(coreTransport, /expectedRevision: identity\.expectedRevision/);
  assert.match(coreTransport, /actor: identity\.assignedActor/);
});

check('WhatsApp and acquisition Core lanes share the Phase 11 bulkhead', () => {
  assert.match(workerHttp, /executeQfjScaleRequest/);
  assert.match(workerHttp, /scaleIdentityFromBody/);
  assert.match(productionNetwork, /boundedNodeHttpPost/);
  assert.doesNotMatch(productionNetwork, /\bfetch\(/);
});

check('Jarvis OS read and command lanes share the Phase 11 bulkhead', () => {
  assert.match(osRead, /executeQfjScaleRequest/);
  assert.match(osRead, /actor: 'qf-jarvis-os'/);
  assert.match(osCommand, /executeQfjScaleRequest/);
  assert.match(osCommand, /actor: 'HUMAN'/);
});

check(
  'QuickFurno gateway verifies V1 before durable work while retaining legacy coexistence',
  () => {
    assert.match(gateway, /verifyQfjScaleRequest/);
    assert.match(gateway, /allowLegacy: true/);
    assert.match(gateway, /scale_contract_rejected/);
    assert.match(gateway, /qfjScaleResponseHeaders/);
  },
);

check('private Riya ingress verifies V1 before replay, classification, and model work', () => {
  const scale = riyaIngress.indexOf('const scaleContract = verifyQfjScaleRequest');
  const replay = riyaIngress.indexOf('const claim = replayGuard.claim');
  const work = riyaIngress.indexOf('await serve(request)');
  assert.ok(scale >= 0 && replay > scale && work > replay);
  assert.match(riyaIngress, /allowLegacy: true/);
});

check('scale metadata is independently Ed25519 signed', () => {
  assert.match(scaleContract, /QFJ_SCALE_SIGNING_DOMAIN/);
  assert.match(scaleContract, /createPrivateKey/);
  assert.match(scaleContract, /createPublicKey/);
  assert.match(scaleContract, /verify\(/);
});

console.log('PHASE11_JARVIS_CONTRACT=PASS checks=' + checks.length);
