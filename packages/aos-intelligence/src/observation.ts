import type { AosSignal } from './contracts.js';
import {
  createBusinessEventSignal,
  detectInvariantViolation,
  detectRelativeAnomaly,
  detectSlaBreach,
  detectSupplyDemandPressure,
  type BusinessEventObservation,
  type InvariantObservation,
  type RelativeAnomalyObservation,
  type SlaObservation,
  type SupplyDemandObservation,
} from './sentry.js';

export type AosObservation =
  | { readonly kind: 'BUSINESS_EVENT'; readonly input: BusinessEventObservation }
  | { readonly kind: 'INVARIANT'; readonly input: InvariantObservation }
  | { readonly kind: 'SLA'; readonly input: SlaObservation }
  | { readonly kind: 'RELATIVE_ANOMALY'; readonly input: RelativeAnomalyObservation }
  | { readonly kind: 'SUPPLY_DEMAND'; readonly input: SupplyDemandObservation };

export function detectAosObservation(input: AosObservation): AosSignal | undefined {
  switch (input.kind) {
    case 'BUSINESS_EVENT':
      return createBusinessEventSignal(input.input);
    case 'INVARIANT':
      return detectInvariantViolation(input.input);
    case 'SLA':
      return detectSlaBreach(input.input);
    case 'RELATIVE_ANOMALY':
      return detectRelativeAnomaly(input.input);
    case 'SUPPLY_DEMAND':
      return detectSupplyDemandPressure(input.input);
  }
}

export interface AosObservationBatch {
  readonly batchId: string;
  readonly observations: readonly AosObservation[];
  readonly generatedAt: string;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}
