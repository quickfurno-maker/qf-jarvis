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
    hasUnresolvedServiceIssue: material.clientVendorJourney?.serviceRecoveryNeeded ?? false,
  });
}

const NEGATED_MATCH_INTENT =
  /\b(?:do\s*not|don't|dont|not\s+now|later|cancel|stop|no)\b[\s\S]{0,40}\b(?:vendor|vendors|professional|professionals|pro|pros|team|teams)\b|\b(?:vendor|vendors)\b[\s\S]{0,24}\b(?:nahi|nahin|mat|later)\b|\bmat\s+bhejo\b|\bnahi\s+chahiye\b/iu;
const MATCH_INTENT =
  /\b(?:send|share|connect|match|assign|find|give|need|want|get)\b[\s\S]{0,80}\b(?:vendor|vendors|professional|professionals|pro|pros|team|teams)\b|\b(?:vendor|vendors|professional|professionals|pro|pros|team|teams)\b[\s\S]{0,80}\b(?:send|share|connect|match|assign|find|give|need|want|get)\b|\b(?:3|three|teen)\s+(?:nearby\s+)?vendors?\b|\bvendors?\s+nearby\b|\bvendors?\b[\s\S]{0,40}\b(?:bhejo|bhej\s*do|chahiye|connect\s*karo|dikhao)\b/iu;
const REASSIGNMENT_INTENT =
  /\b(?:replace|change|remove|another)\b[\s\S]{0,40}\bvendor\b|\bvendor\b[\s\S]{0,40}\b(?:replace|change|remove)\b|\b(?:dusra|doosra)\s+vendor\b/iu;

function lifecycleState(
  status: QuickFurnoWhatsAppTurnMaterialV2['clientJourney'] extends infer Journey
    ? Journey extends { activeRequirement: { status: infer Status } }
      ? Status
      : never
    : never,
): ClientIntelligenceSnapshotV1['journey']['lifecycleState'] {
  return status === 'converted' ? 'CONVERTED' : status === 'cancelled' ? 'WITHDRAWN' : 'OPEN';
}
export function explicitMatchRequested(text: string | undefined): boolean {
  const normalized = text?.trim();
  if (!normalized || normalized.length > 4096) return false;
  if (NEGATED_MATCH_INTENT.test(normalized)) return false;
  return MATCH_INTENT.test(normalized);
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
  const vendorJourney = material.clientVendorJourney;
  const vendorsReleased = vendorJourney?.vendorsReleased ?? matchDecision?.assignmentCount ?? 0;
  const journeyState: ClientIntelligenceSnapshotV1['journey'] = Object.freeze({
    followUpDue: vendorJourney?.followUpDue ?? false,
    satisfactionState: vendorJourney?.satisfactionState ?? 'UNKNOWN',
    serviceRecoveryNeeded: vendorJourney?.serviceRecoveryNeeded ?? false,
    reassignmentState: vendorJourney?.reassignmentState ?? 'NONE',
    lifecycleState: lifecycleState(journey.activeRequirement.status),
    vendorsReleased,
    vendorNoContactCount: vendorJourney?.vendorNoContactCount ?? 0,
    allReleasedVendorsContacted: vendorJourney?.allReleasedVendorsContacted ?? false,
  });

  const decision = Object.freeze({
    clientQuestionPending: false,
    humanHandoffRequested: false,
    explicitReassignmentRequested:
      vendorsReleased > 0 && REASSIGNMENT_INTENT.test(material.normalizedText?.trim() ?? ''),
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
    unresolvedServiceIssue: journeyState.serviceRecoveryNeeded,
    vendorsReleased,
    vendorNoContactCount: journeyState.vendorNoContactCount,
    allReleasedVendorsContacted: journeyState.allReleasedVendorsContacted,
    satisfactionKnown: journeyState.satisfactionState !== 'UNKNOWN',
    followUpDue: journeyState.followUpDue,
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

export function shouldRequestCoreMatch(material: QuickFurnoWhatsAppTurnMaterialV2): boolean {
  return buildWhatsAppClientIntelligence(material)?.nextBestAction.action === 'REQUEST_MATCH';
}
