import { generateKeyPairSync, sign, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { GatewayConfig } from '../config.js';
import {
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  parseSigningKey,
  parseVerificationKey,
  rawBodyDigest,
  requestSigningInput,
  responseSigningInput,
  type HandshakeResponseV1,
} from '../protocol.js';
import { createGatewayServer } from '../server.js';

const quickfurno = generateKeyPairSync('ed25519');
const jarvis = generateKeyPairSync('ed25519');
const quickfurnoKeyId = 'quickfurno-test';
const jarvisKeyId = 'jarvis-test';

const qfVerification = parseVerificationKey(
  quickfurnoKeyId,
  quickfurno.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
);
const jarvisSigning = parseSigningKey(
  jarvisKeyId,
  jarvis.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
);
if (qfVerification === null || jarvisSigning === null) throw new Error('test key setup failed');

const config: GatewayConfig = {
  verificationKeys: [qfVerification],
  signingKey: jarvisSigning,
  maxClockSkewMs: 60_000,
  replayTtlMs: 120_000,
  replayMaxEntries: 100,
};

const servers: ReturnType<typeof createGatewayServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

async function startServer(now: Date): Promise<string> {
  const server = createGatewayServer({ config, now: () => now });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

function challenge(now: Date, requestId = '22222222-2222-4222-8222-222222222222') {
  return {
    protocol: 'qfj.handshake',
    version: 1,
    caller: 'quickfurno-core',
    audience: 'qf-jarvis',
    requestId,
    issuedAt: now.toISOString(),
    nonce: Buffer.alloc(32, 9).toString('base64url'),
    purpose: 'connectivity-canary',
  } as const;
}

function signedHeaders(
  body: string,
  request: ReturnType<typeof challenge>,
): Record<string, string> {
  const signature = sign(
    null,
    Buffer.from(
      requestSigningInput({
        requestId: request.requestId,
        issuedAt: request.issuedAt,
        keyId: quickfurnoKeyId,
        bodyDigest: rawBodyDigest(Buffer.from(body, 'utf8')),
      }),
      'utf8',
    ),
    quickfurno.privateKey,
  ).toString('base64url');
  return {
    'content-type': 'application/json',
    [KEY_ID_HEADER]: quickfurnoKeyId,
    [SIGNATURE_HEADER]: signature,
  };
}

describe('QuickFurno gateway HTTP boundary', () => {
  it('answers health independently of Jarvis OS', async () => {
    const base = await startServer(new Date('2026-09-18T12:00:00.000Z'));
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'qf-jarvis-gateway',
      version: 1,
    });
  });

  it('performs a fully signed two-direction handshake', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const base = await startServer(now);
    const request = challenge(now);
    const body = JSON.stringify(request);
    const response = await fetch(`${base}/v1/handshake/challenge`, {
      method: 'POST',
      headers: signedHeaders(body, request),
      body,
    });
    expect(response.status).toBe(200);

    const raw = await response.text();
    const parsed = JSON.parse(raw) as HandshakeResponseV1;
    expect(parsed.echoNonce).toBe(request.nonce);
    expect(parsed.requestId).toBe(request.requestId);
    expect(parsed.jarvisNonce).not.toBe(request.nonce);
    expect(response.headers.get(KEY_ID_HEADER)).toBe(jarvisKeyId);

    const signature = response.headers.get(SIGNATURE_HEADER);
    expect(signature).not.toBeNull();
    if (signature === null) throw new Error('missing response signature');
    expect(
      verify(
        null,
        Buffer.from(
          responseSigningInput({
            requestId: parsed.requestId,
            issuedAt: parsed.issuedAt,
            keyId: jarvisKeyId,
            bodyDigest: rawBodyDigest(Buffer.from(raw, 'utf8')),
          }),
          'utf8',
        ),
        jarvis.publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('refuses an unsigned challenge before replay state is consumed', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const base = await startServer(now);
    const request = challenge(now);
    const body = JSON.stringify(request);

    const refused = await fetch(`${base}/v1/handshake/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(refused.status).toBe(401);

    const accepted = await fetch(`${base}/v1/handshake/challenge`, {
      method: 'POST',
      headers: signedHeaders(body, request),
      body,
    });
    expect(accepted.status).toBe(200);
  });

  it('rejects replay of an already authenticated request id', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const base = await startServer(now);
    const request = challenge(now);
    const body = JSON.stringify(request);
    const options = {
      method: 'POST',
      headers: signedHeaders(body, request),
      body,
    };

    expect((await fetch(`${base}/v1/handshake/challenge`, options)).status).toBe(200);
    expect((await fetch(`${base}/v1/handshake/challenge`, options)).status).toBe(409);
  });

  it('fails closed when the timestamp is stale', async () => {
    const serverNow = new Date('2026-09-18T12:02:00.001Z');
    const requestNow = new Date('2026-09-18T12:00:00.000Z');
    const base = await startServer(serverNow);
    const request = challenge(requestNow, '33333333-3333-4333-8333-333333333333');
    const body = JSON.stringify(request);
    const response = await fetch(`${base}/v1/handshake/challenge`, {
      method: 'POST',
      headers: signedHeaders(body, request),
      body,
    });
    expect(response.status).toBe(401);
  });
});
