/**
 * @qf-jarvis/contracts — the shared data contracts of the QF Jarvis system.
 *
 * **Importing this package cannot cause an effect.** It opens no socket, reads no
 * environment variable, touches no filesystem, starts no timer, logs nothing, and
 * mutates no global. It defines shapes and validates values, and that is all it
 * can do. Every export below is a schema, a type, a constant, or a pure function.
 *
 * The permanent rule these contracts encode:
 *
 *   Jarvis recommends.
 *   QuickFurno authorizes.
 *   n8n executes.
 *   Providers deliver.
 *   Results return to QuickFurno Core.
 *
 * And the parts of it that are *structural* here, not merely documented:
 *
 * - A recommendation's `producingSystem` can only be `qf-jarvis`.
 * - An approval decision's `issuer` can only be `quickfurno-core`, and its
 *   `decidedBy` can only be a human or a named policy — an agent has no
 *   representation, so agent self-approval cannot be expressed.
 * - An execution intent's `issuer` can only be `quickfurno-core` and its `executor`
 *   only `n8n`. **Jarvis cannot construct a valid execution intent**, and there is
 *   no provider to address one to.
 * - Delivery semantics can only be `at-most-once`.
 * - An indeterminate execution result cannot be recorded as a success.
 * - A recipient can only be an opaque Core reference; a phone number or email
 *   address will not parse.
 *
 * See docs/contracts/ for the full documentation set.
 */

// ---------------------------------------------------------------------------
// Common primitives
// ---------------------------------------------------------------------------

export {
  actorReferenceSchema,
  humanActorSchema,
  policyActorSchema,
  type ActorReference,
  type HumanActor,
  type PolicyActor,
} from './common/actor.js';

export {
  boundedJsonObjectSchema,
  boundedJsonValueSchema,
  createBoundedJsonObjectSchema,
  createBoundedJsonValueSchema,
  DEFAULT_JSON_LIMITS,
  inspectJsonValue,
  isBoundedJsonValue,
  type JsonIssue,
  type JsonLimits,
  type JsonObject,
  type JsonScalar,
  type JsonValue,
} from './common/bounded-json.js';

export {
  entityIdSchema,
  entityReferenceSchema,
  entityTypeSchema,
  MAX_ENTITY_ID_LENGTH,
  MAX_ENTITY_TYPE_LENGTH,
  type EntityReference,
} from './common/entity-reference.js';

export {
  actionParametersSchema,
  AUTHORITY_CLAIM_KEYS,
  CONTACT_KEYS,
  CREDENTIAL_KEYS,
  createGovernedJsonObjectSchema,
  evidenceValueSchema,
  executionParametersSchema,
  inspectGovernedContent,
  MODEL_INTERNAL_KEYS,
  RAW_CONTENT_KEYS,
  resultMetadataSchema,
  RETRY_PERMISSION_KEYS,
} from './common/governed-parameters.js';

export {
  ACTION_FINGERPRINT_PATTERN,
  actionFingerprintSchema,
  actionIdSchema,
  additionalServiceRequestIdSchema,
  agentRunIdSchema,
  approvalRequestIdSchema,
  assignmentBatchIdSchema,
  clientConfirmationIdSchema,
  communicationIdSchema,
  communicationRequestIdSchema,
  communicationResultIdSchema,
  contractVersionSchema,
  correctionIdSchema,
  correlationIdSchema,
  datasetExampleIdSchema,
  decisionIdSchema,
  erasureRequestIdSchema,
  evaluationIdSchema,
  eventIdSchema,
  executionIntentIdSchema,
  executionResultIdSchema,
  idempotencyKeySchema,
  linkedLeadIdSchema,
  MAX_CONTRACT_VERSION,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  memoryInvalidationRequestIdSchema,
  memoryRecordIdSchema,
  MIN_IDEMPOTENCY_KEY_LENGTH,
  outcomeFeedbackIdSchema,
  providerReferenceSchema,
  reassignmentDecisionIdSchema,
  reassignmentRequestIdSchema,
  recommendationIdSchema,
  trainingEligibilityDecisionIdSchema,
  type ActionFingerprint,
  type ActionId,
  type AdditionalServiceRequestId,
  type AgentRunId,
  type ApprovalRequestId,
  type AssignmentBatchId,
  type ClientConfirmationId,
  type CommunicationId,
  type CommunicationRequestId,
  type CommunicationResultId,
  type ContractVersion,
  type CorrectionId,
  type CorrelationId,
  type DatasetExampleId,
  type DecisionId,
  type ErasureRequestId,
  type EvaluationId,
  type EventId,
  type ExecutionIntentId,
  type ExecutionResultId,
  type IdempotencyKey,
  type LinkedLeadId,
  type MemoryInvalidationRequestId,
  type MemoryRecordId,
  type OutcomeFeedbackId,
  type ProviderReference,
  type ReassignmentDecisionId,
  type ReassignmentRequestId,
  type RecommendationId,
  type TrainingEligibilityDecisionId,
} from './common/identifiers.js';

export {
  AGENT_IDS,
  agentIdSchema,
  executionReportingSystemSchema,
  n8nSchema,
  qfJarvisSchema,
  quickfurnoCoreSchema,
  SPECIALIST_AGENT_IDS,
  specialistAgentIdSchema,
  SYSTEM_IDS,
  systemIdSchema,
  type AgentId,
  type ExecutionReportingSystem,
  type SpecialistAgentId,
  type SystemId,
} from './common/systems.js';

