/**
 * **The registered canonical events — version 2, privacy-hardened.**
 *
 * Every schema here is `defineCanonicalEvent(type, version, payload)` where the payload comes
 * from the **one** authoritative registry (`payload-registry.ts`). The events are written out
 * explicitly rather than generated in a loop, because this is a contracts package and the
 * product *is* the explicitness: a reviewer must be able to read the list and see, without
 * running anything, exactly which events exist and at which version.
 *
 * **The 41 inherited events are at `@2`.** Version 1 exists in `event-catalog.ts` and is **not
 * registered** — see `payload-registry.ts` for why, and ADR-0026 §5 for the versioning decision.
 *
 * **The 11 taxonomy events are new, and begin at `@1`.** There is nothing to supersede.
 */

import type { z } from 'zod';

import { defineCanonicalEvent } from './canonical-event.js';
import { CANONICAL_PAYLOAD_SCHEMAS } from './payload-registry.js';

const P = CANONICAL_PAYLOAD_SCHEMAS;

// --- Architecture lifecycle -----------------------------------------------------------------

export const recommendationCreatedEventV2Schema = defineCanonicalEvent(
  'qf.recommendation.created',
  2,
  P['qf.recommendation.created@2'],
);
export const recommendationLifecycleStateRecordedEventV2Schema = defineCanonicalEvent(
  'qf.recommendation.lifecycle-state-recorded',
  2,
  P['qf.recommendation.lifecycle-state-recorded@2'],
);
export const approvalDecisionRecordedEventV2Schema = defineCanonicalEvent(
  'qf.approval.decision-recorded',
  2,
  P['qf.approval.decision-recorded@2'],
);
export const executionIntentIssuedEventV2Schema = defineCanonicalEvent(
  'qf.execution.intent-issued',
  2,
  P['qf.execution.intent-issued@2'],
);
export const executionResultRecordedEventV2Schema = defineCanonicalEvent(
  'qf.execution.result-recorded',
  2,
  P['qf.execution.result-recorded@2'],
);
export const communicationStateRecordedEventV2Schema = defineCanonicalEvent(
  'qf.communication.state-recorded',
  2,
  P['qf.communication.state-recorded@2'],
);

// --- The client journey ---------------------------------------------------------------------

export const clientRequirementCompletedEventV2Schema = defineCanonicalEvent(
  'qf.client.requirement-completed',
  2,
  P['qf.client.requirement-completed@2'],
);
export const clientFollowUpDueDetectedEventV2Schema = defineCanonicalEvent(
  'qf.client.follow-up-due-detected',
  2,
  P['qf.client.follow-up-due-detected@2'],
);
export const clientFollowUpCompletedEventV2Schema = defineCanonicalEvent(
  'qf.client.follow-up-completed',
  2,
  P['qf.client.follow-up-completed@2'],
);
export const clientSatisfactionRecordedEventV2Schema = defineCanonicalEvent(
  'qf.client.satisfaction-recorded',
  2,
  P['qf.client.satisfaction-recorded@2'],
);
export const clientDissatisfactionRecordedEventV2Schema = defineCanonicalEvent(
  'qf.client.dissatisfaction-recorded',
  2,
  P['qf.client.dissatisfaction-recorded@2'],
);
export const clientComplaintRecordedEventV2Schema = defineCanonicalEvent(
  'qf.client.complaint-recorded',
  2,
  P['qf.client.complaint-recorded@2'],
);
export const clientReassignmentRequestedEventV2Schema = defineCanonicalEvent(
  'qf.client.reassignment-requested',
  2,
  P['qf.client.reassignment-requested@2'],
);
export const clientReassignmentAuthorizedEventV2Schema = defineCanonicalEvent(
  'qf.client.reassignment-authorized',
  2,
  P['qf.client.reassignment-authorized@2'],
);
export const clientReassignmentRejectedEventV2Schema = defineCanonicalEvent(
  'qf.client.reassignment-rejected',
  2,
  P['qf.client.reassignment-rejected@2'],
);
export const assignmentBatchCreatedEventV2Schema = defineCanonicalEvent(
  'qf.assignment.batch-created',
  2,
  P['qf.assignment.batch-created@2'],
);
export const assignmentBatchCompletedEventV2Schema = defineCanonicalEvent(
  'qf.assignment.batch-completed',
  2,
  P['qf.assignment.batch-completed@2'],
);
export const clientAdditionalServiceIdentifiedEventV2Schema = defineCanonicalEvent(
  'qf.client.additional-service-identified',
  2,
  P['qf.client.additional-service-identified@2'],
);
export const clientAdditionalServiceConfirmedEventV2Schema = defineCanonicalEvent(
  'qf.client.additional-service-confirmed',
  2,
  P['qf.client.additional-service-confirmed@2'],
);
export const clientAdditionalServiceRejectedEventV2Schema = defineCanonicalEvent(
  'qf.client.additional-service-rejected',
  2,
  P['qf.client.additional-service-rejected@2'],
);
export const leadLinkedCreatedEventV2Schema = defineCanonicalEvent(
  'qf.lead.linked-created',
  2,
  P['qf.lead.linked-created@2'],
);
export const clientReviewRequestedEventV2Schema = defineCanonicalEvent(
  'qf.client.review-requested',
  2,
  P['qf.client.review-requested@2'],
);
export const clientLifecycleClosedEventV2Schema = defineCanonicalEvent(
  'qf.client.lifecycle-closed',
  2,
  P['qf.client.lifecycle-closed@2'],
);

