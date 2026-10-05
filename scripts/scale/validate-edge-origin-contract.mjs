#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');
const policy = JSON.parse(read('deploy/edge/phase10-policy.json'));
const osBase = read('deploy/jarvis-os/compose.production.yml');
const osIngress = read('deploy/jarvis-os/compose.ingress.yml');
const osHsts = read('deploy/jarvis-os/compose.hsts.yml');
const gatewayBase = read('deploy/quickfurno-gateway/compose.production.yml');
const gatewayIngress = read('deploy/quickfurno-gateway/compose.ingress.yml');
const gatewayReadme = read('deploy/quickfurno-gateway/README.md');

function check(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (error) {
    console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

check('Jarvis OS is public-edge traffic but publishes no application port', () => {
  assert.equal(policy.publicOs.ingress, 'cloudflare-proxied-public');
  assert.equal(policy.publicOs.applicationPortsPublished, false);
  assert.doesNotMatch(osBase, /^\s*ports:\s*$/m);
  assert.match(osIngress, /Host\(`jarvis\.quickfurno\.in`\)/);
});

check('Jarvis OS keeps origin login protections independent of Cloudflare', () => {
  assert.match(osIngress, /qf-jarvis-os-login-ratelimit/);
  assert.match(osIngress, /ratelimit\.average:\s*'5'/);
  assert.match(osIngress, /qf-jarvis-os-login-buffer/);
  assert.match(osIngress, /maxRequestBodyBytes:\s*'8192'/);
});

check('nonce CSP remains application-owned and HSTS stays post-TLS', () => {
  assert.equal(policy.publicOs.cspOwner, 'application-nonce');
  assert.doesNotMatch(osIngress, /^\\s*traefik\\..*headers\\.contentSecurityPolicy:/m);
  assert.match(osIngress, /per-request nonce CSP/i);
  assert.match(osHsts, /stsSeconds:\s*'31536000'/);
  assert.match(osHsts, /applied only after trusted TLS/i);
});

check('machine gateway remains an approved direct signed path', () => {
  assert.equal(policy.machineGateway.ingress, 'approved-direct-machine-ingress');
  assert.equal(policy.machineGateway.cloudflareProxy, false);
  assert.equal(policy.machineGateway.applicationPortsPublished, false);
  assert.doesNotMatch(gatewayBase, /^\s*ports:\s*$/m);
  assert.match(gatewayIngress, /gateway\.jarvis\.quickfurno\.in/);
  assert.match(gatewayIngress, /ipallowlist\.sourcerange/);
  assert.match(gatewayReadme, /Ed25519 signature/i);
});

check('machine gateway has general and handshake-specific ceilings', () => {
  assert.match(gatewayIngress, /qf-jarvis-gateway-ratelimit/);
  assert.match(gatewayIngress, /maxRequestBodyBytes:\s*'65536'/);
  assert.match(gatewayIngress, /qf-jarvis-gateway-handshake-ratelimit/);
  assert.match(gatewayIngress, /maxRequestBodyBytes:\s*'8192'/);
});

check('portable policy refuses Cloudflare as business authority', () => {
  assert.equal(policy.portability.cloudflareIsBusinessAuthority, false);
  for (const required of ['authentication', 'authorization', 'rate-limits', 'signatures', 'idempotency']) {
    assert.ok(policy.portability.emergencyBypassMayNotDisable.includes(required), required + ' missing');
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Jarvis Phase 10 edge/origin contract PASS');
