import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAosMarketCapacityObservation } from './aos-market-capacity-source';

const roots: string[] = [];
const nowMs = Date.parse('2026-10-09T12:10:00.000Z');

async function fixture(raw: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qfj-aos-market-'));
  roots.push(root);
  const path = join(root, 'market.json');
  await writeFile(path, JSON.stringify(raw), 'utf8');
  return path;
}

function validObservation() {
  return {
    protocol: 'qfj.aos.market-capacity-observation.v1',
    cycleId: 'aos.market.1',
    emittedAt: '2026-10-09T12:00:00.000Z',
    sourceObservedAt: '2026-10-09T11:59:00.000Z',
    responseEvidence: 'UNAVAILABLE',
    sourceCoverage: {
      demandRows: 300,
      excludedDemandRows: 2,
      vendorRows: 120,
      excludedVendorRows: 4,
      assignmentRows: 900,
      cellsTotal: 8,
      cellsReturned: 8,
      cellsTruncated: false,
    },
    stateCounts: {
      UNDER_SUPPLIED: 2,
      BALANCED: 3,
      OVER_SUPPLIED: 1,
      LOW_QUALITY_SUPPLY: 1,
      DEMAND_STARVED: 1,
    },
    recommendationCounts: {
      ACQUIRE_VENDORS: 2,
      MAINTAIN: 3,
      HOLD_PACKAGE_ACTIVATION: 1,
      IMPROVE_VENDOR_QUALITY: 1,
      BOOST_CLIENT_DEMAND: 1,
    },
    topCells: [
      {
        cellRef: 'market.city-alpha.area-alpha.service-alpha',
        cityRef: 'city-alpha',
        localityRef: 'area-alpha',
        categoryRef: 'service-alpha',
        state: 'UNDER_SUPPLIED',
        recommendation: 'ACQUIRE_VENDORS',
        demand30d: 300,
        effectiveSupply: 6,
        opportunitiesPerEffectiveVendor30d: 150,
        threeVendorFillRate: 0.62,
        confidence: 0.96,
        reasonCodes: ['EFFECTIVE_SUPPLY_BELOW_DEMAND_CAPACITY'],
      },
    ],
    executionAuthority: 'NONE',
    businessEffect: false,
    productionMutation: false,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AOS market-capacity observation source', () => {
  it('reads a fresh bounded market snapshot for owner surfaces', async () => {
    const path = await fixture(validObservation());
    await expect(readAosMarketCapacityObservation(path, nowMs)).resolves.toMatchObject({
      status: 'AVAILABLE',
      observation: {
        stateCounts: { UNDER_SUPPLIED: 2, OVER_SUPPLIED: 1 },
        topCells: [
          {
            localityRef: 'area-alpha',
            categoryRef: 'service-alpha',
            recommendation: 'ACQUIRE_VENDORS',
          },
        ],
      },
    });
  });

  it('distinguishes missing and stale snapshots', async () => {
    await expect(readAosMarketCapacityObservation(undefined, nowMs)).resolves.toEqual({
      status: 'NOT_CONNECTED',
    });
    const stale = validObservation();
    stale.emittedAt = '2026-10-09T11:00:00.000Z';
    const path = await fixture(stale);
    await expect(readAosMarketCapacityObservation(path, nowMs)).resolves.toEqual({
      status: 'STALE',
    });
  });

  it('rejects PII-like refs and unknown content fields', async () => {
    const pii = validObservation();
    const [piiCell] = pii.topCells;
    if (piiCell === undefined) throw new TypeError('fixture-invalid');
    piiCell.cellRef = 'market.phone.9876543210';
    await expect(readAosMarketCapacityObservation(await fixture(pii), nowMs)).resolves.toEqual({
      status: 'UNUSABLE',
    });

    const extra = validObservation();
    const [extraCell] = extra.topCells;
    if (extraCell === undefined) throw new TypeError('fixture-invalid');
    Object.assign(extraCell, { clientPhone: 'redacted' });
    await expect(readAosMarketCapacityObservation(await fixture(extra), nowMs)).resolves.toEqual({
      status: 'UNUSABLE',
    });
  });

  it('rejects any attempt to attach production authority', async () => {
    const unsafe = validObservation();
    unsafe.executionAuthority = 'NONE';
    Object.assign(unsafe, { businessEffect: true });
    await expect(readAosMarketCapacityObservation(await fixture(unsafe), nowMs)).resolves.toEqual({
      status: 'UNUSABLE',
    });
  });
});