// --- The vendor journey ---------------------------------------------------------------------

export const vendorRegistrationStartedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.registration-started',
  2,
  P['qf.vendor.registration-started@2'],
);
export const vendorProfileCompletedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.profile-completed',
  2,
  P['qf.vendor.profile-completed@2'],
);
export const vendorVerificationRequestedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.verification-requested',
  2,
  P['qf.vendor.verification-requested@2'],
);
export const vendorActivatedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.activated',
  2,
  P['qf.vendor.activated@2'],
);
export const vendorInactivityDetectedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.inactivity-detected',
  2,
  P['qf.vendor.inactivity-detected@2'],
);
export const vendorPerformanceUpdatedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.performance-updated',
  2,
  P['qf.vendor.performance-updated@2'],
);
export const vendorPackageReadinessChangedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.package-readiness-changed',
  2,
  P['qf.vendor.package-readiness-changed@2'],
);
export const vendorRechargeOpportunityDetectedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.recharge-opportunity-detected',
  2,
  P['qf.vendor.recharge-opportunity-detected@2'],
);
export const vendorComplaintRecordedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.complaint-recorded',
  2,
  P['qf.vendor.complaint-recorded@2'],
);
export const vendorRetentionRiskDetectedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.retention-risk-detected',
  2,
  P['qf.vendor.retention-risk-detected@2'],
);
export const vendorWinbackCandidateDetectedEventV2Schema = defineCanonicalEvent(
  'qf.vendor.winback-candidate-detected',
  2,
  P['qf.vendor.winback-candidate-detected@2'],
);

// --- Governance, privacy, communication authority -------------------------------------------

export const privacyErasureRequestedEventV2Schema = defineCanonicalEvent(
  'qf.privacy.erasure-requested',
  2,
  P['qf.privacy.erasure-requested@2'],
);
export const privacyErasureRecordedEventV2Schema = defineCanonicalEvent(
  'qf.privacy.erasure-recorded',
  2,
  P['qf.privacy.erasure-recorded@2'],
);
export const policyVersionChangedEventV2Schema = defineCanonicalEvent(
  'qf.policy.version-changed',
  2,
  P['qf.policy.version-changed@2'],
);
export const communicationAuthorizationRecordedEventV2Schema = defineCanonicalEvent(
  'qf.communication.authorization-recorded',
  2,
  P['qf.communication.authorization-recorded@2'],
);
export const communicationResultRecordedEventV2Schema = defineCanonicalEvent(
  'qf.communication.result-recorded',
  2,
  P['qf.communication.result-recorded@2'],
);
export const communicationHumanHandoffRequestedEventV2Schema = defineCanonicalEvent(
  'qf.communication.human-handoff-requested',
  2,
  P['qf.communication.human-handoff-requested@2'],
);
export const communicationHumanHandoffRecordedEventV2Schema = defineCanonicalEvent(
  'qf.communication.human-handoff-recorded',
  2,
  P['qf.communication.human-handoff-recorded@2'],
);

// --- Taxonomy (new in Stage 3.1.4, version 1) -----------------------------------------------