export {
  boundedText,
  MACHINE_TOKEN_PATTERN,
  machineTokenSchema,
  MAX_MACHINE_TOKEN_LENGTH,
  reasonCodeSchema,
  TEXT_LIMITS,
  type MachineToken,
  type ReasonCode,
} from './common/text.js';

export { policyReferenceSchema, type PolicyReference } from './common/policy.js';

export {
  DATA_CLASSIFICATIONS,
  dataClassificationSchema,
  ERASURE_STATES,
  ERASURE_TYPES,
  erasureStateSchema,
  erasureTypeSchema,
  MINIMISATION_STATUSES,
  minimisationStatusSchema,
  type DataClassification,
  type ErasureState,
  type ErasureType,
  type MinimisationStatus,
} from './common/classification.js';

export {
  isAtOrBefore,
  isStrictlyBefore,
  RFC3339_UTC_PATTERN,
  toEpochMillis,
  utcTimestampSchema,
  type UtcTimestamp,
} from './common/timestamp.js';

// ---------------------------------------------------------------------------
// Canonical events
// ---------------------------------------------------------------------------

export { defineCanonicalEvent } from './events/canonical-event.js';
export { eventVersionSchema, type EventVersion } from './events/event-version.js';

export {
  approvalDecisionRecordedEventV1Schema,
  CANONICAL_EVENT_TYPES,
  communicationStateRecordedEventV1Schema,
  executionIntentIssuedEventV1Schema,
  executionResultRecordedEventV1Schema,
  recommendationCreatedEventV1Schema,
  recommendationLifecycleStateRecordedEventV1Schema,
  type ApprovalDecisionRecordedEventV1,
  type CanonicalEvent,
  type CanonicalEventType,
  type CommunicationStateRecordedEventV1,
  type ExecutionIntentIssuedEventV1,
  type ExecutionResultRecordedEventV1,
  type RecommendationCreatedEventV1,
  type RecommendationLifecycleStateRecordedEventV1,
} from './events/event-catalog.js';

export {
  CANONICAL_EVENT_ENTRIES,
  CANONICAL_EVENT_REGISTRY,
  canonicalEventKey,
  isRegisteredCanonicalEvent,
  parseCanonicalEvent,
  safeParseCanonicalEvent,
  type CanonicalEventRegistry,
  type CanonicalEventRegistryEntry,
} from './events/event-registry.js';

// ---------------------------------------------------------------------------
// Governed lifecycle contracts
// ---------------------------------------------------------------------------

export {
  APPROVAL_LEVELS,
  approvalLevelSchema,
  canonicalEventEvidenceSchema,
  derivedSignalEvidenceSchema,
  evidenceItemSchema,
  MAX_CONTRIBUTING_AGENTS,
  MAX_EVIDENCE_ITEMS,
  MAX_PROPOSED_ACTIONS,
  PRIORITIES,
  prioritySchema,
  proposedActionSchema,
  RECOMMENDATION_CONTRACT_VERSION,
  recommendationV1Schema,
  RISK_CLASSES,
  riskClassSchema,
  type ApprovalLevel,
  type EvidenceItem,
  type Priority,
  type ProposedAction,
  type RecommendationV1,
  type RiskClass,
} from './recommendations/recommendation.js';

export {
  RECOMMENDATION_LIFECYCLE_CONTRACT_VERSION,
  RECOMMENDATION_STATE_LABELS,
  RECOMMENDATION_STATES,
  recommendationLifecycleRecordV1Schema,
  recommendationStateSchema,
  type RecommendationLifecycleRecordV1,
  type RecommendationState,
} from './recommendations/recommendation-lifecycle.js';

export {
  actionDecisionSchema,
  APPROVAL_DECISION_CONTRACT_VERSION,
  APPROVAL_OUTCOMES,
  approvalDecisionV1Schema,
  approvalOutcomeSchema,
  MAX_ACTION_DECISIONS,
  type ActionDecision,
  type ApprovalDecisionV1,
  type ApprovalOutcome,
} from './approvals/approval-decision.js';

export {
  deliverySemanticsSchema,
  EXECUTION_INTENT_CONTRACT_VERSION,
  executionIntentV1Schema,
  type DeliverySemantics,
  type ExecutionIntentV1,
} from './execution/execution-intent.js';

export {
  EXECUTION_OUTCOMES,
  EXECUTION_RESULT_CONTRACT_VERSION,
  executionFailureSchema,
  executionOutcomeSchema,
  executionResultV1Schema,
  FAILURE_CATEGORIES,
  failureCategorySchema,
  RETRY_CLASSIFICATIONS,
  retryClassificationSchema,
  type ExecutionFailure,
  type ExecutionOutcome,
  type ExecutionResultV1,
  type FailureCategory,
  type RetryClassification,
} from './execution/execution-result.js';

export {
  COMMUNICATION_CHANNEL_LABELS,
  COMMUNICATION_CHANNELS,
  communicationChannelSchema,
  VOICE_CHANNEL,
  type CommunicationChannel,
} from './communications/communication-channel.js';

export {
  COMMUNICATION_REJECTION_REASONS,
  COMMUNICATION_STATE_COUNT,
  COMMUNICATION_STATE_LABELS,
  COMMUNICATION_STATES,
  communicationStateSchema,
  STATES_JARVIS_MAY_NOT_ORIGINATE,
  type CommunicationState,
} from './communications/communication-state.js';

