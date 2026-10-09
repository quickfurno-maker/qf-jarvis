import type { AosBehaviourContext, AosBehaviourTrigger } from './behavior.js';
import type { AosEvidenceFact } from './contracts.js';
import {
  assessAosMarketCell,
  type AosMarketCellAssessment,
  type AosMarketCellSnapshot,
} from './market-cell.js';
import { detectAosObservation, type AosObservation } from './observation.js';
import { validInstant, validNonNegativeInt, validRef, validUnit } from './validation.js';

export interface AosMarketplaceSliceSnapshot {
  readonly sliceRef: string;
  readonly cityRef: string;
  readonly localityRef?: string;
  readonly categoryRef: string;
  readonly observedAt: string;
  readonly evidenceRef: string;
  readonly openDemand: number;
  readonly eligibleSupply: number;
  readonly maximumDemandPerSupply: number;
  readonly marketCell?: Omit<
    AosMarketCellSnapshot,
    | 'cellRef'
    | 'cityRef'
    | 'localityRef'
    | 'categoryRef'
    | 'observedAt'
    | 'evidenceRef'
    | 'eligibleSupply'
  >;
  readonly vendorResponseRate?: {
    readonly current: number;
    readonly baseline: number;
    readonly minimumRelativeDelta: number;
  };
  readonly firstContactMedianMinutes?: {
    readonly current: number;
    readonly baseline: number;
    readonly minimumRelativeDelta: number;
  };
}

export interface AosMarketplaceBridgeItem {
  readonly observation: AosObservation;
  readonly behaviour?: {
    readonly trigger: AosBehaviourTrigger;
    readonly context: AosBehaviourContext;
  };
  readonly facts: readonly AosEvidenceFact[];
  readonly policyRefs: readonly string[];
}

function fact(
  id: string,
  sourceRef: string,
  observedAt: string,
  value: string | number | boolean,
): AosEvidenceFact {
  return Object.freeze({
    factId: id,
    kind: 'METRIC' as const,
    dataClass: 'BUSINESS_AGGREGATE' as const,
    sourceRef,
    observedAt,
    value,
  });
}

function validate(input: AosMarketplaceSliceSnapshot): void {
  if (
    !validRef(input.sliceRef) ||
    !validRef(input.cityRef) ||
    (input.localityRef !== undefined && !validRef(input.localityRef)) ||
    !validRef(input.categoryRef) ||
    !validRef(input.evidenceRef) ||
    !validInstant(input.observedAt) ||
    !validNonNegativeInt(input.openDemand, 10_000_000) ||
    !validNonNegativeInt(input.eligibleSupply, 10_000_000) ||
    !Number.isFinite(input.maximumDemandPerSupply) ||
    input.maximumDemandPerSupply <= 0
  ) {
    throw new TypeError('aos-marketplace-snapshot-invalid');
  }
  if (
    input.vendorResponseRate !== undefined &&
    (!validUnit(input.vendorResponseRate.current) ||
      !validUnit(input.vendorResponseRate.baseline) ||
      input.vendorResponseRate.baseline <= 0 ||
      !Number.isFinite(input.vendorResponseRate.minimumRelativeDelta) ||
      input.vendorResponseRate.minimumRelativeDelta <= 0 ||
      input.vendorResponseRate.minimumRelativeDelta > 1)
  ) {
    throw new TypeError('aos-marketplace-response-rate-invalid');
  }
  if (
    input.firstContactMedianMinutes !== undefined &&
    (!Number.isFinite(input.firstContactMedianMinutes.current) ||
      !Number.isFinite(input.firstContactMedianMinutes.baseline) ||
      input.firstContactMedianMinutes.current < 0 ||
      input.firstContactMedianMinutes.baseline <= 0 ||
      !Number.isFinite(input.firstContactMedianMinutes.minimumRelativeDelta) ||
      input.firstContactMedianMinutes.minimumRelativeDelta <= 0 ||
      input.firstContactMedianMinutes.minimumRelativeDelta > 10)
  ) {
    throw new TypeError('aos-marketplace-contact-latency-invalid');
  }
}

function caseKey(input: AosMarketplaceSliceSnapshot): string {
  return ['market', input.cityRef, input.localityRef ?? 'all', input.categoryRef].join(':');
}

function scope(input: AosMarketplaceSliceSnapshot): Omit<AosBehaviourContext, 'metrics'> {
  return Object.freeze({
    cityRef: input.cityRef,
    ...(input.localityRef === undefined ? {} : { localityRef: input.localityRef }),
    categoryRef: input.categoryRef,
  });
}

