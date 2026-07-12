/**
 * The Phase 2 canonical event catalog.
 *
 * ### What is here, and what is deliberately not
 *
 * Six events. Every one of them is an **architecture lifecycle event** — a fact
 * about the recommend → authorize → execute → report chain that Phase 0 already
 * approved and that this repository already owns.
 *
 * There is **no `lead.created`, no `vendor.onboarded`, no `wallet.debited`**, and
 * their absence is the most important design decision in this file.
 *
 * We have not integrated with QuickFurno Core. We do not know what Core can emit,
 * what its lead record contains, or what it calls the fields. Writing
 * `leadCreatedEventV1` today would mean **inventing a payload shape for a system
 * nobody has looked at** — and then, when Core turns out to disagree, either
 * bending the contract to match whatever Core happens to emit (which is how a
 * contract becomes a description of an implementation) or discovering in Phase 11
 * that four agents were built against a fiction.
 *
 * So Phase 2 establishes the **mechanism** — the envelope, the versioning, the
 * registry, the failure behavior — and registers the lifecycle contracts we
 * genuinely own. **Core's domain event catalog is deferred to the Core integration
 * phase, where the real source data and capabilities are verified first.** The
 * adapter will absorb the difference; the contract will not bend
 * (phased-roadmap.md, Phase 11).
 *
 * ### Naming convention
 *
 *   qf.<aggregate>.<past-tense-fact>
 *
 * Lowercase, dot-separated, and always past tense — an event is a statement that
 * something *happened*, never an instruction that something *should*. `qf.` names
 * the QuickFurno canonical namespace, so an event from anywhere else is
 * distinguishable on sight. Recorded in ADR-0013.
 *
 * ### Every event is sourced from QuickFurno Core
 *
 * Including `qf.recommendation.created`. Jarvis *produces* the recommendation —
 * the payload says so, with `producingSystem: "qf-jarvis"` — but the canonical
 * *event* is emitted by Core once Core has recorded the submission. The artifact's
 * author and the event's authority are different questions, and the envelope
 * answers only the second.
 */

import { z } from 'zod';

import { approvalDecisionV1Schema } from '../approvals/approval-decision.js';
import { communicationStateRecordV1Schema } from '../communications/communication-state-record.js';
import { defineCanonicalEvent } from './canonical-event.js';
import { executionIntentV1Schema } from '../execution/execution-intent.js';
import { executionResultV1Schema } from '../execution/execution-result.js';
import { recommendationLifecycleRecordV1Schema } from '../recommendations/recommendation-lifecycle.js';
import { recommendationV1Schema } from '../recommendations/recommendation.js';

import type {
  AssignmentBatchCompletedEventV1,
  AssignmentBatchCreatedEventV1,
  ClientAdditionalServiceConfirmedEventV1,
  ClientAdditionalServiceIdentifiedEventV1,
  ClientAdditionalServiceRejectedEventV1,
  ClientComplaintRecordedEventV1,
  ClientDissatisfactionRecordedEventV1,
  ClientFollowUpCompletedEventV1,
  ClientFollowUpDueDetectedEventV1,
  ClientLifecycleClosedEventV1,
  ClientReassignmentAuthorizedEventV1,
  ClientReassignmentRejectedEventV1,
  ClientReassignmentRequestedEventV1,
  ClientRequirementCompletedEventV1,
  ClientReviewRequestedEventV1,
  ClientSatisfactionRecordedEventV1,
  LeadLinkedCreatedEventV1,
} from './client-events.js';

import type {
  VendorActivatedEventV1,
  VendorComplaintRecordedEventV1,
  VendorInactivityDetectedEventV1,
  VendorPackageReadinessChangedEventV1,
  VendorPerformanceUpdatedEventV1,
  VendorProfileCompletedEventV1,
  VendorRechargeOpportunityDetectedEventV1,
  VendorRegistrationStartedEventV1,
  VendorRetentionRiskDetectedEventV1,
  VendorVerificationRequestedEventV1,
  VendorWinbackCandidateDetectedEventV1,
} from './vendor-events.js';

