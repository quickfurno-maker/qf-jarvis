/**
 * Identifiers.
 *
 * Two kinds of identifier exist in this system, and conflating them is a
 * category error:
 *
 * 1. **Contract-generated identifiers** — created by QF Jarvis, QuickFurno Core,
 *    or n8n *for* these contracts. We choose their shape, so we choose UUID and
 *    validate it strictly.
 *
 * 2. **QuickFurno Core entity identifiers** — a lead, a vendor, a client. These
 *    are Core's, and we do not know or control their shape. They are opaque
 *    (see entity-reference.ts). Assuming they are UUIDs would be inventing a
 *    fact about a system we have not integrated with yet — exactly the mistake
 *    Phase 2 exists to avoid.
 *
 * The types below are string aliases, not branded types. Branding would give a
 * compile-time guarantee that a `RecommendationId` is not passed where an
 * `EventId` belongs, but constructing a branded value requires either a type
 * assertion or a parse at every literal — and this package forbids assertions.
 * The runtime guarantee (every one of these is a validated UUID) is the one that
 * matters at a trust boundary, and it is the one we keep.
 */

import { z } from 'zod';

/**
 * A contract-generated identifier: a UUID.
 *
 * Idempotency in this system rests on identifier equality — the same event
 * processed twice must have the effect of once — so the identifier must be
 * globally unique and cheaply comparable, with no coordination.
 */
const contractUuidSchema = z.uuid();

/** Identity of a canonical event. This is the event's idempotency key. */
export const eventIdSchema = contractUuidSchema;
export type EventId = z.infer<typeof eventIdSchema>;

export const recommendationIdSchema = contractUuidSchema;
export type RecommendationId = z.infer<typeof recommendationIdSchema>;

export const decisionIdSchema = contractUuidSchema;
export type DecisionId = z.infer<typeof decisionIdSchema>;

export const executionIntentIdSchema = contractUuidSchema;
export type ExecutionIntentId = z.infer<typeof executionIntentIdSchema>;

export const executionResultIdSchema = contractUuidSchema;
export type ExecutionResultId = z.infer<typeof executionResultIdSchema>;

export const communicationIdSchema = contractUuidSchema;
export type CommunicationId = z.infer<typeof communicationIdSchema>;

/** Identity of a single proposed action within a recommendation. */
export const actionIdSchema = contractUuidSchema;
export type ActionId = z.infer<typeof actionIdSchema>;

/** Identity of an approval request — Jarvis asking, never Jarvis deciding. */
export const approvalRequestIdSchema = contractUuidSchema;
export type ApprovalRequestId = z.infer<typeof approvalRequestIdSchema>;

export const communicationRequestIdSchema = contractUuidSchema;
export type CommunicationRequestId = z.infer<typeof communicationRequestIdSchema>;

export const communicationResultIdSchema = contractUuidSchema;
export type CommunicationResultId = z.infer<typeof communicationResultIdSchema>;

// --- Assignment, reassignment, and linked leads -----------------------------

export const assignmentBatchIdSchema = contractUuidSchema;
export type AssignmentBatchId = z.infer<typeof assignmentBatchIdSchema>;

export const reassignmentRequestIdSchema = contractUuidSchema;
export type ReassignmentRequestId = z.infer<typeof reassignmentRequestIdSchema>;

export const reassignmentDecisionIdSchema = contractUuidSchema;
export type ReassignmentDecisionId = z.infer<typeof reassignmentDecisionIdSchema>;

export const additionalServiceRequestIdSchema = contractUuidSchema;
export type AdditionalServiceRequestId = z.infer<typeof additionalServiceRequestIdSchema>;

export const linkedLeadIdSchema = contractUuidSchema;
export type LinkedLeadId = z.infer<typeof linkedLeadIdSchema>;

/**
 * Identity of a recorded client confirmation.
 *
 * A reassignment and a cross-category lead both require the client to have
 * actually said yes. That confirmation is an artifact with an identity, so that an
 * auditor can point at it — not a boolean somebody set.
 */
export const clientConfirmationIdSchema = contractUuidSchema;
export type ClientConfirmationId = z.infer<typeof clientConfirmationIdSchema>;

// --- Learning, evaluation, and memory ---------------------------------------

export const agentRunIdSchema = contractUuidSchema;
export type AgentRunId = z.infer<typeof agentRunIdSchema>;