export {
  COMMUNICATION_STATE_RECORD_CONTRACT_VERSION,
  communicationStateRecordV1Schema,
  type CommunicationStateRecordV1,
} from './communications/communication-state-record.js';

// ---------------------------------------------------------------------------
// Requests: Jarvis asking. Never Jarvis deciding.
// ---------------------------------------------------------------------------

export {
  APPROVAL_REQUEST_CONTRACT_VERSION,
  approvalRequestV1Schema,
  type ApprovalRequestV1,
} from './approvals/approval-request.js';

export {
  COMMUNICATION_REQUEST_CONTRACT_VERSION,
  communicationRequestV1Schema,
  contentReferenceSchema,
  requestedTimingSchema,
  templateVariablesSchema,
  type CommunicationRequestV1,
  type ContentReference,
  type RequestedTiming,
} from './communications/communication-request.js';

export {
  COMMUNICATION_RESULT_CONTRACT_VERSION,
  COMMUNICATION_RESULT_STATES,
  communicationResultV1Schema,
  type CommunicationResultV1,
} from './communications/communication-result.js';

export {
  COMMUNICATION_AUTHORIZATION_CONTRACT_VERSION,
  COMMUNICATION_AUTHORIZATION_OUTCOMES,
  COMMUNICATION_REFUSAL_REASONS,
  communicationAuthorizationOutcomeSchema,
  communicationAuthorizationV1Schema,
  type CommunicationAuthorizationOutcome,
  type CommunicationAuthorizationV1,
  type CommunicationRefusalReason,
} from './communications/communication-authorization.js';

export {
  HANDOFF_OUTCOMES,
  HUMAN_HANDOFF_RECORD_CONTRACT_VERSION,
  HUMAN_HANDOFF_REQUEST_CONTRACT_VERSION,
  handoffOutcomeSchema,
  humanHandoffRecordV1Schema,
  humanHandoffRequestV1Schema,
  type HandoffOutcome,
  type HumanHandoffRecordV1,
  type HumanHandoffRequestV1,
} from './communications/human-handoff.js';

// ---------------------------------------------------------------------------
// Assignment, reassignment, and linked leads
// ---------------------------------------------------------------------------

export {
  batchNumberSchema,
  distinctEntityKeys,
  entityKey,
  INITIAL_BATCH_NUMBER,
  MAX_BATCHES_PER_LEAD_CATEGORY,
  MAX_VENDORS_PER_BATCH,
  MAX_VENDORS_PER_LEAD_CATEGORY,
  REPLACEMENT_BATCH_NUMBER,
  type BatchNumber,
} from './assignments/assignment-policy.js';

export {
  CLIENT_CONFIRMATION_CONTRACT_VERSION,
  clientConfirmationV1Schema,
  confirmationChannelCodeSchema,
  type ClientConfirmationV1,
} from './assignments/client-confirmation.js';

export {
  ASSIGNMENT_BATCH_CONTRACT_VERSION,
  assignmentBatchV1Schema,
  type AssignmentBatchV1,
} from './assignments/assignment-batch.js';

export {
  CLIENT_REASSIGNMENT_DECISION_CONTRACT_VERSION,
  CLIENT_REASSIGNMENT_REQUEST_CONTRACT_VERSION,
  clientReassignmentDecisionV1Schema,
  clientReassignmentRequestV1Schema,
  DISSATISFACTION_SEVERITIES,
  dissatisfactionSeveritySchema,
  REASSIGNMENT_OUTCOMES,
  reassignmentOutcomeSchema,
  type ClientReassignmentDecisionV1,
  type ClientReassignmentRequestV1,
  type DissatisfactionSeverity,
  type ReassignmentOutcome,
} from './assignments/client-reassignment.js';

export {
  ADDITIONAL_SERVICE_REQUEST_CONTRACT_VERSION,
  additionalServiceRequestV1Schema,
  type AdditionalServiceRequestV1,
} from './assignments/additional-service.js';

export {
  leadIndependenceSchema,
  LINKED_LEAD_CONTRACT_VERSION,
  linkedLeadCreatedV1Schema,
  type LeadIndependence,
  type LinkedLeadCreatedV1,
} from './assignments/linked-lead.js';

// ---------------------------------------------------------------------------
// Learning and evaluation
// ---------------------------------------------------------------------------

export {
  MODEL_PROVIDERS,
  MODEL_REFERENCE_CONTRACT_VERSION,
  modelIdSchema,
  modelProviderSchema,
  modelReferenceV1Schema,
  type ModelProvider,
  type ModelReferenceV1,
} from './learning/model-reference.js';

export {
  PROMPT_CONFIGURATION_REFERENCE_CONTRACT_VERSION,
  PROMPT_DIGEST_PATTERN,
  promptConfigurationReferenceV1Schema,
  promptDigestSchema,
  type PromptConfigurationReferenceV1,
} from './learning/prompt-configuration.js';

export {
  AGENT_RUN_CONTRACT_VERSION,
  AGENT_RUN_OUTCOMES,
  agentRunOutcomeSchema,
  agentRunRecordV1Schema,
  MAX_INPUT_EVENTS,
  MAX_PRODUCED_RECOMMENDATIONS,
  type AgentRunOutcome,
  type AgentRunRecordV1,
} from './learning/agent-run.js';

