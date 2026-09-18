import { createHash, createPrivateKey, sign } from 'node:crypto';

import {
  parseCoreServiceAvailabilitySnapshotV1,
  type CoreServiceAvailabilityReadInput,
  type CoreServiceAvailabilityReader,
} from '@qf-jarvis/core-service-availability-read';

export const JF6_CORE_SERVICE_AVAILABILITY_PATH =
  '/api/internal/jarvis/service-availability' as const;
export const JF6_CORE_SERVICE_AVAILABILITY_DOMAIN =
  'qfj.core.service-availability.http.sig.v1' as const;
export const JF6_CORE_SERVICE_AVAILABILITY_PROTOCOL = 'qfj.core.service-availability.read' as const;
export const JF6_CORE_SERVICE_AVAILABILITY_CALLER = 'qf-jarvis' as const;
export const JF6_CORE_SERVICE_AVAILABILITY_AUDIENCE = 'quickfurno-core' as const;
export const JF6_CORE_SERVICE_AVAILABILITY_KEY_ID_HEADER = 'x-qfj-key-id' as const;
export const JF6_CORE_SERVICE_AVAILABILITY_SIGNATURE_HEADER = 'x-qfj-signature' as const;

const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 8_192;

export type Jf6CoreServiceAvailabilityErrorCode =
  'invalid-config' | 'invalid-input' | 'request-failed' | 'response-invalid';
export class Jf6CoreServiceAvailabilityError extends Error {
  readonly code: Jf6CoreServiceAvailabilityErrorCode;
  constructor(code: Jf6CoreServiceAvailabilityErrorCode) {
    super(code);
    this.name = 'Jf6CoreServiceAvailabilityError';
    this.code = code;
  }
}

export interface Jf6CoreServiceAvailabilityHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}
export type Jf6CoreServiceAvailabilityHttpPost = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  }>,
) => Promise<Jf6CoreServiceAvailabilityHttpResponse>;

export interface Jf6CoreServiceAvailabilityReaderConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly clock: () => string;
  readonly requestId: () => string;
  readonly httpPost: Jf6CoreServiceAvailabilityHttpPost;
  readonly timeoutMs?: number;
}
function endpointFor(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Jf6CoreServiceAvailabilityError('invalid-config');
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Jf6CoreServiceAvailabilityError('invalid-config');
  }
  return new URL(JF6_CORE_SERVICE_AVAILABILITY_PATH, url).toString();
}
function bodyDigest(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}
export function jf6CoreServiceAvailabilitySigningInput(
  args: Readonly<{
    requestId: string;
    issuedAt: string;
    keyId: string;
    bodyDigest: string;
  }>,
): string {
  return [
    JF6_CORE_SERVICE_AVAILABILITY_DOMAIN,
    'POST',
    JF6_CORE_SERVICE_AVAILABILITY_PATH,
    JF6_CORE_SERVICE_AVAILABILITY_CALLER,
    JF6_CORE_SERVICE_AVAILABILITY_AUDIENCE,
    args.requestId,
    args.issuedAt,
    args.keyId,
    args.bodyDigest,
  ].join('\n');
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(),
    expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function createJf6CoreServiceAvailabilityReader(
  config: Jf6CoreServiceAvailabilityReaderConfig,
): CoreServiceAvailabilityReader {
  if (
    !KEY_ID.test(config.keyId) ||
    typeof config.privateKeyPem !== 'string' ||
    !config.privateKeyPem.includes('PRIVATE KEY') ||
    typeof config.clock !== 'function' ||
    typeof config.requestId !== 'function' ||
    typeof config.httpPost !== 'function'
  ) {
    throw new Jf6CoreServiceAvailabilityError('invalid-config');
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    throw new Jf6CoreServiceAvailabilityError('invalid-config');
  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = createPrivateKey(config.privateKeyPem);
  } catch {
    throw new Jf6CoreServiceAvailabilityError('invalid-config');
  }
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519')
    throw new Jf6CoreServiceAvailabilityError('invalid-config');
  const endpoint = endpointFor(config.baseUrl);

  return Object.freeze({
    async readCurrent(input: CoreServiceAvailabilityReadInput): Promise<unknown> {
      if (!ID.test(input.tenantId)) throw new Jf6CoreServiceAvailabilityError('invalid-input');
      const requestId = config.requestId();
      const issuedAt = config.clock();
      if (!ID.test(requestId) || !INSTANT.test(issuedAt) || !Number.isFinite(Date.parse(issuedAt)))
        throw new Jf6CoreServiceAvailabilityError('invalid-input');
      const body = JSON.stringify({
        protocol: JF6_CORE_SERVICE_AVAILABILITY_PROTOCOL,
        version: 1,
        caller: JF6_CORE_SERVICE_AVAILABILITY_CALLER,
        audience: JF6_CORE_SERVICE_AVAILABILITY_AUDIENCE,
        requestId,
        issuedAt,
        tenantId: input.tenantId,
      });
      const signingInput = jf6CoreServiceAvailabilitySigningInput({
        requestId,
        issuedAt,
        keyId: config.keyId,
        bodyDigest: bodyDigest(body),
      });
      const signature = sign(null, Buffer.from(signingInput, 'utf8'), privateKey).toString(
        'base64url',
      );
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await config.httpPost(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: Object.freeze({
            'content-type': 'application/json',
            [JF6_CORE_SERVICE_AVAILABILITY_KEY_ID_HEADER]: config.keyId,
            [JF6_CORE_SERVICE_AVAILABILITY_SIGNATURE_HEADER]: signature,
          }),
          body,
        });
        if (response.status !== 200) throw new Jf6CoreServiceAvailabilityError('request-failed');
        const text = await response.text();
        if (
          Buffer.byteLength(text, 'utf8') < 2 ||
          Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES
        )
          throw new Jf6CoreServiceAvailabilityError('response-invalid');
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Jf6CoreServiceAvailabilityError('response-invalid');
        }
        if (
          !record(parsed) ||
          !exactKeys(parsed, ['protocol', 'version', 'requestId', 'snapshot']) ||
          parsed['protocol'] !== JF6_CORE_SERVICE_AVAILABILITY_PROTOCOL ||
          parsed['version'] !== 1 ||
          parsed['requestId'] !== requestId
        ) {
          throw new Jf6CoreServiceAvailabilityError('response-invalid');
        }
        try {
          return parseCoreServiceAvailabilitySnapshotV1(parsed['snapshot']);
        } catch {
          throw new Jf6CoreServiceAvailabilityError('response-invalid');
        }
      } catch (error) {
        if (error instanceof Jf6CoreServiceAvailabilityError) throw error;
        throw new Jf6CoreServiceAvailabilityError('request-failed');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