export const memoryRecordIdSchema = contractUuidSchema;
export type MemoryRecordId = z.infer<typeof memoryRecordIdSchema>;

export const memoryInvalidationRequestIdSchema = contractUuidSchema;
export type MemoryInvalidationRequestId = z.infer<typeof memoryInvalidationRequestIdSchema>;

export const correctionIdSchema = contractUuidSchema;
export type CorrectionId = z.infer<typeof correctionIdSchema>;

export const evaluationIdSchema = contractUuidSchema;
export type EvaluationId = z.infer<typeof evaluationIdSchema>;

export const outcomeFeedbackIdSchema = contractUuidSchema;
export type OutcomeFeedbackId = z.infer<typeof outcomeFeedbackIdSchema>;

export const datasetExampleIdSchema = contractUuidSchema;
export type DatasetExampleId = z.infer<typeof datasetExampleIdSchema>;

export const trainingEligibilityDecisionIdSchema = contractUuidSchema;
export type TrainingEligibilityDecisionId = z.infer<typeof trainingEligibilityDecisionIdSchema>;

export const erasureRequestIdSchema = contractUuidSchema;
export type ErasureRequestId = z.infer<typeof erasureRequestIdSchema>;

/**
 * A fingerprint of the exact proposed action an approval request is asking about.
 *
 * A SHA-256 digest, lowercase hex. It binds the request to **one specific action as
 * it was worded at the moment it was proposed**.
 *
 * The failure it exists to prevent: a recommendation proposes "send a follow-up
 * message"; a human approves it; the underlying action is then edited — a different
 * template, a different subject, a wider audience — and the approval, which
 * referenced only an `actionId`, silently still applies. The fingerprint makes that
 * a mismatch instead of a quiet escalation. **An approval is for what was actually
 * shown to the approver, not for whatever the identifier now points at.**
 *
 * This package **carries** the fingerprint; it does not compute it. Computing a
 * digest would require a hashing primitive, and this package imports no Node
 * built-in and performs no I/O of any kind (ADR-0012). The producer computes it;
 * the coordination layer verifies it in a later phase. That division is stated
 * plainly so nobody assumes this schema already checked the hash — it checks only
 * that the value is *shaped* like one.
 */
export const ACTION_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export const actionFingerprintSchema = z
  .string()
  .regex(
    ACTION_FINGERPRINT_PATTERN,
    'Must be a lowercase hex SHA-256 digest of the canonical proposed action',
  );

export type ActionFingerprint = z.infer<typeof actionFingerprintSchema>;

/**
 * The thread identifier that survives the whole chain.
 *
 * Source events, recommendation, approval decision, execution intent, execution
 * result, and closure all carry the same correlation identifier. This is what
 * makes the backward walk — effect to evidence — possible, and the backward walk
 * is what makes an incident recoverable rather than merely alarming
 * (docs/governance/auditability-principles.md).
 */
export const correlationIdSchema = contractUuidSchema;
export type CorrelationId = z.infer<typeof correlationIdSchema>;

/**
 * A schema version. A positive integer, and never zero.
 *
 * Bounded above so that a malformed or hostile version number cannot be used to
 * probe the registry with an unbounded value.
 */
export const MAX_CONTRACT_VERSION = 1000;

export const contractVersionSchema = z.int().min(1).max(MAX_CONTRACT_VERSION);
export type ContractVersion = z.infer<typeof contractVersionSchema>;

/**
 * The idempotency key carried by an execution intent.
 *
 * Required, always. It is the mechanism by which a retry re-attempts *the same*
 * execution rather than causing a second one — the difference between a resilient
 * system and one that dials a real person's phone twice for one decision
 * (docs/architecture/execution-governance.md §7).
 *
 * A minimum length is enforced because a short key is a colliding key, and a
 * collision here means two different actions are treated as the same one.
 */
export const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export const idempotencyKeySchema = z
  .string()
  .min(MIN_IDEMPOTENCY_KEY_LENGTH)
  .max(MAX_IDEMPOTENCY_KEY_LENGTH)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Must be an opaque token of [A-Za-z0-9._:-]');

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

/**
 * An opaque reference to something a provider knows about — a message id, a call
 * id. Evidence, never authority: a provider's own view of a delivery is not truth
 * until QuickFurno Core has recorded it.
 */
export const providerReferenceSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Must be an opaque token of [A-Za-z0-9._:-]');

export type ProviderReference = z.infer<typeof providerReferenceSchema>;
