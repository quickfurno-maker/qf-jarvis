import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

export const QFJ_SCALE_PROTOCOL = 'qfj.scale.http' as const;
export const QFJ_SCALE_VERSION = '1' as const;
export const QFJ_SCALE_SIGNING_DOMAIN = 'qfj.scale.http.sig.v1' as const;
export const QFJ_SCALE_LEGACY_REMOVAL_NOT_BEFORE = '2027-01-05T00:00:00Z' as const;

export const QFJ_SCALE_HEADERS = Object.freeze({
  version: 'x-qfj-scale-version',
  requestId: 'x-qfj-request-id',
  idempotencyKey: 'x-qfj-idempotency-key',
  correlationId: 'x-qfj-correlation-id',
  traceId: 'x-qfj-trace-id',
  actor: 'x-qfj-actor',
  expectedRevision: 'x-qfj-expected-revision',
  deadlineAt: 'x-qfj-deadline-at',
  signature: 'x-qfj-scale-signature',
  keyId: 'x-qfj-key-id',
} as const);

export const QFJ_SCALE_RESPONSE_HEADERS = Object.freeze({
  version: 'x-qfj-scale-version',
  correlationId: 'x-qfj-correlation-id',
  traceId: 'x-qfj-trace-id',
  errorClass: 'x-qfj-error-class',
  retryable: 'x-qfj-retryable',
} as const);

export const QFJ_SCALE_ACTORS = [
  'quickfurno-core',
  'qf-jarvis',
  'qf-jarvis-os',
  'qf-agni-control-plane',
  'qf-agni-action-broker',
  'RIYA',
  'ANISHA',
  'AAROHI',
  'JARVIS',
  'SYSTEM',
  'HUMAN',
] as const;

export type QfjScaleActor = (typeof QFJ_SCALE_ACTORS)[number];

export const QFJ_SCALE_ERROR_RETRYABILITY = Object.freeze({
  QFJ_NONE: false,
  QFJ_CONTRACT_INVALID: false,
  QFJ_AUTHENTICATION_FAILED: false,
  QFJ_DEADLINE_EXCEEDED: true,
  QFJ_BACKPRESSURE: true,
  QFJ_CIRCUIT_OPEN: true,
  QFJ_UPSTREAM_TIMEOUT: true,
  QFJ_UPSTREAM_UNAVAILABLE: true,
  QFJ_REMOTE_REFUSED: false,
  QFJ_CONFLICT: false,
  QFJ_INVALID_RESPONSE: false,
  QFJ_INTERNAL_ERROR: false,
} as const);

export type QfjScaleErrorClass = keyof typeof QFJ_SCALE_ERROR_RETRYABILITY;

export interface QfjScaleMetadataV1 {
  readonly version: 1;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly actor: QfjScaleActor;
  readonly expectedRevision?: number;
  readonly deadlineAt: string;
}

export interface QfjScaleVerificationKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
}

export type QfjScaleVerificationResult =
  | { readonly ok: true; readonly mode: 'legacy' }
  | { readonly ok: true; readonly mode: 'v1'; readonly metadata: QfjScaleMetadataV1 }
  | { readonly ok: false; readonly errorClass: QfjScaleErrorClass };

const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const TRACE_ID = /^[0-9a-f]{32}$/u;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{80,128}$/u;

function canonicalInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function metadataValid(value: QfjScaleMetadataV1): boolean {
  return (
    ID.test(value.requestId) &&
    ID.test(value.idempotencyKey) &&
    ID.test(value.correlationId) &&
    TRACE_ID.test(value.traceId) &&
    (QFJ_SCALE_ACTORS as readonly string[]).includes(value.actor) &&
    (value.expectedRevision === undefined ||
      (Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0)) &&
    canonicalInstant(value.deadlineAt)
  );
}

export function createQfjScaleMetadata(input: {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly actor: QfjScaleActor;
  readonly timeoutMs: number;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly expectedRevision?: number;
  readonly nowMs?: number;
}): QfjScaleMetadataV1 {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 5_000) {
    throw new TypeError('qfj-scale-timeout-invalid');
  }
  const value: QfjScaleMetadataV1 = Object.freeze({
    version: 1 as const,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId ?? input.requestId,
    traceId: input.traceId ?? randomBytes(16).toString('hex'),
    actor: input.actor,
    ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
    deadlineAt: new Date(nowMs + input.timeoutMs).toISOString(),
  });
  if (!metadataValid(value)) throw new TypeError('qfj-scale-metadata-invalid');
  return value;
}

