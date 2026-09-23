import { generateKeyPairSync } from 'node:crypto';

import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it, vi } from 'vitest';

import { createJf6CoreDataTools } from '../jf6-private-process/create-core-data-tools.js';

const keys = generateKeyPairSync('ed25519');
const PRIVATE_PEM = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('JF-6 Core data tools composition', () => {
  it('routes service availability through the signed JF-6 reader and never needs a write-capable intake port', async () => {
    const httpPost = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { requestId: string };
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              protocol: 'qfj.core.service-availability.read',
              version: 1,
              requestId: body.requestId,
              snapshot: syntheticAvailabilitySnapshot(),
            }),
          ),
      });
    });
    const tools = createJf6CoreDataTools({
      availability: {
        baseUrl: 'https://quickfurno.internal/',
        keyId: 'qfj-core-tools-test',
        privateKeyPem: PRIVATE_PEM,
        clock: () => '2026-09-23T10:00:00.000Z',
        requestId: () => 'core.tools.req.1',
        httpPost,
      },
      riyaIntakeReadPort: {
        readCurrent: vi.fn(),
        lookupSubmission: vi.fn(),
      },
    });

    const result = await tools.invoke('CORE_SERVICE_AVAILABILITY_READ', { tenantId: 'quickfurno' });
    expect(result.result).toEqual(syntheticAvailabilitySnapshot());
    expect(httpPost).toHaveBeenCalledOnce();
    expect('submit' in tools).toBe(false);
  });
});
