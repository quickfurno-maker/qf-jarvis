import {
  createClientIntelligenceSnapshotV1,
  planClientNextBestAction,
  type ClientIntelligenceSnapshotV1,
} from '@qf-jarvis/client-intelligence';

import type { QuickFurnoWhatsAppTurnMaterialV2 } from './contracts.js';

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
): ClientIntelligenceSnapshotV1 | undefined {
  const journey = material.clientJourney;
  if (journey === undefined) return undefined;

  const matchRequested = explicitMatchRequested(material.normalizedText);
  const missingMandatoryFieldRefs = matchRequested ? missingFields(material) : Object.freeze([]);
  const journeyState: ClientIntelligenceSnapshotV1['journey'] = Object.freeze({
    followUpDue: false,
    satisfactionState: 'UNKNOWN',
    serviceRecoveryNeeded: false,
    reassignmentState: 'NONE',
    lifecycleState: lifecycleState(journey.activeRequirement.status),
    vendorsReleased: 0,
    vendorNoContactCount: 0,
    allReleasedVendorsContacted: false,
  });

  const nextBestAction = planClientNextBestAction({
    clientQuestionPending: false,
    humanHandoffRequested: false,
    unresolvedServiceIssue: false,
    explicitReassignmentRequested: false,
    extraVendorReviewRequested: false,
    matchRequested,
    matchReady: false,
    missingMandatoryFieldRefs,
    vendorsReleased: 0,
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
