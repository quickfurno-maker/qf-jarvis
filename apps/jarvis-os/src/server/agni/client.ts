import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';

import { loadAgniConfig } from '../auth/config/loader';

const AGNI_PROTOCOL = 'agni.m2m.http.v1' as const;
const AGNI_SIGNING_DOMAIN = 'agni.m2m.http.sig.v1' as const;
const CLIENT = 'qf-jarvis-os' as const;
const MAX_RESPONSE_BYTES = 128 * 1024;

function digest(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('base64url');
}

function headers(input: {
  readonly path: string;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly deadlineAt: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly rawBody: Uint8Array;
}): Readonly<Record<string, string>> {
  const key = createPrivateKey(input.privateKeyPem);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('agni-key-invalid');
  }
  const signing = [
    AGNI_SIGNING_DOMAIN,
    AGNI_PROTOCOL,
    'POST',
    input.path,
    CLIENT,
    input.requestId,
    input.issuedAt,
    input.deadlineAt,
    input.keyId,
    digest(input.rawBody),
  ].join('\n');
  const signature = sign(null, Buffer.from(signing, 'utf8'), key).toString('base64url');
  return Object.freeze({
    'x-agni-protocol': AGNI_PROTOCOL,
    'x-agni-client': CLIENT,
    'x-agni-request-id': input.requestId,
    'x-agni-issued-at': input.issuedAt,
    'x-agni-deadline-at': input.deadlineAt,
    'x-agni-key-id': input.keyId,
    'x-agni-signature': signature,
    'content-type': 'application/json',
  });
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!path.startsWith('/v1/') || path.includes('?') || path.includes('#')) {
    throw new TypeError('agni-path-invalid');
  }
  const config = loadAgniConfig();
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  if (raw.byteLength < 2 || raw.byteLength > 64 * 1024) throw new TypeError('agni-request-invalid');
  const requestId = randomUUID();
  const issuedAt = new Date();
  const deadlineAt = new Date(issuedAt.getTime() + 10_000);
  const response = await globalThis.fetch(new URL(path, config.baseUrl), {
    method: 'POST',
    headers: headers({
      path,
      requestId,
      issuedAt: issuedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      keyId: config.keyId,
      privateKeyPem: config.privateKeyPem,
      rawBody: raw,
    }),
    body: raw,
    redirect: 'error',
    signal: signal ?? AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES)
    throw new TypeError('agni-response-too-large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('agni-response-invalid');
  }
  if (!response.ok) throw new TypeError('agni-request-refused');
  return parsed;
}

export function readAgniHealth(
  system: 'QUICKFURNO' | 'JARVIS',
  service: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(service)) {
    return Promise.reject(new TypeError('agni-service-invalid'));
  }
  return post('/v1/health', { protocol: 'agni.health.request.v1', system, service }, signal);
}

export function readAgniIncidents(limit = 50, signal?: AbortSignal): Promise<unknown> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return Promise.reject(new TypeError('agni-limit-invalid'));
  }
  return post('/v1/incidents', { protocol: 'agni.incidents.request.v1', limit }, signal);
}

export function investigateAgni(
  input: {
    readonly system: 'QUICKFURNO' | 'JARVIS';
    readonly service: string;
    readonly category:
      'RELIABILITY' | 'SECURITY' | 'PERFORMANCE' | 'COST' | 'DEPENDENCY' | 'OBSERVABILITY';
    readonly severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
    readonly signalType: string;
    readonly safeSummary: string;
    readonly safeFacts?: Readonly<Record<string, string | number | boolean>>;
    readonly evidenceRefs?: readonly string[];
  },
  signal?: AbortSignal,
): Promise<unknown> {
  return post('/v1/investigate', { protocol: 'agni.investigate.request.v1', ...input }, signal);
}

export function proposeAgniFix(
  incidentId: string,
  facts: Readonly<Record<string, string | number>>,
  signal?: AbortSignal,
): Promise<unknown> {
  return post('/v1/propose', { protocol: 'agni.propose.request.v1', incidentId, facts }, signal);
}
