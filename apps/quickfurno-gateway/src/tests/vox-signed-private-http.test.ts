import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGatewayServer } from '../server.js';
import type { GatewayConfig } from '../config.js';
import { parseSigningKey, parseVerificationKey } from '../protocol.js';
import { createVoxCoreSubjectAuthorizer } from '../../../../contracts/vox/coreSubjectAuthorizer.mjs';
import { createScopedVoxAdvisoryReader } from '../../../../contracts/vox/scopedAdvisoryReader.mjs';
import { signAgentView, VOX_JARVIS_CONTRACT } from '../../../../contracts/vox/agentView.mjs';
const ids = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const nowSec = Math.floor(Date.now() / 1000);
const secret = 'synthetic-only-vox16f-not-a-staging-secret-secret';
const bearer = 'a'.repeat(120) + '.' + 'b'.repeat(120) + '.' + 'c'.repeat(120);
const k1 = generateKeyPairSync('ed25519'),
  k2 = generateKeyPairSync('ed25519');
const a = parseVerificationKey(
  'core-test',
  k1.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
);
const b = parseSigningKey(
  'jarvis-test',
  k2.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
);
if (!a || !b) throw Error('INVALID_TEST_KEY');
const config: GatewayConfig = {
  schemaVersion: 1,
  environment: 'staging',
  serviceId: 'qf-jarvis.quickfurno-gateway',
  verificationKeys: [a],
  signingKey: b,
  maxClockSkewMs: 60000,
  replayTtlMs: 120000,
  replayMaxEntries: 100,
};
const old = process.env['QFJ_VOX_ADVISORY_ENABLED'];
const servers: Array<ReturnType<typeof createGatewayServer>> = [];
afterEach(async () => {
  if (old === undefined) delete process.env['QFJ_VOX_ADVISORY_ENABLED'];
  else process.env['QFJ_VOX_ADVISORY_ENABLED'] = old;
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});
function signed(jti: number) {
  return signAgentView(
    {
      schema: VOX_JARVIS_CONTRACT,
      iss: 'qf-jarvis',
      aud: 'vox-web',
      agent: 'ANISHA',
      channel: 'VENDOR_SERVICE',
      subjectType: 'vendor',
      subjectId: ids(1),
      jti: ids(jti),
      revision: 11,
      iat: nowSec,
      exp: nowSec + 90,
      memoryStatus: 'CONSENTED',
      humanTakeover: true,
      lastEvent: 'HUMAN_REQUESTED',
    },
    secret,
  );
}
async function serve(opts: { coreAllowed: boolean; failDb?: boolean }) {
  let coreReads = 0,
    dbClaims = 0;
  const seen = new Set<string>();
  const authorizeCoreSubject = createVoxCoreSubjectAuthorizer({
    coreOrigin: 'https://staging-core.quickfurno.in',
    fetchImpl: async (url, request) => {
      coreReads++;
      expect(url).toBe('https://staging-core.quickfurno.in/api/vox/v1/agent-subject-access');
      expect(request?.headers).toMatchObject({ authorization: 'Bearer ' + bearer });
      if (!opts.coreAllowed)
        return { ok: false, status: 403, headers: { get: () => 'application/json' } };
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          ok: true,
          schema: 'qf.vox.agent.subject.access.v1',
          allowed: true,
          agent: 'ANISHA',
          subjectType: 'vendor',
          subjectId: ids(1),
          revision: 11,
          staffUserId: ids(9),
          aal2Verified: true,
          objectScopeActive: true,
          cityScopeActive: true,
          humanTakeoverAllowed: true,
          permissions: ['READ_ONLY'],
        }),
      };
    },
  });
  const pool = {
    query: async (_sql: unknown, params: unknown[]) => {
      dbClaims++;
      if (opts.failDb) throw Error('PRIVATE_POSTGRES_DOWN');
      const key = String(params[0]);
      if (seen.has(key)) return { rows: [] };
      seen.add(key);
      return { rows: [{ key_hash: key }] };
    },
  };
  const reader = createScopedVoxAdvisoryReader({
    pool,
    secret,
    authorizeCoreSubject,
    clock: () => nowSec,
  });
  const server = createGatewayServer({ config, voxAdvisoryReader: reader });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url =
    'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/internal/vox/v1/agent-view';
  return { url, reads: () => coreReads, claims: () => dbClaims };
}
function send(url: string, token: string, staff = bearer) {
  return fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + staff, 'content-type': 'application/json' },
    body: JSON.stringify({ agentViewToken: token }),
  });
}
describe('VOX16F signed Anisha Core+Jarvis actual loopback HTTP flow', () => {
  it('genuine HMAC+strict Core callback+one database receipt, then replay 403', async () => {
    process.env['QFJ_VOX_ADVISORY_ENABLED'] = 'staging';
    const h = await serve({ coreAllowed: true });
    const token = signed(3);
    const yes = await send(h.url, token);
    expect(yes.status).toBe(200);
    const v = await yes.json();
    expect(v).toMatchObject({
      agent: 'ANISHA',
      permissions: ['READ_ONLY'],
      proofConsumed: true,
      subjectId: ids(1),
      revision: 11,
    });
    expect(JSON.stringify(v)).not.toContain('Bearer');
    const no = await send(h.url, token);
    expect(no.status).toBe(403);
    expect(h.reads()).toBe(2);
    expect(h.claims()).toBe(2);
  });
  it('current Core denies revoked staff without using replay receipt', async () => {
    process.env['QFJ_VOX_ADVISORY_ENABLED'] = 'staging';
    const h = await serve({ coreAllowed: false });
    expect((await send(h.url, signed(4))).status).toBe(403);
    expect(h.reads()).toBe(1);
    expect(h.claims()).toBe(0);
  });
  it('PostgreSQL unavailable fails closed', async () => {
    process.env['QFJ_VOX_ADVISORY_ENABLED'] = 'staging';
    const h = await serve({ coreAllowed: true, failDb: true });
    expect((await send(h.url, signed(5))).status).toBe(403);
    expect(h.claims()).toBe(1);
  });
  it('invalid staff token rejected without Core or DB lookup', async () => {
    process.env['QFJ_VOX_ADVISORY_ENABLED'] = 'staging';
    const h = await serve({ coreAllowed: true });
    expect((await send(h.url, signed(6), 'fake')).status).toBe(401);
    expect(h.reads()).toBe(0);
    expect(h.claims()).toBe(0);
  });
});
