import {
  AOS_DETECTOR_TYPES,
  AOS_PRIORITIES,
  type AosPriority,
  type AosSignal,
} from './contracts.js';
import {
  validInstant,
  validNonNegativeInt,
  validReasonCode,
  validRef,
  validUnit,
} from './validation.js';

type SignalInput = Omit<AosSignal, 'executionAuthority' | 'businessEffect'>;

function uniqueRefs(refs: readonly string[]): readonly string[] {
  if (refs.length < 1 || refs.length > 32 || refs.some((ref) => !validRef(ref))) {
    throw new TypeError('aos-signal-evidence-invalid');
  }
  return Object.freeze([...new Set(refs)]);
}

export function createAosSignal(input: SignalInput): AosSignal {
  if (
    !validRef(input.signalId) ||
    !validRef(input.detectorId) ||
    !AOS_DETECTOR_TYPES.includes(input.detectorType) ||
    !validRef(input.caseKey) ||
    !validRef(input.subjectRef) ||
    (input.correlationRef !== undefined && !validRef(input.correlationRef))
  ) {
    throw new TypeError('aos-signal-reference-invalid');
  }
  if (
    !AOS_PRIORITIES.includes(input.priority) ||
    !validUnit(input.score) ||
    !validInstant(input.observedAt) ||
    !validReasonCode(input.reasonCode)
  ) {
    throw new TypeError('aos-signal-value-invalid');
  }

  return Object.freeze({
    ...input,
    evidenceRefs: uniqueRefs(input.evidenceRefs),
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export interface InvariantObservation {
  readonly signalId: string;
  readonly detectorId: string;
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly correlationRef?: string;
  readonly violated: boolean;
  readonly priority: AosPriority;
  readonly observedAt: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string;
}

export function detectInvariantViolation(input: InvariantObservation): AosSignal | undefined {
  if (!input.violated) return undefined;
  return createAosSignal({
    signalId: input.signalId,
    detectorId: input.detectorId,
    detectorType: 'BUSINESS_INVARIANT',
    caseKey: input.caseKey,
    subjectRef: input.subjectRef,
    ...(input.correlationRef === undefined ? {} : { correlationRef: input.correlationRef }),
    priority: input.priority,
    score: 1,
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
    reasonCode: input.reasonCode,
  });
}

export interface SlaObservation {
  readonly signalId: string;
  readonly detectorId: string;
  readonly detectorType?: 'SLA' | 'JOURNEY';
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly correlationRef?: string;
  readonly elapsedMs: number;
  readonly thresholdMs: number;
  readonly priority: AosPriority;
  readonly observedAt: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string;
}

export function detectSlaBreach(input: SlaObservation): AosSignal | undefined {
  if (
    !validNonNegativeInt(input.elapsedMs) ||
    !validNonNegativeInt(input.thresholdMs) ||
    input.thresholdMs < 1
  ) {
    throw new TypeError('aos-sla-observation-invalid');
  }
  if (input.elapsedMs <= input.thresholdMs) return undefined;

  const overrun = (input.elapsedMs - input.thresholdMs) / input.thresholdMs;
  return createAosSignal({
    signalId: input.signalId,
    detectorId: input.detectorId,
    detectorType: input.detectorType ?? 'SLA',
    caseKey: input.caseKey,
    subjectRef: input.subjectRef,
    ...(input.correlationRef === undefined ? {} : { correlationRef: input.correlationRef }),
    priority: input.priority,
    score: Math.min(1, 0.5 + overrun / 2),
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
    reasonCode: input.reasonCode,
  });
}

export interface RelativeAnomalyObservation {
  readonly signalId: string;
  readonly detectorId: string;
  readonly detectorType?: 'RELATIVE_ANOMALY' | 'CHANGE_POINT' | 'UNKNOWN_PATTERN';
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly correlationRef?: string;
  readonly current: number;
  readonly baseline: number;
  readonly minimumRelativeDelta: number;
  readonly direction: 'HIGH_IS_BAD' | 'LOW_IS_BAD' | 'BOTH';
  readonly warningPriority: AosPriority;
  readonly criticalPriority: AosPriority;
  readonly observedAt: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string;
}

export function detectRelativeAnomaly(input: RelativeAnomalyObservation): AosSignal | undefined {
  if (
    !Number.isFinite(input.current) ||
    !Number.isFinite(input.baseline) ||
    input.baseline === 0 ||
    !Number.isFinite(input.minimumRelativeDelta) ||
    input.minimumRelativeDelta <= 0 ||
    input.minimumRelativeDelta > 10
  ) {
    throw new TypeError('aos-relative-observation-invalid');
  }
  const delta = (input.current - input.baseline) / Math.abs(input.baseline);
  const high = delta >= input.minimumRelativeDelta;
  const low = delta <= -input.minimumRelativeDelta;
  const allowed =
    (high && (input.direction === 'HIGH_IS_BAD' || input.direction === 'BOTH')) ||
    (low && (input.direction === 'LOW_IS_BAD' || input.direction === 'BOTH'));
  if (!allowed) return undefined;

  const critical = Math.abs(delta) >= input.minimumRelativeDelta * 2;
  return createAosSignal({
    signalId: input.signalId,
    detectorId: input.detectorId,
    detectorType: input.detectorType ?? 'RELATIVE_ANOMALY',
    caseKey: input.caseKey,
    subjectRef: input.subjectRef,
    ...(input.correlationRef === undefined ? {} : { correlationRef: input.correlationRef }),
    priority: critical ? input.criticalPriority : input.warningPriority,
    score: Math.min(1, Math.abs(delta)),
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
    reasonCode: input.reasonCode,
  });
}

export interface SupplyDemandObservation {
  readonly signalId: string;
  readonly detectorId: string;
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly openDemand: number;
  readonly eligibleSupply: number;
  readonly maximumDemandPerSupply: number;
  readonly observedAt: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string;
}
export function detectSupplyDemandPressure(input: SupplyDemandObservation): AosSignal | undefined {
  if (
    !validNonNegativeInt(input.openDemand, 10_000_000) ||
    !validNonNegativeInt(input.eligibleSupply, 10_000_000) ||
    !Number.isFinite(input.maximumDemandPerSupply) ||
    input.maximumDemandPerSupply <= 0
  ) {
    throw new TypeError('aos-supply-demand-observation-invalid');
  }
  if (input.openDemand === 0) return undefined;

  const ratio =
    input.eligibleSupply === 0 ? Number.POSITIVE_INFINITY : input.openDemand / input.eligibleSupply;
  if (ratio <= input.maximumDemandPerSupply) return undefined;

  const pressure =
    input.eligibleSupply === 0 ? 1 : Math.min(1, ratio / input.maximumDemandPerSupply - 1);
  return createAosSignal({
    signalId: input.signalId,
    detectorId: input.detectorId,
    detectorType: 'SUPPLY_DEMAND',
    caseKey: input.caseKey,
    subjectRef: input.subjectRef,
    priority: input.eligibleSupply === 0 || ratio >= input.maximumDemandPerSupply * 2 ? 'P1' : 'P2',
    score: pressure,
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
    reasonCode: input.reasonCode,
  });
}

export interface BusinessEventObservation {
  readonly signalId: string;
  readonly detectorId: string;
  readonly detectorType?: 'BUSINESS_EVENT' | 'OPPORTUNITY' | 'SUPPLY_DEMAND';
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly correlationRef?: string;
  readonly priority: AosPriority;
  readonly observedAt: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string;
  readonly score?: number;
}

export function createBusinessEventSignal(input: BusinessEventObservation): AosSignal {
  return createAosSignal({
    signalId: input.signalId,
    detectorId: input.detectorId,
    detectorType: input.detectorType ?? 'BUSINESS_EVENT',
    caseKey: input.caseKey,
    subjectRef: input.subjectRef,
    ...(input.correlationRef === undefined ? {} : { correlationRef: input.correlationRef }),
    priority: input.priority,
    score: input.score ?? 1,
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
    reasonCode: input.reasonCode,
  });
}
