/**
 * Valid fixtures for the revised Phase 2 contracts and the target event catalogue.
 *
 * Held separately from valid.ts purely for size. The rules are identical and they are not
 * relaxed here:
 *
 * **No real data appears in this file, and none ever may.** Every identifier is a fixed,
 * obviously-synthetic UUID. Every subject is an opaque reference to an entity that does
 * not exist. There is not a phone number, an email address, a name, an address, a token,
 * or a provider credential anywhere in it — and the schemas would refuse most of them.
 *
 * ### Why this file imports only *types* from valid.ts
 *
 * `valid.ts` composes its tables from these fixtures, so a value import in the other
 * direction would be a runtime cycle: `valid.ts` would begin executing, reach into this
 * module, and this module would reach back for a constant that has not been initialised
 * yet. Type-only imports are erased at compile time, so they cost nothing at runtime and
 * the cycle never exists. Hence the separate constants below rather than a shared import.
 */

import type {
  AssignmentBatchCompletedEventV1,
  AssignmentBatchCreatedEventV1,
  CanonicalEvent,
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
  CommunicationAuthorizationRecordedEventV1,
  CommunicationHumanHandoffRecordedEventV1,
  CommunicationHumanHandoffRequestedEventV1,
  CommunicationResultRecordedEventV1,
  LeadLinkedCreatedEventV1,
  PolicyVersionChangedEventV1,
  PrivacyErasureRecordedEventV1,
  PrivacyErasureRequestedEventV1,
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
} from '../events/event-catalog.js';
import type { EvidenceItem } from '../recommendations/recommendation.js';
import type { AdditionalServiceRequestV1 } from '../assignments/additional-service.js';
import type { AgentMemoryRecordV1 } from '../memory/agent-memory.js';
import type { AgentRunRecordV1 } from '../learning/agent-run.js';
import type { ApprovalRequestV1 } from '../approvals/approval-request.js';
import type { AssignmentBatchV1 } from '../assignments/assignment-batch.js';
import type { ClientConfirmationV1 } from '../assignments/client-confirmation.js';
import type { ModelReferenceV1 } from '../learning/model-reference.js';
import type { PromptConfigurationReferenceV1 } from '../learning/prompt-configuration.js';
import type {
  ClientReassignmentDecisionV1,
  ClientReassignmentRequestV1,
} from '../assignments/client-reassignment.js';
import type { CommunicationAuthorizationV1 } from '../communications/communication-authorization.js';
import type { CommunicationRequestV1 } from '../communications/communication-request.js';
import type { CommunicationResultV1 } from '../communications/communication-result.js';
import type { DatasetExampleProvenanceV1 } from '../learning/dataset-provenance.js';
import type { ErasureRecordV1, ErasureRequestV1 } from '../privacy/erasure.js';
import type { HumanCorrectionV1 } from '../learning/human-correction.js';
import type {
  HumanHandoffRecordV1,
  HumanHandoffRequestV1,
} from '../communications/human-handoff.js';
import type { LinkedLeadCreatedV1 } from '../assignments/linked-lead.js';
import type { MemoryInvalidationRequestV1 } from '../memory/memory-invalidation.js';
import type { OutcomeFeedbackV1 } from '../learning/outcome-feedback.js';
import type { PolicyVersionChangeV1 } from '../governance/policy-version.js';
import type { RecommendationEvaluationV1 } from '../learning/recommendation-evaluation.js';
import type { TrainingEligibilityDecisionV1 } from '../learning/training-eligibility.js';
import type { ContractName, ValidFixture } from './valid.js';

/** Fixed, synthetic identifiers for the revised contracts. Stable, so tests are deterministic. */
export const TARGET_IDS = {
  approvalRequest: 'a1000001-0000-4000-8000-000000000001',
  communicationRequest: 'a1000002-0000-4000-8000-000000000002',
  communicationResult: 'a1000003-0000-4000-8000-000000000003',
  communication: 'a1000004-0000-4000-8000-000000000004',
  executionIntent: 'a1000005-0000-4000-8000-000000000005',
  executionResult: 'a1000006-0000-4000-8000-000000000006',
  recommendation: 'a1000007-0000-4000-8000-000000000007',
  decision: 'a1000008-0000-4000-8000-000000000008',
  action: 'a1000009-0000-4000-8000-000000000009',
  correlation: 'a100000a-0000-4000-8000-00000000000a',
  sourceEvent: 'a100000b-0000-4000-8000-00000000000b',

  initialBatch: 'b1000001-0000-4000-8000-000000000001',
  replacementBatch: 'b1000002-0000-4000-8000-000000000002',
  reassignmentRequest: 'b1000003-0000-4000-8000-000000000003',
  reassignmentDecision: 'b1000004-0000-4000-8000-000000000004',
  clientConfirmation: 'b1000005-0000-4000-8000-000000000005',
  additionalServiceRequest: 'b1000006-0000-4000-8000-000000000006',
  linkedLead: 'b1000007-0000-4000-8000-000000000007',
  confirmationEvent: 'b1000008-0000-4000-8000-000000000008',

  agentRun: 'c1000001-0000-4000-8000-000000000001',
  memoryRecord: 'c1000002-0000-4000-8000-000000000002',
  memoryInvalidation: 'c1000003-0000-4000-8000-000000000003',
  correction: 'c1000004-0000-4000-8000-000000000004',
  evaluation: 'c1000005-0000-4000-8000-000000000005',
  outcomeFeedback: 'c1000006-0000-4000-8000-000000000006',
  datasetExample: 'c1000007-0000-4000-8000-000000000007',
  trainingEligibility: 'c1000008-0000-4000-8000-000000000008',
  erasureRequest: 'c1000009-0000-4000-8000-000000000009',
} as const;

export const TARGET_TIMES = {
  occurredAt: '2026-07-11T09:00:00Z',
  emittedAt: '2026-07-11T09:00:05Z',
  createdAt: '2026-07-11T09:00:00Z',
  confirmedAt: '2026-07-11T08:30:00Z',
  expiresAt: '2026-07-11T17:00:00Z',
  decidedAt: '2026-07-11T09:30:00Z',
  recordedAt: '2026-07-11T09:35:00Z',
  startedAt: '2026-07-11T08:59:00Z',
  completedAt: '2026-07-11T09:00:00Z',
  scheduledAt: '2026-07-11T12:00:00Z',
} as const;

