import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJson } from '@qf-jarvis/core-decision-adapter';
import {
  coreRequest,
  fixedClock,
  scriptedStateReader,
  syntheticState,
} from '@qf-jarvis/core-decision-adapter/testing';
import {
  QUICKFURNO_CORE_DECISION_KEY_ID_HEADER,
  QUICKFURNO_CORE_DECISION_SIGNATURE_HEADER,
  quickFurnoCoreSigningInput,
  rawQuickFurnoCoreBodyDigest,
} from '@qf-jarvis/core-decision-http-transport';

import { createJf6CoreDecisionBoundary } from '../jf6-private-process/create-core-decision-boundary.js';

const KEY_ID = 'qfj-jf6-test';
const keys = generateKeyPairSync('ed25519');
const PRIVATE_PEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const servers: Server[] = [];

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
async function listeningCore(): Promise<{
  readonly baseUrl: string;
  readonly calls: () => number;
  readonly signatureValid: () => boolean;
}> {
  let calls = 0;
  let signatureValid = false;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      calls += 1;
      const raw = Buffer.concat(chunks);
      const body = raw.toString('utf8');
      const command = JSON.parse(body) as Record<string, unknown>;
      const headerKey = req.headers[QUICKFURNO_CORE_DECISION_KEY_ID_HEADER];
      const headerSignature = req.headers[QUICKFURNO_CORE_DECISION_SIGNATURE_HEADER];
      if (headerKey === KEY_ID && typeof headerSignature === 'string') {
        const signingInput = quickFurnoCoreSigningInput({
          commandId: String(command['commandId']),
          createdAt: String(command['createdAt']),
          keyId: KEY_ID,
          bodyDigest: rawQuickFurnoCoreBodyDigest(raw),
        });
        signatureValid = verify(
          null,
          Buffer.from(signingInput, 'utf8'),
          keys.publicKey,
          Buffer.from(headerSignature, 'base64url'),
        );
      }
      const response = canonicalJson({
        protocol: command['protocol'],
        commandId: command['commandId'],
        idempotencyKey: command['idempotencyKey'],
        proposalId: command['proposalId'],
        proposalVersion: command['proposalVersion'],
        conversationId: command['conversationId'],
        boundRevision: command['expectedRevision'],
        proposalDigest: command['proposalDigest'],
        outcome: 'ACCEPTED',
        reason: 'core-decided',
        decidedAt: '2026-07-25T00:00:05Z',
      });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server did not bind');
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/`,
    calls: () => calls,
    signatureValid: () => signatureValid,
  };
}
describe('JF-6 Core decision composition', () => {
  it('makes one signed Core hop and accepts only the existing adapter-validated answer', async () => {
    const core = await listeningCore();
    const adapter = createJf6CoreDecisionBoundary({
      baseUrl: core.baseUrl,
      keyId: KEY_ID,
      privateKeyPem: PRIVATE_PEM,
      stateReader: scriptedStateReader(syntheticState()),
      clock: fixedClock(),
    });

    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.reason).toBe('core-accepted');
    expect(result.transportInvoked).toBe(true);
    expect(core.calls()).toBe(1);
    expect(core.signatureValid()).toBe(true);
  });

  it('preserves the pre-transport state gate: blocked state makes zero HTTP calls', async () => {
    const core = await listeningCore();
    const adapter = createJf6CoreDecisionBoundary({
      baseUrl: core.baseUrl,
      keyId: KEY_ID,
      privateKeyPem: PRIVATE_PEM,
      stateReader: scriptedStateReader(syntheticState({ cancelled: true })),
      clock: fixedClock(),
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('STALE_REVISION');
    expect(result.transportInvoked).toBe(false);
    expect(core.calls()).toBe(0);
  });

  it('refuses an insecure non-loopback Core target at construction', () => {
    expect(() =>
      createJf6CoreDecisionBoundary({
        baseUrl: 'http://quickfurno.example/',
        keyId: KEY_ID,
        privateKeyPem: PRIVATE_PEM,
        stateReader: scriptedStateReader(syntheticState()),
        clock: fixedClock(),
      }),
    ).toThrow();
  });
});