import type {
  CommunicationAuthorizationRecordedEventV1,
  CommunicationHumanHandoffRecordedEventV1,
  CommunicationHumanHandoffRequestedEventV1,
  CommunicationResultRecordedEventV1,
  PolicyVersionChangedEventV1,
  PrivacyErasureRecordedEventV1,
  PrivacyErasureRequestedEventV1,
} from './governance-events.js';

/** The registered event types. This list is exhaustive and lives in source control. */
export const CANONICAL_EVENT_TYPES = [
  // --- Architecture lifecycle: recommend → authorize → execute → report ---
  'qf.recommendation.created',
  'qf.recommendation.lifecycle-state-recorded',
  'qf.approval.decision-recorded',
  'qf.execution.intent-issued',
  'qf.execution.result-recorded',
  'qf.communication.state-recorded',

  // --- Target: the client journey and vendor assignment ---
  'qf.client.requirement-completed',
  'qf.client.follow-up-due-detected',
  'qf.client.follow-up-completed',
  'qf.client.satisfaction-recorded',
  'qf.client.dissatisfaction-recorded',
  'qf.client.complaint-recorded',
  'qf.client.reassignment-requested',
  'qf.client.reassignment-authorized',
  'qf.client.reassignment-rejected',
  'qf.assignment.batch-created',
  'qf.assignment.batch-completed',
  'qf.client.additional-service-identified',
  'qf.client.additional-service-confirmed',
  'qf.client.additional-service-rejected',
  'qf.lead.linked-created',
  'qf.client.review-requested',
  'qf.client.lifecycle-closed',

  // --- Target: the vendor journey ---
  'qf.vendor.registration-started',
  'qf.vendor.profile-completed',
  'qf.vendor.verification-requested',
  'qf.vendor.activated',
  'qf.vendor.inactivity-detected',
  'qf.vendor.performance-updated',
  'qf.vendor.package-readiness-changed',
  'qf.vendor.recharge-opportunity-detected',
  'qf.vendor.complaint-recorded',
  'qf.vendor.retention-risk-detected',
  'qf.vendor.winback-candidate-detected',

  // --- Target: governance, privacy, and communication authority ---
  'qf.privacy.erasure-requested',
  'qf.privacy.erasure-recorded',
  'qf.policy.version-changed',
  'qf.communication.authorization-recorded',
  'qf.communication.result-recorded',
  'qf.communication.human-handoff-requested',
  'qf.communication.human-handoff-recorded',
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

/**
 * QF Jarvis produced a recommendation, and QuickFurno Core recorded it.
 *
 * The recommendation inside is inert. This event announces that a proposal exists;
 * it authorizes nothing.
 */
export const recommendationCreatedEventV1Schema = defineCanonicalEvent(
  'qf.recommendation.created',
  1,
  z.strictObject({ recommendation: recommendationV1Schema }),
);
export type RecommendationCreatedEventV1 = z.infer<typeof recommendationCreatedEventV1Schema>;

/** A recommendation moved to a new lifecycle state. */
export const recommendationLifecycleStateRecordedEventV1Schema = defineCanonicalEvent(
  'qf.recommendation.lifecycle-state-recorded',
  1,
  z.strictObject({ record: recommendationLifecycleRecordV1Schema }),
);
export type RecommendationLifecycleStateRecordedEventV1 = z.infer<
  typeof recommendationLifecycleStateRecordedEventV1Schema
>;

/**
 * QuickFurno Core recorded an authoritative approval decision.
 *
 * This event *is* the authorization becoming real. Jarvis reflects it; Jarvis never
 * anticipates it. No optimistic approval state, ever (ADR-0007).
 */
export const approvalDecisionRecordedEventV1Schema = defineCanonicalEvent(
  'qf.approval.decision-recorded',
  1,
  z.strictObject({ decision: approvalDecisionV1Schema }),
);
export type ApprovalDecisionRecordedEventV1 = z.infer<typeof approvalDecisionRecordedEventV1Schema>;

/** QuickFurno Core issued a bounded, expiring execution intent to n8n. */
export const executionIntentIssuedEventV1Schema = defineCanonicalEvent(
  'qf.execution.intent-issued',
  1,
  z.strictObject({ intent: executionIntentV1Schema }),
);
export type ExecutionIntentIssuedEventV1 = z.infer<typeof executionIntentIssuedEventV1Schema>;

/**
 * QuickFurno Core recorded an execution result.
 *
 * The payload may name n8n or the QF Communications Runtime as the *reporter*. The
 * envelope still names Core as the *source*, because reporting is not authority.
 */
export const executionResultRecordedEventV1Schema = defineCanonicalEvent(
  'qf.execution.result-recorded',
  1,
  z.strictObject({ result: executionResultV1Schema }),
);
export type ExecutionResultRecordedEventV1 = z.infer<typeof executionResultRecordedEventV1Schema>;

/** A governed communication moved to a new lifecycle state. */
export const communicationStateRecordedEventV1Schema = defineCanonicalEvent(
  'qf.communication.state-recorded',
  1,
  z.strictObject({ record: communicationStateRecordV1Schema }),
);
export type CommunicationStateRecordedEventV1 = z.infer<
  typeof communicationStateRecordedEventV1Schema
>;

/**
 * Every registered canonical event, as one discriminated union.
 *
 * Discriminated on `eventType`, so `switch (event.eventType)` narrows exhaustively
 * and a new event type that nobody handled becomes a **compile error** rather than
 * a silently ignored message.
 */
export type CanonicalEvent =
  // Architecture lifecycle
  | RecommendationCreatedEventV1
  | RecommendationLifecycleStateRecordedEventV1
  | ApprovalDecisionRecordedEventV1
  | ExecutionIntentIssuedEventV1
  | ExecutionResultRecordedEventV1
  | CommunicationStateRecordedEventV1
  // Target: client journey and assignment
  | ClientRequirementCompletedEventV1
  | ClientFollowUpDueDetectedEventV1
  | ClientFollowUpCompletedEventV1
  | ClientSatisfactionRecordedEventV1
  | ClientDissatisfactionRecordedEventV1
  | ClientComplaintRecordedEventV1
  | ClientReassignmentRequestedEventV1
  | ClientReassignmentAuthorizedEventV1
  | ClientReassignmentRejectedEventV1
  | AssignmentBatchCreatedEventV1
  | AssignmentBatchCompletedEventV1
  | ClientAdditionalServiceIdentifiedEventV1
  | ClientAdditionalServiceConfirmedEventV1
  | ClientAdditionalServiceRejectedEventV1
  | LeadLinkedCreatedEventV1
  | ClientReviewRequestedEventV1
  | ClientLifecycleClosedEventV1
  // Target: vendor journey
  | VendorRegistrationStartedEventV1
  | VendorProfileCompletedEventV1
  | VendorVerificationRequestedEventV1
  | VendorActivatedEventV1
  | VendorInactivityDetectedEventV1
  | VendorPerformanceUpdatedEventV1
  | VendorPackageReadinessChangedEventV1
  | VendorRechargeOpportunityDetectedEventV1
  | VendorComplaintRecordedEventV1
  | VendorRetentionRiskDetectedEventV1
  | VendorWinbackCandidateDetectedEventV1
  // Target: governance, privacy, communication authority
  | PrivacyErasureRequestedEventV1
  | PrivacyErasureRecordedEventV1
  | PolicyVersionChangedEventV1
  | CommunicationAuthorizationRecordedEventV1
  | CommunicationResultRecordedEventV1
  | CommunicationHumanHandoffRequestedEventV1
  | CommunicationHumanHandoffRecordedEventV1;

// ---------------------------------------------------------------------------
// Target events, re-exported so the catalog remains the single import site
// ---------------------------------------------------------------------------

export * from './client-events.js';
export * from './vendor-events.js';
export * from './governance-events.js';
