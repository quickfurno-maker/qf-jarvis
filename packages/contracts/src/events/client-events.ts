/**
 * Target canonical events: the client journey, and vendor assignment.
 *
 * Seventeen events covering the complete client journey that Riya advises on — from a
 * requirement being completed, through follow-up and satisfaction, through
 * dissatisfaction and reassignment, through cross-category additional services, to
 * lifecycle closure.
 *
 * **These are target contracts. QuickFurno Core does not emit them today.** See
 * target-payloads.ts for what that means and why the payloads are as thin as they are.
 *
 * ### Naming
 *
 * `qf.<aggregate>.<past-tense-fact>`, per ADR-0013. The directive's names use
 * `snake_case` (`client.requirement_completed`); the canonical registry uses the
 * repository's existing convention (`qf.client.requirement-completed`). The mapping is
 * one-to-one and is documented in docs/contracts/event-catalog.md — **the conventions are
 * not mixed silently.**
 *
 * A note on `qf.client.follow-up-due-detected`: the directive calls it `followup_due`,
 * which is a *state*, not a past-tense fact. An event that says "a follow-up IS due"
 * reads as an instruction — and the moment a consumer can be instructed by an event, the
 * event bus has become a command channel (ADR-0013). What actually happened is that
 * something *detected* that a follow-up had fallen due, so that is what it is called.
 */

import { z } from 'zod';

import {
  additionalServiceRequestIdSchema,
  assignmentBatchIdSchema,
  clientConfirmationIdSchema,
} from '../common/identifiers.js';
import { additionalServiceRequestV1Schema } from '../assignments/additional-service.js';
import { assignmentBatchV1Schema } from '../assignments/assignment-batch.js';
import { batchNumberSchema } from '../assignments/assignment-policy.js';
import {
  clientReassignmentDecisionV1Schema,
  clientReassignmentRequestV1Schema,
  dissatisfactionSeveritySchema,
} from '../assignments/client-reassignment.js';
import { clientConfirmationV1Schema } from '../assignments/client-confirmation.js';
import { communicationChannelSchema } from '../communications/communication-channel.js';
import { defineCanonicalEvent } from './canonical-event.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { leadCategoryShape, observationPayload, qualitativeBandSchema } from './target-payloads.js';
import { linkedLeadCreatedV1Schema } from '../assignments/linked-lead.js';
import { utcTimestampSchema } from '../common/timestamp.js';

// ---------------------------------------------------------------------------
// The client journey
// ---------------------------------------------------------------------------

/** The client finished stating what they need. Subject: the client. */
export const clientRequirementCompletedEventV1Schema = defineCanonicalEvent(
  'qf.client.requirement-completed',
  1,
  observationPayload(leadCategoryShape),
);
export type ClientRequirementCompletedEventV1 = z.infer<
  typeof clientRequirementCompletedEventV1Schema
>;

/**
 * Something detected that a follow-up had fallen due.
 *
 * Past tense, and it matters — see the file header. `dueAt` is when it became due, which
 * may well be earlier than when anybody noticed.
 */
export const clientFollowUpDueDetectedEventV1Schema = defineCanonicalEvent(
  'qf.client.follow-up-due-detected',
  1,
  observationPayload({ ...leadCategoryShape, dueAt: utcTimestampSchema }),
);
export type ClientFollowUpDueDetectedEventV1 = z.infer<
  typeof clientFollowUpDueDetectedEventV1Schema
>;

/** A follow-up actually happened. */
export const clientFollowUpCompletedEventV1Schema = defineCanonicalEvent(
  'qf.client.follow-up-completed',
  1,
  observationPayload({
    ...leadCategoryShape,
    channel: communicationChannelSchema.optional(),
  }),
);
export type ClientFollowUpCompletedEventV1 = z.infer<typeof clientFollowUpCompletedEventV1Schema>;

/** The client said they were happy. */
export const clientSatisfactionRecordedEventV1Schema = defineCanonicalEvent(
  'qf.client.satisfaction-recorded',
  1,
  observationPayload(leadCategoryShape),
);
export type ClientSatisfactionRecordedEventV1 = z.infer<
  typeof clientSatisfactionRecordedEventV1Schema
>;

/**
 * The client said they were **not** happy.
 *
 * This event is the evidence a reassignment request stands on. It is emphatically **not**
 * a reassignment: dissatisfaction is a fact, and acting on it requires the client to
 * explicitly ask (see `qf.client.reassignment-requested`).
 */
export const clientDissatisfactionRecordedEventV1Schema = defineCanonicalEvent(
  'qf.client.dissatisfaction-recorded',
  1,
  observationPayload({
    ...leadCategoryShape,
    severity: dissatisfactionSeveritySchema,
  }),
);
export type ClientDissatisfactionRecordedEventV1 = z.infer<
  typeof clientDissatisfactionRecordedEventV1Schema
>;

/** A formal complaint. Distinct from dissatisfaction: it is escalated, and it is tracked. */
export const clientComplaintRecordedEventV1Schema = defineCanonicalEvent(
  'qf.client.complaint-recorded',
  1,
  observationPayload({
    lead: entityReferenceSchema.optional(),
    category: entityReferenceSchema.optional(),
    severity: qualitativeBandSchema,
  }),
);
export type ClientComplaintRecordedEventV1 = z.infer<typeof clientComplaintRecordedEventV1Schema>;

// ---------------------------------------------------------------------------
// Reassignment
// ---------------------------------------------------------------------------

