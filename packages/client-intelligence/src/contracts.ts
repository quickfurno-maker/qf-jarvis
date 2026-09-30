export const CLIENT_BEHAVIOUR_SIGNAL_TYPES = [
  'ENGAGEMENT',
  'URGENCY',
  'REQUIREMENT_CLARITY',
  'PRICE_SENSITIVITY',
  'TRUST_STATUS',
  'DECISION_READINESS',
  'SENTIMENT',
] as const;

export type ClientBehaviourSignalType = (typeof CLIENT_BEHAVIOUR_SIGNAL_TYPES)[number];

export const CLIENT_BEHAVIOUR_VALUES = Object.freeze({
  ENGAGEMENT: ['HIGH', 'NORMAL', 'LOW'],
  URGENCY: ['FLEXIBLE', 'NORMAL', 'URGENT'],
  REQUIREMENT_CLARITY: ['UNCLEAR', 'PARTIAL', 'CLEAR'],
  PRICE_SENSITIVITY: ['UNKNOWN', 'NORMAL', 'PRICE_SENSITIVE'],
  TRUST_STATUS: ['NORMAL', 'NEEDS_REASSURANCE'],
  DECISION_READINESS: ['NEEDS_GUIDANCE', 'COMPARING', 'DECISION_READY'],
  SENTIMENT: ['POSITIVE', 'NEUTRAL', 'HESITANT', 'FRUSTRATED'],
} as const);

export type ClientBehaviourValue =
  (typeof CLIENT_BEHAVIOUR_VALUES)[ClientBehaviourSignalType][number];

export interface ClientBehaviourSignal {
  readonly signalType: ClientBehaviourSignalType;
  readonly value: ClientBehaviourValue;
  readonly confidence: number;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly expiresAt?: string;
  readonly authority: 'ADVISORY_ONLY';
}

export type ClientBehaviourState = Readonly<
  Partial<Record<ClientBehaviourSignalType, ClientBehaviourSignal>>
>;

export const SERVICE_RELEVANCE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ServiceRelevance = (typeof SERVICE_RELEVANCE)[number];

export const SERVICE_RELATION_SOURCE_STATES = ['ACTIVE', 'COMPLETED', 'EITHER'] as const;
export type ServiceRelationSourceState = (typeof SERVICE_RELATION_SOURCE_STATES)[number];

export interface ServiceRelationTimingRule {
  readonly sourceState?: ServiceRelationSourceState;
  readonly propertyStageRefs?: readonly string[];
  readonly possessionWithinDays?: number;
}

export interface ServiceRelationRule {
  readonly targetServiceRef: string;
  readonly relevance: ServiceRelevance;
  readonly timing?: ServiceRelationTimingRule;
}

export interface ServiceBlueprint {
  readonly version: 1;
  readonly serviceRef: string;
  readonly coreCategoryRef: string;
  readonly qualification: {
    readonly mandatoryFieldRefs: readonly string[];
    readonly optionalFieldRefs: readonly string[];
  };
  readonly relatedServices: readonly ServiceRelationRule[];
}

export interface ServiceBlueprintRegistry {
  readonly version: 1;
  readonly blueprints: readonly ServiceBlueprint[];
  get(serviceRef: string): ServiceBlueprint | undefined;
}

export interface ClientOpportunityContext {
  readonly sourceServiceRefs: readonly string[];
  readonly activeServiceRefs: readonly string[];
  readonly completedServiceRefs: readonly string[];
  readonly declinedServiceRefs: readonly string[];
  readonly recentNurtureServiceRefs: readonly string[];
  readonly explicitInterestServiceRefs: readonly string[];
  readonly propertyStageRef?: string;
  readonly daysToPossession?: number;
  readonly hasUnresolvedServiceIssue: boolean;
}

export interface ClientServiceOpportunity {
  readonly serviceRef: string;
  readonly sourceServiceRef: string;
  readonly score: number;
  readonly relevance: ServiceRelevance;
  readonly status: 'NURTURE_ELIGIBLE';
  readonly explicitInterest: boolean;
  readonly reasonCodes: readonly string[];
  readonly authority: 'ADVISORY_ONLY';
}

export const CLIENT_NEXT_BEST_ACTION_TYPES = [
  'ANSWER_CLIENT',
  'ASK_MISSING_FIELD',
  'CHECK_CORE_ELIGIBILITY',
  'REQUEST_MATCH',
  'CHECK_VENDOR_CONTACT',
  'REQUEST_REASSIGNMENT',
  'REQUEST_EXTRA_VENDOR_REVIEW',
  'ASK_SATISFACTION',
  'SURFACE_ADDITIONAL_SERVICE',
  'SCHEDULE_FOLLOWUP_PROPOSAL',
  'SERVICE_RECOVERY',
  'HUMAN_HANDOFF',
] as const;

export type ClientNextBestActionType = (typeof CLIENT_NEXT_BEST_ACTION_TYPES)[number];

export interface ClientNextBestActionInput {
  readonly clientQuestionPending: boolean;
  readonly humanHandoffRequested: boolean;
  readonly unresolvedServiceIssue: boolean;
  readonly explicitReassignmentRequested: boolean;
  readonly extraVendorReviewRequested: boolean;
  readonly matchRequested: boolean;
  readonly matchReady: boolean;
  readonly missingMandatoryFieldRefs: readonly string[];
  readonly vendorsReleased: number;
  readonly vendorNoContactCount: number;
  readonly allReleasedVendorsContacted: boolean;
  readonly satisfactionKnown: boolean;
  readonly followUpDue: boolean;
  readonly opportunities: readonly ClientServiceOpportunity[];
}

export interface ClientNextBestAction {
  readonly action: ClientNextBestActionType;
  readonly reasonCode: string;
  readonly requiredFieldRef?: string;
  readonly serviceRef?: string;
  readonly requiresCoreDecision: boolean;
  readonly businessEffect: false;
  readonly executionAuthorized: false;
}