export function qfjScaleBodyDigest(rawBody: Uint8Array): string {
  return createHash('sha256').update(rawBody).digest('base64url');
}

export function qfjScaleSigningInput(args: {
  readonly method: string;
  readonly path: string;
  readonly metadata: QfjScaleMetadataV1;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  if (
    !metadataValid(args.metadata) ||
    !KEY_ID.test(args.keyId) ||
    !/^[A-Z]{3,12}$/u.test(args.method.toUpperCase()) ||
    !args.path.startsWith('/') ||
    args.path.includes('?') ||
    args.path.includes('#')
  ) {
    throw new TypeError('qfj-scale-signing-input-invalid');
  }
  return [
    QFJ_SCALE_SIGNING_DOMAIN,
    QFJ_SCALE_VERSION,
    args.method.toUpperCase(),
    args.path,
    args.metadata.requestId,
    args.metadata.idempotencyKey,
    args.metadata.correlationId,
    args.metadata.traceId,
    args.metadata.actor,
    args.metadata.expectedRevision === undefined ? '-' : String(args.metadata.expectedRevision),
    args.metadata.deadlineAt,
    args.keyId,
    args.bodyDigest,
  ].join('\n');
}

export function signQfjScaleHeaders(args: {
  readonly method: string;
  readonly path: string;
  readonly metadata: QfjScaleMetadataV1;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly rawBody: Uint8Array;
}): Readonly<Record<string, string>> {
  if (!KEY_ID.test(args.keyId) || !args.privateKeyPem.includes('PRIVATE KEY')) {
    throw new TypeError('qfj-scale-signing-key-invalid');
  }
  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = createPrivateKey(args.privateKeyPem);
  } catch {
    throw new TypeError('qfj-scale-signing-key-invalid');
  }
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('qfj-scale-signing-key-invalid');
  }
  const signature = sign(
    null,
    Buffer.from(
      qfjScaleSigningInput({
        method: args.method,
        path: args.path,
        metadata: args.metadata,
        keyId: args.keyId,
        bodyDigest: qfjScaleBodyDigest(args.rawBody),
      }),
      'utf8',
    ),
    privateKey,
  ).toString('base64url');

  return Object.freeze({
    [QFJ_SCALE_HEADERS.version]: QFJ_SCALE_VERSION,
    [QFJ_SCALE_HEADERS.requestId]: args.metadata.requestId,
    [QFJ_SCALE_HEADERS.idempotencyKey]: args.metadata.idempotencyKey,
    [QFJ_SCALE_HEADERS.correlationId]: args.metadata.correlationId,
    [QFJ_SCALE_HEADERS.traceId]: args.metadata.traceId,
    [QFJ_SCALE_HEADERS.actor]: args.metadata.actor,
    ...(args.metadata.expectedRevision === undefined
      ? {}
      : { [QFJ_SCALE_HEADERS.expectedRevision]: String(args.metadata.expectedRevision) }),
    [QFJ_SCALE_HEADERS.deadlineAt]: args.metadata.deadlineAt,
    [QFJ_SCALE_HEADERS.signature]: signature,
    [QFJ_SCALE_HEADERS.keyId]: args.keyId,
  });
}

function headerValue(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === 'string' || value === undefined) return value;
  const values: readonly string[] = value;
  return values.length === 1 ? values[0] : undefined;
}

