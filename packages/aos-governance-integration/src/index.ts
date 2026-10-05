export {
  AOS_MODEL_CAPABILITY_REQUIREMENT,
  classifyAosAdaptiveComplexity,
  selectAosCertifiedModelRelease,
} from './model-control.js';
export type { AosCertifiedModelSelection, AosCertifiedModelSignals } from './model-control.js';

export { createCertifiedAosModelReasoner } from './certified-reasoner.js';
export type { AosCertifiedModelSelectionEvent } from './certified-reasoner.js';

export {
  createAosDecisionAdjudicator,
  shouldAdjudicateAosRecommendation,
} from './decision-adjudication.js';
export type {
  AosAdjudicationDecision,
  AosAdjudicationSignals,
  AosDecisionAdjudicator,
} from './decision-adjudication.js';

export { compareAosPoliciesInDigitalTwin, runAosPolicyDigitalTwin } from './digital-twin.js';
export type {
  AosDigitalTwinScenario,
  AosPolicyDigitalTwinComparison,
  AosPolicyDigitalTwinResult,
} from './digital-twin.js';

export { createAosCanonicalRecommendationProjector } from './canonical-recommendation.js';
export type {
  AosCanonicalRecommendationProjection,
  AosCanonicalRecommendationProjector,
} from './canonical-recommendation.js';