export const cityCreatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.city-created',
  1,
  P['qf.taxonomy.city-created@1'],
);
export const cityUpdatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.city-updated',
  1,
  P['qf.taxonomy.city-updated@1'],
);
export const cityDeactivatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.city-deactivated',
  1,
  P['qf.taxonomy.city-deactivated@1'],
);
export const categoryCreatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.category-created',
  1,
  P['qf.taxonomy.category-created@1'],
);
export const categoryUpdatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.category-updated',
  1,
  P['qf.taxonomy.category-updated@1'],
);
export const categoryDeactivatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.category-deactivated',
  1,
  P['qf.taxonomy.category-deactivated@1'],
);
export const subcategoryCreatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.subcategory-created',
  1,
  P['qf.taxonomy.subcategory-created@1'],
);
export const subcategoryMovedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.subcategory-moved',
  1,
  P['qf.taxonomy.subcategory-moved@1'],
);
export const subcategoryUpdatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.subcategory-updated',
  1,
  P['qf.taxonomy.subcategory-updated@1'],
);
export const subcategoryDeactivatedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.subcategory-deactivated',
  1,
  P['qf.taxonomy.subcategory-deactivated@1'],
);
export const taxonomyVersionPublishedEventV1Schema = defineCanonicalEvent(
  'qf.taxonomy.version-published',
  1,
  P['qf.taxonomy.version-published@1'],
);

/**
 * Every registered event, as `(type, version, schema)`.
 *
 * The registry in `event-registry.ts` is built from exactly this list, so "what is registered" and
 * "what is defined" cannot drift apart — a drift that would show up as an event nobody can parse
 * and nobody can find.
 */
export const REGISTERED_EVENT_DEFINITIONS = [
  // Architecture lifecycle
  ['qf.recommendation.created', 2, recommendationCreatedEventV2Schema],
  [
    'qf.recommendation.lifecycle-state-recorded',
    2,
    recommendationLifecycleStateRecordedEventV2Schema,
  ],
  ['qf.approval.decision-recorded', 2, approvalDecisionRecordedEventV2Schema],
  ['qf.execution.intent-issued', 2, executionIntentIssuedEventV2Schema],
  ['qf.execution.result-recorded', 2, executionResultRecordedEventV2Schema],
  ['qf.communication.state-recorded', 2, communicationStateRecordedEventV2Schema],
  // Client journey
  ['qf.client.requirement-completed', 2, clientRequirementCompletedEventV2Schema],
  ['qf.client.follow-up-due-detected', 2, clientFollowUpDueDetectedEventV2Schema],
  ['qf.client.follow-up-completed', 2, clientFollowUpCompletedEventV2Schema],
  ['qf.client.satisfaction-recorded', 2, clientSatisfactionRecordedEventV2Schema],
  ['qf.client.dissatisfaction-recorded', 2, clientDissatisfactionRecordedEventV2Schema],
  ['qf.client.complaint-recorded', 2, clientComplaintRecordedEventV2Schema],
  ['qf.client.reassignment-requested', 2, clientReassignmentRequestedEventV2Schema],
  ['qf.client.reassignment-authorized', 2, clientReassignmentAuthorizedEventV2Schema],
  ['qf.client.reassignment-rejected', 2, clientReassignmentRejectedEventV2Schema],
  ['qf.assignment.batch-created', 2, assignmentBatchCreatedEventV2Schema],
  ['qf.assignment.batch-completed', 2, assignmentBatchCompletedEventV2Schema],
  ['qf.client.additional-service-identified', 2, clientAdditionalServiceIdentifiedEventV2Schema],
  ['qf.client.additional-service-confirmed', 2, clientAdditionalServiceConfirmedEventV2Schema],
  ['qf.client.additional-service-rejected', 2, clientAdditionalServiceRejectedEventV2Schema],
  ['qf.lead.linked-created', 2, leadLinkedCreatedEventV2Schema],
  ['qf.client.review-requested', 2, clientReviewRequestedEventV2Schema],
  ['qf.client.lifecycle-closed', 2, clientLifecycleClosedEventV2Schema],
  // Vendor journey
  ['qf.vendor.registration-started', 2, vendorRegistrationStartedEventV2Schema],
  ['qf.vendor.profile-completed', 2, vendorProfileCompletedEventV2Schema],
  ['qf.vendor.verification-requested', 2, vendorVerificationRequestedEventV2Schema],
  ['qf.vendor.activated', 2, vendorActivatedEventV2Schema],
  ['qf.vendor.inactivity-detected', 2, vendorInactivityDetectedEventV2Schema],
  ['qf.vendor.performance-updated', 2, vendorPerformanceUpdatedEventV2Schema],
  ['qf.vendor.package-readiness-changed', 2, vendorPackageReadinessChangedEventV2Schema],
  ['qf.vendor.recharge-opportunity-detected', 2, vendorRechargeOpportunityDetectedEventV2Schema],
  ['qf.vendor.complaint-recorded', 2, vendorComplaintRecordedEventV2Schema],
  ['qf.vendor.retention-risk-detected', 2, vendorRetentionRiskDetectedEventV2Schema],
  ['qf.vendor.winback-candidate-detected', 2, vendorWinbackCandidateDetectedEventV2Schema],
  // Governance, privacy, communication
  ['qf.privacy.erasure-requested', 2, privacyErasureRequestedEventV2Schema],
  ['qf.privacy.erasure-recorded', 2, privacyErasureRecordedEventV2Schema],
  ['qf.policy.version-changed', 2, policyVersionChangedEventV2Schema],
  ['qf.communication.authorization-recorded', 2, communicationAuthorizationRecordedEventV2Schema],
  ['qf.communication.result-recorded', 2, communicationResultRecordedEventV2Schema],
  ['qf.communication.human-handoff-requested', 2, communicationHumanHandoffRequestedEventV2Schema],
  ['qf.communication.human-handoff-recorded', 2, communicationHumanHandoffRecordedEventV2Schema],
  // Taxonomy
  ['qf.taxonomy.city-created', 1, cityCreatedEventV1Schema],
  ['qf.taxonomy.city-updated', 1, cityUpdatedEventV1Schema],
  ['qf.taxonomy.city-deactivated', 1, cityDeactivatedEventV1Schema],
  ['qf.taxonomy.category-created', 1, categoryCreatedEventV1Schema],
  ['qf.taxonomy.category-updated', 1, categoryUpdatedEventV1Schema],
  ['qf.taxonomy.category-deactivated', 1, categoryDeactivatedEventV1Schema],
  ['qf.taxonomy.subcategory-created', 1, subcategoryCreatedEventV1Schema],
  ['qf.taxonomy.subcategory-moved', 1, subcategoryMovedEventV1Schema],
  ['qf.taxonomy.subcategory-updated', 1, subcategoryUpdatedEventV1Schema],
  ['qf.taxonomy.subcategory-deactivated', 1, subcategoryDeactivatedEventV1Schema],
  ['qf.taxonomy.version-published', 1, taxonomyVersionPublishedEventV1Schema],
] as const satisfies readonly (readonly [string, number, z.ZodType])[];