export {
  CORRECTION_TYPES,
  correctionTypeSchema,
  HUMAN_CORRECTION_CONTRACT_VERSION,
  humanCorrectionV1Schema,
  type CorrectionType,
  type HumanCorrectionV1,
} from './learning/human-correction.js';

export {
  ACCEPTANCE_OUTCOMES,
  acceptanceOutcomeSchema,
  QUALITY_BANDS,
  qualityBandSchema,
  RECOMMENDATION_EVALUATION_CONTRACT_VERSION,
  recommendationEvaluationV1Schema,
  type AcceptanceOutcome,
  type QualityBand,
  type RecommendationEvaluationV1,
} from './learning/recommendation-evaluation.js';

export {
  OUTCOME_CLASSES,
  OUTCOME_FEEDBACK_CONTRACT_VERSION,
  outcomeClassSchema,
  outcomeFeedbackV1Schema,
  type OutcomeClass,
  type OutcomeFeedbackV1,
} from './learning/outcome-feedback.js';

export {
  DATASET_EXAMPLE_PROVENANCE_CONTRACT_VERSION,
  DATASET_SOURCE_KINDS,
  datasetExampleProvenanceV1Schema,
  datasetSourceKindSchema,
  datasetSourceReferenceSchema,
  MAX_SOURCE_REFERENCES,
  type DatasetExampleProvenanceV1,
  type DatasetSourceKind,
  type DatasetSourceReference,
} from './learning/dataset-provenance.js';

export {
  TRAINING_ELIGIBILITY_DECISION_CONTRACT_VERSION,
  trainingEligibilityDecisionV1Schema,
  type TrainingEligibilityDecisionV1,
} from './learning/training-eligibility.js';

// ---------------------------------------------------------------------------
// Agent memory — derived, rebuildable, never authoritative
// ---------------------------------------------------------------------------

export {
  AGENT_MEMORY_CONTRACT_VERSION,
  agentMemoryRecordV1Schema,
  derivedSignalsSchema,
  MAX_MEMORY_SOURCE_EVENTS,
  MAX_MEMORY_SUBJECTS,
  MEMORY_SUBJECT_OWNERSHIP,
  type AgentMemoryRecordV1,
} from './memory/agent-memory.js';

export {
  MEMORY_INVALIDATION_CONTRACT_VERSION,
  MEMORY_INVALIDATION_SCOPES,
  memoryInvalidationRequestV1Schema,
  memoryInvalidationScopeSchema,
  type MemoryInvalidationRequestV1,
  type MemoryInvalidationScope,
} from './memory/memory-invalidation.js';

// ---------------------------------------------------------------------------
// Privacy and policy governance
// ---------------------------------------------------------------------------

export {
  ERASABLE_SCOPES,
  ERASURE_OUTCOMES,
  ERASURE_RECORD_CONTRACT_VERSION,
  ERASURE_REQUEST_CONTRACT_VERSION,
  erasableScopeSchema,
  erasureOutcomeSchema,
  erasureRecordV1Schema,
  erasureRequestV1Schema,
  type ErasableScope,
  type ErasureOutcome,
  type ErasureRecordV1,
  type ErasureRequestV1,
} from './privacy/erasure.js';

export {
  POLICY_VERSION_CHANGE_CONTRACT_VERSION,
  policyVersionChangeV1Schema,
  type PolicyVersionChangeV1,
} from './governance/policy-version.js';

// ---------------------------------------------------------------------------
// Target event payload primitives
// ---------------------------------------------------------------------------

export {
  derivedObservationSchema,
  observationPayload,
  observationPayloadSchema,
  QUALITATIVE_BANDS,
  qualitativeBandSchema,
  type ObservationPayload,
  type QualitativeBand,
} from './events/target-payloads.js';

// ---------------------------------------------------------------------------
// Validation API
// ---------------------------------------------------------------------------

export {
  contractFailure,
  ContractValidationError,
  parseWith,
  safeParseWith,
  toContractIssues,
  toContractResult,
  type ContractIssue,
  type ContractResult,
} from './validation.js';

import { additionalServiceRequestV1Schema } from './assignments/additional-service.js';
import { agentMemoryRecordV1Schema } from './memory/agent-memory.js';
import { agentRunRecordV1Schema } from './learning/agent-run.js';
import { clientConfirmationV1Schema } from './assignments/client-confirmation.js';
import { modelReferenceV1Schema } from './learning/model-reference.js';
import { promptConfigurationReferenceV1Schema } from './learning/prompt-configuration.js';
import { approvalDecisionV1Schema } from './approvals/approval-decision.js';
import { approvalRequestV1Schema } from './approvals/approval-request.js';
import { assignmentBatchV1Schema } from './assignments/assignment-batch.js';
import { communicationAuthorizationV1Schema } from './communications/communication-authorization.js';
import { communicationRequestV1Schema } from './communications/communication-request.js';
import { communicationResultV1Schema } from './communications/communication-result.js';
import { communicationStateRecordV1Schema } from './communications/communication-state-record.js';
import { datasetExampleProvenanceV1Schema } from './learning/dataset-provenance.js';
import { erasureRecordV1Schema, erasureRequestV1Schema } from './privacy/erasure.js';
import { executionIntentV1Schema } from './execution/execution-intent.js';
import { executionResultV1Schema } from './execution/execution-result.js';
import { humanCorrectionV1Schema } from './learning/human-correction.js';
import {
  humanHandoffRecordV1Schema,
  humanHandoffRequestV1Schema,
} from './communications/human-handoff.js';
import { linkedLeadCreatedV1Schema } from './assignments/linked-lead.js';
import { memoryInvalidationRequestV1Schema } from './memory/memory-invalidation.js';
import { outcomeFeedbackV1Schema } from './learning/outcome-feedback.js';
import { policyVersionChangeV1Schema } from './governance/policy-version.js';
import { recommendationEvaluationV1Schema } from './learning/recommendation-evaluation.js';
import { recommendationLifecycleRecordV1Schema } from './recommendations/recommendation-lifecycle.js';
import { recommendationV1Schema } from './recommendations/recommendation.js';
import { trainingEligibilityDecisionV1Schema } from './learning/training-eligibility.js';
import {
  clientReassignmentDecisionV1Schema,
  clientReassignmentRequestV1Schema,
} from './assignments/client-reassignment.js';
import { parseWith, safeParseWith, type ContractResult } from './validation.js';