export function verifyQfjScaleRequest(args: {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly method: string;
  readonly path: string;
  readonly rawBody: Uint8Array;
  readonly verificationKeys: readonly QfjScaleVerificationKey[];
  readonly nowMs?: number;
  readonly allowLegacy?: boolean;
}): QfjScaleVerificationResult {
  const version = headerValue(args.headers, QFJ_SCALE_HEADERS.version);
  if (version === undefined) {
    return args.allowLegacy !== false
      ? { ok: true, mode: 'legacy' }
      : { ok: false, errorClass: 'QFJ_CONTRACT_INVALID' };
  }
  if (version !== QFJ_SCALE_VERSION) {
    return { ok: false, errorClass: 'QFJ_CONTRACT_INVALID' };
  }

  const expectedRevisionText = headerValue(args.headers, QFJ_SCALE_HEADERS.expectedRevision);
  const expectedRevision =
    expectedRevisionText === undefined ? undefined : Number(expectedRevisionText);
  const metadata: QfjScaleMetadataV1 = {
    version: 1,
    requestId: headerValue(args.headers, QFJ_SCALE_HEADERS.requestId) ?? '',
    idempotencyKey: headerValue(args.headers, QFJ_SCALE_HEADERS.idempotencyKey) ?? '',
    correlationId: headerValue(args.headers, QFJ_SCALE_HEADERS.correlationId) ?? '',
    traceId: headerValue(args.headers, QFJ_SCALE_HEADERS.traceId) ?? '',
    actor: (headerValue(args.headers, QFJ_SCALE_HEADERS.actor) ?? '') as QfjScaleActor,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    deadlineAt: headerValue(args.headers, QFJ_SCALE_HEADERS.deadlineAt) ?? '',
  };

  if (!metadataValid(metadata)) {
    return { ok: false, errorClass: 'QFJ_CONTRACT_INVALID' };
  }
  const traceparent = headerValue(args.headers, 'traceparent');
  if (traceparent !== undefined) {
    const parsed = TRACEPARENT.exec(traceparent);
    if (parsed?.[1] !== metadata.traceId) {
      return { ok: false, errorClass: 'QFJ_CONTRACT_INVALID' };
    }
  }
  if ((args.nowMs ?? Date.now()) > Date.parse(metadata.deadlineAt)) {
    return { ok: false, errorClass: 'QFJ_DEADLINE_EXCEEDED' };
  }

  const keyId = headerValue(args.headers, QFJ_SCALE_HEADERS.keyId);
  const signatureText = headerValue(args.headers, QFJ_SCALE_HEADERS.signature);
  if (!keyId || !KEY_ID.test(keyId) || !signatureText || !SIGNATURE.test(signatureText)) {
    return { ok: false, errorClass: 'QFJ_AUTHENTICATION_FAILED' };
  }
  const configured = args.verificationKeys.find((entry) => entry.keyId === keyId);
  if (!configured || configured.publicKeyPem.includes('PRIVATE KEY')) {
    return { ok: false, errorClass: 'QFJ_AUTHENTICATION_FAILED' };
  }

  try {
    const publicKey = createPublicKey(configured.publicKeyPem);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
      return { ok: false, errorClass: 'QFJ_AUTHENTICATION_FAILED' };
    }
    const signature = Buffer.from(signatureText, 'base64url');
    const valid =
      signature.length === 64 &&
      verify(
        null,
        Buffer.from(
          qfjScaleSigningInput({
            method: args.method,
            path: args.path,
            metadata,
            keyId,
            bodyDigest: qfjScaleBodyDigest(args.rawBody),
          }),
          'utf8',
        ),
        publicKey,
        signature,
      );
    return valid
      ? { ok: true, mode: 'v1', metadata: Object.freeze(metadata) }
      : { ok: false, errorClass: 'QFJ_AUTHENTICATION_FAILED' };
  } catch {
    return { ok: false, errorClass: 'QFJ_AUTHENTICATION_FAILED' };
  }
}

export function qfjScaleRetryable(errorClass: QfjScaleErrorClass): boolean {
  return QFJ_SCALE_ERROR_RETRYABILITY[errorClass];
}

export function qfjScaleResponseHeaders(
  metadata: Pick<QfjScaleMetadataV1, 'correlationId' | 'traceId'>,
  errorClass: QfjScaleErrorClass = 'QFJ_NONE',
): Readonly<Record<string, string>> {
  return Object.freeze({
    [QFJ_SCALE_RESPONSE_HEADERS.version]: QFJ_SCALE_VERSION,
    [QFJ_SCALE_RESPONSE_HEADERS.correlationId]: metadata.correlationId,
    [QFJ_SCALE_RESPONSE_HEADERS.traceId]: metadata.traceId,
    [QFJ_SCALE_RESPONSE_HEADERS.errorClass]: errorClass,
    [QFJ_SCALE_RESPONSE_HEADERS.retryable]: String(qfjScaleRetryable(errorClass)),
  });
}

export function qfjScaleErrorForHttpStatus(status: number): QfjScaleErrorClass {
  if (status >= 200 && status < 400) return 'QFJ_NONE';
  if (status === 409) return 'QFJ_CONFLICT';
  if (status === 429) return 'QFJ_BACKPRESSURE';
  if (status === 401 || status === 403) return 'QFJ_AUTHENTICATION_FAILED';
  if (status >= 400 && status < 500) return 'QFJ_REMOTE_REFUSED';
  if (status >= 500) return 'QFJ_UPSTREAM_UNAVAILABLE';
  return 'QFJ_INTERNAL_ERROR';
}
