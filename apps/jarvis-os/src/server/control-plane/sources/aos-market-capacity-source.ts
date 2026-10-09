import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const MAX_FILE_BYTES = 128 * 1024;
const MAX_STALENESS_MS = 30 * 60 * 1_000;
const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const REASON = /^[A-Z0-9_:-]{1,96}$/u;
const CONTACT_LIKE_DIGITS = /\d{7,}/u;
const STATES = [
  'UNDER_SUPPLIED',
  'BALANCED',
  'OVER_SUPPLIED',
  'LOW_QUALITY_SUPPLY',
  'DEMAND_STARVED',
] as const;
const RECOMMENDATIONS = [
  'ACQUIRE_VENDORS',
  'MAINTAIN',
  'HOLD_PACKAGE_ACTIVATION',
  'IMPROVE_VENDOR_QUALITY',
  'BOOST_CLIENT_DEMAND',
] as const;

type MarketState = (typeof STATES)[number];
type MarketRecommendation = (typeof RECOMMENDATIONS)[number];

export interface AosMarketCapacityCellView {
  readonly cellRef: string;
  readonly cityRef: string;
  readonly localityRef?: string;
  readonly categoryRef: string;
  readonly state: MarketState;
  readonly recommendation: MarketRecommendation;
  readonly demand30d: number;
  readonly effectiveSupply: number;
  readonly opportunitiesPerEffectiveVendor30d: number | null;
  readonly threeVendorFillRate: number;
  readonly confidence: number;
  readonly reasonCodes: readonly string[];
}

export interface AosMarketCapacityView {
  readonly observedAt: string;
  readonly sourceObservedAt: string;
  readonly responseEvidence: 'UNAVAILABLE' | 'AVAILABLE';
  readonly cellsTotal: number;
  readonly cellsReturned: number;
  readonly cellsTruncated: boolean;
  readonly stateCounts: Readonly<Record<MarketState, number>>;
  readonly topCells: readonly AosMarketCapacityCellView[];
}

export type AosMarketCapacityRead =
  | Readonly<{ status: 'AVAILABLE'; observation: AosMarketCapacityView }>
  | Readonly<{ status: 'NOT_CONNECTED' | 'STALE' | 'UNUSABLE' }>;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value) && !CONTACT_LIKE_DIGITS.test(value);
}
function marketState(value: unknown): value is MarketState {
  return typeof value === 'string' && STATES.includes(value as MarketState);
}
function marketRecommendation(value: unknown): value is MarketRecommendation {
  return typeof value === 'string' && RECOMMENDATIONS.includes(value as MarketRecommendation);
}

function parseStateCounts(value: unknown): Readonly<Record<MarketState, number>> | null {
  if (!record(value) || !exact(value, STATES)) return null;
  const output: Record<MarketState, number> = {
    UNDER_SUPPLIED: 0,
    BALANCED: 0,
    OVER_SUPPLIED: 0,
    LOW_QUALITY_SUPPLY: 0,
    DEMAND_STARVED: 0,
  };
  for (const key of STATES) {
    if (!count(value[key])) return null;
    output[key] = value[key];
  }
  return Object.freeze(output);
}

