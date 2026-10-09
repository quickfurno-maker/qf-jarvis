import { createHash, createPrivateKey, sign } from 'node:crypto';

import { executeQfjScaleRequest } from '@qf-jarvis/cross-system-scale-contract';

import type { QuickFurnoWhatsAppHttpConfig } from './quickfurno-http.js';

const PATH = '/api/internal/jarvis/aos-market-capacity';
const DOMAIN = 'qfj.aos.market-capacity.http.sig.v1';
const PROTOCOL = 'qfj.aos.market-capacity.read';
const CALLER = 'qf-jarvis';
const AUDIENCE = 'quickfurno-core';
const KEY_ID_HEADER = 'x-qfj-key-id';
const SIGNATURE_HEADER = 'x-qfj-signature';
const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const MAX_RESPONSE_BYTES = 512 * 1024;

export interface QuickFurnoAosMarketCapacityCellV1 {
  readonly cellRef: string;
  readonly cityRef: string;
  readonly localityRef: string;
  readonly categoryRef: string;
  readonly demand7d: number;
  readonly demand30d: number;
  readonly demand90d: number;
  readonly registeredSupply: number;
  readonly eligibleSupply: number;
  readonly activeSupply: number;
  readonly creditReadySupply: number;
  readonly threeVendorFillRate: number;
}
export interface QuickFurnoAosMarketCapacitySnapshotV1 {
  readonly protocol: 'qfj.aos.market-capacity.snapshot.v1';
  readonly observedAt: string;
  readonly windowDays: 90;
  readonly vendorOpportunityPerLead: 3;
  readonly responseEvidence: 'UNAVAILABLE';
  readonly coverage: Readonly<{
    demandRows: number;
    excludedDemandRows: number;
    vendorRows: number;
    excludedVendorRows: number;
    assignmentRows: number;
    cellsTotal: number;
    cellsReturned: number;
    cellsTruncated: boolean;
  }>;
  readonly cells: readonly QuickFurnoAosMarketCapacityCellV1[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(),
    expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function nonNegativeInt(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000
  );
}
function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function parseCell(value: unknown): QuickFurnoAosMarketCapacityCellV1 | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'cellRef',
      'cityRef',
      'localityRef',
      'categoryRef',
      'demand7d',
      'demand30d',
      'demand90d',
      'registeredSupply',
      'eligibleSupply',
      'activeSupply',
      'creditReadySupply',
      'threeVendorFillRate',
    ])
  )
    return null;
  for (const key of ['cellRef', 'cityRef', 'localityRef', 'categoryRef'] as const) {
    if (typeof value[key] !== 'string' || !REF.test(value[key])) return null;
  }
  for (const key of [
    'demand7d',
    'demand30d',
    'demand90d',
    'registeredSupply',
    'eligibleSupply',
    'activeSupply',
    'creditReadySupply',
  ] as const) {
    if (!nonNegativeInt(value[key])) return null;
  }
  if (!unit(value['threeVendorFillRate'])) return null;
  const demand7d = value['demand7d'] as number;
  const demand30d = value['demand30d'] as number;
  const demand90d = value['demand90d'] as number;
  const registeredSupply = value['registeredSupply'] as number;
  const eligibleSupply = value['eligibleSupply'] as number;
  const activeSupply = value['activeSupply'] as number;
  const creditReadySupply = value['creditReadySupply'] as number;
  const threeVendorFillRate = value['threeVendorFillRate'];
  if (
    demand7d > demand30d ||
    demand30d > demand90d ||
    activeSupply > registeredSupply ||
    eligibleSupply > registeredSupply ||
    creditReadySupply > eligibleSupply
  )
    return null;
  return Object.freeze({
    cellRef: value['cellRef'] as string,
    cityRef: value['cityRef'] as string,
    localityRef: value['localityRef'] as string,
    categoryRef: value['categoryRef'] as string,
    demand7d,
    demand30d,
    demand90d,
    registeredSupply,
    eligibleSupply,
    activeSupply,
    creditReadySupply,
    threeVendorFillRate,
  });
}
function parseSnapshot(value: unknown): QuickFurnoAosMarketCapacitySnapshotV1 | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'protocol',
      'observedAt',
      'windowDays',
      'vendorOpportunityPerLead',
      'responseEvidence',
      'coverage',
      'cells',
    ])
  )
    return null;
  if (
    value['protocol'] !== 'qfj.aos.market-capacity.snapshot.v1' ||
    value['windowDays'] !== 90 ||
    value['vendorOpportunityPerLead'] !== 3 ||
    value['responseEvidence'] !== 'UNAVAILABLE' ||
    typeof value['observedAt'] !== 'string' ||
    !INSTANT.test(value['observedAt']) ||
    !Number.isFinite(Date.parse(value['observedAt'])) ||
    !Array.isArray(value['cells']) ||
    value['cells'].length > 500 ||
    !isRecord(value['coverage'])
  )
    return null;
  const coverage = value['coverage'];
  if (
    !exactKeys(coverage, [
      'demandRows',
      'excludedDemandRows',
      'vendorRows',
      'excludedVendorRows',
      'assignmentRows',
      'cellsTotal',
      'cellsReturned',
      'cellsTruncated',
    ])
  )
    return null;
  for (const key of [
    'demandRows',
    'excludedDemandRows',
    'vendorRows',
    'excludedVendorRows',
    'assignmentRows',
    'cellsTotal',
    'cellsReturned',
  ] as const) {
    if (!nonNegativeInt(coverage[key])) return null;
  }
  if (
    typeof coverage['cellsTruncated'] !== 'boolean' ||
    coverage['cellsReturned'] !== value['cells'].length
  )
    return null;
  const cells: QuickFurnoAosMarketCapacityCellV1[] = [];
  for (const candidate of value['cells']) {
    const parsed = parseCell(candidate);
    if (parsed === null) return null;
    cells.push(parsed);
  }
  if (new Set(cells.map((one) => one.cellRef)).size !== cells.length) return null;

  const demandRows = Number(coverage['demandRows']);
  const excludedDemandRows = Number(coverage['excludedDemandRows']);
  const vendorRows = Number(coverage['vendorRows']);
  const excludedVendorRows = Number(coverage['excludedVendorRows']);
  const assignmentRows = Number(coverage['assignmentRows']);
  const cellsTotal = Number(coverage['cellsTotal']);
  const cellsReturned = coverage['cellsReturned'];
  const cellsTruncated = coverage['cellsTruncated'];
  return Object.freeze({
    protocol: 'qfj.aos.market-capacity.snapshot.v1' as const,
    observedAt: value['observedAt'],
    windowDays: 90,
    vendorOpportunityPerLead: 3,
    responseEvidence: 'UNAVAILABLE' as const,
    coverage: Object.freeze({
      demandRows,
      excludedDemandRows,
      vendorRows,
      excludedVendorRows,
      assignmentRows,
      cellsTotal,
      cellsReturned,
      cellsTruncated,
    }),
    cells: Object.freeze(cells),
  });
}
function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new TypeError('aos-market-capacity-config-invalid');
  }
  return new URL(PATH, url).toString();
}
function bodyDigest(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}
function signingInput(requestId: string, issuedAt: string, keyId: string, digest: string): string {
  return [DOMAIN, 'POST', PATH, CALLER, AUDIENCE, requestId, issuedAt, keyId, digest].join('\n');
}

