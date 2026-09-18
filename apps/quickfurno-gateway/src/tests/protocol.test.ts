import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  HANDSHAKE_PATH,
  KEY_ID_HEADER,
  REQUEST_SIGNING_DOMAIN,
  RESPONSE_SIGNING_DOMAIN,
  SIGNATURE_HEADER,
  createHandshakeResponse,
  parseHandshakeChallenge,
  parseSigningKey,
  parseVerificationKey,
  rawBodyDigest,
  requestSigningInput,
  responseSigningInput,
  signHandshakeResponse,
  verifyHandshakeSignature,
} from '../protocol.js';
import { BoundedReplayCache } from '../replay-cache.js';

const quickfurno = generateKeyPairSync('ed25519');
const jarvis = generateKeyPairSync('ed25519');
const quickfurnoKeyId = 'quickfurno-prod-2026-09';
const jarvisKeyId = 'jarvis-gateway-prod-2026-09';
const issuedAt = '2026-09-18T12:00:00.000Z';
const requestId = '11111111-1111-4111-8111-111111111111';
const nonce = Buffer.alloc(32, 7).toString('base64url');

function challengeObject() {
  return {
    protocol: 'qfj.handshake',
    version: 1,
    caller: 'quickfurno-core',
    audience: 'qf-jarvis',
    requestId,
    issuedAt,
    nonce,
    purpose: 'connectivity-canary',
  };
}

describe('QuickFurno -> Jarvis handshake protocol', () => {
  it('locks the route and domain-separated signature vocabulary', () => {
    expect(HANDSHAKE_PATH).toBe('/v1/handshake/challenge');
    expect(REQUEST_SIGNING_DOMAIN).toBe('qfj.handshake.http.sig.v1');
    expect(RESPONSE_SIGNING_DOMAIN).toBe('qfj.handshake.response.http.sig.v1');
    expect(KEY_ID_HEADER).toBe('x-qfj-key-id');
    expect(SIGNATURE_HEADER).toBe('x-qfj-signature');
  });

  it('accepts only the exact challenge shape', () => {
    expect(parseHandshakeChallenge(challengeObject())).not.toBeNull();
    expect(
      parseHandshakeChallenge({ ...challengeObject(), providerToken: 'forbidden' }),
    ).toBeNull();
    expect(parseHandshakeChallenge({ ...challengeObject(), caller: 'someone-else' })).toBeNull();
    expect(parseHandshakeChallenge({ ...challengeObject(), nonce: 'short' })).toBeNull();
  });

  it('independently verifies an Ed25519 QuickFurno signature and freshness', () => {
    const challenge = parseHandshakeChallenge(challengeObject());
    expect(challenge).not.toBeNull();
    if (challenge === null) throw new Error('challenge not parsed');
    const raw = Buffer.from(JSON.stringify(challengeObject()), 'utf8');
    const signature = sign(
      null,
      Buffer.from(
        requestSigningInput({
          requestId,
          issuedAt,
          keyId: quickfurnoKeyId,
          bodyDigest: rawBodyDigest(raw),
        }),
        'utf8',
      ),
      quickfurno.privateKey,
    ).toString('base64url');
    const verificationKey = parseVerificationKey(
      quickfurnoKeyId,
      quickfurno.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    );
    expect(verificationKey).not.toBeNull();
    if (verificationKey === null) throw new Error('verification key not parsed');

    expect(
      verifyHandshakeSignature({
        rawBody: raw,
        challenge,
        keyId: quickfurnoKeyId,
        signature,
        verificationKeys: [verificationKey],
        nowMs: Date.parse(issuedAt) + 30_000,
        maxClockSkewMs: 60_000,
      }),
    ).toBe(true);
    expect(
      verifyHandshakeSignature({
        rawBody: raw,
        challenge,
        keyId: quickfurnoKeyId,
        signature,
        verificationKeys: [verificationKey],
        nowMs: Date.parse(issuedAt) + 60_001,
        maxClockSkewMs: 60_000,
      }),
    ).toBe(false);
  });

  it('signs the Jarvis response with a separate directional key and echoes the nonce', () => {
    const challenge = parseHandshakeChallenge(challengeObject());
    if (challenge === null) throw new Error('challenge not parsed');
    const signingKey = parseSigningKey(
      jarvisKeyId,
      jarvis.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    );
    expect(signingKey).not.toBeNull();
    if (signingKey === null) throw new Error('signing key not parsed');

    const response = createHandshakeResponse({
      challenge,
      now: new Date('2026-09-18T12:00:01.000Z'),
    });
    expect(response.echoNonce).toBe(nonce);
    expect(response.jarvisNonce).not.toBe(nonce);
    const raw = Buffer.from(JSON.stringify(response), 'utf8');
    const signature = signHandshakeResponse({ rawBody: raw, response, signingKey });
    const verified = verify(
      null,
      Buffer.from(
        responseSigningInput({
          requestId,
          issuedAt: response.issuedAt,
          keyId: jarvisKeyId,
          bodyDigest: createHash('sha256').update(raw).digest('base64url'),
        }),
        'utf8',
      ),
      jarvis.publicKey,
      Buffer.from(signature, 'base64url'),
    );
    expect(verified).toBe(true);
  });

  it('rejects non-Ed25519 key material', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      parseSigningKey(
        'rsa-key',
        rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      ),
    ).toBeNull();
    expect(
      parseVerificationKey(
        'rsa-key',
        rsa.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      ),
    ).toBeNull();
  });

  it('bounds replay memory and rejects a repeated request id within the TTL', () => {
    const replay = new BoundedReplayCache(120_000, 100);
    expect(replay.claim(requestId, 1_000)).toBe(true);
    expect(replay.claim(requestId, 1_001)).toBe(false);
    expect(replay.claim(requestId, 121_001)).toBe(true);
  });
});
