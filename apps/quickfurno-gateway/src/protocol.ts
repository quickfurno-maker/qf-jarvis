import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

export const HANDSHAKE_PATH = '/v1/handshake/challenge' as const;
export const HANDSHAKE_METHOD = 'POST' as const;
export const HANDSHAKE_PROTOCOL = 'qfj.handshake' as const;
export const HANDSHAKE_RESPONSE_PROTOCOL = 'qfj.handshake.response' as const;
export const HANDSHAKE_VERSION = 1 as const;
export const REQUEST_CALLER = 'quickfurno-core' as const;
export const REQUEST_AUDIENCE = 'qf-jarvis' as const;
export const RESPONSE_CALLER = 'qf-jarvis' as const;
export const RESPONSE_AUDIENCE = 'quickfurno-core' as const;
export const REQUEST_SIGNING_DOMAIN = 'qfj.handshake.http.sig.v1' as const;
export const RESPONSE_SIGNING_DOMAIN = 'qfj.handshake.response.http.sig.v1' as const;
export const KEY_ID_HEADER = 'x-qfj-key-id' as const;
export const SIGNATURE_HEADER = 'x-qfj-signature' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{80,128}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const NONCE = /^[A-Za-z0-9_-]{43,86}$/u;

export interface VerificationKey {
  readonly keyId: string;
  readonly publicKey: KeyObject;
}

export interface SigningKey {
  readonly keyId: string;
  readonly privateKey: KeyObject;
}

export interface HandshakeChallengeV1 {
  readonly protocol: typeof HANDSHAKE_PROTOCOL;
  readonly version: typeof HANDSHAKE_VERSION;
  readonly caller: typeof REQUEST_CALLER;
  readonly audience: typeof REQUEST_AUDIENCE;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly nonce: string;
  readonly purpose: 'connectivity-canary';
}

export interface HandshakeResponseV1 {
  readonly protocol: typeof HANDSHAKE_RESPONSE_PROTOCOL;
  readonly version: typeof HANDSHAKE_VERSION;
  readonly caller: typeof RESPONSE_CALLER;
  readonly audience: typeof RESPONSE_AUDIENCE;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly echoNonce: string;
  readonly jarvisNonce: string;
  readonly gatewayVersion: 1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).sort().join(',') === [...keys].sort().join(',');
}

function validNonce(value: string): boolean {
  if (!NONCE.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length >= 32 && decoded.length <= 64;
  } catch {
    return false;
  }
}

export function parseHandshakeChallenge(value: unknown): HandshakeChallengeV1 | null {
  if (!isPlainRecord(value)) return null;
  if (
    !exactKeys(value, [
      'protocol',
      'version',
      'caller',
      'audience',
      'requestId',
      'issuedAt',
      'nonce',
      'purpose',
    ])
  ) {
    return null;
  }
  if (
    value['protocol'] !== HANDSHAKE_PROTOCOL ||
    value['version'] !== HANDSHAKE_VERSION ||
    value['caller'] !== REQUEST_CALLER ||
    value['audience'] !== REQUEST_AUDIENCE ||
    value['purpose'] !== 'connectivity-canary' ||
    typeof value['requestId'] !== 'string' ||
    !UUID.test(value['requestId']) ||
    typeof value['issuedAt'] !== 'string' ||
    !INSTANT.test(value['issuedAt']) ||
    !Number.isFinite(Date.parse(value['issuedAt'])) ||
    typeof value['nonce'] !== 'string' ||
    !validNonce(value['nonce'])
  ) {
    return null;
  }
  return Object.freeze({
    protocol: HANDSHAKE_PROTOCOL,
    version: HANDSHAKE_VERSION,
    caller: REQUEST_CALLER,
    audience: REQUEST_AUDIENCE,
    requestId: value['requestId'],
    issuedAt: value['issuedAt'],
    nonce: value['nonce'],
    purpose: 'connectivity-canary',
  });
}

export function rawBodyDigest(rawBody: Uint8Array): string {
  return createHash('sha256').update(rawBody).digest('base64url');
}