import type { AdditionalServiceRequestV1 } from './assignments/additional-service.js';
import type { AgentMemoryRecordV1 } from './memory/agent-memory.js';
import type { AgentRunRecordV1 } from './learning/agent-run.js';
import type { ClientConfirmationV1 } from './assignments/client-confirmation.js';
import type { ModelReferenceV1 } from './learning/model-reference.js';
import type { PromptConfigurationReferenceV1 } from './learning/prompt-configuration.js';
import type { ApprovalDecisionV1 } from './approvals/approval-decision.js';
import type { ApprovalRequestV1 } from './approvals/approval-request.js';
import type { AssignmentBatchV1 } from './assignments/assignment-batch.js';
import type { CommunicationAuthorizationV1 } from './communications/communication-authorization.js';
import type { CommunicationRequestV1 } from './communications/communication-request.js';
import type { CommunicationResultV1 } from './communications/communication-result.js';
import type { CommunicationStateRecordV1 } from './communications/communication-state-record.js';
import type { DatasetExampleProvenanceV1 } from './learning/dataset-provenance.js';
import type { ErasureRecordV1, ErasureRequestV1 } from './privacy/erasure.js';
import type { ExecutionIntentV1 } from './execution/execution-intent.js';
import type { ExecutionResultV1 } from './execution/execution-result.js';
import type { HumanCorrectionV1 } from './learning/human-correction.js';
import type {
  HumanHandoffRecordV1,
  HumanHandoffRequestV1,
} from './communications/human-handoff.js';
import type { LinkedLeadCreatedV1 } from './assignments/linked-lead.js';
import type { MemoryInvalidationRequestV1 } from './memory/memory-invalidation.js';
import type { OutcomeFeedbackV1 } from './learning/outcome-feedback.js';
import type { PolicyVersionChangeV1 } from './governance/policy-version.js';
import type { RecommendationEvaluationV1 } from './learning/recommendation-evaluation.js';
import type { RecommendationLifecycleRecordV1 } from './recommendations/recommendation-lifecycle.js';
import type { RecommendationV1 } from './recommendations/recommendation.js';
import type { TrainingEligibilityDecisionV1 } from './learning/training-eligibility.js';
import type {
  ClientReassignmentDecisionV1,
  ClientReassignmentRequestV1,
} from './assignments/client-reassignment.js';

/** Parse a recommendation, or throw. */
export function parseRecommendation(input: unknown): RecommendationV1 {
  return parseWith('RecommendationV1', recommendationV1Schema, input);
}

/** Parse a recommendation, returning an explicit result. */
export function safeParseRecommendation(input: unknown): ContractResult<RecommendationV1> {
  return safeParseWith('RecommendationV1', recommendationV1Schema, input);
}

/** Parse a recommendation lifecycle record, or throw. */
export function parseRecommendationLifecycleRecord(
  input: unknown,
): RecommendationLifecycleRecordV1 {
  return parseWith('RecommendationLifecycleRecordV1', recommendationLifecycleRecordV1Schema, input);
}

/** Parse a recommendation lifecycle record, returning an explicit result. */
export function safeParseRecommendationLifecycleRecord(
  input: unknown,
): ContractResult<RecommendationLifecycleRecordV1> {
  return safeParseWith(
    'RecommendationLifecycleRecordV1',
    recommendationLifecycleRecordV1Schema,
    input,
  );
}

/** Parse an approval decision, or throw. */
export function parseApprovalDecision(input: unknown): ApprovalDecisionV1 {
  return parseWith('ApprovalDecisionV1', approvalDecisionV1Schema, input);
}

/** Parse an approval decision, returning an explicit result. */
export function safeParseApprovalDecision(input: unknown): ContractResult<ApprovalDecisionV1> {
  return safeParseWith('ApprovalDecisionV1', approvalDecisionV1Schema, input);
}

/** Parse an execution intent, or throw. */
export function parseExecutionIntent(input: unknown): ExecutionIntentV1 {
  return parseWith('ExecutionIntentV1', executionIntentV1Schema, input);
}

/** Parse an execution intent, returning an explicit result. */
export function safeParseExecutionIntent(input: unknown): ContractResult<ExecutionIntentV1> {
  return safeParseWith('ExecutionIntentV1', executionIntentV1Schema, input);
}

/** Parse an execution result, or throw. */
export function parseExecutionResult(input: unknown): ExecutionResultV1 {
  return parseWith('ExecutionResultV1', executionResultV1Schema, input);
}

