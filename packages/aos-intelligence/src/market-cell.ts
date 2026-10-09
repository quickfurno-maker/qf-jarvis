import { validInstant, validNonNegativeInt, validRef, validUnit } from './validation.js';

export const AOS_MARKET_CELL_STATES = [
  'UNDER_SUPPLIED',
  'BALANCED',
  'OVER_SUPPLIED',
  'LOW_QUALITY_SUPPLY',
  'DEMAND_STARVED',
] as const;
export type AosMarketCellState = (typeof AOS_MARKET_CELL_STATES)[number];

export const AOS_MARKET_CELL_RECOMMENDATIONS = [
  'ACQUIRE_VENDORS',
  'MAINTAIN',
  'HOLD_PACKAGE_ACTIVATION',
  'IMPROVE_VENDOR_QUALITY',
  'BOOST_CLIENT_DEMAND',
] as const;
export type AosMarketCellRecommendation = (typeof AOS_MARKET_CELL_RECOMMENDATIONS)[number];

export interface AosMarketCellPolicy {
  readonly vendorsPerLead: 3;
  readonly healthyOpportunityMin30d: number;
  readonly healthyOpportunityMax30d: number;
  readonly minimumThreeVendorFillRate: number;
  readonly minimumVendorResponseRate: number;
  readonly minimumEffectiveSupplyRatio: number;
  readonly demandDeclineThreshold: number;
}

export const AOS_MARKET_CELL_POLICY_V1: AosMarketCellPolicy = Object.freeze({
  vendorsPerLead: 3 as const,
  healthyOpportunityMin30d: 12,
  healthyOpportunityMax30d: 30,
  minimumThreeVendorFillRate: 0.9,
  minimumVendorResponseRate: 0.65,
  minimumEffectiveSupplyRatio: 0.6,
  demandDeclineThreshold: 0.2,
});

export interface AosMarketCellSnapshot {
  readonly cellRef: string;
  readonly cityRef: string;
  readonly localityRef?: string;
  readonly categoryRef: string;
  readonly observedAt: string;
  readonly evidenceRef: string;
  readonly demand7d: number;
  readonly demand30d: number;
  readonly demand90d: number;
  readonly registeredSupply: number;
  readonly eligibleSupply: number;
  readonly activeSupply: number;
  readonly creditReadySupply: number;
  /** Optional until Core has authoritative vendor-contact acknowledgement evidence. */
  readonly vendorResponseRate?: number;
  readonly threeVendorFillRate: number;
}

