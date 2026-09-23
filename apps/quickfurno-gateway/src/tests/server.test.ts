import { generateKeyPairSync, sign, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { GatewayConfig } from '../config.js';
import type { DurableTurnSpool, DurableTurnRecordV1 } from '../durable-turn-spool.js';
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
import {
  WHATSAPP_TURN_PATH,
  whatsAppTurnSigningInput,
  type WhatsAppTurnV1,
} from '../whatsapp-turn-protocol.js';

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

function memoryTurnSpool() {
  const records = new Map<string, DurableTurnRecordV1>();
  const spool: DurableTurnSpool = Object.freeze({
    accept(turn: WhatsAppTurnV1, acceptedAt: string) {
      const next: DurableTurnRecordV1 = Object.freeze({
        version: 1,
        requestId: turn.requestId,
        conversationId: turn.conversationId,
        conversationRevision: turn.conversationRevision,
        inboundMessageId: turn.inboundMessageId,
        receivedAt: turn.receivedAt,
        assignedActor: turn.assignedActor,
        subjectType: turn.subjectType,
        acceptedAt,
      });
      const prior = records.get(turn.inboundMessageId);
      if (prior) {
        const same =
          prior.conversationId === next.conversationId &&
          prior.conversationRevision === next.conversationRevision &&
          prior.inboundMessageId === next.inboundMessageId &&
          prior.receivedAt === next.receivedAt &&
          prior.assignedActor === next.assignedActor &&
          prior.subjectType === next.subjectType;
        if (same && prior.requestId === turn.requestId) {
          return Promise.resolve({ outcome: 'replay' as const, record: prior });
        }
        return Promise.resolve(
          same
            ? { outcome: 'duplicate' as const, record: prior }
            : { outcome: 'conflict' as const },
        );
      }
      records.set(turn.inboundMessageId, next);
      return Promise.resolve({ outcome: 'accepted' as const, record: next });
    },
    claimNext: () => Promise.resolve(null),
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    release: () => Promise.resolve(),
    recoverStale: () => Promise.resolve(0),
    snapshot: () =>
      Promise.resolve({
        pending: records.size,
        processing: 0,
        completed: 0,
        failed: 0,
        oldestPendingAgeMs: null,
      }),
  });
  return { spool, records };
}

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

async function startServer(now: Date, turnSpool?: DurableTurnSpool): Promise<string> {
  const server = createGatewayServer({
    config,
    now: () => now,
    ...(turnSpool ? { turnSpool } : {}),
  });
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

function turn(now: Date, over: Partial<Record<string, unknown>> = {}) {
  return {
    protocol: 'qfj.whatsapp.turn',
    version: 1,
    caller: 'quickfurno-core',
    audience: 'qf-jarvis',
    requestId: '44444444-4444-4444-8444-444444444444',
    issuedAt: now.toISOString(),
    conversationId: '55555555-5555-4555-8555-555555555555',
    conversationRevision: 7,
    inboundMessageId: '66666666-6666-4666-8666-666666666666',
    receivedAt: now.toISOString(),
    assignedActor: 'RIYA',
    subjectType: 'client',
    normalizedText: 'hello',
    ...over,
  } as const;
}

function signedTurnHeaders(body: string, request: ReturnType<typeof turn>): Record<string, string> {
  const signature = sign(
    null,
    Buffer.from(
      whatsAppTurnSigningInput({
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

  it('durably accepts a signed WhatsApp turn and stores no normalized text', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const memory = memoryTurnSpool();
    const base = await startServer(now, memory.spool);
    const request = turn(now);
    const body = JSON.stringify(request);
    const response = await fetch(`${base}${WHATSAPP_TURN_PATH}`, {
      method: 'POST',
      headers: signedTurnHeaders(body, request),
      body,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'accepted', durable: true });
    const stored = memory.records.get(request.inboundMessageId);
    expect(stored?.assignedActor).toBe('RIYA');
    expect(stored).not.toHaveProperty('normalizedText');
  });

  it('converges a re-signed duplicate turn and rejects identity conflict', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const memory = memoryTurnSpool();
    const base = await startServer(now, memory.spool);
    const first = turn(now);
    const sendTurn = async (request: ReturnType<typeof turn>) => {
      const body = JSON.stringify(request);
      return fetch(`${base}${WHATSAPP_TURN_PATH}`, {
        method: 'POST',
        headers: signedTurnHeaders(body, request),
        body,
      });
    };
    expect((await sendTurn(first)).status).toBe(202);
    const replayResponse = await sendTurn(first);
    expect(replayResponse.status).toBe(409);
    expect(await replayResponse.json()).toEqual({ error: 'replay_rejected' });
    const duplicate = turn(now, { requestId: '77777777-7777-4777-8777-777777777777' });
    const duplicateResponse = await sendTurn(duplicate);
    expect(duplicateResponse.status).toBe(202);
    expect(await duplicateResponse.json()).toMatchObject({ status: 'duplicate' });
    const conflict = turn(now, { conversationRevision: 8 });
    expect((await sendTurn(conflict)).status).toBe(409);
  });

  it('refuses WhatsApp turns when durable spool is not configured', async () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const base = await startServer(now);
    const request = turn(now);
    const body = JSON.stringify(request);
    const response = await fetch(`${base}${WHATSAPP_TURN_PATH}`, {
      method: 'POST',
      headers: signedTurnHeaders(body, request),
      body,
    });
    expect(response.status).toBe(503);
  });
});