/**
 * The parsed type of every registered event, one per schema.
 *
 * Fixtures and consumers annotate with these, so a fixture that drifts from its contract fails
 * at compile time rather than at parse time.
 */
export type RecommendationCreatedEventV2 = z.infer<typeof recommendationCreatedEventV2Schema>;
export type RecommendationLifecycleStateRecordedEventV2 = z.infer<
  typeof recommendationLifecycleStateRecordedEventV2Schema
>;
export type ApprovalDecisionRecordedEventV2 = z.infer<typeof approvalDecisionRecordedEventV2Schema>;
export type ExecutionIntentIssuedEventV2 = z.infer<typeof executionIntentIssuedEventV2Schema>;
export type ExecutionResultRecordedEventV2 = z.infer<typeof executionResultRecordedEventV2Schema>;
export type CommunicationStateRecordedEventV2 = z.infer<
  typeof communicationStateRecordedEventV2Schema
>;
export type ClientRequirementCompletedEventV2 = z.infer<
  typeof clientRequirementCompletedEventV2Schema
>;
export type ClientFollowUpDueDetectedEventV2 = z.infer<
  typeof clientFollowUpDueDetectedEventV2Schema
>;
export type ClientFollowUpCompletedEventV2 = z.infer<typeof clientFollowUpCompletedEventV2Schema>;
export type ClientSatisfactionRecordedEventV2 = z.infer<
  typeof clientSatisfactionRecordedEventV2Schema
>;
export type ClientDissatisfactionRecordedEventV2 = z.infer<
  typeof clientDissatisfactionRecordedEventV2Schema
>;
export type ClientComplaintRecordedEventV2 = z.infer<typeof clientComplaintRecordedEventV2Schema>;
export type ClientReassignmentRequestedEventV2 = z.infer<
  typeof clientReassignmentRequestedEventV2Schema
>;
export type ClientReassignmentAuthorizedEventV2 = z.infer<
  typeof clientReassignmentAuthorizedEventV2Schema
>;
export type ClientReassignmentRejectedEventV2 = z.infer<
  typeof clientReassignmentRejectedEventV2Schema
>;
export type AssignmentBatchCreatedEventV2 = z.infer<typeof assignmentBatchCreatedEventV2Schema>;
export type AssignmentBatchCompletedEventV2 = z.infer<typeof assignmentBatchCompletedEventV2Schema>;
export type ClientAdditionalServiceIdentifiedEventV2 = z.infer<
  typeof clientAdditionalServiceIdentifiedEventV2Schema
>;
export type ClientAdditionalServiceConfirmedEventV2 = z.infer<
  typeof clientAdditionalServiceConfirmedEventV2Schema
