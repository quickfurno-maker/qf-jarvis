import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createQuickFurnoAosMarketCapacityReader } from '../quickfurno-whatsapp/aos-market-capacity-http.js';
import type { QuickFurnoWhatsAppHttpPost } from '../quickfurno-whatsapp/quickfurno-http.js';

const PATH = '/api/internal/jarvis/aos-market-capacity';
const DOMAIN = 'qfj.aos.market-capacity.http.sig.v1';
const keys = generateKeyPairSync('ed25519');
const keyId = 'jarvis-aos-test';
const privateKeyPem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

function digest(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}
function signedInput(body: string, requestId: string, issuedAt: string): string {
  return [
    DOMAIN,
    'POST',
    PATH,
    'qf-jarvis',
    'quickfurno-core',
    requestId,
    issuedAt,
    keyId,
    digest(body),
  ].join('\n');
}
function config(httpPost: QuickFurnoWhatsAppHttpPost) {
  return {
    baseUrl: 'https://quickfurno.example/',
    keyId,
    privateKeyPem,
    clock: () => '2026-10-09T12:00:00.000Z',
    requestId: () => 'aos-capacity-request-1',
    httpPost,
    timeoutMs: 2500,
  };
}
function response(requestId: string) {
  return {
    protocol: 'qfj.aos.market-capacity.read',
    version: 1,
    requestId,
    snapshot: {
      protocol: 'qfj.aos.market-capacity.snapshot.v1',
      observedAt: '2026-10-09T12:00:00.000Z',
      windowDays: 90,
      vendorOpportunityPerLead: 3,
      responseEvidence: 'UNAVAILABLE',
      coverage: {
        demandRows: 300,
        excludedDemandRows: 2,
        vendorRows: 120,
        excludedVendorRows: 4,
        assignmentRows: 900,
        cellsTotal: 8,
        cellsReturned: 1,
        cellsTruncated: false,
      },
      cells: [
        {
          cellRef: 'market.pune.wakad.plumber',
          cityRef: 'pune',
          localityRef: 'wakad',
          categoryRef: 'plumber',
          demand7d: 70,
          demand30d: 300,
          demand90d: 900,
          registeredSupply: 120,
          eligibleSupply: 110,
          activeSupply: 115,
          creditReadySupply: 100,
          threeVendorFillRate: 0.98,
        },
      ],
    },
  };
}

describe('AOS market-capacity signed Core reader', () => {
  it('signs the exact request bytes and accepts only the bounded aggregate snapshot', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((url, init) => {
      expect(url).toBe('https://quickfurno.example' + PATH);
      const request = JSON.parse(init.body) as Record<string, unknown>;
      expect(request).toMatchObject({
        protocol: 'qfj.aos.market-capacity.read',
        version: 1,
        caller: 'qf-jarvis',
        audience: 'quickfurno-core',
        tenantId: 'quickfurno',
      });
      const signature = init.headers['x-qfj-signature'];
      expect(signature).toBeDefined();
      expect(
        verify(
          null,
          Buffer.from(
            signedInput(init.body, String(request['requestId']), String(request['issuedAt'])),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature ?? '', 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify(response(String(request['requestId'])))),
      });
    });

    const result = await createQuickFurnoAosMarketCapacityReader(config(post)).read('quickfurno');
    expect(result.responseEvidence).toBe('UNAVAILABLE');
    expect(result.cells[0]).toMatchObject({
      cellRef: 'market.pune.wakad.plumber',
      demand30d: 300,
      creditReadySupply: 100,
      threeVendorFillRate: 0.98,
    });
    expect(JSON.stringify(result)).not.toMatch(/phone|email|message|name/iu);
    expect(post).toHaveBeenCalledOnce();
  });

  it('fails closed on structurally inconsistent supply aggregates', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      const body = response(String(request['requestId']));
      const [cell] = body.snapshot.cells;
      if (cell === undefined) throw new TypeError('fixture-invalid');
      cell.creditReadySupply = 111;
      cell.eligibleSupply = 110;
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
    });
    await expect(
      createQuickFurnoAosMarketCapacityReader(config(post)).read('quickfurno'),
    ).rejects.toThrow('aos-market-capacity-response-invalid');
  });
});