export function marketCellAssessmentForSlice(
  input: AosMarketplaceSliceSnapshot,
): AosMarketCellAssessment | undefined {
  if (input.marketCell === undefined) return undefined;
  return assessAosMarketCell({
    cellRef: input.sliceRef,
    cityRef: input.cityRef,
    ...(input.localityRef === undefined ? {} : { localityRef: input.localityRef }),
    categoryRef: input.categoryRef,
    observedAt: input.observedAt,
    evidenceRef: input.evidenceRef,
    eligibleSupply: input.eligibleSupply,
    ...input.marketCell,
  });
}

function marketCellTrigger(assessment: AosMarketCellAssessment): AosBehaviourTrigger | undefined {
  switch (assessment.state) {
    case 'UNDER_SUPPLIED':
      return 'MARKET_UNDER_SUPPLIED';
    case 'OVER_SUPPLIED':
      return 'MARKET_OVER_SUPPLIED';
    case 'LOW_QUALITY_SUPPLY':
      return 'MARKET_LOW_QUALITY_SUPPLY';
    case 'DEMAND_STARVED':
      return 'MARKET_DEMAND_STARVED';
    case 'BALANCED':
      return undefined;
  }
}

export function bridgeMarketplaceSliceToAos(
  input: AosMarketplaceSliceSnapshot,
): readonly AosMarketplaceBridgeItem[] {
  validate(input);
  const key = caseKey(input);
  const commonFacts = Object.freeze([
    fact('fact:market-open-demand', input.evidenceRef, input.observedAt, input.openDemand),
    fact('fact:market-eligible-supply', input.evidenceRef, input.observedAt, input.eligibleSupply),
  ]);
  const items: AosMarketplaceBridgeItem[] = [];

  const assessment = marketCellAssessmentForSlice(input);
  const capacityTrigger = assessment === undefined ? undefined : marketCellTrigger(assessment);
  if (assessment !== undefined && capacityTrigger !== undefined) {
    const priority =
      assessment.state === 'UNDER_SUPPLIED' || assessment.state === 'LOW_QUALITY_SUPPLY'
        ? ('P1' as const)
        : ('P2' as const);
    items.push(
      Object.freeze({
        observation: Object.freeze({
          kind: 'BUSINESS_EVENT' as const,
          input: Object.freeze({
            signalId: 'signal.' + input.sliceRef + '.market-cell',
            detectorId: 'market.capacity-balance',
            detectorType: 'SUPPLY_DEMAND' as const,
            caseKey: key,
            subjectRef: key,
            priority,
            score: assessment.confidence,
            observedAt: input.observedAt,
            evidenceRefs: Object.freeze([input.evidenceRef]),
            reasonCode: 'MARKET_' + assessment.state,
          }),
        }),
        behaviour: Object.freeze({
          trigger: capacityTrigger,
          context: Object.freeze({
            ...scope(input),
            metrics: Object.freeze({
              matchingDemandCount: input.marketCell?.demand30d ?? input.openDemand,
              vendorResponseRate: input.marketCell?.vendorResponseRate ?? 1,
            }),
          }),
        }),
        facts: Object.freeze([
          ...commonFacts,
          fact(
            'fact:market-demand-7d',
            input.evidenceRef,
            input.observedAt,
            input.marketCell?.demand7d ?? 0,
          ),
          fact(
            'fact:market-demand-30d',
            input.evidenceRef,
            input.observedAt,
            input.marketCell?.demand30d ?? 0,
          ),
          fact(
            'fact:market-demand-90d',
            input.evidenceRef,
            input.observedAt,
            input.marketCell?.demand90d ?? 0,
          ),
          fact(
            'fact:market-registered-supply',
            input.evidenceRef,
            input.observedAt,
            input.marketCell?.registeredSupply ?? 0,
          ),
          fact(
            'fact:market-active-supply',
            input.evidenceRef,
            input.observedAt,
            input.marketCell?.activeSupply ?? 0,
          ),
          fact(
            'fact:market-credit-ready-supply',
            input.evidenceRef,
            input.observedAt,
            input.marketCell?.creditReadySupply ?? 0,
          ),
          fact(
            'fact:market-effective-supply',
            input.evidenceRef,
            input.observedAt,
            assessment.effectiveSupply,
          ),
          fact(
            'fact:market-lead-opportunities-30d',
            input.evidenceRef,
            input.observedAt,
            assessment.leadOpportunities30d,
          ),
          fact(
            'fact:market-three-vendor-fill-rate',
            input.evidenceRef,
            input.observedAt,
            input.marketCell?.threeVendorFillRate ?? 0,
          ),
          fact('fact:market-capacity-state', input.evidenceRef, input.observedAt, assessment.state),
        ]),
        policyRefs: Object.freeze(['aos:marketplace-capacity-balance:v1']),
      }),
    );
  } else if (assessment === undefined) {
    items.push(
      Object.freeze({
        observation: Object.freeze({
          kind: 'SUPPLY_DEMAND' as const,
          input: Object.freeze({
            signalId: 'signal.' + input.sliceRef + '.supply-demand',
            detectorId: 'market.supply-demand',
            caseKey: key,
            subjectRef: key,
            openDemand: input.openDemand,
            eligibleSupply: input.eligibleSupply,
            maximumDemandPerSupply: input.maximumDemandPerSupply,
            observedAt: input.observedAt,
            evidenceRefs: Object.freeze([input.evidenceRef]),
            reasonCode: 'MARKET_SUPPLY_DEMAND_PRESSURE',
          }),
        }),
        behaviour: Object.freeze({
          trigger: 'SUPPLY_SHORTAGE' as const,
          context: Object.freeze({
            ...scope(input),
            metrics: Object.freeze({
              matchingDemandCount: input.openDemand,
            }),
          }),
        }),
        facts: commonFacts,
        policyRefs: Object.freeze(['aos:marketplace-supply-demand:v1']),
      }),
    );
  }

  if (input.vendorResponseRate !== undefined) {
    items.push(
      Object.freeze({
        observation: Object.freeze({
          kind: 'RELATIVE_ANOMALY' as const,
          input: Object.freeze({
            signalId: 'signal.' + input.sliceRef + '.vendor-response',
            detectorId: 'market.vendor-response-rate',
            detectorType: 'RELATIVE_ANOMALY' as const,
            caseKey: key,
            subjectRef: key,
            current: input.vendorResponseRate.current,
            baseline: input.vendorResponseRate.baseline,
            minimumRelativeDelta: input.vendorResponseRate.minimumRelativeDelta,
            direction: 'LOW_IS_BAD' as const,
            warningPriority: 'P2' as const,
            criticalPriority: 'P1' as const,
            observedAt: input.observedAt,
            evidenceRefs: Object.freeze([input.evidenceRef]),
            reasonCode: 'MARKET_VENDOR_RESPONSE_DEGRADED',
          }),
        }),
        behaviour: Object.freeze({
          trigger: 'VENDOR_RESPONSE_DEGRADED' as const,
          context: Object.freeze({
            ...scope(input),
            metrics: Object.freeze({
              vendorResponseRate: input.vendorResponseRate.current,
              matchingDemandCount: input.openDemand,
            }),
          }),
        }),
        facts: Object.freeze([
          ...commonFacts,
          fact(
            'fact:market-vendor-response-current',
            input.evidenceRef,
            input.observedAt,
            input.vendorResponseRate.current,
          ),
          fact(
            'fact:market-vendor-response-baseline',
            input.evidenceRef,
            input.observedAt,
            input.vendorResponseRate.baseline,
          ),
        ]),
        policyRefs: Object.freeze(['aos:marketplace-response-health:v1']),
      }),
    );
  }

  if (input.firstContactMedianMinutes !== undefined) {
    items.push(
      Object.freeze({
        observation: Object.freeze({
          kind: 'RELATIVE_ANOMALY' as const,
          input: Object.freeze({
            signalId: 'signal.' + input.sliceRef + '.first-contact-latency',
            detectorId: 'market.first-contact-latency',
            detectorType: 'RELATIVE_ANOMALY' as const,
            caseKey: key,
            subjectRef: key,
            current: input.firstContactMedianMinutes.current,
            baseline: input.firstContactMedianMinutes.baseline,
            minimumRelativeDelta: input.firstContactMedianMinutes.minimumRelativeDelta,
            direction: 'HIGH_IS_BAD' as const,
            warningPriority: 'P2' as const,
            criticalPriority: 'P1' as const,
            observedAt: input.observedAt,
            evidenceRefs: Object.freeze([input.evidenceRef]),
            reasonCode: 'MARKET_FIRST_CONTACT_LATENCY_DEGRADED',
          }),
        }),
        facts: Object.freeze([
          ...commonFacts,
          fact(
            'fact:market-first-contact-current-minutes',
            input.evidenceRef,
            input.observedAt,
            input.firstContactMedianMinutes.current,
          ),
          fact(
            'fact:market-first-contact-baseline-minutes',
            input.evidenceRef,
            input.observedAt,
            input.firstContactMedianMinutes.baseline,
          ),
        ]),
        policyRefs: Object.freeze(['aos:marketplace-contact-health:v1']),
      }),
    );
  }

  return Object.freeze(
    items.filter((item) => detectAosObservation(item.observation) !== undefined),
  );
}
