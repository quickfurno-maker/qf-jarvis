import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadGatewayConfig } from '../config.js';

const roots: string[] = [];
function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'qfj-phase13-gateway-'));
  roots.push(value);
  return value;
}

function keyPair(keyId: string) {
  const pair = generateKeyPairSync('ed25519');
  return {
    verification: {
      keyId,
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
    signing: {
      keyId,
      privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    },
  };
}

function config(over: Record<string, unknown> = {}) {
  const quickfurnoOld = keyPair('qf.old');
  const quickfurnoNew = keyPair('qf.new');
  const jarvis = keyPair('jarvis.current');
  return {
    schemaVersion: 1,
    environment: 'production',
    serviceId: 'qf-jarvis.quickfurno-gateway',
    quickfurnoVerificationKeys: [quickfurnoOld.verification, quickfurnoNew.verification],
    jarvisSigningKey: jarvis.signing,
    maxClockSkewMs: 60_000,
    replayTtlMs: 120_000,
    replayMaxEntries: 10_000,
    ...over,
  };
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('Phase 13 gateway deployment config', () => {
  it('accepts an overlapping QuickFurno verification keyset for zero-downtime rotation', () => {
    const dir = root();
    const path = join(dir, 'gateway.json');
    writeFileSync(path, JSON.stringify(config()));
    const loaded = loadGatewayConfig(path);
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.environment).toBe('production');
    expect(loaded.serviceId).toBe('qf-jarvis.quickfurno-gateway');
    expect(loaded.verificationKeys.map((key) => key.keyId)).toEqual(['qf.old', 'qf.new']);
  });

  it.each([
    ['wrong schema', { schemaVersion: 2 }],
    ['wrong environment', { environment: 'unknown' }],
    ['wrong service identity', { serviceId: 'qf-jarvis.other' }],
  ])('fails closed on %s', (_label, over) => {
    const dir = root();
    const path = join(dir, 'gateway.json');
    writeFileSync(path, JSON.stringify(config(over)));
    expect(() => loadGatewayConfig(path)).toThrow('gateway_config_invalid');
  });

  it('accepts new-key-only after the overlap window', () => {
    const dir = root();
    const path = join(dir, 'gateway.json');
    const quickfurnoNew = keyPair('qf.new');
    writeFileSync(
      path,
      JSON.stringify(config({ quickfurnoVerificationKeys: [quickfurnoNew.verification] })),
    );
    expect(loadGatewayConfig(path).verificationKeys.map((key) => key.keyId)).toEqual(['qf.new']);
  });
});