/** Parse an execution result, returning an explicit result. */
export function safeParseExecutionResult(input: unknown): ContractResult<ExecutionResultV1> {
  return safeParseWith('ExecutionResultV1', executionResultV1Schema, input);
}

/** Parse a communication state record, or throw. */
export function parseCommunicationStateRecord(input: unknown): CommunicationStateRecordV1 {
  return parseWith('CommunicationStateRecordV1', communicationStateRecordV1Schema, input);
}

/** Parse a communication state record, returning an explicit result. */
export function safeParseCommunicationStateRecord(
  input: unknown,
): ContractResult<CommunicationStateRecordV1> {
  return safeParseWith('CommunicationStateRecordV1', communicationStateRecordV1Schema, input);
}

/** Parse an approval request, or throw. Jarvis asking — it carries no authority. */
export function parseApprovalRequest(input: unknown): ApprovalRequestV1 {
  return parseWith('ApprovalRequestV1', approvalRequestV1Schema, input);
}

/** Parse an approval request, returning an explicit result. */
export function safeParseApprovalRequest(input: unknown): ContractResult<ApprovalRequestV1> {
  return safeParseWith('ApprovalRequestV1', approvalRequestV1Schema, input);
}

/** Parse a communication request, or throw. It cannot send, and cannot authorize. */
export function parseCommunicationRequest(input: unknown): CommunicationRequestV1 {
  return parseWith('CommunicationRequestV1', communicationRequestV1Schema, input);
}

/** Parse a communication request, returning an explicit result. */
export function safeParseCommunicationRequest(
  input: unknown,
): ContractResult<CommunicationRequestV1> {
  return safeParseWith('CommunicationRequestV1', communicationRequestV1Schema, input);
}

/** Parse a communication result, or throw. Core's truth, not a provider's claim. */
export function parseCommunicationResult(input: unknown): CommunicationResultV1 {
  return parseWith('CommunicationResultV1', communicationResultV1Schema, input);
}

/** Parse a communication result, returning an explicit result. */
export function safeParseCommunicationResult(
  input: unknown,
): ContractResult<CommunicationResultV1> {
  return safeParseWith('CommunicationResultV1', communicationResultV1Schema, input);
}

/** Parse a communication authorization, or throw. The consent boundary. */
export function parseCommunicationAuthorization(input: unknown): CommunicationAuthorizationV1 {
  return parseWith('CommunicationAuthorizationV1', communicationAuthorizationV1Schema, input);
}

/** Parse a communication authorization, returning an explicit result. */
export function safeParseCommunicationAuthorization(
  input: unknown,
): ContractResult<CommunicationAuthorizationV1> {
  return safeParseWith('CommunicationAuthorizationV1', communicationAuthorizationV1Schema, input);
}

/** Parse an assignment batch, or throw. Every vendor-cap invariant is checked here. */
export function parseAssignmentBatch(input: unknown): AssignmentBatchV1 {
  return parseWith('AssignmentBatchV1', assignmentBatchV1Schema, input);
}

/** Parse an assignment batch, returning an explicit result. */
export function safeParseAssignmentBatch(input: unknown): ContractResult<AssignmentBatchV1> {
  return safeParseWith('AssignmentBatchV1', assignmentBatchV1Schema, input);
}

/** Parse a client reassignment request, or throw. Riya asks; she never assigns. */
export function parseClientReassignmentRequest(input: unknown): ClientReassignmentRequestV1 {
  return parseWith('ClientReassignmentRequestV1', clientReassignmentRequestV1Schema, input);
}

/** Parse a client reassignment request, returning an explicit result. */
export function safeParseClientReassignmentRequest(
  input: unknown,
): ContractResult<ClientReassignmentRequestV1> {
  return safeParseWith('ClientReassignmentRequestV1', clientReassignmentRequestV1Schema, input);
}

/** Parse a client reassignment decision, or throw. Core decides. */
export function parseClientReassignmentDecision(input: unknown): ClientReassignmentDecisionV1 {
  return parseWith('ClientReassignmentDecisionV1', clientReassignmentDecisionV1Schema, input);
}

/** Parse a client reassignment decision, returning an explicit result. */
export function safeParseClientReassignmentDecision(
  input: unknown,
): ContractResult<ClientReassignmentDecisionV1> {
  return safeParseWith('ClientReassignmentDecisionV1', clientReassignmentDecisionV1Schema, input);
}

/** Parse an additional-service request, or throw. Cross-category, and confirmed. */
export function parseAdditionalServiceRequest(input: unknown): AdditionalServiceRequestV1 {
  return parseWith('AdditionalServiceRequestV1', additionalServiceRequestV1Schema, input);
}

/** Parse an additional-service request, returning an explicit result. */
export function safeParseAdditionalServiceRequest(
  input: unknown,
): ContractResult<AdditionalServiceRequestV1> {
  return safeParseWith('AdditionalServiceRequestV1', additionalServiceRequestV1Schema, input);
}

/** Parse a linked-lead creation, or throw. Its own identity, always. */
export function parseLinkedLeadCreated(input: unknown): LinkedLeadCreatedV1 {
  return parseWith('LinkedLeadCreatedV1', linkedLeadCreatedV1Schema, input);
}