function signingInput(args: {
  readonly domain: string;
  readonly caller: string;
  readonly audience: string;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return [
    args.domain,
    HANDSHAKE_METHOD,
    HANDSHAKE_PATH,
    args.caller,
    args.audience,
    args.requestId,
    args.issuedAt,
    args.keyId,
    args.bodyDigest,
  ].join('\n');
}

export function requestSigningInput(args: {
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return signingInput({
    ...args,
    domain: REQUEST_SIGNING_DOMAIN,
    caller: REQUEST_CALLER,
    audience: REQUEST_AUDIENCE,
  });
}

export function responseSigningInput(args: {
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return signingInput({
    ...args,
    domain: RESPONSE_SIGNING_DOMAIN,
    caller: RESPONSE_CALLER,
    audience: RESPONSE_AUDIENCE,
  });
}

export function parseVerificationKey(keyId: string, publicKeyPem: string): VerificationKey | null {
  if (!KEY_ID.test(keyId) || publicKeyPem.includes('PRIVATE KEY')) return null;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') return null;
    return Object.freeze({ keyId, publicKey });
  } catch {
    return null;
  }
}

export function parseSigningKey(keyId: string, privateKeyPem: string): SigningKey | null {
  if (!KEY_ID.test(keyId) || !privateKeyPem.includes('PRIVATE KEY')) return null;
  try {
    const privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') return null;
    return Object.freeze({ keyId, privateKey });
  } catch {
    return null;
  }
}

export function verifyHandshakeSignature(args: {
  readonly rawBody: Uint8Array;
  readonly challenge: HandshakeChallengeV1;
  readonly keyId: string | null;
  readonly signature: string | null;
  readonly verificationKeys: readonly VerificationKey[];
  readonly nowMs: number;
  readonly maxClockSkewMs: number;
}): boolean {
  if (
    !args.keyId ||
    !KEY_ID.test(args.keyId) ||
    !args.signature ||
    !SIGNATURE.test(args.signature)
  ) {
    return false;
  }
  const issuedMs = Date.parse(args.challenge.issuedAt);
  if (!Number.isFinite(issuedMs) || Math.abs(args.nowMs - issuedMs) > args.maxClockSkewMs)
    return false;
  const configured = args.verificationKeys.find((key) => key.keyId === args.keyId);
  if (!configured) return false;
  let signature: Buffer;
  try {
    signature = Buffer.from(args.signature, 'base64url');
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;
  return verify(
    null,
    Buffer.from(
      requestSigningInput({
        requestId: args.challenge.requestId,
        issuedAt: args.challenge.issuedAt,
        keyId: args.keyId,
        bodyDigest: rawBodyDigest(args.rawBody),
      }),
      'utf8',
    ),
    configured.publicKey,
    signature,
  );
}

export function createHandshakeResponse(args: {
  readonly challenge: HandshakeChallengeV1;
  readonly now: Date;
}): HandshakeResponseV1 {
  return Object.freeze({
    protocol: HANDSHAKE_RESPONSE_PROTOCOL,
    version: HANDSHAKE_VERSION,
    caller: RESPONSE_CALLER,
    audience: RESPONSE_AUDIENCE,
    requestId: args.challenge.requestId,
    issuedAt: args.now.toISOString(),
    echoNonce: args.challenge.nonce,
    jarvisNonce: randomBytes(32).toString('base64url'),
    gatewayVersion: 1,
  });
}

export function signHandshakeResponse(args: {
  readonly rawBody: Uint8Array;
  readonly response: HandshakeResponseV1;
  readonly signingKey: SigningKey;
}): string {
  return sign(
    null,
    Buffer.from(
      responseSigningInput({
        requestId: args.response.requestId,
        issuedAt: args.response.issuedAt,
        keyId: args.signingKey.keyId,
        bodyDigest: rawBodyDigest(args.rawBody),
      }),
      'utf8',
    ),
    args.signingKey.privateKey,
  ).toString('base64url');
}