export function createQuickFurnoAosMarketCapacityReader(config: QuickFurnoWhatsAppHttpConfig) {
  const url = endpoint(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? 5000;
  const key = createPrivateKey(config.privateKeyPem);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519')
    throw new TypeError('aos-market-capacity-config-invalid');

  return Object.freeze({
    async read(tenantId: string): Promise<QuickFurnoAosMarketCapacitySnapshotV1> {
      if (!REF.test(tenantId)) throw new TypeError('aos-market-capacity-input-invalid');
      const requestId = config.requestId(),
        issuedAt = config.clock();
      if (!REF.test(requestId) || !INSTANT.test(issuedAt) || !Number.isFinite(Date.parse(issuedAt)))
        throw new TypeError('aos-market-capacity-input-invalid');
      const body = JSON.stringify({
        protocol: PROTOCOL,
        version: 1,
        caller: CALLER,
        audience: AUDIENCE,
        requestId,
        issuedAt,
        tenantId,
      });
      const signature = sign(
        null,
        Buffer.from(signingInput(requestId, issuedAt, config.keyId, bodyDigest(body)), 'utf8'),
        key,
      ).toString('base64url');
      const result = await executeQfjScaleRequest({
        url,
        path: PATH,
        body,
        keyId: config.keyId,
        privateKeyPem: config.privateKeyPem,
        actor: 'qf-jarvis',
        requestId,
        idempotencyKey: requestId,
        correlationId: requestId,
        timeoutMs,
        headers: Object.freeze({
          'content-type': 'application/json',
          [KEY_ID_HEADER]: config.keyId,
          [SIGNATURE_HEADER]: signature,
        }),
        httpPost: config.httpPost,
      });
      if (!result.ok || result.response.status !== 200)
        throw new Error('aos-market-capacity-request-failed');
      const raw = await result.response.text();
      if (Buffer.byteLength(raw, 'utf8') < 2 || Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES)
        throw new Error('aos-market-capacity-response-invalid');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('aos-market-capacity-response-invalid');
      }
      if (
        !isRecord(parsed) ||
        !exactKeys(parsed, ['protocol', 'version', 'requestId', 'snapshot']) ||
        parsed['protocol'] !== PROTOCOL ||
        parsed['version'] !== 1 ||
        parsed['requestId'] !== requestId
      ) {
        throw new Error('aos-market-capacity-response-invalid');
      }
      const snapshot = parseSnapshot(parsed['snapshot']);
      if (!snapshot) throw new Error('aos-market-capacity-response-invalid');
      return snapshot;
    },
  });
}