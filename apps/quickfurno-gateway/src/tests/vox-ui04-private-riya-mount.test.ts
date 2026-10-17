import { generateKeyPairSync } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { GatewayConfig } from '../config.js';
import { parseSigningKey, parseVerificationKey } from '../protocol.js';
import { createGatewayServer } from '../server.js';

const qf = generateKeyPairSync('ed25519');
const qfj = generateKeyPairSync('ed25519');
const verification = parseVerificationKey(
  'core-test',
  qf.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
);
const signing = parseSigningKey(
  'jarvis-test',
  qfj.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
);
if (!verification || !signing) throw new Error('TEST_KEY_SETUP_FAILED');
const staging: GatewayConfig = {
  schemaVersion: 1,
  environment: 'staging',
  serviceId: 'qf-jarvis.quickfurno-gateway',
  verificationKeys: [verification],
  signingKey: signing,
  maxClockSkewMs: 60000,
  replayTtlMs: 120000,
  replayMaxEntries: 100,
};
type Handler = NonNullable<Parameters<typeof createGatewayServer>[0]['voxRiyaPausePrivateHandler']>;
const servers: ReturnType<typeof createGatewayServer>[] = [];
const original = process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'];
afterEach(async () => {
  if (original === undefined) delete process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'];
  else process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'] = original;
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});
async function endpoint(handler?: Handler, config = staging) {
  const server = createGatewayServer({
    config,
    ...(handler ? { voxRiyaPausePrivateHandler: handler } : {}),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return 'http://127.0.0.1:' + port + '/internal/vox/v1/riya/pause';
}
const body = '{"request":{"schema":"not_a_real_command"},"signature":"fake"}';
function post(url: string, init: RequestInit = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    ...init,
  });
}
describe('VOX UI-04 actual Jarvis private HTTP route source containment', () => {
  it('disabled without explicit staging flag even when handler injected', async () => {
    delete process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'];
    let called = 0;
    const url = await endpoint({
      verifyPrivateIngress: async () => true,
      handle: async () => {
        called++;
      },
    });
    const r = await post(url);
    expect(r.status).toBe(503);
    expect(called).toBe(0);
  });
  it('staging flag is insufficient without installed private signer handler', async () => {
    process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'] = 'staging';
    const url = await endpoint();
    expect((await post(url)).status).toBe(503);
  });
  it('production environment denies even when flag and injected callback present', async () => {
    process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'] = 'staging';
    let calls = 0;
    const url = await endpoint(
      {
        verifyPrivateIngress: async () => true,
        handle: async () => {
          calls++;
        },
      },
      { ...staging, environment: 'production' },
    );
    expect((await post(url)).status).toBe(503);
    expect(calls).toBe(0);
  });
  it('wrong HTTP method or content type denied before private ingress callback', async () => {
    process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'] = 'staging';
    let calls = 0;
    const url = await endpoint({
      verifyPrivateIngress: async () => {
        calls++;
        return true;
      },
      handle: async () => {
        calls++;
      },
    });
    expect((await fetch(url)).status).toBe(405);
    expect((await post(url, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect(calls).toBe(0);
  });
  it('private ingress explicit false and exception both reject', async () => {
    process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'] = 'staging';
    for (const verifyPrivateIngress of [
      async (_req: IncomingMessage) => false,
      async (_req: IncomingMessage): Promise<boolean> => {
        throw Error('cannot trust ingress');
      },
    ]) {
      let calls = 0;
      const url = await endpoint({
        verifyPrivateIngress,
        handle: async () => {
          calls++;
        },
      });
      const r = await post(url);
      expect(r.status).toBe(403);
      expect(calls).toBe(0);
      expect(await r.json()).toEqual({ error: 'private_origin_denied' });
    }
  });
  it('private handler invocation requires all gates; NO implicit provider action', async () => {
    process.env['QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED'] = 'staging';
    let calls = 0;
    // A synthetic handler is used ONLY to prove dispatch. The live gateway
    // index.ts does not inject any implementation and remains default-off.
    const url = await endpoint({
      verifyPrivateIngress: async () => true,
      handle: async (_request: IncomingMessage, response: ServerResponse) => {
        calls++;
        response.writeHead(409, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify({ error: 'signed_core_transaction_unavailable' }));
      },
    });
    const r = await post(url);
    expect(r.status).toBe(409);
    expect(calls).toBe(1);
    expect(await r.json()).toEqual({ error: 'signed_core_transaction_unavailable' });
  });
});
