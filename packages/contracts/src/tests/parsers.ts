/**
 * Test helper: map a contract name to its safe parser.
 *
 * Not a test file. Shared by the table-driven suites so that a fixture declaring
 * `contract: 'ExecutionIntentV1'` is checked against the parser a real consumer
 * would actually call — the exported public API, not the internal schema.
 *
 * The map is exhaustive over `ContractName` by type, so **adding a contract without
 * adding its parser here is a compile error**, not a silently unexercised contract.
 */

import type { ContractName } from '../fixtures/valid.js';
import {
  safeParseAdditionalServiceRequest,
  safeParseAgentMemoryRecord,
  safeParseAgentRunRecord,
  safeParseApprovalDecision,
  safeParseApprovalRequest,
  safeParseAssignmentBatch,
  safeParseCanonicalEvent,
  safeParseClientConfirmation,
  safeParseClientReassignmentDecision,
  safeParseClientReassignmentRequest,
  safeParseCommunicationAuthorization,
  safeParseCommunicationRequest,
  safeParseCommunicationResult,
  safeParseCommunicationStateRecord,
  safeParseDatasetExampleProvenance,
  safeParseErasureRecord,
  safeParseErasureRequest,
  safeParseExecutionIntent,
  safeParseExecutionResult,
  safeParseHumanCorrection,
  safeParseHumanHandoffRecord,
  safeParseHumanHandoffRequest,
  safeParseLinkedLeadCreated,
  safeParseMemoryInvalidationRequest,
  safeParseModelReference,
  safeParseOutcomeFeedback,
  safeParsePolicyVersionChange,
  safeParsePromptConfigurationReference,
  safeParseRecommendation,
  safeParseRecommendationEvaluation,
  safeParseRecommendationLifecycleRecord,
  safeParseTrainingEligibilityDecision,
  type ContractResult,
} from '../index.js';

export const SAFE_PARSERS: Readonly<
  Record<ContractName, (input: unknown) => ContractResult<unknown>>
> = {
  // Phase 2, as originally implemented
  RecommendationV1: safeParseRecommendation,
  RecommendationLifecycleRecordV1: safeParseRecommendationLifecycleRecord,
  ApprovalDecisionV1: safeParseApprovalDecision,
  ExecutionIntentV1: safeParseExecutionIntent,
  ExecutionResultV1: safeParseExecutionResult,
  CommunicationStateRecordV1: safeParseCommunicationStateRecord,
  CanonicalEvent: safeParseCanonicalEvent,

  // Requests: Jarvis asking, never deciding
  ApprovalRequestV1: safeParseApprovalRequest,
  CommunicationRequestV1: safeParseCommunicationRequest,
  CommunicationResultV1: safeParseCommunicationResult,
  CommunicationAuthorizationV1: safeParseCommunicationAuthorization,
  HumanHandoffRequestV1: safeParseHumanHandoffRequest,
  HumanHandoffRecordV1: safeParseHumanHandoffRecord,

  // Assignment, reassignment, linked leads
  ClientConfirmationV1: safeParseClientConfirmation,
  AssignmentBatchV1: safeParseAssignmentBatch,
  ClientReassignmentRequestV1: safeParseClientReassignmentRequest,
  ClientReassignmentDecisionV1: safeParseClientReassignmentDecision,
  AdditionalServiceRequestV1: safeParseAdditionalServiceRequest,
  LinkedLeadCreatedV1: safeParseLinkedLeadCreated,

  // Learning, evaluation, memory
  ModelReferenceV1: safeParseModelReference,
  PromptConfigurationReferenceV1: safeParsePromptConfigurationReference,
  AgentRunRecordV1: safeParseAgentRunRecord,
  AgentMemoryRecordV1: safeParseAgentMemoryRecord,
  MemoryInvalidationRequestV1: safeParseMemoryInvalidationRequest,
  HumanCorrectionV1: safeParseHumanCorrection,
  RecommendationEvaluationV1: safeParseRecommendationEvaluation,
  OutcomeFeedbackV1: safeParseOutcomeFeedback,
  DatasetExampleProvenanceV1: safeParseDatasetExampleProvenance,
  TrainingEligibilityDecisionV1: safeParseTrainingEligibilityDecision,

  // Privacy and policy
  ErasureRequestV1: safeParseErasureRequest,
  ErasureRecordV1: safeParseErasureRecord,
  PolicyVersionChangeV1: safeParsePolicyVersionChange,
};
