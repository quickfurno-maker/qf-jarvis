/**
 * Deterministic SYNTHETIC execution context for one evaluation turn (MVP-P2A.2).
 *
 * ### Why the operator has to build this at all
 *
 * The real Riya profile needs a continuity state and a Core availability snapshot — that is what
 * makes it the real profile rather than a bare chat call. An evaluation run has neither: there is no
 * conversation and there is certainly no QuickFurno Core to read. So the operator builds both, from
 * independently authored placeholders, through the SAME public constructors production uses. A
 * hand-rolled object cast to the contract would let an evaluation turn carry a state production could
 * never produce.
 *
 * ### Independently authored, and that is load-bearing
 *
 * Nothing here reads `passingShape`, `expectedObservations`, `requiredQualityDimensions` or any other
 * evaluator field. If the situation were derived from the answer key, a candidate would be handed the
 * conversation that makes the expected answer correct — and the resulting "measurement" would be of
 * the corpus, not the model. A spec asserts this module names no expectation field.
 *
 * ### Phase drives the state, and the contract is strict about it
 *
 * `createRiyaConversationContinuityState` refuses a `SUMMARY`-or-later state whose summary is not
 * confirmed, or that lacks the four summary-required discovery facts, or a `COMPLETE` without
 * completion evidence. Those are real invariants, so a post-summary P10 case genuinely needs a
 * populated prior conversation. The placeholders below supply one — the same one for every case at
 * that phase, so the only thing that varies between two cases is the client turn being measured.
 */
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateV1,
  RiyaConversationPhase,
} from '@qf-jarvis/riya-conversation-continuity';

/** The synthetic tenant and conversation. Obvious placeholders; no real identifier is reachable. */
export const SYNTHETIC_TENANT_ID = 'tenant.synthetic.evaluation';
export const SYNTHETIC_CONVERSATION_PREFIX = 'conv.synthetic.evaluation';

/**
 * The synthetic Core availability snapshot.
 *
 * One service, two cities, and the service-city pairs written out EXPLICITLY rather than implied by
 * the two lists. That is the rule RWC-P5 exists to enforce and the prompt is written to obey, so an
 * evaluation snapshot that left it implicit would be testing Riya against a world where the rule does
 * not apply.
 *
 * Parsed through Core's own public parser: if the shape is wrong the operator fails here rather than
 * shipping a snapshot the production reader would have refused.
 */
export const SYNTHETIC_AVAILABILITY: CoreServiceAvailabilitySnapshotV1 =
  parseCoreServiceAvailabilitySnapshotV1({
    version: 1,
    snapshotRef: 'core.snapshot.synthetic.evaluation.v1',
    taxonomyVersion: 1,
    cities: [
      { ref: 'city.alpha', displayName: 'City Alpha' },
      { ref: 'city.beta', displayName: 'City Beta' },
    ],
    services: [{ ref: 'service.alpha', displayName: 'Service Alpha' }],
    availability: [{ serviceRef: 'service.alpha', cityRefs: ['city.alpha', 'city.beta'] }],
  });

/**
 * The prior conversation a post-summary case must already have had.
 *
 * Four placeholders, authored here. `budget.mid` and `timeline.festive` look like corpus values
 * because both are the repository's standing placeholder vocabulary — but they are written in this
 * file, not read from a fixture, and changing a fixture's expectation cannot change them.
 */
const SUMMARY_DISCOVERY = Object.freeze({
  serviceInterestRef: 'service.alpha',
  locationRef: 'city.alpha',
  budgetNote: 'budget.mid',
  timelineNote: 'timeline.festive',
  completeness: 'SUFFICIENT_FOR_CORE_REVIEW' as const,
});

/** Before a summary exists, discovery is legitimately empty and more is required. */
const EARLY_DISCOVERY = Object.freeze({
  completeness: 'MORE_DISCOVERY_REQUIRED' as const,
});

/** The phases at or past `SUMMARY`, which the continuity contract holds to a stricter shape. */
const AT_OR_AFTER_SUMMARY: readonly RiyaConversationPhase[] = Object.freeze([
  'SUMMARY',
  'CONTACT',
  'CONSENT',
  'COMPLETE',
]);

/**
 * Build the continuity state a case starts from, using ONLY its governed starting phase.
 *
 * Deterministic: the same phase always produces the same state, so two runs of the same case put the
 * candidate in exactly the same situation and a difference between them is the model.
 */
export function syntheticContinuityFor(
  phase: RiyaConversationPhase,
  caseId: string,
): RiyaConversationContinuityStateV1 {
  const postSummary = AT_OR_AFTER_SUMMARY.includes(phase);
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: SYNTHETIC_TENANT_ID,
    // Bounded to the identifier grammar and derived from the case reference, so a blocked case is
    // traceable without a content-bearing name.
    conversationId: `${SYNTHETIC_CONVERSATION_PREFIX}.${caseId}`.slice(0, 128),
    continuityRevision: postSummary ? 4 : 1,
    phase,
    discovery: postSummary ? SUMMARY_DISCOVERY : EARLY_DISCOVERY,
    summaryConfirmed: postSummary,
    // COMPLETE is reachable only through a governed confirmation, so the contract requires evidence
    // that one happened. Opaque, synthetic, and it asserts nothing about a real lead.
    ...(phase === 'COMPLETE'
      ? { completionEvidenceRef: 'evidence.synthetic.evaluation.complete.v1' }
      : {}),
  });
}
