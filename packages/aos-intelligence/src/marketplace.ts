import type { AosBehaviourContext, AosBehaviourTrigger } from './behavior.js';
import type { AosEvidenceFact } from './contracts.js';
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