export interface AosMarketCellAssessment {
  readonly protocol: 'qfj.aos.market-cell-assessment.v1';
  readonly cellRef: string;
  readonly cityRef: string;
  readonly localityRef?: string;
  readonly categoryRef: string;
  readonly observedAt: string;
  readonly evidenceRef: string;
  readonly state: AosMarketCellState;
  readonly recommendation: AosMarketCellRecommendation;
  readonly leadOpportunities30d: number;
  readonly threeVendorFillRate: number;
  readonly effectiveSupply: number;
  readonly effectiveSupplyRatio: number;
  readonly opportunitiesPerEffectiveVendor30d: number | null;
  readonly recentDemandTrend: number | null;
  readonly mediumDemandTrend: number | null;
  readonly confidence: number;
  readonly reasonCodes: readonly string[];
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validatePolicy(policy: AosMarketCellPolicy): void {
  if (
    !finitePositive(policy.healthyOpportunityMin30d) ||
    !finitePositive(policy.healthyOpportunityMax30d) ||
    policy.healthyOpportunityMin30d >= policy.healthyOpportunityMax30d ||
    !validUnit(policy.minimumThreeVendorFillRate) ||
    !validUnit(policy.minimumVendorResponseRate) ||
    !validUnit(policy.minimumEffectiveSupplyRatio) ||
    !validUnit(policy.demandDeclineThreshold) ||
    policy.demandDeclineThreshold === 0
  ) {
    throw new TypeError('aos-market-cell-policy-invalid');
  }
}

function validate(input: AosMarketCellSnapshot): void {
  if (
    !validRef(input.cellRef) ||
    !validRef(input.cityRef) ||
    (input.localityRef !== undefined && !validRef(input.localityRef)) ||
    !validRef(input.categoryRef) ||
    !validRef(input.evidenceRef) ||
    !validInstant(input.observedAt)
  ) {
    throw new TypeError('aos-market-cell-reference-invalid');
  }
  for (const value of [
    input.demand7d,
    input.demand30d,
    input.demand90d,
    input.registeredSupply,
    input.eligibleSupply,
    input.activeSupply,
    input.creditReadySupply,
  ]) {
    if (!validNonNegativeInt(value, 10_000_000)) {
      throw new TypeError('aos-market-cell-count-invalid');
    }
  }
  if (
    input.demand7d > input.demand30d ||
    input.demand30d > input.demand90d ||
    input.eligibleSupply > input.registeredSupply ||
    input.activeSupply > input.registeredSupply ||
    input.creditReadySupply > input.registeredSupply ||
    (input.vendorResponseRate !== undefined && !validUnit(input.vendorResponseRate)) ||
    !validUnit(input.threeVendorFillRate)
  ) {
    throw new TypeError('aos-market-cell-shape-invalid');
  }
}

function relative(current: number, baseline: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return null;
  return (current - baseline) / baseline;
}

function recommendationFor(state: AosMarketCellState): AosMarketCellRecommendation {
  switch (state) {
    case 'UNDER_SUPPLIED':
      return 'ACQUIRE_VENDORS';
    case 'OVER_SUPPLIED':
      return 'HOLD_PACKAGE_ACTIVATION';
    case 'LOW_QUALITY_SUPPLY':
      return 'IMPROVE_VENDOR_QUALITY';
    case 'DEMAND_STARVED':
      return 'BOOST_CLIENT_DEMAND';
    case 'BALANCED':
      return 'MAINTAIN';
  }
}

export function assessAosMarketCell(
  input: AosMarketCellSnapshot,
  policy: AosMarketCellPolicy = AOS_MARKET_CELL_POLICY_V1,
): AosMarketCellAssessment {
  validate(input);
  validatePolicy(policy);

  const baseSupply = Math.min(input.eligibleSupply, input.activeSupply, input.creditReadySupply);
  const responseQuality =
    input.vendorResponseRate === undefined || policy.minimumVendorResponseRate === 0
      ? 1
      : Math.min(1, input.vendorResponseRate / policy.minimumVendorResponseRate);
  const effectiveSupply = baseSupply * responseQuality;
  const effectiveSupplyRatio =
    input.eligibleSupply === 0 ? 0 : Math.min(1, effectiveSupply / input.eligibleSupply);
  const leadOpportunities30d = input.demand30d * policy.vendorsPerLead;
  const opportunitiesPerEffectiveVendor30d =
    effectiveSupply > 0 ? leadOpportunities30d / effectiveSupply : null;

  const previous23dDaily = Math.max(0, input.demand30d - input.demand7d) / 23;
  const recentDemandTrend = relative(input.demand7d / 7, previous23dDaily);
  const previous60dDaily = Math.max(0, input.demand90d - input.demand30d) / 60;
  const mediumDemandTrend = relative(input.demand30d / 30, previous60dDaily);
  const demandDeclining =
    (recentDemandTrend !== null && recentDemandTrend <= -policy.demandDeclineThreshold) ||
    (mediumDemandTrend !== null && mediumDemandTrend <= -policy.demandDeclineThreshold);

  const rawOpportunitiesPerEligible =
    input.eligibleSupply > 0 ? leadOpportunities30d / input.eligibleSupply : null;
  const qualityWeak =
    (input.vendorResponseRate !== undefined &&
      input.vendorResponseRate < policy.minimumVendorResponseRate) ||
    effectiveSupplyRatio < policy.minimumEffectiveSupplyRatio;
  const rawSupplyCouldCover =
    rawOpportunitiesPerEligible !== null &&
    rawOpportunitiesPerEligible <= policy.healthyOpportunityMax30d;

  let state: AosMarketCellState;
  const reasons: string[] = [];

  if (input.demand30d === 0 && input.eligibleSupply > 0) {
    state = 'DEMAND_STARVED';
    reasons.push('NO_30D_DEMAND_WITH_AVAILABLE_SUPPLY');
  } else if (
    qualityWeak &&
    rawSupplyCouldCover &&
    input.threeVendorFillRate < policy.minimumThreeVendorFillRate
  ) {
    state = 'LOW_QUALITY_SUPPLY';
    reasons.push('RAW_SUPPLY_EXISTS_BUT_EFFECTIVE_QUALITY_IS_LOW');
  } else if (
    input.demand30d > 0 &&
    (effectiveSupply === 0 ||
      opportunitiesPerEffectiveVendor30d === null ||
      opportunitiesPerEffectiveVendor30d > policy.healthyOpportunityMax30d ||
      (input.threeVendorFillRate < policy.minimumThreeVendorFillRate && !rawSupplyCouldCover))
  ) {
    state = 'UNDER_SUPPLIED';
    reasons.push('EFFECTIVE_SUPPLY_BELOW_DEMAND_CAPACITY');
  } else if (
    opportunitiesPerEffectiveVendor30d !== null &&
    opportunitiesPerEffectiveVendor30d < policy.healthyOpportunityMin30d &&
    demandDeclining
  ) {
    state = 'DEMAND_STARVED';
    reasons.push('LOW_VENDOR_OPPORTUNITY_WITH_DECLINING_DEMAND');
  } else if (
    opportunitiesPerEffectiveVendor30d !== null &&
    opportunitiesPerEffectiveVendor30d < policy.healthyOpportunityMin30d
  ) {
    state = 'OVER_SUPPLIED';
    reasons.push('LOW_VENDOR_OPPORTUNITY_WITH_STABLE_SUPPLY');
  } else if (qualityWeak) {
    state = 'LOW_QUALITY_SUPPLY';
    reasons.push('VENDOR_RESPONSE_OR_EFFECTIVE_SUPPLY_QUALITY_LOW');
  } else {
    state = 'BALANCED';
    reasons.push('SUPPLY_DEMAND_WITHIN_GOVERNED_RANGE');
  }

  if (input.threeVendorFillRate < policy.minimumThreeVendorFillRate) {
    reasons.push('THREE_VENDOR_FILL_RATE_BELOW_TARGET');
  }
  if (
    input.vendorResponseRate !== undefined &&
    input.vendorResponseRate < policy.minimumVendorResponseRate
  ) {
    reasons.push('VENDOR_RESPONSE_RATE_BELOW_TARGET');
  }
  if (input.vendorResponseRate === undefined) {
    reasons.push('VENDOR_RESPONSE_EVIDENCE_UNAVAILABLE');
  }

  const confidence = Math.max(
    0.65,
    Math.min(
      0.99,
      0.8 +
        (input.demand90d >= 30 ? 0.08 : 0) +
        (input.eligibleSupply >= 5 ? 0.05 : 0) +
        (input.vendorResponseRate !== undefined ? 0.03 : -0.03) +
        (state !== 'BALANCED' ? 0.03 : 0),
    ),
  );

  return Object.freeze({
    protocol: 'qfj.aos.market-cell-assessment.v1' as const,
    cellRef: input.cellRef,
    cityRef: input.cityRef,
    ...(input.localityRef === undefined ? {} : { localityRef: input.localityRef }),
    categoryRef: input.categoryRef,
    observedAt: input.observedAt,
    evidenceRef: input.evidenceRef,
    state,
    recommendation: recommendationFor(state),
    leadOpportunities30d,
    threeVendorFillRate: input.threeVendorFillRate,
    effectiveSupply,
    effectiveSupplyRatio,
    opportunitiesPerEffectiveVendor30d,
    recentDemandTrend,
    mediumDemandTrend,
    confidence,
    reasonCodes: Object.freeze([...new Set(reasons)]),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}
