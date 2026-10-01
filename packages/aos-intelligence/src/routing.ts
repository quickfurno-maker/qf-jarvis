import type { AosModelRoute, AosModelRoutingInput } from './contracts.js';
import { validNonNegativeInt, validUnit } from './validation.js';

export function chooseAosModelRoute(input: AosModelRoutingInput): AosModelRoute {
  if (
    !validUnit(input.noveltyScore) ||
    !validNonNegativeInt(input.evidenceConflictCount, 100) ||
    !validNonNegativeInt(input.similarResolvedCaseCount, 1_000_000)
  ) {
    throw new TypeError('aos-model-routing-input-invalid');
  }

  const deepWorthwhile =
    input.priority === 'P0' || input.evidenceConflictCount > 0 || input.noveltyScore >= 0.8;

  if (deepWorthwhile && input.deepBudgetAvailable) return 'DEEP';

  const deterministicPolicyEnough =
    input.deterministicRecommendationAvailable === true && !deepWorthwhile;
  if (deterministicPolicyEnough) return 'NO_MODEL';

  const deterministicHistoryEnough =
    input.priority === 'P3' &&
    input.evidenceConflictCount === 0 &&
    input.noveltyScore < 0.5 &&
    input.similarResolvedCaseCount >= 5;
  if (deterministicHistoryEnough) return 'NO_MODEL';

  if (input.routineBudgetAvailable) return 'ROUTINE';
  if (input.deepBudgetAvailable && (input.priority === 'P0' || input.priority === 'P1')) {
    return 'DEEP';
  }
  return 'NO_MODEL';
}