/** Jarvis asked Core to reassign, carrying the client's explicit confirmation. Authorizes nothing. */
export const clientReassignmentRequestedEventV1Schema = defineCanonicalEvent(
  'qf.client.reassignment-requested',
  1,
  z.strictObject({ request: clientReassignmentRequestV1Schema }),
);
export type ClientReassignmentRequestedEventV1 = z.infer<
  typeof clientReassignmentRequestedEventV1Schema
>;

/** Core authorized a replacement batch. This event *is* the authorization becoming real. */
export const clientReassignmentAuthorizedEventV1Schema = defineCanonicalEvent(
  'qf.client.reassignment-authorized',
  1,
  z.strictObject({ decision: clientReassignmentDecisionV1Schema }),
);
export type ClientReassignmentAuthorizedEventV1 = z.infer<
  typeof clientReassignmentAuthorizedEventV1Schema
>;

/** Core refused. A refusal is a decision Core made, and it is the one most worth pointing at later. */
export const clientReassignmentRejectedEventV1Schema = defineCanonicalEvent(
  'qf.client.reassignment-rejected',
  1,
  z.strictObject({ decision: clientReassignmentDecisionV1Schema }),
);
export type ClientReassignmentRejectedEventV1 = z.infer<
  typeof clientReassignmentRejectedEventV1Schema
>;

// ---------------------------------------------------------------------------
// Assignment batches
// ---------------------------------------------------------------------------

/**
 * Core created a batch of at most three vendors.
 *
 * Every limit — three per batch, two batches, six unique vendors per lead-category, no
 * overlap, explicit client confirmation on a replacement — is enforced inside
 * `AssignmentBatchV1` itself, so an invalid batch cannot reach a consumer through this
 * event. See assignments/assignment-batch.ts.
 */
export const assignmentBatchCreatedEventV1Schema = defineCanonicalEvent(
  'qf.assignment.batch-created',
  1,
  z.strictObject({ batch: assignmentBatchV1Schema }),
);
export type AssignmentBatchCreatedEventV1 = z.infer<typeof assignmentBatchCreatedEventV1Schema>;

/** The batch ran its course — the vendors responded, or the window closed. */
export const assignmentBatchCompletedEventV1Schema = defineCanonicalEvent(
  'qf.assignment.batch-completed',
  1,
  observationPayload({
    ...leadCategoryShape,
    assignmentBatchId: assignmentBatchIdSchema,
    batchNumber: batchNumberSchema,
  }),
);
export type AssignmentBatchCompletedEventV1 = z.infer<typeof assignmentBatchCompletedEventV1Schema>;

// ---------------------------------------------------------------------------
// Cross-category additional services
// ---------------------------------------------------------------------------

/** Riya noticed the client may also want something in another category. A signal, not a conclusion. */
export const clientAdditionalServiceIdentifiedEventV1Schema = defineCanonicalEvent(
  'qf.client.additional-service-identified',
  1,
  z.strictObject({ request: additionalServiceRequestV1Schema }),
);
export type ClientAdditionalServiceIdentifiedEventV1 = z.infer<
  typeof clientAdditionalServiceIdentifiedEventV1Schema
>;

/**
 * The client explicitly confirmed they want it.
 *
 * This is the event a linked lead may be created on the strength of — and nothing else is.
 */
export const clientAdditionalServiceConfirmedEventV1Schema = defineCanonicalEvent(
  'qf.client.additional-service-confirmed',
  1,
  observationPayload({
    additionalServiceRequestId: additionalServiceRequestIdSchema,
    clientConfirmation: clientConfirmationV1Schema,
    proposedCategory: entityReferenceSchema,
  }),
);
export type ClientAdditionalServiceConfirmedEventV1 = z.infer<
  typeof clientAdditionalServiceConfirmedEventV1Schema
>;

/** The client said no. Recorded, because a rejected suggestion is evaluation data. */
export const clientAdditionalServiceRejectedEventV1Schema = defineCanonicalEvent(
  'qf.client.additional-service-rejected',
  1,
  observationPayload({
    additionalServiceRequestId: additionalServiceRequestIdSchema,
    proposedCategory: entityReferenceSchema,
  }),
);
export type ClientAdditionalServiceRejectedEventV1 = z.infer<
  typeof clientAdditionalServiceRejectedEventV1Schema
>;

/**
 * Core created a **separate** lead for the new category.
 *
 * Its own identity, its own consent, its own verification, its own scoring, its own
 * matching, and its own fresh batch of three. See assignments/linked-lead.ts for why every
 * one of those words is load-bearing.
 */
export const leadLinkedCreatedEventV1Schema = defineCanonicalEvent(
  'qf.lead.linked-created',
  1,
  z.strictObject({ link: linkedLeadCreatedV1Schema }),
);
export type LeadLinkedCreatedEventV1 = z.infer<typeof leadLinkedCreatedEventV1Schema>;

// ---------------------------------------------------------------------------
// Closure
// ---------------------------------------------------------------------------

/** A review was asked of the client. */
export const clientReviewRequestedEventV1Schema = defineCanonicalEvent(
  'qf.client.review-requested',
  1,
  observationPayload({
    ...leadCategoryShape,
    clientConfirmationId: clientConfirmationIdSchema.optional(),
  }),
);
export type ClientReviewRequestedEventV1 = z.infer<typeof clientReviewRequestedEventV1Schema>;

/** The journey ended. How it ended is a reason code, so it can be counted. */
export const clientLifecycleClosedEventV1Schema = defineCanonicalEvent(
  'qf.client.lifecycle-closed',
  1,
  observationPayload({
    ...leadCategoryShape,
    outcome: z.enum(['converted', 'lost', 'abandoned', 'withdrawn']),
  }),
);
export type ClientLifecycleClosedEventV1 = z.infer<typeof clientLifecycleClosedEventV1Schema>;
