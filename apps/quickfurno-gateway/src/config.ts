import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  parseSigningKey,
  parseVerificationKey,
  type SigningKey,
  type VerificationKey,
} from './protocol.js';

const MAX_CONFIG_BYTES = 64 * 1024;

export interface GatewayConfig {
  readonly verificationKeys: readonly VerificationKey[];
  readonly signingKey: SigningKey;
  readonly maxClockSkewMs: number;
  readonly replayTtlMs: number;
  readonly replayMaxEntries: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function loadGatewayConfig(configPath: string): GatewayConfig {
  if (!isAbsolute(configPath)) throw new Error('gateway_config_invalid');
  const raw = readFileSync(configPath);
  if (raw.length < 2 || raw.length > MAX_CONFIG_BYTES) throw new Error('gateway_config_invalid');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('gateway_config_invalid');
  }
  const root = record(parsed);
  if (
    root === null ||
    Object.keys(root).sort().join(',') !==
      [
        'jarvisSigningKey',
        'maxClockSkewMs',
        'quickfurnoVerificationKeys',
        'replayMaxEntries',
        'replayTtlMs',
      ]
        .sort()
        .join(',')
  ) {
    throw new Error('gateway_config_invalid');
  }

  const keys = root['quickfurnoVerificationKeys'];
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 4) {
    throw new Error('gateway_config_invalid');
  }
  const verificationKeys: VerificationKey[] = [];
  const seen = new Set<string>();
  for (const value of keys) {
    const item = record(value);
    if (
      item === null ||
      Object.keys(item).sort().join(',') !== ['keyId', 'publicKeyPem'].sort().join(',') ||
      typeof item['keyId'] !== 'string' ||
      typeof item['publicKeyPem'] !== 'string' ||
      seen.has(item['keyId'])
    ) {
      throw new Error('gateway_config_invalid');
    }
    const key = parseVerificationKey(item['keyId'], item['publicKeyPem']);
    if (key === null) throw new Error('gateway_config_invalid');
    seen.add(item['keyId']);
    verificationKeys.push(key);
  }

  const signing = record(root['jarvisSigningKey']);
  if (
    signing === null ||
    Object.keys(signing).sort().join(',') !== ['keyId', 'privateKeyPem'].sort().join(',') ||
    typeof signing['keyId'] !== 'string' ||
    typeof signing['privateKeyPem'] !== 'string'
  ) {
    throw new Error('gateway_config_invalid');
  }
  const signingKey = parseSigningKey(signing['keyId'], signing['privateKeyPem']);
  if (signingKey === null) throw new Error('gateway_config_invalid');

  const maxClockSkewMs = root['maxClockSkewMs'];
  const replayTtlMs = root['replayTtlMs'];
  const replayMaxEntries = root['replayMaxEntries'];
  if (
    typeof maxClockSkewMs !== 'number' ||
    !Number.isSafeInteger(maxClockSkewMs) ||
    maxClockSkewMs < 5_000 ||
    maxClockSkewMs > 120_000 ||
    typeof replayTtlMs !== 'number' ||
    !Number.isSafeInteger(replayTtlMs) ||
    replayTtlMs < maxClockSkewMs ||
    replayTtlMs > 600_000 ||
    typeof replayMaxEntries !== 'number' ||
    !Number.isSafeInteger(replayMaxEntries) ||
    replayMaxEntries < 100 ||
    replayMaxEntries > 100_000
  ) {
    throw new Error('gateway_config_invalid');
  }

  return Object.freeze({
    verificationKeys: Object.freeze(verificationKeys),
    signingKey,
    maxClockSkewMs,
    replayTtlMs,
    replayMaxEntries,
  });
}
