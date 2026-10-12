import { createHash, generateKeyPairSync, verify, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createQuickFurnoAnishaMemoryConsentReader,
  createQuickFurnoAnishaMemoryPurgeCore,
} from '../src/quickfurno-whatsapp/quickfurno-http.js';
import { createAnishaMemoryPurgeWorker } from '../src/quickfurno-whatsapp/anisha-memory-purge-worker.js';

const vendorId = '44444444-4444-4444-8444-444444444444';
const conversationId = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-12T07:00:00.000Z';
const task = {
  purgeId: '11111111-1111-4111-8111-111111111111',
  vendorId,
  leaseToken: '55555555-5555-4555-8555-555555555555',
};
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keyId = 'anisha-staging-cert-only';
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('AN-A2e signed Core/Jarvis wire certification (loopback, no deployed service)', () => {
  let baseUrl = '';
  let authentic = 0;
  let rejectCount = 0;
  let ackCount = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (typeof chunk === 'string') chunks.push(Buffer.from(chunk, 'utf8'));
        else {
          response.writeHead(400).end();
          return;
        }
      }
      const body = Buffer.concat(chunks);
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      } catch {
        response.writeHead(400).end();
        return;
      }
      const pathname = request.url ?? '';
      const action = pathname.endsWith('-claim')
        ? 'CLAIM'
        : pathname.endsWith('-ack')
          ? 'ACK'
          : pathname.endsWith('-consent')
            ? 'CONSENT'
            : 'UNKNOWN';
      const domain =
        action === 'CONSENT'
          ? 'qfj.anisha.memory-consent.http.sig.v1'
          : 'qfj.anisha.memory-purge.' + action.toLowerCase() + '.http.sig.v1';
      const digest = createHash('sha256').update(body).digest('base64url');
      const signInput = [
        domain,
        'POST',
        pathname,
        'qf-jarvis',
        'quickfurno-core',
        value['requestId'],
        value['issuedAt'],
        keyId,
        digest,
      ].join('\n');
      const signatureHeader = request.headers['x-qfj-signature'];
      const signature = Buffer.from(
        typeof signatureHeader === 'string' ? signatureHeader : '',
        'base64url',
      );
      const authorized =
        request.method === 'POST' &&
        request.headers['x-qfj-key-id'] === keyId &&
        signature.length === 64 &&
        verify(null, Buffer.from(signInput), publicKey, signature) &&
        Math.abs(Date.parse(now) - Date.parse(String(value['issuedAt']))) < 30_000;
      if (!authorized) {
        rejectCount++;
        response.writeHead(401).end();
        return;
      }
      authentic++;
      const common = { version: 1, requestId: value['requestId'] };
      let payload: unknown;
      if (action === 'CONSENT')
        payload = {
          ...common,
          protocol: 'qfj.anisha.memory-consent',
          vendorId,
          conversationId,
          expectedRevision: 9,
          source: 'QUICKFURNO_CORE',
          decision: 'GRANTED',
          observedAt: now,
          consentRevision: 4,
          consentUpdatedAt: now,
          erasurePending: false,
        };
      else if (action === 'CLAIM')
        payload = {
          ...common,
          protocol: 'qfj.anisha.memory-purge',
          action: 'CLAIM',
          tasks: [task],
        };
      else if (action === 'ACK') {
        ackCount++;
        payload = {
          ...common,
          protocol: 'qfj.anisha.memory-purge',
          action: 'ACK',
          acknowledged: true,
        };
      } else {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(payload));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  const httpPost = async (
    url: string,
    init: {
      readonly method: 'POST';
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
      readonly signal: AbortSignal;
      readonly redirect: 'error';
    },
  ) => {
    const result = await fetch(url, init);
    return { status: result.status, text: () => result.text() };
  };
  const cfg = () => ({
    baseUrl,
    keyId,
    privateKeyPem: pem,
    requestId: () => randomUUID(),
    clock: () => now,
    httpPost,
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen({ port: 0, host: '127.0.0.1' }, () => {
        resolve();
      }),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('loopback-bind-failed');
    baseUrl = 'http://127.0.0.1:' + String(address.port) + '/';
  });
  afterAll(async () => {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  });
  it('real TCP POST signs distinct Core consent, claim and ACK domains', async () => {
    const consent = createQuickFurnoAnishaMemoryConsentReader(cfg());
    const c = await consent.read({
      tenantId: 'quickfurno',
      vendorId,
      conversationId,
      expectedRevision: 9,
    });
    expect(c).toMatchObject({
      vendorId,
      decision: 'GRANTED',
      consentRevision: 4,
      erasurePending: false,
    });
    const core = createQuickFurnoAnishaMemoryPurgeCore(cfg());
    const erased: string[] = [];
    const worker = createAnishaMemoryPurgeWorker({
      core,
      erase: async (job) => {
        await Promise.resolve();
        erased.push(job.vendorId);
        return { deletedCount: 1 };
      },
    });
    await expect(worker.runCycle()).resolves.toEqual({
      claimed: 1,
      deleted: 1,
      acknowledged: 1,
      failed: 0,
    });
    expect(erased).toEqual([vendorId]);
    expect(ackCount).toBe(1);
    expect(authentic).toBeGreaterThanOrEqual(3);
  });
  it('tampered body without a matching Ed25519 signature is rejected before a claim', async () => {
    const result = await fetch(baseUrl + 'api/internal/jarvis/anisha-memory-purge-claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-qfj-key-id': keyId,
        'x-qfj-signature': 'tampered',
      },
      body: JSON.stringify({
        protocol: 'qfj.anisha.memory-purge',
        version: 1,
        action: 'CLAIM',
        caller: 'qf-jarvis',
        audience: 'quickfurno-core',
        requestId: randomUUID(),
        issuedAt: now,
        maxItems: 5,
      }),
    });
    expect(result.status).toBe(401);
    expect(rejectCount).toBeGreaterThanOrEqual(1);
  });
});