function parseCell(value: unknown): AosMarketCapacityCellView | null {
  if (!record(value)) return null;
  const allowed = [
    'cellRef',
    'cityRef',
    'localityRef',
    'categoryRef',
    'state',
    'recommendation',
    'demand30d',
    'effectiveSupply',
    'opportunitiesPerEffectiveVendor30d',
    'threeVendorFillRate',
    'confidence',
    'reasonCodes',
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  if (
    !validRef(value['cellRef']) ||
    !validRef(value['cityRef']) ||
    (value['localityRef'] !== undefined && !validRef(value['localityRef'])) ||
    !validRef(value['categoryRef']) ||
    !marketState(value['state']) ||
    !marketRecommendation(value['recommendation']) ||
    !count(value['demand30d']) ||
    !nonNegative(value['effectiveSupply']) ||
    !(
      value['opportunitiesPerEffectiveVendor30d'] === null ||
      nonNegative(value['opportunitiesPerEffectiveVendor30d'])
    ) ||
    !unit(value['threeVendorFillRate']) ||
    !unit(value['confidence']) ||
    !Array.isArray(value['reasonCodes']) ||
    value['reasonCodes'].length > 12
  )
    return null;

  if (value['reasonCodes'].some((reason) => typeof reason !== 'string')) return null;
  if (value['reasonCodes'].some((reason) => !REASON.test(reason as string))) return null;

  const reasonCodes = Object.freeze([...(value['reasonCodes'] as string[])]);
  return Object.freeze({
    cellRef: value['cellRef'],
    cityRef: value['cityRef'],
    ...(value['localityRef'] === undefined ? {} : { localityRef: value['localityRef'] }),
    categoryRef: value['categoryRef'],
    state: value['state'],
    recommendation: value['recommendation'],

    demand30d: value['demand30d'],
    effectiveSupply: value['effectiveSupply'],
    opportunitiesPerEffectiveVendor30d: value['opportunitiesPerEffectiveVendor30d'],
    threeVendorFillRate: value['threeVendorFillRate'],
    confidence: value['confidence'],
    reasonCodes,
  });
}

function parseObservation(value: unknown): AosMarketCapacityView | null {
  if (!record(value)) return null;
  if (
    !exact(value, [
      'protocol',
      'cycleId',
      'emittedAt',
      'sourceObservedAt',
      'responseEvidence',
      'sourceCoverage',
      'stateCounts',
      'recommendationCounts',
      'topCells',
      'executionAuthority',
      'businessEffect',
      'productionMutation',
    ])
  )
    return null;
  if (
    value['protocol'] !== 'qfj.aos.market-capacity-observation.v1' ||
    value['executionAuthority'] !== 'NONE' ||
    value['businessEffect'] !== false ||
    value['productionMutation'] !== false ||
    (value['responseEvidence'] !== 'UNAVAILABLE' && value['responseEvidence'] !== 'AVAILABLE') ||
    typeof value['emittedAt'] !== 'string' ||
    typeof value['sourceObservedAt'] !== 'string' ||
    !Array.isArray(value['topCells']) ||
    value['topCells'].length > 25
  )
    return null;

  const emittedMs = Date.parse(value['emittedAt']);
  const sourceMs = Date.parse(value['sourceObservedAt']);
  if (!Number.isFinite(emittedMs) || !Number.isFinite(sourceMs)) return null;

  if (!record(value['sourceCoverage'])) return null;
  const coverage = value['sourceCoverage'];
  if (!count(coverage['cellsTotal']) || !count(coverage['cellsReturned'])) return null;
  if (typeof coverage['cellsTruncated'] !== 'boolean') return null;

  const stateCounts = parseStateCounts(value['stateCounts']);
  if (stateCounts === null) return null;
  const parsedCells = value['topCells'].map(parseCell);
  if (parsedCells.some((cell) => cell === null)) return null;

  const topCells = parsedCells.filter((cell): cell is AosMarketCapacityCellView => cell !== null);
  if (topCells.length !== parsedCells.length) return null;
  return Object.freeze({
    observedAt: value['emittedAt'],
    sourceObservedAt: value['sourceObservedAt'],
    responseEvidence: value['responseEvidence'],

    cellsTotal: coverage['cellsTotal'],
    cellsReturned: coverage['cellsReturned'],
    cellsTruncated: coverage['cellsTruncated'],
    stateCounts,
    topCells: Object.freeze(topCells),
  });
}

export async function readAosMarketCapacityObservation(
  filePath: string | undefined,
  nowMs: number = Date.now(),
): Promise<AosMarketCapacityRead> {
  if (filePath === undefined) return Object.freeze({ status: 'NOT_CONNECTED' as const });
  if (!isAbsolute(filePath) || !Number.isFinite(nowMs) || nowMs < 0) {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }
  let raw: string;
  try {
    raw = await readFile(filePath, { encoding: 'utf8' });
  } catch {
    return Object.freeze({ status: 'NOT_CONNECTED' as const });
  }
  if (raw.length < 2 || raw.length > MAX_FILE_BYTES) {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }
  let observation: AosMarketCapacityView | null;
  try {
    observation = parseObservation(JSON.parse(raw) as unknown);
  } catch {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }
  if (observation === null) return Object.freeze({ status: 'UNUSABLE' as const });
  const emittedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(emittedAt) || emittedAt > nowMs + 1_000) {
    return Object.freeze({ status: 'UNUSABLE' as const });
  }
  if (nowMs - emittedAt > MAX_STALENESS_MS) {
    return Object.freeze({ status: 'STALE' as const });
  }
  return Object.freeze({ status: 'AVAILABLE' as const, observation });
}