/** Parse a linked-lead creation, returning an explicit result. */
export function safeParseLinkedLeadCreated(input: unknown): ContractResult<LinkedLeadCreatedV1> {
  return safeParseWith('LinkedLeadCreatedV1', linkedLeadCreatedV1Schema, input);
}

/** Parse an agent-run record, or throw. */
export function parseAgentRunRecord(input: unknown): AgentRunRecordV1 {
  return parseWith('AgentRunRecordV1', agentRunRecordV1Schema, input);
}

/** Parse an agent-run record, returning an explicit result. */
export function safeParseAgentRunRecord(input: unknown): ContractResult<AgentRunRecordV1> {
  return safeParseWith('AgentRunRecordV1', agentRunRecordV1Schema, input);
}

/** Parse an agent memory record, or throw. Derived, rebuildable, never authoritative. */
export function parseAgentMemoryRecord(input: unknown): AgentMemoryRecordV1 {
  return parseWith('AgentMemoryRecordV1', agentMemoryRecordV1Schema, input);
}

/** Parse an agent memory record, returning an explicit result. */
export function safeParseAgentMemoryRecord(input: unknown): ContractResult<AgentMemoryRecordV1> {
  return safeParseWith('AgentMemoryRecordV1', agentMemoryRecordV1Schema, input);
}

/** Parse a memory invalidation request, or throw. */
export function parseMemoryInvalidationRequest(input: unknown): MemoryInvalidationRequestV1 {
  return parseWith('MemoryInvalidationRequestV1', memoryInvalidationRequestV1Schema, input);
}

/** Parse a memory invalidation request, returning an explicit result. */
export function safeParseMemoryInvalidationRequest(
  input: unknown,
): ContractResult<MemoryInvalidationRequestV1> {
  return safeParseWith('MemoryInvalidationRequestV1', memoryInvalidationRequestV1Schema, input);
}

/** Parse a human correction, or throw. A new record — never an edit. */
export function parseHumanCorrection(input: unknown): HumanCorrectionV1 {
  return parseWith('HumanCorrectionV1', humanCorrectionV1Schema, input);
}

/** Parse a human correction, returning an explicit result. */
export function safeParseHumanCorrection(input: unknown): ContractResult<HumanCorrectionV1> {
  return safeParseWith('HumanCorrectionV1', humanCorrectionV1Schema, input);
}

/** Parse a recommendation evaluation, or throw. Acceptance — not outcome. */
export function parseRecommendationEvaluation(input: unknown): RecommendationEvaluationV1 {
  return parseWith('RecommendationEvaluationV1', recommendationEvaluationV1Schema, input);
}

/** Parse a recommendation evaluation, returning an explicit result. */
export function safeParseRecommendationEvaluation(
  input: unknown,
): ContractResult<RecommendationEvaluationV1> {
  return safeParseWith('RecommendationEvaluationV1', recommendationEvaluationV1Schema, input);
}

/** Parse outcome feedback, or throw. Did the metric actually move? */
export function parseOutcomeFeedback(input: unknown): OutcomeFeedbackV1 {
  return parseWith('OutcomeFeedbackV1', outcomeFeedbackV1Schema, input);
}

/** Parse outcome feedback, returning an explicit result. */
export function safeParseOutcomeFeedback(input: unknown): ContractResult<OutcomeFeedbackV1> {
  return safeParseWith('OutcomeFeedbackV1', outcomeFeedbackV1Schema, input);
}

/** Parse dataset-example provenance, or throw. */
export function parseDatasetExampleProvenance(input: unknown): DatasetExampleProvenanceV1 {
  return parseWith('DatasetExampleProvenanceV1', datasetExampleProvenanceV1Schema, input);
}

/** Parse dataset-example provenance, returning an explicit result. */
export function safeParseDatasetExampleProvenance(
  input: unknown,
): ContractResult<DatasetExampleProvenanceV1> {
  return safeParseWith('DatasetExampleProvenanceV1', datasetExampleProvenanceV1Schema, input);
}

/** Parse a training-eligibility decision, or throw. No data becomes training data automatically. */
export function parseTrainingEligibilityDecision(input: unknown): TrainingEligibilityDecisionV1 {
  return parseWith('TrainingEligibilityDecisionV1', trainingEligibilityDecisionV1Schema, input);
}

/** Parse a training-eligibility decision, returning an explicit result. */
export function safeParseTrainingEligibilityDecision(
  input: unknown,
): ContractResult<TrainingEligibilityDecisionV1> {
  return safeParseWith('TrainingEligibilityDecisionV1', trainingEligibilityDecisionV1Schema, input);
}

/** Parse an erasure request, or throw. */
export function parseErasureRequest(input: unknown): ErasureRequestV1 {
  return parseWith('ErasureRequestV1', erasureRequestV1Schema, input);
}

/** Parse an erasure request, returning an explicit result. */
export function safeParseErasureRequest(input: unknown): ContractResult<ErasureRequestV1> {
  return safeParseWith('ErasureRequestV1', erasureRequestV1Schema, input);
}

/** Parse an erasure record, or throw. "Completed" may not leave data behind. */
export function parseErasureRecord(input: unknown): ErasureRecordV1 {
  return parseWith('ErasureRecordV1', erasureRecordV1Schema, input);
}

/** Parse an erasure record, returning an explicit result. */
export function safeParseErasureRecord(input: unknown): ContractResult<ErasureRecordV1> {
  return safeParseWith('ErasureRecordV1', erasureRecordV1Schema, input);
}

