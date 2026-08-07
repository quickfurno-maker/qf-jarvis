/**
 * Canonical state builders for the specs. Test-only, excluded from the emitting build.
 *
 * Every fixture is built through the REAL `createRiyaConversationContinuityState`. A hand-rolled
 * object literal cast to the state type would let a spec assert a round trip for a value the
 * contract would never have produced -- and the round trip is the thing being proved.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateV1,
  RiyaConversationPhase,
} from '@qf-jarvis/riya-conversation-continuity';

/**
 * The state a first turn creates: nothing discovered, nothing confirmed, revision 0.
 *
 * `locationRef` exists so two candidates for the SAME key can differ in CONTENT rather than in
 * revision. Since RWC-P2B-R1 a durable row is born at revision 0, so a nonzero candidate is refused
 * as invalid input and could no longer be used to tell two racers apart.
 */
export function initialState(
  tenantId: string,
  conversationId: string,
  continuityRevision = 0,
  locationRef?: string,
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId,
    conversationId,
    continuityRevision,
    phase: 'INTRO',
    discovery:
      locationRef === undefined
        ? {
            completeness: 'MORE_DISCOVERY_REQUIRED',
            missingFields: [...DISCOVERY_FIELDS_FROZEN],
          }
        : {
            locationRef,
            completeness: 'MORE_DISCOVERY_REQUIRED',
            missingFields: DISCOVERY_FIELDS_FROZEN.filter((field) => field !== 'location'),
          },
    ...(locationRef === undefined ? {} : { fieldProvenance: { location: 'user_stated' as const } }),
    summaryConfirmed: false,
  });
}

/**
 * A state carrying every one of the seven discovery values, each with provenance.
 *
 * `missingFields` is empty because the constructor refuses a value that is simultaneously listed as
 * outstanding -- a snapshot contradicting itself is exactly the shape a half-applied update leaves.
 */
export function fullyDiscoveredState(
  tenantId: string,
  conversationId: string,
  options: {
    readonly phase?: RiyaConversationPhase;
    readonly continuityRevision?: number;
    readonly summaryConfirmed?: boolean;
    readonly completionEvidenceRef?: string;
  } = {},
): RiyaConversationContinuityStateV1 {
  const phase = options.phase ?? 'SUMMARY';
  const provenance: Partial<Record<DiscoveryField, 'user_stated'>> = {};
  for (const field of DISCOVERY_FIELDS_FROZEN) {
    provenance[field] = 'user_stated';
  }
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId,
    conversationId,
    continuityRevision: options.continuityRevision ?? 1,
    phase,
    discovery: {
      serviceInterestRef: 'service.modular-kitchen',
      locationRef: 'city.pune',
      propertyTypeRef: 'property.apartment-3bhk',
      scopeSummary: 'Full kitchen refit including counters and storage.',
      budgetNote: 'Around 6-8 lakh.',
      timelineNote: 'Starting after the monsoon.',
      consultationPreferenceRef: 'consult.video',
      completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
      missingFields: [],
    },
    fieldProvenance: provenance,
    summaryConfirmed: options.summaryConfirmed ?? false,
    ...(options.completionEvidenceRef === undefined
      ? {}
      : { completionEvidenceRef: options.completionEvidenceRef }),
  });
}

/**
 * The four SUMMARY-required values only, so the summary-readiness rule is satisfied without
 * claiming the three genuinely optional fields were ever discussed.
 */
export function summaryReadyState(
  tenantId: string,
  conversationId: string,
  options: {
    readonly phase?: RiyaConversationPhase;
    readonly continuityRevision?: number;
    readonly summaryConfirmed?: boolean;
    readonly completionEvidenceRef?: string;
  } = {},
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId,
    conversationId,
    continuityRevision: options.continuityRevision ?? 1,
    phase: options.phase ?? 'SUMMARY',
    discovery: {
      serviceInterestRef: 'service.wardrobe',
      locationRef: 'city.mumbai',
      budgetNote: 'Up to 3 lakh.',
      timelineNote: 'Next quarter.',
      // MORE_DISCOVERY_REQUIRED, not SUFFICIENT_FOR_CORE_REVIEW: `createNeedDiscovery` refuses the
      // one combination that would be a lie -- claiming discovery is sufficient for Core review
      // while still listing fields as missing. The three optional fields genuinely are outstanding.
      completeness: 'MORE_DISCOVERY_REQUIRED',
      missingFields: ['propertyType', 'scope', 'consultationPreference'],
    },
    fieldProvenance: {
      serviceInterest: 'user_stated',
      location: 'user_selected',
      budget: 'user_confirmed',
      timeline: 'model_inferred',
    },
    summaryConfirmed: options.summaryConfirmed ?? false,
    ...(options.completionEvidenceRef === undefined
      ? {}
      : { completionEvidenceRef: options.completionEvidenceRef }),
  });
}

/**
 * A legitimate state for each of the nine phases.
 *
 * The five phases before SUMMARY may not have `summaryConfirmed` true and need no discovery; SUMMARY
 * onward must be summary-ready; the three after it must have `summaryConfirmed` true; and COMPLETE
 * must carry completion evidence. Those are the constructor's rules, and this builder obeys them
 * rather than working around them.
 */
export function stateForPhase(
  tenantId: string,
  conversationId: string,
  phase: RiyaConversationPhase,
  continuityRevision = 0,
): RiyaConversationContinuityStateV1 {
  const beforeSummary: readonly RiyaConversationPhase[] = [
    'INTRO',
    'NEED',
    'LOCATION',
    'PROJECT_DETAILS',
    'BUDGET_TIMELINE',
  ];
  if (beforeSummary.includes(phase)) {
    return createRiyaConversationContinuityState({
      version: 1,
      tenantId,
      conversationId,
      continuityRevision,
      phase,
      discovery: {
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: [...DISCOVERY_FIELDS_FROZEN],
      },
      summaryConfirmed: false,
    });
  }
  const afterSummary = phase === 'CONTACT' || phase === 'CONSENT' || phase === 'COMPLETE';
  return summaryReadyState(tenantId, conversationId, {
    phase,
    continuityRevision,
    summaryConfirmed: afterSummary,
    ...(phase === 'COMPLETE' ? { completionEvidenceRef: 'confirmation.evidence.1' } : {}),
  });
}