>;
export type ClientAdditionalServiceRejectedEventV2 = z.infer<
  typeof clientAdditionalServiceRejectedEventV2Schema
>;
export type LeadLinkedCreatedEventV2 = z.infer<typeof leadLinkedCreatedEventV2Schema>;
export type ClientReviewRequestedEventV2 = z.infer<typeof clientReviewRequestedEventV2Schema>;
export type ClientLifecycleClosedEventV2 = z.infer<typeof clientLifecycleClosedEventV2Schema>;
export type VendorRegistrationStartedEventV2 = z.infer<
  typeof vendorRegistrationStartedEventV2Schema
>;
export type VendorProfileCompletedEventV2 = z.infer<typeof vendorProfileCompletedEventV2Schema>;
export type VendorVerificationRequestedEventV2 = z.infer<
  typeof vendorVerificationRequestedEventV2Schema
>;
export type VendorActivatedEventV2 = z.infer<typeof vendorActivatedEventV2Schema>;
export type VendorInactivityDetectedEventV2 = z.infer<typeof vendorInactivityDetectedEventV2Schema>;
export type VendorPerformanceUpdatedEventV2 = z.infer<typeof vendorPerformanceUpdatedEventV2Schema>;
export type VendorPackageReadinessChangedEventV2 = z.infer<
  typeof vendorPackageReadinessChangedEventV2Schema
>;
export type VendorRechargeOpportunityDetectedEventV2 = z.infer<
  typeof vendorRechargeOpportunityDetectedEventV2Schema
>;
export type VendorComplaintRecordedEventV2 = z.infer<typeof vendorComplaintRecordedEventV2Schema>;
export type VendorRetentionRiskDetectedEventV2 = z.infer<
  typeof vendorRetentionRiskDetectedEventV2Schema
>;
export type VendorWinbackCandidateDetectedEventV2 = z.infer<
  typeof vendorWinbackCandidateDetectedEventV2Schema
>;
export type PrivacyErasureRequestedEventV2 = z.infer<typeof privacyErasureRequestedEventV2Schema>;
export type PrivacyErasureRecordedEventV2 = z.infer<typeof privacyErasureRecordedEventV2Schema>;
export type PolicyVersionChangedEventV2 = z.infer<typeof policyVersionChangedEventV2Schema>;
export type CommunicationAuthorizationRecordedEventV2 = z.infer<
  typeof communicationAuthorizationRecordedEventV2Schema
>;
export type CommunicationResultRecordedEventV2 = z.infer<
  typeof communicationResultRecordedEventV2Schema
>;
export type CommunicationHumanHandoffRequestedEventV2 = z.infer<
  typeof communicationHumanHandoffRequestedEventV2Schema
>;
export type CommunicationHumanHandoffRecordedEventV2 = z.infer<
  typeof communicationHumanHandoffRecordedEventV2Schema
>;
export type CityCreatedEventV1 = z.infer<typeof cityCreatedEventV1Schema>;
export type CityUpdatedEventV1 = z.infer<typeof cityUpdatedEventV1Schema>;
export type CityDeactivatedEventV1 = z.infer<typeof cityDeactivatedEventV1Schema>;
export type CategoryCreatedEventV1 = z.infer<typeof categoryCreatedEventV1Schema>;
export type CategoryUpdatedEventV1 = z.infer<typeof categoryUpdatedEventV1Schema>;
export type CategoryDeactivatedEventV1 = z.infer<typeof categoryDeactivatedEventV1Schema>;
export type SubcategoryCreatedEventV1 = z.infer<typeof subcategoryCreatedEventV1Schema>;
export type SubcategoryMovedEventV1 = z.infer<typeof subcategoryMovedEventV1Schema>;
export type SubcategoryUpdatedEventV1 = z.infer<typeof subcategoryUpdatedEventV1Schema>;
export type SubcategoryDeactivatedEventV1 = z.infer<typeof subcategoryDeactivatedEventV1Schema>;
export type TaxonomyVersionPublishedEventV1 = z.infer<typeof taxonomyVersionPublishedEventV1Schema>;

/** Every registered schema, as a union. */
type RegisteredSchema = (typeof REGISTERED_EVENT_DEFINITIONS)[number][2];

/**
 * A parsed canonical event — the union of every registered contract's output.
 *
 * Derived from `REGISTERED_EVENT_DEFINITIONS` rather than hand-written, so the type and the
 * registry cannot disagree. A hand-written union is a union somebody forgets to extend, and the
 * symptom is an event that parses at runtime and does not exist at compile time.
 */
export type CanonicalEvent = RegisteredSchema extends z.ZodType<infer T> ? T : never;