/** Opaque QuickFurno Core references. Core owns what any of these actually are. */
const CLIENT = { entityType: 'client', entityId: 'CORE-CLIENT-00311' } as const;
const LEAD = { entityType: 'lead', entityId: 'CORE-LEAD-00042' } as const;
const LINKED_LEAD = { entityType: 'lead', entityId: 'CORE-LEAD-00043' } as const;
const VENDOR_SUBJECT = { entityType: 'vendor', entityId: 'CORE-VENDOR-00088' } as const;
const CATEGORY_WARDROBE = { entityType: 'category', entityId: 'CORE-CAT-WARDROBE' } as const;
const CATEGORY_KITCHEN = { entityType: 'category', entityId: 'CORE-CAT-KITCHEN' } as const;
const APPROVER = { entityType: 'user', entityId: 'CORE-USER-00007' } as const;
const CITY = { entityType: 'city', entityId: 'CORE-CITY-PUNE' } as const;

/** Three distinct vendors for the initial batch, and three more for the replacement. */
const VENDOR_A = { entityType: 'vendor', entityId: 'CORE-VENDOR-00001' } as const;
const VENDOR_B = { entityType: 'vendor', entityId: 'CORE-VENDOR-00002' } as const;
const VENDOR_C = { entityType: 'vendor', entityId: 'CORE-VENDOR-00003' } as const;
const VENDOR_D = { entityType: 'vendor', entityId: 'CORE-VENDOR-00004' } as const;
const VENDOR_E = { entityType: 'vendor', entityId: 'CORE-VENDOR-00005' } as const;
const VENDOR_F = { entityType: 'vendor', entityId: 'CORE-VENDOR-00006' } as const;

export const INITIAL_VENDORS = [VENDOR_A, VENDOR_B, VENDOR_C];
export const REPLACEMENT_VENDORS = [VENDOR_D, VENDOR_E, VENDOR_F];

const HUMAN_ACTOR = { actorType: 'human', actor: APPROVER } as const;
const POLICY = { policyId: 'qf.governance', policyVersion: 3 } as const;

/** A SHA-256-shaped fingerprint. Obviously synthetic, and structurally valid. */
const ACTION_FINGERPRINT = 'a'.repeat(64);

const EVIDENCE: EvidenceItem[] = [
  {
    evidenceType: 'canonical-event',
    eventId: TARGET_IDS.sourceEvent,
    eventType: 'qf.client.dissatisfaction-recorded',
    description: 'The client recorded dissatisfaction with the current vendor batch.',
  },
];

/**
 * The client actually said yes. An artifact, not a boolean.
 *
 * Versioned like every other contract — it is the evidence that gates a reassignment, so
 * it is the last thing that should be unversioned.
 */
export const validClientConfirmation: ClientConfirmationV1 = {
  confirmationId: TARGET_IDS.clientConfirmation,
  contractVersion: 1,
  confirmedBy: CLIENT,
  confirmedAt: TARGET_TIMES.confirmedAt,
  confirmationChannelCode: 'whatsapp-reply',
  evidenceEventId: TARGET_IDS.confirmationEvent,
  statementCode: 'client-requested-replacement-vendors',
};

/** The same confirmation, for a cross-category request. */
export const validClientConfirmationAdditionalCategory: ClientConfirmationV1 = {
  ...validClientConfirmation,
  confirmationId: 'b3000001-0000-4000-8000-000000000001',
  statementCode: 'client-confirmed-additional-category',
};

// ---------------------------------------------------------------------------
// Learning provenance — standalone, because Core validates these before they are
// embedded in an agent-run record, and a contract that can only be checked once it
// is already inside something else cannot be checked where it is created.
// ---------------------------------------------------------------------------

export const validModelReference: ModelReferenceV1 = {
  contractVersion: 1,
  provider: 'anthropic',
  modelId: 'claude-opus',
  modelVersion: '4-8',
  invocationConfigurationVersion: 2,
};

/** The other initial provider. Both are named; neither is integrated. */
export const validModelReferenceOpenAi: ModelReferenceV1 = {
  contractVersion: 1,
  provider: 'openai',
  modelId: 'gpt',
  modelVersion: '5',
  invocationConfigurationVersion: 1,
};

/** Minimal: no digest. */
export const validPromptConfigurationReference: PromptConfigurationReferenceV1 = {
  contractVersion: 1,
  promptId: 'kabir.fraud-synthesis',
  promptVersion: 5,
  configurationId: 'kabir.default',
  configurationVersion: 3,
};

/** Complete: with the integrity digest that proves *which* prompt ran, without holding it. */
export const validPromptConfigurationReferenceWithDigest: PromptConfigurationReferenceV1 = {
  ...validPromptConfigurationReference,
  promptDigest: 'b'.repeat(64),
};

// ---------------------------------------------------------------------------
// Requests: Jarvis asking
// ---------------------------------------------------------------------------