/** Parse a policy version change, or throw. */
export function parsePolicyVersionChange(input: unknown): PolicyVersionChangeV1 {
  return parseWith('PolicyVersionChangeV1', policyVersionChangeV1Schema, input);
}

/** Parse a policy version change, returning an explicit result. */
export function safeParsePolicyVersionChange(
  input: unknown,
): ContractResult<PolicyVersionChangeV1> {
  return safeParseWith('PolicyVersionChangeV1', policyVersionChangeV1Schema, input);
}

/** Parse a human handoff request, or throw. Asking for a person is not having one. */
export function parseHumanHandoffRequest(input: unknown): HumanHandoffRequestV1 {
  return parseWith('HumanHandoffRequestV1', humanHandoffRequestV1Schema, input);
}

/** Parse a human handoff request, returning an explicit result. */
export function safeParseHumanHandoffRequest(
  input: unknown,
): ContractResult<HumanHandoffRequestV1> {
  return safeParseWith('HumanHandoffRequestV1', humanHandoffRequestV1Schema, input);
}

/** Parse a human handoff record, or throw. A person actually picked it up. */
export function parseHumanHandoffRecord(input: unknown): HumanHandoffRecordV1 {
  return parseWith('HumanHandoffRecordV1', humanHandoffRecordV1Schema, input);
}

/** Parse a human handoff record, returning an explicit result. */
export function safeParseHumanHandoffRecord(input: unknown): ContractResult<HumanHandoffRecordV1> {
  return safeParseWith('HumanHandoffRecordV1', humanHandoffRecordV1Schema, input);
}

/**
 * Parse a client confirmation, or throw.
 *
 * Embedded inside four other contracts, and validated transitively by each of them — but
 * exposed standalone as well, because Core will need to validate one **before** it is
 * embedded in anything. A contract that can only be checked once it is already inside
 * something else cannot be checked at the point it is created.
 */
export function parseClientConfirmation(input: unknown): ClientConfirmationV1 {
  return parseWith('ClientConfirmationV1', clientConfirmationV1Schema, input);
}

/** Parse a client confirmation, returning an explicit result. */
export function safeParseClientConfirmation(input: unknown): ContractResult<ClientConfirmationV1> {
  return safeParseWith('ClientConfirmationV1', clientConfirmationV1Schema, input);
}

/** Parse a model reference, or throw. A citation of a model — never a channel to one. */
export function parseModelReference(input: unknown): ModelReferenceV1 {
  return parseWith('ModelReferenceV1', modelReferenceV1Schema, input);
}

/** Parse a model reference, returning an explicit result. */
export function safeParseModelReference(input: unknown): ContractResult<ModelReferenceV1> {
  return safeParseWith('ModelReferenceV1', modelReferenceV1Schema, input);
}

/** Parse a prompt configuration reference, or throw. References and versions only. */
export function parsePromptConfigurationReference(input: unknown): PromptConfigurationReferenceV1 {
  return parseWith('PromptConfigurationReferenceV1', promptConfigurationReferenceV1Schema, input);
}

/** Parse a prompt configuration reference, returning an explicit result. */
export function safeParsePromptConfigurationReference(
  input: unknown,
): ContractResult<PromptConfigurationReferenceV1> {
  return safeParseWith(
    'PromptConfigurationReferenceV1',
    promptConfigurationReferenceV1Schema,
    input,
  );
}

// --- Stage 3.1.4: canonical payload privacy hardening (ADR-0026) ---
export {
  inspectProhibitedContent,
  isFreeOfProhibitedContent,
  isProhibitedKey,
  keySegments,
  normaliseKey,
  PROHIBITED_KEY_GROUPS,
  PROHIBITED_KEYS,
  type ProhibitedContentIssue,
} from './common/prohibited-content.js';

export {
  boundedCountSchema,
  contractPayloadV2,
  derivedSignalSchema,
  derivedSignalListSchema,
  MAX_SIGNALS,
  MAX_TAXONOMY_LABEL_LENGTH,
  observationPayloadV2,
  observationPayloadV2Schema,
  PAYLOAD_NUMERIC_BOUNDS,
  scoreSchema,
  taxonomyLabelSchema,
  unitIntervalSchema,
  withProhibitedContentGuard,
  type DerivedSignal,
  type ObservationPayloadV2,
  type TaxonomyLabel,
} from './events/payload-primitives.js';

export {
  CANONICAL_PAYLOAD_KEYS,
  CANONICAL_PAYLOAD_SCHEMAS,
  canonicalPayloadKey,
  resolveCanonicalPayloadSchema,
  type CanonicalPayloadKey,
} from './events/payload-registry.js';

export {
  TAXONOMY_EVENT_TYPES,
  TAXONOMY_NODE_STATES,
  taxonomyNodeStateSchema,
  taxonomyReferenceShape,
  taxonomyVersionSchema,
  type TaxonomyEventType,
  type TaxonomyVersion,
} from './events/taxonomy-events.js';

export { REGISTERED_EVENT_DEFINITIONS } from './events/canonical-events-v2.js';

export {
  findRetiredVersion,
  isRetiredCanonicalVersion,
  RETIRED_EVENT_VERSIONS,
  UNSUPPORTED_RETIRED_VERSION,
  UNSUPPORTED_UNKNOWN_VERSION,
  type RetiredEventVersion,
} from './events/retired-versions.js';

export { isGuardedPayloadSchema } from './events/payload-primitives.js';
