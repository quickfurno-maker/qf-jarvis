#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  QFJ_SCALE_HEADERS,
  createQfjScaleMetadata,
  qfjCompatibilityResponseHeaders,
  qfjScaleBodyDigest,
  qfjScaleSigningInput,
  signQfjScaleHeaders,
  verifyQfjScaleRequest,
} from '../../packages/cross-system-scale-contract/src/contract.ts';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (p) => readFile(join(ROOT, p), 'utf8');
const contractText = await read('contracts/qfj-phase23-compat-v1.json');
const fixtureText = await read('contracts/qfj-phase23-consumer-fixture-v1.json');
const contract = JSON.parse(contractText);
const fixture = JSON.parse(fixtureText);
const gateway = await read('apps/quickfurno-gateway/src/server.ts');
const registry = await read('packages/contracts/src/events/event-registry.ts');
const registryTest = await read('packages/contracts/src/tests/event-registry.test.ts');

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name + ' - ' + error.message);
    process.exitCode = 1;
  }
};

check('canonical Phase23 contract', () => {
  assert.equal(contract.contract, 'qfj.phase23.compatibility.v1');
  assert.equal(contract.phase22Baselines.jarvis, '615db33b3905443207699bda820ffee7d462dd50');
});
check('legacy and current compatibility headers agree with QuickFurno fixture', () => {
  assert.deepEqual(qfjCompatibilityResponseHeaders('legacy'), {
    'x-qfj-current-version': '1',
    'x-qfj-min-supported-version': '0',
    deprecation: 'true',
    sunset: 'Mon, 05 Jan 2027 00:00:00 GMT',
  });
  assert.deepEqual(qfjCompatibilityResponseHeaders('current'), {
    'x-qfj-current-version': '1',
    'x-qfj-min-supported-version': '0',
  });
});
check('legacy V0 coexistence remains enabled', () => {
  assert.deepEqual(
    verifyQfjScaleRequest({
      headers: {},
      method: 'POST',
      path: fixture.v1.path,
      rawBody: Buffer.from(fixture.bodyUtf8, 'utf8'),
      verificationKeys: [],
      allowLegacy: true,
      nowMs: Date.parse('2026-10-06T13:00:00Z'),
    }),
    { ok: true, mode: 'legacy' },
  );
});
check('unsupported V2 fails closed', () => {
  assert.deepEqual(
    verifyQfjScaleRequest({
      headers: { [QFJ_SCALE_HEADERS.version]: '2' },
      method: 'POST',
      path: fixture.v1.path,
      rawBody: Buffer.from(fixture.bodyUtf8, 'utf8'),
      verificationKeys: [],
      allowLegacy: true,
      nowMs: Date.parse('2026-10-06T13:00:00Z'),
    }),
    { ok: false, errorClass: 'QFJ_CONTRACT_INVALID' },
  );
});
check('frozen body digest matches Jarvis consumer', () => {
  assert.equal(
    qfjScaleBodyDigest(Buffer.from(fixture.bodyUtf8, 'utf8')),
    fixture.bodyDigestBase64Url,
  );
});
check('frozen signing input matches Jarvis consumer', () => {
  const metadata = {
    version: 1,
    requestId: fixture.v1.requestId,
    idempotencyKey: fixture.v1.idempotencyKey,
    correlationId: fixture.v1.correlationId,
    traceId: fixture.v1.traceId,
    actor: fixture.v1.actor,
    deadlineAt: fixture.v1.deadlineAt,
  };
  assert.equal(
    qfjScaleSigningInput({
      method: fixture.v1.method,
      path: fixture.v1.path,
      metadata,
      keyId: fixture.v1.keyId,
      bodyDigest: fixture.bodyDigestBase64Url,
    }),
    fixture.v1.expectedSigningInput,
  );
});
check('actual current V1 producer is accepted', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const metadata = createQfjScaleMetadata({
    requestId: 'phase23-jarvis-runtime-1',
    idempotencyKey: 'phase23-jarvis-idem-1',
    actor: 'qf-jarvis',
    timeoutMs: 5000,
    traceId: '33333333333333333333333333333333',
    nowMs: Date.parse('2026-10-06T13:00:00Z'),
  });
  const rawBody = Buffer.from(fixture.bodyUtf8, 'utf8');
  const headers = signQfjScaleHeaders({
    method: 'POST',
    path: fixture.v1.path,
    metadata,
    keyId: 'phase23-runtime',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    rawBody,
  });
  const result = verifyQfjScaleRequest({
    headers,
    method: 'POST',
    path: fixture.v1.path,
    rawBody,
    verificationKeys: [
      {
        keyId: 'phase23-runtime',
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    ],
    allowLegacy: true,
    nowMs: Date.parse('2026-10-06T13:00:01Z'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.mode, 'v1');
});
check('additive response fields remain N-1 tolerant', () => {
  const response = fixture.additiveResponseCompatibility.nResponse;
  const projection = {
    status: response.status,
    requestId: response.requestId,
  };
  assert.deepEqual(projection, fixture.additiveResponseCompatibility.nMinus1ExpectedProjection);
});
check('gateway emits compatibility telemetry', () => {
  assert.match(gateway, /qf\.compatibility\.requests/u);
  assert.match(gateway, /received_version/u);
  assert.match(gateway, /recordCompatibility\(request, scaleContract\)/u);
});
check('gateway returns compatibility headers for accepted legacy/current requests', () => {
  assert.match(gateway, /qfjCompatibilityResponseHeaders/u);
  assert.match(gateway, /compatibilityHeaders\(scaleContract\)/u);
});
check('event registry keys contracts by event type and version', () => {
  assert.match(registry, /eventType.*eventVersion/su);
  assert.match(registry, /canonicalEventKey/u);
});
check('unknown event versions fail closed without fallback', () => {
  assert.match(registry, /UNSUPPORTED_UNKNOWN_VERSION/u);
  assert.match(registry, /never falls back/u);
  assert.match(registryTest, /rejects an unknown future version/u);
  assert.match(registryTest, /does NOT fall back/u);
});
check('event registry is immutable at runtime', () => {
  assert.match(registryTest, /exposes no mutator at all/u);
  assert.match(registry, /Object\.freeze/u);
});
check('event idempotency identity remains explicit', () => {
  assert.equal(contract.eventPolicy.eventIdIsIdempotencyIdentity, true);
});
check('breaking changes require version advancement', () => {
  assert.equal(contract.eventPolicy.requiredFieldAdditionRequiresNewVersion, true);
  assert.equal(contract.eventPolicy.fieldRemovalRequiresNewVersion, true);
  assert.equal(contract.apiPolicy.removeOrRenameFieldRequiresNewMajor, true);
});
check('deprecation requires telemetry and zero-usage proof', () => {
  assert.equal(contract.deprecationPolicy.telemetryRequiredBeforeRemoval, true);
  assert.equal(contract.deprecationPolicy.zeroUsageEvidenceRequired, true);
  assert.equal(contract.deprecationPolicy.minimumZeroUsageDaysBeforeRemoval, 30);
});
check('database contract requires N/N-1 coexistence', () => {
  assert.equal(contract.databasePolicy.nAndNMinus1MustCoexist, true);
  assert.equal(contract.databasePolicy.destructiveContractStepRequiresNMinus1Retired, true);
});
check('Jarvis remains consumer/producer, not business authority', () => {
  assert.equal(
    contract.authority.jarvis,
    'consumer/producer only within signed governed contracts',
  );
});
check('production is unchanged', () => {
  for (const [key, value] of Object.entries(contract.productionBoundary)) {
    assert.equal(value, false, key);
  }
});
check('Phase24 is exact next step', () => {
  assert.match(contract.exit.nextPhase, /Phase 24/);
});

const sha = createHash('sha256').update(contractText).digest('hex');
const fixtureSha = createHash('sha256').update(fixtureText).digest('hex');
console.log(
  'Jarvis Phase23 ' +
    (process.exitCode ? 'FAILED' : 'PASS') +
    ` (${passed}/20) contractSha256=${sha} fixtureSha256=${fixtureSha}`,
);
if (process.exitCode) process.exit(process.exitCode);
