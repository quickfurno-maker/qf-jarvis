import { createHash, generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';

import {
  JF6_CORE_SERVICE_AVAILABILITY_KEY_ID_HEADER,
  JF6_CORE_SERVICE_AVAILABILITY_SIGNATURE_HEADER,
  Jf6CoreServiceAvailabilityError,
  createJf6CoreServiceAvailabilityReader,
  jf6CoreServiceAvailabilitySigningInput,
  type Jf6CoreServiceAvailabilityHttpPost,
} from '../jf6-private-process/create-core-service-availability-reader.js';

const KEY_ID = 'qfj-availability-test';
const NOW = '2026-09-18T02:00:00.000Z';
const keys = generateKeyPairSync('ed25519');
const PRIVATE_PEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function response(snapshot: unknown = syntheticAvailabilitySnapshot()) {
  return {
    protocol: 'qfj.core.service-availability.read',
    version: 1,
    requestId: 'availability.req.1',
    snapshot,
  };
}
function reader(
  httpPost: Jf6CoreServiceAvailabilityHttpPost,
  over: Partial<Parameters<typeof createJf6CoreServiceAvailabilityReader>[0]> = {},
) {
  return createJf6CoreServiceAvailabilityReader({
    baseUrl: 'https://quickfurno.internal/',
    keyId: KEY_ID,
    privateKeyPem: PRIVATE_PEM,
    clock: () => NOW,
    requestId: () => 'availability.req.1',
    httpPost,
    ...over,
  });
}

describe('JF-6 QuickFurno Core service-availability reader', () => {
  it('makes one signed request and returns only a contract-proved snapshot', async () => {
    let calls = 0;
    const httpPost: Jf6CoreServiceAvailabilityHttpPost = (url, init) => {
      calls += 1;
      expect(url).toBe('https://quickfurno.internal/api/internal/jarvis/service-availability');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(body).toEqual({
        protocol: 'qfj.core.service-availability.read',
        version: 1,
        caller: 'qf-jarvis',
        audience: 'quickfurno-core',
        requestId: 'availability.req.1',
        issuedAt: NOW,
        tenantId: 'quickfurno',
      });
      const signature = init.headers[JF6_CORE_SERVICE_AVAILABILITY_SIGNATURE_HEADER];
      expect(init.headers[JF6_CORE_SERVICE_AVAILABILITY_KEY_ID_HEADER]).toBe(KEY_ID);
      expect(signature).toBeDefined();
      const signingInput = jf6CoreServiceAvailabilitySigningInput({
        requestId: 'availability.req.1',
        issuedAt: NOW,
        keyId: KEY_ID,
        bodyDigest: createHash('sha256').update(Buffer.from(init.body, 'utf8')).digest('base64url'),
      });
      expect(
        verify(
          null,
          Buffer.from(signingInput, 'utf8'),
          keys.publicKey,
          Buffer.from(signature ?? '', 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify(response())),
      });
    };

    const snapshot = await reader(httpPost).readCurrent({ tenantId: 'quickfurno' });
    expect(snapshot).toEqual(syntheticAvailabilitySnapshot());
    expect(calls).toBe(1);
  });

  it('refuses response identity mismatch', async () => {
    const httpPost: Jf6CoreServiceAvailabilityHttpPost = () =>
      Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ ...response(), requestId: 'availability.req.other' })),
      });
    await expect(reader(httpPost).readCurrent({ tenantId: 'quickfurno' })).rejects.toEqual(
      new Jf6CoreServiceAvailabilityError('response-invalid'),
    );
  });

  it('normalizes a malformed Core snapshot to response-invalid', async () => {
    const httpPost: Jf6CoreServiceAvailabilityHttpPost = () =>
      Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              response({
                version: 1,
                snapshotRef: 'bad',
                taxonomyVersion: 1,
                cities: [],
                services: [{ ref: 'svc.one', displayName: 'Service One' }],
                availability: [],
              }),
            ),
          ),
      });
    await expect(reader(httpPost).readCurrent({ tenantId: 'quickfurno' })).rejects.toEqual(
      new Jf6CoreServiceAvailabilityError('response-invalid'),
    );
  });

  it('does not retry a failed request', async () => {
    let calls = 0;
    const httpPost: Jf6CoreServiceAvailabilityHttpPost = () => {
      calls += 1;
      return Promise.reject(new Error('upstream detail'));
    };
    await expect(reader(httpPost).readCurrent({ tenantId: 'quickfurno' })).rejects.toEqual(
      new Jf6CoreServiceAvailabilityError('request-failed'),
    );
    expect(calls).toBe(1);
  });

  it('refuses non-200 without reading authority from the body', async () => {
    const httpPost: Jf6CoreServiceAvailabilityHttpPost = () =>
      Promise.resolve({
        status: 503,
        text: () => Promise.resolve(JSON.stringify(response())),
      });
    await expect(reader(httpPost).readCurrent({ tenantId: 'quickfurno' })).rejects.toEqual(
      new Jf6CoreServiceAvailabilityError('request-failed'),
    );
  });

  it('refuses unsafe Core targets and invalid request identity before network', async () => {
    const post: Jf6CoreServiceAvailabilityHttpPost = () =>
      Promise.resolve({ status: 200, text: () => Promise.resolve('{}') });
    expect(() => reader(post, { baseUrl: 'http://quickfurno.example/' })).toThrow(
      Jf6CoreServiceAvailabilityError,
    );
    await expect(
      reader(post, { requestId: () => 'bad request' }).readCurrent({
        tenantId: 'quickfurno',
      }),
    ).rejects.toEqual(new Jf6CoreServiceAvailabilityError('invalid-input'));
    await expect(reader(post).readCurrent({ tenantId: 'bad tenant' })).rejects.toEqual(
      new Jf6CoreServiceAvailabilityError('invalid-input'),
    );
  });
});