export const validApprovalRequest: ApprovalRequestV1 = {
  approvalRequestId: TARGET_IDS.approvalRequest,
  contractVersion: 1,
  recommendationId: TARGET_IDS.recommendation,
  proposedActionId: TARGET_IDS.action,
  actionFingerprint: ACTION_FINGERPRINT,
  requestedAuthority: 'authorized-team-human',
  risk: 'client-or-vendor-facing-communication',
  createdAt: TARGET_TIMES.createdAt,
  expiresAt: TARGET_TIMES.expiresAt,
  producingSystem: 'qf-jarvis',
  requestingAgent: 'riya',
  requestingAgentVersion: 'riya.1-0-0',
  summary: 'Ask the client whether the current vendors met their requirement.',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

/** Money escalates. This one asks for the founder, as it must. */
export const validApprovalRequestMoneyRelated: ApprovalRequestV1 = {
  ...validApprovalRequest,
  approvalRequestId: 'a2000001-0000-4000-8000-000000000001',
  requestedAuthority: 'founder',
  risk: 'money-related',
  requestingAgent: 'anisha',
  requestingAgentVersion: 'anisha.1-0-0',
  summary: 'Propose a recharge conversation with a vendor whose package is nearly exhausted.',
};

export const validCommunicationRequest: CommunicationRequestV1 = {
  communicationRequestId: TARGET_IDS.communicationRequest,
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  producingSystem: 'qf-jarvis',
  requestingAgent: 'riya',
  requestingAgentVersion: 'riya.1-0-0',
  recipient: CLIENT,
  purposeCode: 'requirement-follow-up',
  proposedChannel: 'whatsapp',
  content: {
    contentType: 'template',
    templateId: 'client.follow-up',
    templateVersion: 2,
    variables: { categoryLabel: 'wardrobe' },
  },
  requestedTiming: { timingType: 'scheduled', requestedAt: TARGET_TIMES.scheduledAt },
  createdAt: TARGET_TIMES.createdAt,
  expiresAt: TARGET_TIMES.expiresAt,
  priority: 'medium',
  requiredApproval: 'authorized-team-human',
  policy: POLICY,
  summary: 'Follow up with the client about their wardrobe requirement.',
  correlationId: TARGET_IDS.correlation,
};

/** Voice needs a script and explicit human approval on every call. */
export const validCommunicationRequestVoice: CommunicationRequestV1 = {
  ...validCommunicationRequest,
  communicationRequestId: 'a2000002-0000-4000-8000-000000000002',
  proposedChannel: 'voice',
  requiredApproval: 'founder',
  content: {
    contentType: 'script',
    templateId: 'client.callback',
    templateVersion: 1,
  },
  requestedTiming: { timingType: 'immediate' },
  summary: 'Call the client back, as they requested.',
};

// ---------------------------------------------------------------------------
// Communication authority and results
// ---------------------------------------------------------------------------

export const validCommunicationAuthorization: CommunicationAuthorizationV1 = {
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  communicationRequestId: TARGET_IDS.communicationRequest,
  issuer: 'quickfurno-core',
  outcome: 'authorized',
  authorizedChannel: 'whatsapp',
  approvalDecisionId: TARGET_IDS.decision,
  decidedAt: TARGET_TIMES.decidedAt,
  reasonCode: 'eligible',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

/** The refusal that must never be silently retried. */
export const validCommunicationAuthorizationOptedOut: CommunicationAuthorizationV1 = {
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  communicationRequestId: TARGET_IDS.communicationRequest,
  issuer: 'quickfurno-core',
  outcome: 'rejected',
  decidedAt: TARGET_TIMES.decidedAt,
  reasonCode: 'recipient-opted-out',
  explanation: 'The recipient has opted out of this purpose.',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

export const validCommunicationResultDelivered: CommunicationResultV1 = {
  communicationResultId: TARGET_IDS.communicationResult,
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  executionIntentId: TARGET_IDS.executionIntent,
  executionResultId: TARGET_IDS.executionResult,
  issuer: 'quickfurno-core',
  lifecycleState: 'delivered',
  outcome: 'succeeded',
  recordedAt: TARGET_TIMES.recordedAt,
  providerEvidence: { providerReference: 'wamid.SYNTHETIC-0001' },
  reasonCode: 'delivered',
  correlationId: TARGET_IDS.correlation,
};

/** Provider accepted is not delivered — so the outcome is deliberately not "succeeded". */
export const validCommunicationResultProviderAccepted: CommunicationResultV1 = {
  communicationResultId: 'a2000003-0000-4000-8000-000000000003',
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  executionIntentId: TARGET_IDS.executionIntent,
  executionResultId: TARGET_IDS.executionResult,
  issuer: 'quickfurno-core',
  lifecycleState: 'provider-accepted',
  outcome: 'failed',
  recordedAt: TARGET_TIMES.recordedAt,
  failure: {
    failureCode: 'provider-accepted-then-dropped',
    failureCategory: 'provider',
    retryClassification: 'not-retryable',
  },
  reasonCode: 'provider-accepted-not-delivered',
  correlationId: TARGET_IDS.correlation,
};

/** We do not know. Requires reconciliation, and is never a success. */
export const validCommunicationResultIndeterminate: CommunicationResultV1 = {
  communicationResultId: 'a2000004-0000-4000-8000-000000000004',
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  executionIntentId: TARGET_IDS.executionIntent,
  executionResultId: TARGET_IDS.executionResult,
  issuer: 'quickfurno-core',
  lifecycleState: 'failed',
  outcome: 'indeterminate',
  recordedAt: TARGET_TIMES.recordedAt,
  failure: {
    failureCode: 'provider-timeout',
    failureCategory: 'ambiguous',
    retryClassification: 'requires-reconciliation',
  },
  reasonCode: 'outcome-unknown',
  correlationId: TARGET_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Assignment, reassignment, linked leads
// ---------------------------------------------------------------------------

export const validInitialBatch: AssignmentBatchV1 = {
  assignmentBatchId: TARGET_IDS.initialBatch,
  contractVersion: 1,
  lead: LEAD,
  category: CATEGORY_WARDROBE,
  client: CLIENT,
  batchNumber: 1,
  vendors: INITIAL_VENDORS,
  issuer: 'quickfurno-core',
  createdAt: TARGET_TIMES.createdAt,
  reasonCode: 'initial-assignment',
  correlationId: TARGET_IDS.correlation,
};

/** Three further vendors, none of whom appeared in the first batch. Six unique, total. */
export const validReplacementBatch: AssignmentBatchV1 = {
  assignmentBatchId: TARGET_IDS.replacementBatch,
  contractVersion: 1,
  lead: LEAD,
  category: CATEGORY_WARDROBE,
  client: CLIENT,
  batchNumber: 2,
  vendors: REPLACEMENT_VENDORS,
  issuer: 'quickfurno-core',
  createdAt: TARGET_TIMES.decidedAt,
  clientConfirmationId: TARGET_IDS.clientConfirmation,
  reassignmentDecisionId: TARGET_IDS.reassignmentDecision,
  previousBatchId: TARGET_IDS.initialBatch,
  previousBatchVendors: INITIAL_VENDORS,
  reasonCode: 'client-requested-replacement',
  correlationId: TARGET_IDS.correlation,
};

export const validReassignmentRequest: ClientReassignmentRequestV1 = {
  reassignmentRequestId: TARGET_IDS.reassignmentRequest,
  contractVersion: 1,
  lead: LEAD,
  category: CATEGORY_WARDROBE,
  client: CLIENT,
  currentBatchId: TARGET_IDS.initialBatch,
  producingSystem: 'qf-jarvis',
  requestingAgent: 'riya',
  requestingAgentVersion: 'riya.1-0-0',
  dissatisfaction: {
    reasonCode: 'vendors-unresponsive',
    severity: 'moderate',
    evidence: EVIDENCE,
  },
  clientConfirmation: validClientConfirmation,
  summary: 'The client asked for different vendors after none of the three responded.',
  policy: POLICY,
  createdAt: TARGET_TIMES.createdAt,
  expiresAt: TARGET_TIMES.expiresAt,
  correlationId: TARGET_IDS.correlation,
};

export const validReassignmentDecisionAuthorized: ClientReassignmentDecisionV1 = {
  reassignmentDecisionId: TARGET_IDS.reassignmentDecision,
  contractVersion: 1,
  reassignmentRequestId: TARGET_IDS.reassignmentRequest,
  issuer: 'quickfurno-core',
  decidedBy: HUMAN_ACTOR,
  decidedAt: TARGET_TIMES.decidedAt,
  outcome: 'authorized',
  authorizedBatchId: TARGET_IDS.replacementBatch,
  reasonCode: 'dissatisfaction-confirmed',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

export const validReassignmentDecisionRejected: ClientReassignmentDecisionV1 = {
  reassignmentDecisionId: 'b2000001-0000-4000-8000-000000000001',
  contractVersion: 1,
  reassignmentRequestId: TARGET_IDS.reassignmentRequest,
  issuer: 'quickfurno-core',
  decidedBy: HUMAN_ACTOR,
  decidedAt: TARGET_TIMES.decidedAt,
  outcome: 'rejected',
  reasonCode: 'lifetime-vendor-limit-reached',
  explanation: 'This lead-category has already reached its replacement batch.',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

export const validAdditionalServiceRequest: AdditionalServiceRequestV1 = {
  additionalServiceRequestId: TARGET_IDS.additionalServiceRequest,
  contractVersion: 1,
  client: CLIENT,
  originatingLead: LEAD,
  originatingCategory: CATEGORY_WARDROBE,
  proposedCategory: CATEGORY_KITCHEN,
  producingSystem: 'qf-jarvis',
  identifyingAgent: 'riya',
  identifyingAgentVersion: 'riya.1-0-0',
  evidence: EVIDENCE,
  clientConfirmation: {
    ...validClientConfirmation,
    statementCode: 'client-confirmed-additional-category',
  },
  summary: 'The client also asked about a kitchen, which is a different category.',
  reasonCode: 'additional-category-requested',
  policy: POLICY,
  createdAt: TARGET_TIMES.createdAt,
  expiresAt: TARGET_TIMES.expiresAt,
  correlationId: TARGET_IDS.correlation,
};

export const validLinkedLeadCreated: LinkedLeadCreatedV1 = {
  linkedLeadId: TARGET_IDS.linkedLead,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  client: CLIENT,
  newLead: LINKED_LEAD,
  newCategory: CATEGORY_KITCHEN,
  originatingLead: LEAD,
  originatingCategory: CATEGORY_WARDROBE,
  additionalServiceRequestId: TARGET_IDS.additionalServiceRequest,
  clientConfirmation: {
    ...validClientConfirmation,
    statementCode: 'client-confirmed-additional-category',
  },
  independence: {
    independentConsent: true,
    independentVerification: true,
    independentScoring: true,
    independentMatching: true,
  },
  createdAt: TARGET_TIMES.createdAt,
  reasonCode: 'cross-category-requirement',
  correlationId: TARGET_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Learning and evaluation
// ---------------------------------------------------------------------------

/** A run with no model at all — deterministic rules concluded it. The best kind of run. */
export const validAgentRunDeterministic: AgentRunRecordV1 = {
  agentRunId: TARGET_IDS.agentRun,
  contractVersion: 1,
  agent: 'kabir',
  agentVersion: 'kabir.1-0-0',
  startedAt: TARGET_TIMES.startedAt,
  completedAt: TARGET_TIMES.completedAt,
  outcome: 'completed',
  inputEventIds: [TARGET_IDS.sourceEvent],
  producedRecommendationIds: [TARGET_IDS.recommendation],
  deterministicRulesEvaluated: 12,
  policy: POLICY,
  reasonCode: 'rules-concluded',
  correlationId: TARGET_IDS.correlation,
};

/** A run that consulted a model — and therefore must record its prompt provenance. */
export const validAgentRunWithModel: AgentRunRecordV1 = {
  agentRunId: 'c2000001-0000-4000-8000-000000000001',
  contractVersion: 1,
  agent: 'kabir',
  agentVersion: 'kabir.1-0-0',
  startedAt: TARGET_TIMES.startedAt,
  completedAt: TARGET_TIMES.completedAt,
  outcome: 'completed',
  inputEventIds: [TARGET_IDS.sourceEvent],
  producedRecommendationIds: [TARGET_IDS.recommendation],
  deterministicRulesEvaluated: 8,
  model: {
    contractVersion: 1,
    provider: 'anthropic',
    modelId: 'claude-opus',
    modelVersion: '4-8',
    invocationConfigurationVersion: 2,
  },
  promptConfiguration: {
    contractVersion: 1,
    promptId: 'kabir.fraud-synthesis',
    promptVersion: 5,
    configurationId: 'kabir.default',
    configurationVersion: 3,
    promptDigest: 'b'.repeat(64),
  },
  policy: POLICY,
  reasonCode: 'judgment-required',
  correlationId: TARGET_IDS.correlation,
};

export const validHumanCorrection: HumanCorrectionV1 = {
  correctionId: TARGET_IDS.correction,
  contractVersion: 1,
  recommendationId: TARGET_IDS.recommendation,
  correctedBy: HUMAN_ACTOR,
  correctedAt: TARGET_TIMES.recordedAt,
  correctionType: 'judgment-wrong',
  reasonCode: 'budget-was-plausible',
  correctedSummary: 'The stated budget is normal for this category in this city.',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

export const validRecommendationEvaluation: RecommendationEvaluationV1 = {
  evaluationId: TARGET_IDS.evaluation,
  contractVersion: 1,
  recommendationId: TARGET_IDS.recommendation,
  evaluatedAgent: 'kabir',
  evaluatedAgentVersion: 'kabir.1-0-0',
  evaluator: HUMAN_ACTOR,
  evaluatedAt: TARGET_TIMES.recordedAt,
  acceptanceOutcome: 'accepted',
  qualityBand: 'good',
  statedConfidence: 0.82,
  confidenceWasJustified: true,
  reasonCode: 'evidence-held-up',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

/** The metric moved as predicted, and the evidence points at where. */
export const validOutcomeFeedbackPositive: OutcomeFeedbackV1 = {
  outcomeFeedbackId: TARGET_IDS.outcomeFeedback,
  contractVersion: 1,
  recommendationId: TARGET_IDS.recommendation,
  observedAt: TARGET_TIMES.recordedAt,
  outcomeClass: 'positive',
  outcomeMetricCode: 'cost-per-verified-lead',
  movedInExpectedDirection: true,
  evidence: EVIDENCE,
  reasonCode: 'metric-improved',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

/** We genuinely do not know — and saying so is a valid, and often correct, answer. */
export const validOutcomeFeedbackUnknown: OutcomeFeedbackV1 = {
  outcomeFeedbackId: 'c2000002-0000-4000-8000-000000000002',
  contractVersion: 1,
  recommendationId: TARGET_IDS.recommendation,
  observedAt: TARGET_TIMES.recordedAt,
  outcomeClass: 'unknown',
  outcomeMetricCode: 'client-conversion',
  evidence: [],
  reasonCode: 'confounded-by-campaign-change',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

export const validDatasetExampleProvenance: DatasetExampleProvenanceV1 = {
  datasetExampleId: TARGET_IDS.datasetExample,
  contractVersion: 1,
  sourceReferences: [
    { sourceKind: 'canonical-event', eventId: TARGET_IDS.sourceEvent },
    { sourceKind: 'human-correction', correctionId: TARGET_IDS.correction },
  ],
  correctionReferences: [TARGET_IDS.correction],
  evaluationReferences: [TARGET_IDS.evaluation],
  dataClassification: 'internal',
  minimisationStatus: 'anonymised',
  erasureState: 'none',
  purposeLimitation: 'lead-quality-evaluation',
  policy: POLICY,
  createdAt: TARGET_TIMES.createdAt,
  correlationId: TARGET_IDS.correlation,
};

/** A human said yes, and every precondition holds. */
export const validTrainingEligibilityApproved: TrainingEligibilityDecisionV1 = {
  trainingEligibilityDecisionId: TARGET_IDS.trainingEligibility,
  contractVersion: 1,
  datasetExampleId: TARGET_IDS.datasetExample,
  eligible: true,
  decidedBy: HUMAN_ACTOR,
  decidedAt: TARGET_TIMES.decidedAt,
  dataClassification: 'internal',
  minimisationStatus: 'anonymised',
  provenanceComplete: true,
  purposeLimitation: 'lead-quality-evaluation',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

/** A refusal, with a countable reason. */
export const validTrainingEligibilityRefused: TrainingEligibilityDecisionV1 = {
  trainingEligibilityDecisionId: 'c2000003-0000-4000-8000-000000000003',
  contractVersion: 1,
  datasetExampleId: TARGET_IDS.datasetExample,
  eligible: false,
  decidedBy: HUMAN_ACTOR,
  decidedAt: TARGET_TIMES.decidedAt,
  dataClassification: 'personal',
  minimisationStatus: 'not-minimised',
  provenanceComplete: false,
  purposeLimitation: 'lead-quality-evaluation',
  rejectionReasonCode: 'not-minimised',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** Riya remembering a client. Derived, rebuildable, and never authoritative. */
export const validAgentMemoryRiya: AgentMemoryRecordV1 = {
  memoryRecordId: TARGET_IDS.memoryRecord,
  contractVersion: 1,
  ownerAgent: 'riya',
  subjectReferences: [CLIENT],
  sourceEventIds: [TARGET_IDS.sourceEvent],
  derivedSummary: 'This client prefers WhatsApp and replies in the evening.',
  createdAt: TARGET_TIMES.createdAt,
  updatedAt: TARGET_TIMES.recordedAt,
  expiresAt: TARGET_TIMES.expiresAt,
  policy: POLICY,
  dataClassification: 'personal',
  rebuildable: true,
  authoritative: false,
  erasureState: 'none',
  reasonCode: 'relationship-context',
  correlationId: TARGET_IDS.correlation,
};

/** Jitin remembering a city — aggregate only. No client, no vendor. */
export const validAgentMemoryJitin: AgentMemoryRecordV1 = {
  memoryRecordId: 'c2000004-0000-4000-8000-000000000004',
  contractVersion: 1,
  ownerAgent: 'jitin',
  subjectReferences: [CITY, CATEGORY_WARDROBE],
  sourceEventIds: [TARGET_IDS.sourceEvent],
  derivedSummary: 'Wardrobe demand in this city peaks after the monsoon.',
  createdAt: TARGET_TIMES.createdAt,
  updatedAt: TARGET_TIMES.recordedAt,
  policy: POLICY,
  dataClassification: 'internal',
  rebuildable: true,
  authoritative: false,
  erasureState: 'none',
  reasonCode: 'demand-seasonality',
  correlationId: TARGET_IDS.correlation,
};

/** The shape a deletion request takes: forget everything you know about this client. */
export const validMemoryInvalidationBySubject: MemoryInvalidationRequestV1 = {
  memoryInvalidationRequestId: TARGET_IDS.memoryInvalidation,
  contractVersion: 1,
  scope: 'subject',
  ownerAgent: 'riya',
  subjectReference: CLIENT,
  erasureRequestId: TARGET_IDS.erasureRequest,
  requestedBy: HUMAN_ACTOR,
  requestedAt: TARGET_TIMES.recordedAt,
  reasonCode: 'erasure-requested',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Privacy and policy
// ---------------------------------------------------------------------------

export const validErasureRequest: ErasureRequestV1 = {
  erasureRequestId: TARGET_IDS.erasureRequest,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  subject: CLIENT,
  erasureType: 'deletion',
  requestedBy: HUMAN_ACTOR,
  requestedAt: TARGET_TIMES.createdAt,
  scopes: ['derived-read-models', 'identity-references', 'recommendation-evidence', 'agent-memory'],
  reasonCode: 'client-exercised-erasure-right',
  policy: POLICY,
  correlationId: TARGET_IDS.correlation,
};

/** Completed, with nothing left behind. */
export const validErasureRecordCompleted: ErasureRecordV1 = {
  erasureRequestId: TARGET_IDS.erasureRequest,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  subject: CLIENT,
  erasureType: 'deletion',
  outcome: 'completed',
  scopesCompleted: [
    'derived-read-models',
    'identity-references',
    'recommendation-evidence',
    'agent-memory',
  ],
  scopesOutstanding: [],
  recordedAt: TARGET_TIMES.recordedAt,
  reasonCode: 'erasure-complete',
  correlationId: TARGET_IDS.correlation,
};

/** Honest about what it did not reach. This is why `partial` exists. */
export const validErasureRecordPartial: ErasureRecordV1 = {
  erasureRequestId: TARGET_IDS.erasureRequest,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  subject: CLIENT,
  erasureType: 'anonymisation',
  outcome: 'partial',
  scopesCompleted: ['derived-read-models'],
  scopesOutstanding: ['agent-memory', 'dataset-examples'],
  recordedAt: TARGET_TIMES.recordedAt,
  reasonCode: 'erasure-in-progress',
  correlationId: TARGET_IDS.correlation,
};

export const validPolicyVersionChange: PolicyVersionChangeV1 = {
  contractVersion: 1,
  issuer: 'quickfurno-core',
  policyId: 'qf.governance',
  previousVersion: 2,
  newVersion: 3,
  changedBy: HUMAN_ACTOR,
  changedAt: TARGET_TIMES.createdAt,
  effectiveFrom: TARGET_TIMES.decidedAt,
  reasonCode: 'approval-thresholds-tightened',
  summary: 'Money-related recommendations now require founder approval without exception.',
  correlationId: TARGET_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Human handoff
// ---------------------------------------------------------------------------

export const validHumanHandoffRequest: HumanHandoffRequestV1 = {
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  producingSystem: 'qf-jarvis',
  requestingAgent: 'riya',
  requestingAgentVersion: 'riya.1-0-0',
  requestedAt: TARGET_TIMES.recordedAt,
  reasonCode: 'client-asked-something-unscripted',
  priority: 'high',
  summary: 'The client asked a question the template does not cover.',
  correlationId: TARGET_IDS.correlation,
};

export const validHumanHandoffRecord: HumanHandoffRecordV1 = {
  contractVersion: 1,
  communicationId: TARGET_IDS.communication,
  issuer: 'quickfurno-core',
  handledBy: HUMAN_ACTOR,
  recordedAt: TARGET_TIMES.recordedAt,
  outcome: 'accepted',
  reasonCode: 'human-took-over',
  correlationId: TARGET_IDS.correlation,
};

// ---------------------------------------------------------------------------
// The contract fixture table
// ---------------------------------------------------------------------------

export const TARGET_VALID_FIXTURES: readonly ValidFixture[] = [
  {
    name: 'approval request: team human',
    contract: 'ApprovalRequestV1',
    value: validApprovalRequest,
  },
  {
    name: 'approval request: money-related escalates to founder',
    contract: 'ApprovalRequestV1',
    value: validApprovalRequestMoneyRelated,
  },
  {
    name: 'communication request: whatsapp template, scheduled',
    contract: 'CommunicationRequestV1',
    value: validCommunicationRequest,
  },
  {
    name: 'communication request: voice, script, founder approval',
    contract: 'CommunicationRequestV1',
    value: validCommunicationRequestVoice,
  },
  {
    name: 'communication authorization: authorized',
    contract: 'CommunicationAuthorizationV1',
    value: validCommunicationAuthorization,
  },
  {
    name: 'communication authorization: rejected, recipient opted out',
    contract: 'CommunicationAuthorizationV1',
    value: validCommunicationAuthorizationOptedOut,
  },
  {
    name: 'communication result: delivered',
    contract: 'CommunicationResultV1',
    value: validCommunicationResultDelivered,
  },
  {
    name: 'communication result: provider-accepted is not delivered',
    contract: 'CommunicationResultV1',
    value: validCommunicationResultProviderAccepted,
  },
  {
    name: 'communication result: indeterminate requires reconciliation',
    contract: 'CommunicationResultV1',
    value: validCommunicationResultIndeterminate,
  },
  {
    name: 'client confirmation: replacement vendors requested',
    contract: 'ClientConfirmationV1',
    value: validClientConfirmation,
  },
  {
    name: 'client confirmation: additional category confirmed',
    contract: 'ClientConfirmationV1',
    value: validClientConfirmationAdditionalCategory,
  },
  {
    name: 'model reference: anthropic',
    contract: 'ModelReferenceV1',
    value: validModelReference,
  },
  {
    name: 'model reference: openai',
    contract: 'ModelReferenceV1',
    value: validModelReferenceOpenAi,
  },
  {
    name: 'prompt configuration: minimal, no digest',
    contract: 'PromptConfigurationReferenceV1',
    value: validPromptConfigurationReference,
  },
  {
    name: 'prompt configuration: with integrity digest',
    contract: 'PromptConfigurationReferenceV1',
    value: validPromptConfigurationReferenceWithDigest,
  },
  {
    name: 'assignment batch: initial, three vendors',
    contract: 'AssignmentBatchV1',
    value: validInitialBatch,
  },
  {
    name: 'assignment batch: replacement, three further vendors, six unique in total',
    contract: 'AssignmentBatchV1',
    value: validReplacementBatch,
  },
  {
    name: 'reassignment request: confirmed by the client',
    contract: 'ClientReassignmentRequestV1',
    value: validReassignmentRequest,
  },
  {
    name: 'reassignment decision: authorized',
    contract: 'ClientReassignmentDecisionV1',
    value: validReassignmentDecisionAuthorized,
  },
  {
    name: 'reassignment decision: rejected',
    contract: 'ClientReassignmentDecisionV1',
    value: validReassignmentDecisionRejected,
  },
  {
    name: 'additional service: a different category',
    contract: 'AdditionalServiceRequestV1',
    value: validAdditionalServiceRequest,
  },
  {
    name: 'linked lead: its own identity, its own everything',
    contract: 'LinkedLeadCreatedV1',
    value: validLinkedLeadCreated,
  },
  {
    name: 'agent run: deterministic rules, no model',
    contract: 'AgentRunRecordV1',
    value: validAgentRunDeterministic,
  },
  {
    name: 'agent run: model invoked, prompt provenance recorded',
    contract: 'AgentRunRecordV1',
    value: validAgentRunWithModel,
  },
  {
    name: 'human correction: judgment wrong',
    contract: 'HumanCorrectionV1',
    value: validHumanCorrection,
  },
  {
    name: 'recommendation evaluation: accepted',
    contract: 'RecommendationEvaluationV1',
    value: validRecommendationEvaluation,
  },
  {
    name: 'outcome feedback: positive, moved as predicted',
    contract: 'OutcomeFeedbackV1',
    value: validOutcomeFeedbackPositive,
  },
  {
    name: 'outcome feedback: unknown, and honest about it',
    contract: 'OutcomeFeedbackV1',
    value: validOutcomeFeedbackUnknown,
  },
  {
    name: 'dataset provenance: sourced and corrected',
    contract: 'DatasetExampleProvenanceV1',
    value: validDatasetExampleProvenance,
  },
  {
    name: 'training eligibility: approved by a human, all preconditions met',
    contract: 'TrainingEligibilityDecisionV1',
    value: validTrainingEligibilityApproved,
  },
  {
    name: 'training eligibility: refused, with a reason',
    contract: 'TrainingEligibilityDecisionV1',
    value: validTrainingEligibilityRefused,
  },
  {
    name: 'agent memory: Riya, a client, derived and non-authoritative',
    contract: 'AgentMemoryRecordV1',
    value: validAgentMemoryRiya,
  },
  {
    name: 'agent memory: Jitin, aggregate only',
    contract: 'AgentMemoryRecordV1',
    value: validAgentMemoryJitin,
  },
  {
    name: 'memory invalidation: forget this subject (an erasure)',
    contract: 'MemoryInvalidationRequestV1',
    value: validMemoryInvalidationBySubject,
  },
  { name: 'erasure request: deletion', contract: 'ErasureRequestV1', value: validErasureRequest },
  {
    name: 'erasure record: completed, nothing outstanding',
    contract: 'ErasureRecordV1',
    value: validErasureRecordCompleted,
  },
  {
    name: 'erasure record: partial, and honest about what remains',
    contract: 'ErasureRecordV1',
    value: validErasureRecordPartial,
  },
  {
    name: 'policy version change: forward only',
    contract: 'PolicyVersionChangeV1',
    value: validPolicyVersionChange,
  },
  {
    name: 'human handoff request: asking for a person',
    contract: 'HumanHandoffRequestV1',
    value: validHumanHandoffRequest,
  },
  {
    name: 'human handoff record: a person took it',
    contract: 'HumanHandoffRecordV1',
    value: validHumanHandoffRecord,
  },
];

// ---------------------------------------------------------------------------
// Target event fixtures — one per registered type, as the coverage test requires
// ---------------------------------------------------------------------------

/** The envelope every target event fixture shares. Core is always the source. */
const ENVELOPE = {
  eventVersion: 1,
  occurredAt: TARGET_TIMES.occurredAt,
  emittedAt: TARGET_TIMES.emittedAt,
  source: 'quickfurno-core',
  correlationId: TARGET_IDS.correlation,
} as const;

/** Distinct, obviously synthetic event ids. One per target event. */
const E = (n: number): string => `e0000${String(n).padStart(3, '0')}-0000-4000-8000-000000000001`;

export const validClientRequirementCompletedEvent: ClientRequirementCompletedEventV1 = {
  ...ENVELOPE,
  eventId: E(1),
  eventType: 'qf.client.requirement-completed',
  subject: CLIENT,
  payload: { reasonCode: 'requirement-complete', lead: LEAD, category: CATEGORY_WARDROBE },
};

export const validClientFollowUpDueDetectedEvent: ClientFollowUpDueDetectedEventV1 = {
  ...ENVELOPE,
  eventId: E(2),
  eventType: 'qf.client.follow-up-due-detected',
  subject: CLIENT,
  payload: {
    reasonCode: 'no-contact-in-window',
    lead: LEAD,
    category: CATEGORY_WARDROBE,
    dueAt: TARGET_TIMES.occurredAt,
  },
};

export const validClientFollowUpCompletedEvent: ClientFollowUpCompletedEventV1 = {
  ...ENVELOPE,
  eventId: E(3),
  eventType: 'qf.client.follow-up-completed',
  subject: CLIENT,
  payload: {
    reasonCode: 'follow-up-done',
    lead: LEAD,
    category: CATEGORY_WARDROBE,
    channel: 'whatsapp',
  },
};

export const validClientSatisfactionRecordedEvent: ClientSatisfactionRecordedEventV1 = {
  ...ENVELOPE,
  eventId: E(4),
  eventType: 'qf.client.satisfaction-recorded',
  subject: CLIENT,
  payload: { reasonCode: 'client-satisfied', lead: LEAD, category: CATEGORY_WARDROBE },
};

export const validClientDissatisfactionRecordedEvent: ClientDissatisfactionRecordedEventV1 = {
  ...ENVELOPE,
  eventId: E(5),
  eventType: 'qf.client.dissatisfaction-recorded',
  subject: CLIENT,
  payload: {
    reasonCode: 'vendors-unresponsive',
    lead: LEAD,
    category: CATEGORY_WARDROBE,
    severity: 'moderate',
  },
};

export const validClientComplaintRecordedEvent: ClientComplaintRecordedEventV1 = {
  ...ENVELOPE,
  eventId: E(6),
  eventType: 'qf.client.complaint-recorded',
  subject: CLIENT,
  payload: { reasonCode: 'service-complaint', severity: 'high' },
};

export const validClientReassignmentRequestedEvent: ClientReassignmentRequestedEventV1 = {
  ...ENVELOPE,
  eventId: E(7),
  eventType: 'qf.client.reassignment-requested',
  subject: CLIENT,
  payload: { request: validReassignmentRequest },
};

export const validClientReassignmentAuthorizedEvent: ClientReassignmentAuthorizedEventV1 = {
  ...ENVELOPE,
  eventId: E(8),
  eventType: 'qf.client.reassignment-authorized',
  subject: CLIENT,
  payload: { decision: validReassignmentDecisionAuthorized },
};

export const validClientReassignmentRejectedEvent: ClientReassignmentRejectedEventV1 = {
  ...ENVELOPE,
  eventId: E(9),
  eventType: 'qf.client.reassignment-rejected',
  subject: CLIENT,
  payload: { decision: validReassignmentDecisionRejected },
};

export const validAssignmentBatchCreatedEvent: AssignmentBatchCreatedEventV1 = {
  ...ENVELOPE,
  eventId: E(10),
  eventType: 'qf.assignment.batch-created',
  subject: LEAD,
  payload: { batch: validInitialBatch },
};

export const validAssignmentBatchCompletedEvent: AssignmentBatchCompletedEventV1 = {
  ...ENVELOPE,
  eventId: E(11),
  eventType: 'qf.assignment.batch-completed',
  subject: LEAD,
  payload: {
    reasonCode: 'batch-window-closed',
    lead: LEAD,
    category: CATEGORY_WARDROBE,
    assignmentBatchId: TARGET_IDS.initialBatch,
    batchNumber: 1,
  },
};

export const validClientAdditionalServiceIdentifiedEvent: ClientAdditionalServiceIdentifiedEventV1 =
  {
    ...ENVELOPE,
    eventId: E(12),
    eventType: 'qf.client.additional-service-identified',
    subject: CLIENT,
    payload: { request: validAdditionalServiceRequest },
  };

export const validClientAdditionalServiceConfirmedEvent: ClientAdditionalServiceConfirmedEventV1 = {
  ...ENVELOPE,
  eventId: E(13),
  eventType: 'qf.client.additional-service-confirmed',
  subject: CLIENT,
  payload: {
    reasonCode: 'client-confirmed',
    additionalServiceRequestId: TARGET_IDS.additionalServiceRequest,
    clientConfirmation: validClientConfirmation,
    proposedCategory: CATEGORY_KITCHEN,
  },
};

export const validClientAdditionalServiceRejectedEvent: ClientAdditionalServiceRejectedEventV1 = {
  ...ENVELOPE,
  eventId: E(14),
  eventType: 'qf.client.additional-service-rejected',
  subject: CLIENT,
  payload: {
    reasonCode: 'client-declined',
    additionalServiceRequestId: TARGET_IDS.additionalServiceRequest,
    proposedCategory: CATEGORY_KITCHEN,
  },
};

export const validLeadLinkedCreatedEvent: LeadLinkedCreatedEventV1 = {
  ...ENVELOPE,
  eventId: E(15),
  eventType: 'qf.lead.linked-created',
  subject: LINKED_LEAD,
  payload: { link: validLinkedLeadCreated },
};

export const validClientReviewRequestedEvent: ClientReviewRequestedEventV1 = {
  ...ENVELOPE,
  eventId: E(16),
  eventType: 'qf.client.review-requested',
  subject: CLIENT,
  payload: { reasonCode: 'job-complete', lead: LEAD, category: CATEGORY_WARDROBE },
};

export const validClientLifecycleClosedEvent: ClientLifecycleClosedEventV1 = {
  ...ENVELOPE,
  eventId: E(17),
  eventType: 'qf.client.lifecycle-closed',
  subject: CLIENT,
  payload: {
    reasonCode: 'converted',
    lead: LEAD,
    category: CATEGORY_WARDROBE,
    outcome: 'converted',
  },
};

export const validVendorRegistrationStartedEvent: VendorRegistrationStartedEventV1 = {
  ...ENVELOPE,
  eventId: E(18),
  eventType: 'qf.vendor.registration-started',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'registration-begun', registrationChannelCode: 'web' },
};

export const validVendorProfileCompletedEvent: VendorProfileCompletedEventV1 = {
  ...ENVELOPE,
  eventId: E(19),
  eventType: 'qf.vendor.profile-completed',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'profile-complete', completeness: 1 },
};

export const validVendorVerificationRequestedEvent: VendorVerificationRequestedEventV1 = {
  ...ENVELOPE,
  eventId: E(20),
  eventType: 'qf.vendor.verification-requested',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'verification-requested' },
};

export const validVendorActivatedEvent: VendorActivatedEventV1 = {
  ...ENVELOPE,
  eventId: E(21),
  eventType: 'qf.vendor.activated',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'vendor-activated' },
};

export const validVendorInactivityDetectedEvent: VendorInactivityDetectedEventV1 = {
  ...ENVELOPE,
  eventId: E(22),
  eventType: 'qf.vendor.inactivity-detected',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'no-activity', inactiveSinceAt: TARGET_TIMES.createdAt },
};

export const validVendorPerformanceUpdatedEvent: VendorPerformanceUpdatedEventV1 = {
  ...ENVELOPE,
  eventId: E(23),
  eventType: 'qf.vendor.performance-updated',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'performance-recomputed', performanceBand: 'medium' },
};

export const validVendorPackageReadinessChangedEvent: VendorPackageReadinessChangedEventV1 = {
  ...ENVELOPE,
  eventId: E(24),
  eventType: 'qf.vendor.package-readiness-changed',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'readiness-changed', readinessBand: 'low' },
};

export const validVendorRechargeOpportunityDetectedEvent: VendorRechargeOpportunityDetectedEventV1 =
  {
    ...ENVELOPE,
    eventId: E(25),
    eventType: 'qf.vendor.recharge-opportunity-detected',
    subject: VENDOR_SUBJECT,
    payload: { reasonCode: 'package-nearly-exhausted', opportunityBand: 'high' },
  };

export const validVendorComplaintRecordedEvent: VendorComplaintRecordedEventV1 = {
  ...ENVELOPE,
  eventId: E(26),
  eventType: 'qf.vendor.complaint-recorded',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'client-complaint', severity: 'medium' },
};

export const validVendorRetentionRiskDetectedEvent: VendorRetentionRiskDetectedEventV1 = {
  ...ENVELOPE,
  eventId: E(27),
  eventType: 'qf.vendor.retention-risk-detected',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'engagement-falling', riskBand: 'high' },
};

export const validVendorWinbackCandidateDetectedEvent: VendorWinbackCandidateDetectedEventV1 = {
  ...ENVELOPE,
  eventId: E(28),
  eventType: 'qf.vendor.winback-candidate-detected',
  subject: VENDOR_SUBJECT,
  payload: { reasonCode: 'previously-strong-vendor', candidacyBand: 'medium' },
};

export const validPrivacyErasureRequestedEvent: PrivacyErasureRequestedEventV1 = {
  ...ENVELOPE,
  eventId: E(29),
  eventType: 'qf.privacy.erasure-requested',
  subject: CLIENT,
  payload: { request: validErasureRequest },
};

export const validPrivacyErasureRecordedEvent: PrivacyErasureRecordedEventV1 = {
  ...ENVELOPE,
  eventId: E(30),
  eventType: 'qf.privacy.erasure-recorded',
  subject: CLIENT,
  payload: { record: validErasureRecordCompleted },
};

export const validPolicyVersionChangedEvent: PolicyVersionChangedEventV1 = {
  ...ENVELOPE,
  eventId: E(31),
  eventType: 'qf.policy.version-changed',
  subject: { entityType: 'policy', entityId: 'qf.governance' },
  payload: { change: validPolicyVersionChange },
};

export const validCommunicationAuthorizationRecordedEvent: CommunicationAuthorizationRecordedEventV1 =
  {
    ...ENVELOPE,
    eventId: E(32),
    eventType: 'qf.communication.authorization-recorded',
    subject: CLIENT,
    payload: { authorization: validCommunicationAuthorizationOptedOut },
  };

export const validCommunicationResultRecordedEvent: CommunicationResultRecordedEventV1 = {
  ...ENVELOPE,
  eventId: E(33),
  eventType: 'qf.communication.result-recorded',
  subject: CLIENT,
  payload: { result: validCommunicationResultDelivered },
};

export const validCommunicationHumanHandoffRequestedEvent: CommunicationHumanHandoffRequestedEventV1 =
  {
    ...ENVELOPE,
    eventId: E(34),
    eventType: 'qf.communication.human-handoff-requested',
    subject: CLIENT,
    payload: { request: validHumanHandoffRequest },
  };

export const validCommunicationHumanHandoffRecordedEvent: CommunicationHumanHandoffRecordedEventV1 =
  {
    ...ENVELOPE,
    eventId: E(35),
    eventType: 'qf.communication.human-handoff-recorded',
    subject: CLIENT,
    payload: { record: validHumanHandoffRecord },
  };

/** Every target event, for the registry-coverage test. */
export const TARGET_VALID_EVENT_FIXTURES: readonly CanonicalEvent[] = [
  validClientRequirementCompletedEvent,
  validClientFollowUpDueDetectedEvent,
  validClientFollowUpCompletedEvent,
  validClientSatisfactionRecordedEvent,
  validClientDissatisfactionRecordedEvent,
  validClientComplaintRecordedEvent,
  validClientReassignmentRequestedEvent,
  validClientReassignmentAuthorizedEvent,
  validClientReassignmentRejectedEvent,
  validAssignmentBatchCreatedEvent,
  validAssignmentBatchCompletedEvent,
  validClientAdditionalServiceIdentifiedEvent,
  validClientAdditionalServiceConfirmedEvent,
  validClientAdditionalServiceRejectedEvent,
  validLeadLinkedCreatedEvent,
  validClientReviewRequestedEvent,
  validClientLifecycleClosedEvent,
  validVendorRegistrationStartedEvent,
  validVendorProfileCompletedEvent,
  validVendorVerificationRequestedEvent,
  validVendorActivatedEvent,
  validVendorInactivityDetectedEvent,
  validVendorPerformanceUpdatedEvent,
  validVendorPackageReadinessChangedEvent,
  validVendorRechargeOpportunityDetectedEvent,
  validVendorComplaintRecordedEvent,
  validVendorRetentionRiskDetectedEvent,
  validVendorWinbackCandidateDetectedEvent,
  validPrivacyErasureRequestedEvent,
  validPrivacyErasureRecordedEvent,
  validPolicyVersionChangedEvent,
  validCommunicationAuthorizationRecordedEvent,
  validCommunicationResultRecordedEvent,
  validCommunicationHumanHandoffRequestedEvent,
  validCommunicationHumanHandoffRecordedEvent,
];

/** Re-exported for the invalid-fixture builders, which mutate copies of these. */
export type { ContractName };
