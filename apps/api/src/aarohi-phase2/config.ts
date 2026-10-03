import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import type { AarohiDiscoveryProviderChannel } from './provider-port.js';

export interface AarohiPhase2WorkerFileProviderConfig {
  readonly key: string;
  readonly channel: AarohiDiscoveryProviderChannel;
  readonly endpoint: string;
  readonly bearerTokenFile: string;
  readonly allowedHosts: readonly string[];
  readonly socialContinuation: boolean;
  readonly socialReplyPolling: boolean;
}
export interface AarohiPhase2WorkerFileConfig {
  readonly revision: string;
  readonly enabled: boolean;
  readonly workerRef: string;
  readonly pollMs: number;
  readonly core: {
    readonly baseUrl: string;
    readonly keyId: string;
    readonly privateKeyFile: string;
    readonly timeoutMs: number;
  };
  readonly providers: readonly AarohiPhase2WorkerFileProviderConfig[];
}

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const CHANNELS = new Set([
  'INSTAGRAM',
  'FACEBOOK',
  'X',
  'GOOGLE',
  'WEBSITE',
  'JUSTDIAL',
  'INDIAMART',
]);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function absoluteFile(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value))
    throw new Error('aarohi-phase2-config-invalid');
  return value;
}
export function loadAarohiPhase2WorkerConfig(path: string): AarohiPhase2WorkerFileConfig {
  if (!isAbsolute(path)) throw new Error('aarohi-phase2-config-invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('aarohi-phase2-config-invalid');
  }
  if (!record(parsed) || !record(parsed['core']) || !Array.isArray(parsed['providers']))
    throw new Error('aarohi-phase2-config-invalid');
  if (
    typeof parsed['revision'] !== 'string' ||
    !REF.test(parsed['revision']) ||
    typeof parsed['enabled'] !== 'boolean' ||
    typeof parsed['workerRef'] !== 'string' ||
    !REF.test(parsed['workerRef']) ||
    !Number.isInteger(parsed['pollMs']) ||
    Number(parsed['pollMs']) < 1000 ||
    Number(parsed['pollMs']) > 300000
  )
    throw new Error('aarohi-phase2-config-invalid');
  const core = parsed['core'];
  if (
    typeof core['baseUrl'] !== 'string' ||
    typeof core['keyId'] !== 'string' ||
    !REF.test(core['keyId']) ||
    !Number.isInteger(core['timeoutMs']) ||
    Number(core['timeoutMs']) < 500 ||
    Number(core['timeoutMs']) > 30000
  )
    throw new Error('aarohi-phase2-config-invalid');
  const privateKeyFile = absoluteFile(core['privateKeyFile']);
  const providers = parsed['providers'].map((raw) => {
    if (
      !record(raw) ||
      typeof raw['key'] !== 'string' ||
      !REF.test(raw['key']) ||
      typeof raw['channel'] !== 'string' ||
      !CHANNELS.has(raw['channel']) ||
      typeof raw['endpoint'] !== 'string' ||
      !Array.isArray(raw['allowedHosts']) ||
      raw['allowedHosts'].length < 1 ||
      raw['allowedHosts'].length > 20 ||
      raw['allowedHosts'].some(
        (host) => typeof host !== 'string' || host.length < 1 || host.length > 253,
      )
    )
      throw new Error('aarohi-phase2-config-invalid');
    return Object.freeze({
      key: raw['key'],
      channel: raw['channel'] as AarohiDiscoveryProviderChannel,
      endpoint: raw['endpoint'],
      bearerTokenFile: absoluteFile(raw['bearerTokenFile']),
      allowedHosts: Object.freeze(raw['allowedHosts'].map(String)),
      socialContinuation: raw['socialContinuation'] === true,
      socialReplyPolling: raw['socialReplyPolling'] === true,
    });
  });
  return Object.freeze({
    revision: parsed['revision'],
    enabled: parsed['enabled'],
    workerRef: parsed['workerRef'],
    pollMs: Number(parsed['pollMs']),
    core: Object.freeze({
      baseUrl: String(core['baseUrl']),
      keyId: String(core['keyId']),
      privateKeyFile,
      timeoutMs: Number(core['timeoutMs']),
    }),
    providers: Object.freeze(providers),
  });
}

export function readSecretFile(path: string, maxBytes: number): string {
  const value = readFileSync(absoluteFile(path), 'utf8').trim();
  if (value.length < 1 || Buffer.byteLength(value, 'utf8') > maxBytes)
    throw new Error('aarohi-phase2-secret-invalid');
  return value;
}
