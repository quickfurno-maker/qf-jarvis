import type {
  ClientBehaviourSignal,
  ClientIntelligenceSnapshotV1,
  ClientOpportunityContext,
  ServiceBlueprintRegistry,
} from './contracts.js';
import { CLIENT_BEHAVIOUR_SIGNAL_TYPES } from './contracts.js';
import { buildClientBehaviourState } from './behaviour.js';
import { planClientNextBestAction } from './next-best-action.js';
import { evaluateClientServiceOpportunities } from './opportunity.js';
import { createClientIntelligenceSnapshotV1 } from './snapshot.js';
import { assertUniqueRefs } from './validation.js';

export interface ClientDecisionContextV1 {
  readonly clientQuestionPending: boolean;
  readonly humanHandoffRequested: boolean;
  readonly explicitReassignmentRequested: boolean;
  readonly extraVendorReviewRequested: boolean;
  readonly matchRequested: boolean;
  readonly matchReady: boolean;
  readonly missingMandatoryFieldRefs: readonly string[];
}

export interface ClientIntelligenceContextBuildInputV1 {
  readonly asOf: string;
  readonly behaviourSignals: readonly ClientBehaviourSignal[];
  readonly blueprintRegistry: ServiceBlueprintRegistry;
  readonly opportunityContext: ClientOpportunityContext;
  readonly journey: ClientIntelligenceSnapshotV1['journey'];
  readonly decision: ClientDecisionContextV1;
}
function validateDecision(input: ClientDecisionContextV1): void {
  assertUniqueRefs(
    input.missingMandatoryFieldRefs,
    'client-intelligence-context-missing-field-invalid',
  );
  if (
    input.explicitReassignmentRequested &&
    input.extraVendorReviewRequested
  ) {
    throw new TypeError('client-intelligence-context-conflicting-vendor-request');
  }
}

export function buildClientIntelligenceContextV1(
  input: ClientIntelligenceContextBuildInputV1,
): ClientIntelligenceSnapshotV1 {
  validateDecision(input.decision);

  const behaviourState = buildClientBehaviourState(input.behaviourSignals, input.asOf);
  const behaviour = CLIENT_BEHAVIOUR_SIGNAL_TYPES.flatMap((signalType) => {
    const signal = behaviourState[signalType];
    return signal === undefined
      ? []
      : [
          Object.freeze({
            signalType,
            value: signal.value,
            confidence: signal.confidence,
          }),
        ];
  });

  const opportunities = evaluateClientServiceOpportunities({
    registry: input.blueprintRegistry,
    context: input.opportunityContext,
  });
  const nextBestAction = planClientNextBestAction({
    clientQuestionPending: input.decision.clientQuestionPending,
    humanHandoffRequested: input.decision.humanHandoffRequested,
    unresolvedServiceIssue: input.journey.serviceRecoveryNeeded,
    explicitReassignmentRequested: input.decision.explicitReassignmentRequested,
    extraVendorReviewRequested: input.decision.extraVendorReviewRequested,
    matchRequested: input.decision.matchRequested,
    matchReady: input.decision.matchReady,
    missingMandatoryFieldRefs: input.decision.missingMandatoryFieldRefs,
    vendorsReleased: input.journey.vendorsReleased,
    vendorNoContactCount: input.journey.vendorNoContactCount,
    allReleasedVendorsContacted: input.journey.allReleasedVendorsContacted,
    satisfactionKnown: input.journey.satisfactionState !== 'UNKNOWN',
    followUpDue: input.journey.followUpDue,
    opportunities,
  });

  return createClientIntelligenceSnapshotV1({
    version: 1,
    behaviour,
    journey: input.journey,
    opportunities: opportunities.map((opportunity) =>
      Object.freeze({
        serviceRef: opportunity.serviceRef,
        score: opportunity.score,
        relevance: opportunity.relevance,
        explicitInterest: opportunity.explicitInterest,
      }),
    ),
    nextBestAction,
  });
}
