import {
  buildClientIntelligenceContextV1,
  createClientIntelligenceSnapshotV1,
  planClientNextBestAction,
  type ClientIntelligenceSnapshotV1,
  type ClientOpportunityContext,
  type ServiceBlueprintRegistry,
} from '@qf-jarvis/client-intelligence';

import type { QuickFurnoWhatsAppTurnMaterialV2 } from './contracts.js';


export interface WhatsAppClientIntelligenceOptions {
  readonly serviceBlueprintRegistry?: ServiceBlueprintRegistry;
}

function unique(values: readonly (string | undefined)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string => value !== undefined))]);
}

function daysUntil(date: string | undefined, asOf: string): number | undefined {
  if (date === undefined) return undefined;
  const target = Date.parse(date);
  const current = Date.parse(asOf);
  if (!Number.isFinite(target) || !Number.isFinite(current) || target < current) return undefined;
  return Math.ceil((target - current) / 86_400_000);
}

function opportunityContext(
  material: QuickFurnoWhatsAppTurnMaterialV2,
): ClientOpportunityContext | undefined {
  const journey = material.clientJourney;
  if (journey === undefined) return undefined;
  const activeService =
    journey.activeRequirement.status === 'cancelled' || journey.activeRequirement.status === 'closed'
      ? undefined
      : journey.activeRequirement.serviceInterest;
  const pastRequirements = journey.version === 2 ? journey.pastRequirements : [];
  const completedServiceRefs = unique(
    pastRequirements
      .filter((requirement) => requirement.status === 'converted')
      .map((requirement) => requirement.categoryRef),
  );
  const currentProperty =
    journey.version === 2
      ? journey.properties.find((property) => property.relation === 'current')
      : undefined;
  const possessionDays = daysUntil(currentProperty?.possessionDate, material.receivedAt);
  return Object.freeze({
    sourceServiceRefs: unique([activeService, ...completedServiceRefs]),
    activeServiceRefs: unique([activeService]),
    completedServiceRefs,
    declinedServiceRefs: Object.freeze([]),
    recentNurtureServiceRefs: Object.freeze([]),
    explicitInterestServiceRefs: Object.freeze([]),
    ...(currentProperty?.projectStage === undefined
      ? {}
      : { propertyStageRef: currentProperty.projectStage }),
    ...(possessionDays === undefined ? {} : { daysToPossession: possessionDays }),
    hasUnresolvedServiceIssue: false,
  });
}

const MATCH_INTENT =
  /\b(send|share|connect|match|assign|find|give|need|want)\b[\s\S]{0,80}\b(vendor|vendors|professional|professionals|pro|pros|team|teams)\b|\b(vendor|vendors|professional|professionals|pro|pros|team|teams)\b[\s\S]{0,80}\b(send|share|connect|match|assign|find|give|need|want)\b|\b(?:3|three)\s+(?:nearby\s+)?vendors?\b|\bvendors?\s+nearby\b/iu;

function lifecycleState(
  status: QuickFurnoWhatsAppTurnMaterialV2['clientJourney'] extends infer Journey
    ? Journey extends { activeRequirement: { status: infer Status } }
      ? Status
      : never
    : never,
): ClientIntelligenceSnapshotV1['journey']['lifecycleState'] {
  return status === 'converted' ? 'CONVERTED' : status === 'cancelled' ? 'WITHDRAWN' : 'OPEN';
}
function explicitMatchRequested(text: string | undefined): boolean {
  if (text === undefined || text.length === 0) return false;
  return MATCH_INTENT.test(text);
}

function missingFields(material: QuickFurnoWhatsAppTurnMaterialV2): readonly string[] {
  const match = material.clientMatchDecision;
  if (match?.state === 'REQUIREMENT_INCOMPLETE' || match?.state === 'NEEDS_ENRICHMENT') {
    return Object.freeze([...match.missingFields]);
  }
  const journey = material.clientJourney;
  if (journey === undefined) return Object.freeze([]);
  return Object.freeze([...journey.missing]);
}

/**
 * Build the bounded Client OS context that is safe to expose to Riya today.
 *
 * This adapter intentionally refuses to invent vendor journey, satisfaction,
 * follow-up, behaviour or opportunity state. Those values remain neutral until
 * authoritative Core material / certified Jarvis projections are wired in.
 */
export function buildWhatsAppClientIntelligence(
  material: QuickFurnoWhatsAppTurnMaterialV2,
  options: WhatsAppClientIntelligenceOptions = {},
): ClientIntelligenceSnapshotV1 | undefined {
  const journey = material.clientJourney;
  if (journey === undefined) return undefined;

  const matchRequested = explicitMatchRequested(material.normalizedText);
  const matchDecision = material.clientMatchDecision;
  const missingMandatoryFieldRefs = matchRequested ? missingFields(material) : Object.freeze([]);
  const vendorsReleased = matchDecision?.assignmentCount ?? 0;
  const journeyState: ClientIntelligenceSnapshotV1['journey'] = Object.freeze({
    followUpDue: false,
    satisfactionState: 'UNKNOWN',
    serviceRecoveryNeeded: false,
    reassignmentState: 'NONE',
    lifecycleState: lifecycleState(journey.activeRequirement.status),
    vendorsReleased,
    vendorNoContactCount: 0,
    allReleasedVendorsContacted: false,
  });

  const decision = Object.freeze({
    clientQuestionPending: false,
    humanHandoffRequested: false,
    explicitReassignmentRequested: false,
    extraVendorReviewRequested: false,
    matchRequested,
    matchReady: matchDecision?.state === 'READY' && matchDecision.coreReady,
    missingMandatoryFieldRefs,
  });

  const context = opportunityContext(material);
  if (options.serviceBlueprintRegistry !== undefined && context !== undefined) {
    return buildClientIntelligenceContextV1({
      asOf: material.receivedAt,
      behaviourSignals: Object.freeze([]),
      blueprintRegistry: options.serviceBlueprintRegistry,
      opportunityContext: context,
      journey: journeyState,
      decision,
    });
  }

  const nextBestAction = planClientNextBestAction({
    ...decision,
    unresolvedServiceIssue: false,
    vendorsReleased,
    vendorNoContactCount: 0,
    allReleasedVendorsContacted: false,
    satisfactionKnown: false,
    followUpDue: false,
    opportunities: Object.freeze([]),
  });

  return createClientIntelligenceSnapshotV1({
    version: 1,
    behaviour: Object.freeze([]),
    journey: journeyState,
    opportunities: Object.freeze([]),
    nextBestAction,
  });
}
