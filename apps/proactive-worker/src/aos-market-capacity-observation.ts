import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

import type {
  AosMarketCellAssessment,
  AosMarketCellRecommendation,
  AosMarketCellState,
} from '@qf-jarvis/aos-intelligence';

import type { AosSupervisorCycleResult } from './aos-supervisor-cycle.js';

export interface AosMarketCapacitySourceCoverage {
  readonly demandRows: number;
  readonly excludedDemandRows: number;
  readonly vendorRows: number;
  readonly excludedVendorRows: number;
  readonly assignmentRows: number;
  readonly cellsTotal: number;
  readonly cellsReturned: number;
  readonly cellsTruncated: boolean;
}

export interface AosMarketCapacityObservation {
  readonly protocol: 'qfj.aos.market-capacity-observation.v1';
  readonly cycleId: string;
  readonly emittedAt: string;
  readonly sourceObservedAt: string;
  readonly responseEvidence: 'UNAVAILABLE' | 'AVAILABLE';
  readonly sourceCoverage: AosMarketCapacitySourceCoverage;
  readonly stateCounts: Readonly<Record<AosMarketCellState, number>>;
  readonly recommendationCounts: Readonly<Record<AosMarketCellRecommendation, number>>;
  readonly topCells: readonly Readonly<{
    cellRef: string;
    cityRef: string;
    localityRef?: string;
    categoryRef: string;
    state: AosMarketCellState;
    recommendation: AosMarketCellRecommendation;
    demand30d: number;
    effectiveSupply: number;
    opportunitiesPerEffectiveVendor30d: number | null;
    threeVendorFillRate: number;
    confidence: number;
    reasonCodes: readonly string[];
  }>[];
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

function zeroStates(): Record<AosMarketCellState, number> {
  return {
    UNDER_SUPPLIED: 0,
    BALANCED: 0,
    OVER_SUPPLIED: 0,
    LOW_QUALITY_SUPPLY: 0,
    DEMAND_STARVED: 0,
  };
}
function zeroRecommendations(): Record<AosMarketCellRecommendation, number> {
  return {
    ACQUIRE_VENDORS: 0,
    MAINTAIN: 0,
    HOLD_PACKAGE_ACTIVATION: 0,
    IMPROVE_VENDOR_QUALITY: 0,
    BOOST_CLIENT_DEMAND: 0,
  };
}

function priority(input: AosMarketCellAssessment): number {
  switch (input.state) {
    case 'UNDER_SUPPLIED':
      return 0;
    case 'LOW_QUALITY_SUPPLY':
      return 1;
    case 'DEMAND_STARVED':
      return 2;
    case 'OVER_SUPPLIED':
      return 3;
    case 'BALANCED':
      return 4;
  }
}

export function buildAosMarketCapacityObservation(input: {
  readonly cycle: AosSupervisorCycleResult;
  readonly emittedAt: string;
  readonly sourceObservedAt: string;
  readonly sourceCoverage: AosMarketCapacitySourceCoverage;
  readonly responseEvidence: 'UNAVAILABLE' | 'AVAILABLE';
}): AosMarketCapacityObservation {
  const assessments = input.cycle.marketplace?.marketCells ?? [];
  const states = zeroStates();
  const recommendations = zeroRecommendations();
  for (const assessment of assessments) {
    states[assessment.state] += 1;
    recommendations[assessment.recommendation] += 1;
  }
  const topCells = [...assessments]
    .sort(
      (left, right) =>
        priority(left) - priority(right) ||
        right.confidence - left.confidence ||
        right.leadOpportunities30d - left.leadOpportunities30d ||
        left.cellRef.localeCompare(right.cellRef),
    )
    .slice(0, 25)
    .map((assessment) => {
      return Object.freeze({
        cellRef: assessment.cellRef,
        cityRef: assessment.cityRef,
        ...(assessment.localityRef === undefined ? {} : { localityRef: assessment.localityRef }),
        categoryRef: assessment.categoryRef,
        state: assessment.state,
        recommendation: assessment.recommendation,
        demand30d: Math.floor(assessment.leadOpportunities30d / 3),
        effectiveSupply: assessment.effectiveSupply,
        opportunitiesPerEffectiveVendor30d: assessment.opportunitiesPerEffectiveVendor30d,
        threeVendorFillRate: assessment.threeVendorFillRate,
        confidence: assessment.confidence,
        reasonCodes: Object.freeze([...assessment.reasonCodes]),
      });
    });

  return Object.freeze({
    protocol: 'qfj.aos.market-capacity-observation.v1' as const,
    cycleId: input.cycle.cycleId,
    emittedAt: input.emittedAt,
    sourceObservedAt: input.sourceObservedAt,
    responseEvidence: input.responseEvidence,
    sourceCoverage: Object.freeze({ ...input.sourceCoverage }),
    stateCounts: Object.freeze(states),
    recommendationCounts: Object.freeze(recommendations),
    topCells: Object.freeze(topCells),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}

export interface AosMarketCapacityObservationWriter {
  write(input: {
    readonly cycle: AosSupervisorCycleResult;
    readonly emittedAt: string;
    readonly sourceObservedAt: string;
    readonly sourceCoverage: AosMarketCapacitySourceCoverage;
    readonly responseEvidence: 'UNAVAILABLE' | 'AVAILABLE';
  }): Promise<void>;
}

export function createFileAosMarketCapacityObservationWriter(
  filePath: string,
): AosMarketCapacityObservationWriter {
  if (!isAbsolute(filePath)) throw new TypeError('aos-market-capacity-observation-path-invalid');
  return Object.freeze({
    async write(input: Parameters<AosMarketCapacityObservationWriter['write']>[0]): Promise<void> {
      const snapshot = buildAosMarketCapacityObservation(input);
      await mkdir(dirname(filePath), { recursive: true, mode: 0o750 });
      const temporary = filePath + '.tmp';
      await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o640 });
      await chmod(temporary, 0o640);
      await rename(temporary, filePath);
    },
  });
}
