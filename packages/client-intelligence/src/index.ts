export {
  CLIENT_BEHAVIOUR_SIGNAL_TYPES,
  CLIENT_BEHAVIOUR_VALUES,
  CLIENT_LIFECYCLE_STATES,
  CLIENT_NEXT_BEST_ACTION_TYPES,
  CLIENT_REASSIGNMENT_STATES,
  CLIENT_SATISFACTION_STATES,
  SERVICE_RELATION_SOURCE_STATES,
  SERVICE_RELEVANCE,
} from './contracts.js';
export type {
  ClientBehaviourSignal,
  ClientBehaviourSignalType,
  ClientBehaviourState,
  ClientBehaviourValue,
  ClientIntelligenceSnapshotV1,
  ClientLifecycleState,
  ClientNextBestAction,
  ClientNextBestActionInput,
  ClientNextBestActionType,
  ClientOpportunityContext,
  ClientReassignmentState,
  ClientSatisfactionState,
  ClientServiceOpportunity,
  ServiceBlueprint,
  ServiceBlueprintRegistry,
  ServiceRelationRule,
  ServiceRelationSourceState,
  ServiceRelationTimingRule,
  ServiceRelevance,
} from './contracts.js';

export { buildClientBehaviourState, createClientBehaviourSignal } from './behaviour.js';
export {
  createServiceBlueprintRegistry,
  missingMandatoryQualificationFields,
} from './service-blueprint.js';
export { evaluateClientServiceOpportunities } from './opportunity.js';
export { planClientNextBestAction } from './next-best-action.js';
export {
  createClientIntelligenceSnapshotV1,
  parseClientIntelligenceSnapshotV1,
} from './snapshot.js';
