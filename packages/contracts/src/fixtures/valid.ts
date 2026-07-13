/**
 * Valid fixtures — one representative payload per contract, and per interesting shape.
 *
 * **No real data appears here, and none ever may.** Every identifier is a fixed,
 * obviously-synthetic UUID; every subject is an opaque reference to an entity that
 * does not exist; there is not a phone number, an email address, a name, an
 * address, a token, or a provider credential anywhere in this file, and the
 * schemas would refuse most of them anyway.
 *
 * Fixtures are `const` and are never mutated. Tests that need to modify one
 * `structuredClone` it first — see `cloneFixture` below — so that a test which
 * corrupts a fixture cannot poison the test that runs after it.
 *
 * These are also the fixtures the *event registry* is checked against: every
 * registered `type@version` must have one, so a contract cannot be registered and
 * left unexercised.
 */

import { TARGET_VALID_EVENT_FIXTURES, TARGET_VALID_FIXTURES } from './target-valid.js';

import type { ApprovalDecisionV1 } from '../approvals/approval-decision.js';
import type { CanonicalEvent } from '../events/event-catalog.js';
import type { CommunicationStateRecordV1 } from '../communications/communication-state-record.js';
import type { ExecutionIntentV1 } from '../execution/execution-intent.js';
import type { ExecutionResultV1 } from '../execution/execution-result.js';
import type { RecommendationLifecycleRecordV1 } from '../recommendations/recommendation-lifecycle.js';
import type { RecommendationV1 } from '../recommendations/recommendation.js';

/** Deep-copy a fixture, so a test can mutate its copy and not the shared original. */
export function cloneFixture<T>(fixture: T): T {
  return structuredClone(fixture);
}

/** Fixed, synthetic identifiers. Stable across runs, so tests are deterministic. */
export const FIXTURE_IDS = {
  event: '4f6b1e2a-0c3d-4e5f-8a9b-1c2d3e4f5a6b',
  causationEvent: '5a7c2f3b-1d4e-4f60-9bac-2d3e4f5a6b7c',
  recommendation: '6b8d3a4c-2e5f-4071-8cbd-3e4f5a6b7c8d',
  decision: '7c9e4b5d-3f60-4182-9dce-4f5a6b7c8d9e',
  intent: '8daf5c6e-4071-4293-8edf-5a6b7c8d9eaf',
  result: '9eb06d7f-5182-43a4-9fe0-6b7c8d9eafb0',
  communication: 'af217e80-6293-44b5-8af1-7c8d9eafb0c1',
  correlation: 'b0328f91-73a4-45c6-9b02-8d9eafb0c1d2',
  actionA: 'c1439002-84b5-46d7-8c13-9eafb0c1d2e3',
  actionB: 'd254a113-95c6-47e8-9d24-afb0c1d2e3f4',
} as const;

export const FIXTURE_TIMES = {
  occurredAt: '2026-07-11T09:00:00Z',
  emittedAt: '2026-07-11T09:00:05Z',
  createdAt: '2026-07-11T09:00:00Z',
  expiresAt: '2026-07-11T17:00:00Z',
  decidedAt: '2026-07-11T09:30:00Z',
  validUntil: '2026-07-11T15:30:00Z',
  issuedAt: '2026-07-11T09:31:00Z',
  intentExpiresAt: '2026-07-11T11:31:00Z',
  recordedAt: '2026-07-11T09:35:00Z',
} as const;

/** An opaque QuickFurno Core reference. Core owns what a "lead" actually is. */
const LEAD_SUBJECT = { entityType: 'lead', entityId: 'CORE-LEAD-00042' };
const CLIENT_SUBJECT = { entityType: 'client', entityId: 'CORE-CLIENT-00311' };
const VENDOR_SUBJECT = { entityType: 'vendor', entityId: 'CORE-VENDOR-00088' };
const APPROVER = { entityType: 'user', entityId: 'CORE-USER-00007' };

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

/**
 * The minimal valid recommendation: informational.
 *
 * It proposes nothing and requires no approval, because nothing executes. This is
 * the "attention item with no proposed action" from the approved approval matrix —
 * most recommendations close this way, with a human reading them and acting in the
 * real world.
 */
export const validInformationalRecommendation: RecommendationV1 = {
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  recommendationType: 'lead.quality-trend',
  createdAt: FIXTURE_TIMES.createdAt,
  expiresAt: FIXTURE_TIMES.expiresAt,
  producingSystem: 'qf-jarvis',
  producingAgent: 'kabir',
  producingAgentVersion: 'kabir.3',
  subject: LEAD_SUBJECT,
  priority: 'medium',
  confidence: 0.72,
  risk: 'informational',
  requiredApproval: 'none',
  summary: 'Verified lead rate for carpentry in Pune fell sharply this week.',
  rationale:
    'Verified lead rate fell from 0.61 to 0.38 across seven days while volume held steady, which points at intake quality rather than demand.',
  evidence: [
    {
      evidenceType: 'derived-signal',
      signalCode: 'lead.verified-rate-drop',
      description: 'Verified lead rate fell from 0.61 to 0.38 over seven days.',
    },
  ],
  proposedActions: [],
  composite: false,
  correlationId: FIXTURE_IDS.correlation,
};

/**
 * A complete, actionable recommendation from a single specialist.
 *
 * Note what it does *not* carry: no recipient phone number, no message transport,
 * no approval flag. Riya proposes content, timing, and channel — and nothing else.
 */
export const validActionableRecommendation: RecommendationV1 = {
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  recommendationType: 'client.follow-up',
  createdAt: FIXTURE_TIMES.createdAt,
  expiresAt: FIXTURE_TIMES.expiresAt,
  producingSystem: 'qf-jarvis',
  producingAgent: 'riya',
  producingAgentVersion: 'riya.2',
  subject: CLIENT_SUBJECT,
  priority: 'high',
  confidence: 0.81,
  risk: 'client-or-vendor-facing-communication',
  requiredApproval: 'authorized-team-human',
  summary: 'Follow up with a client who has gone quiet on a high-value requirement.',
  rationale:
    'The requirement was submitted four days ago, contacted once, and has been silent since. The category has a long consideration cycle, so silence is not yet disinterest.',
  evidence: [
    {
      evidenceType: 'canonical-event',
      eventId: FIXTURE_IDS.causationEvent,
      eventType: 'qf.recommendation.created',
      description: 'The requirement was submitted and recorded by QuickFurno Core.',
    },
    {
      evidenceType: 'derived-signal',
      signalCode: 'client.silent-since-first-contact',
      description: 'No inbound activity for four days after a single outbound contact.',
      value: { daysSilent: 4, contactAttempts: 1 },
    },
  ],
  proposedActions: [
    {
      actionId: FIXTURE_IDS.actionA,
      actionType: 'communication.send-whatsapp',
      actionContractVersion: 1,
      summary: 'Send an approved follow-up template about the outstanding requirement.',
      parameters: { templateId: 'client-followup-v2', channel: 'whatsapp' },
    },
  ],
  composite: false,
  correlationId: FIXTURE_IDS.correlation,
};

/**
 * A composite recommendation — the coordination layer's actual job.
 *
 * Three specialists concluded three things; Jarvis connected them into one founder
 * attention item. **Every contributor stays attributable**, because a composite
 * with no attributable contributors is a Jarvis conclusion in disguise.
 *
 * It is money-related, so it escalates: `founder`, never a delegated approver.
 */
export const validCompositeRecommendation: RecommendationV1 = {
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  recommendationType: 'cross-domain.campaign-quality-erosion',
  createdAt: FIXTURE_TIMES.createdAt,
  expiresAt: FIXTURE_TIMES.expiresAt,
  producingSystem: 'qf-jarvis',
  producingAgent: 'jarvis',
  producingAgentVersion: 'jarvis.1',
  subject: VENDOR_SUBJECT,
  priority: 'critical',
  confidence: 0.88,
  risk: 'money-related',
  requiredApproval: 'founder',
  summary: 'One campaign is producing implausible leads that vendors are paying for.',
  rationale:
    'Kabir finds the leads implausible, Jitin traces them to a single campaign whose cost per verified lead is climbing, and Anisha sees the vendors who paid for them lapsing. These are one situation, not three.',
  evidence: [
    {
      evidenceType: 'derived-signal',
      signalCode: 'lead.implausible-cluster',
      description: 'A cluster of leads shares an implausible budget and category pairing.',
    },
    {
      evidenceType: 'derived-signal',
      signalCode: 'campaign.cost-per-verified-lead-rising',
      description: 'Cost per verified lead rose sharply for one city-category pair.',
    },
    {
      evidenceType: 'derived-signal',
      signalCode: 'vendor.package-lapse-risk',
      description: 'Vendors who received the cluster are letting packages lapse.',
    },
  ],
  proposedActions: [
    {
      actionId: FIXTURE_IDS.actionA,
      actionType: 'campaign.shift-budget',
      actionContractVersion: 1,
      summary: 'Shift budget away from the campaign producing implausible leads.',
      parameters: { campaignRef: 'CORE-CAMPAIGN-00021', direction: 'decrease' },
    },
    {
      actionId: FIXTURE_IDS.actionB,
      actionType: 'vendor.open-retention-conversation',
      actionContractVersion: 1,
      summary: 'Open a retention conversation with the affected vendors.',
      parameters: { cohortRef: 'CORE-COHORT-00004' },
    },
  ],
  composite: true,
  contributingAgents: ['kabir', 'jitin', 'anisha'],
  correlationId: FIXTURE_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Recommendation lifecycle
// ---------------------------------------------------------------------------

/** A state Jarvis owns and may record itself. No Core reference needed. */
export const validLifecycleRecordRecommended: RecommendationLifecycleRecordV1 = {
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  state: 'recommended',
  recordedAt: FIXTURE_TIMES.recordedAt,
  reasonCode: 'agent.analysis-complete',
  correlationId: FIXTURE_IDS.correlation,
};

/** A state only Core can produce — so it must carry Core's decision. */
export const validLifecycleRecordApproved: RecommendationLifecycleRecordV1 = {
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  state: 'approved',
  recordedAt: FIXTURE_TIMES.recordedAt,
  approvalDecisionId: FIXTURE_IDS.decision,
  reasonCode: 'core.decision-recorded',
  explanation: 'QuickFurno Core validated authority, state, risk policy, and expiry, and approved.',
  correlationId: FIXTURE_IDS.correlation,
};

/** Expired is not approved. Nothing happened, and the record says so. */
export const validLifecycleRecordExpired: RecommendationLifecycleRecordV1 = {
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  state: 'expired',
  recordedAt: FIXTURE_TIMES.recordedAt,
  reasonCode: 'recommendation.expired-before-decision',
  correlationId: FIXTURE_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Approval decisions
// ---------------------------------------------------------------------------

/** A named human approved one action. Core recorded it. */
export const validApprovalDecisionByHuman: ApprovalDecisionV1 = {
  decisionId: FIXTURE_IDS.decision,
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  decidedBy: { actorType: 'human', actor: APPROVER },
  decidedAt: FIXTURE_TIMES.decidedAt,
  outcome: 'approved',
  actionDecisions: [{ actionId: FIXTURE_IDS.actionA, decision: 'approved' }],
  reasonCode: 'approver.within-delegated-limit',
  validUntil: FIXTURE_TIMES.validUntil,
  correlationId: FIXTURE_IDS.correlation,
};

/**
 * Partial approval, expressed explicitly.
 *
 * One action approved, one rejected. The rejected action is not executable, and no
 * execution intent may ever reference it.
 */
export const validApprovalDecisionPartial: ApprovalDecisionV1 = {
  decisionId: FIXTURE_IDS.decision,
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  decidedBy: { actorType: 'human', actor: APPROVER },
  decidedAt: FIXTURE_TIMES.decidedAt,
  outcome: 'approved',
  actionDecisions: [
    { actionId: FIXTURE_IDS.actionA, decision: 'approved' },
    { actionId: FIXTURE_IDS.actionB, decision: 'rejected' },
  ],
  reasonCode: 'approver.partial-approval',
  explanation: 'The follow-up is approved; the budget shift is not.',
  correlationId: FIXTURE_IDS.correlation,
};

/**
 * A policy authorized it — and is attributable exactly as a human would be.
 * Which policy, which version.
 */
export const validApprovalDecisionByPolicy: ApprovalDecisionV1 = {
  decisionId: FIXTURE_IDS.decision,
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  decidedBy: { actorType: 'policy', policyId: 'low-risk-internal-flag', policyVersion: 3 },
  decidedAt: FIXTURE_TIMES.decidedAt,
  outcome: 'approved',
  actionDecisions: [{ actionId: FIXTURE_IDS.actionA, decision: 'approved' }],
  reasonCode: 'policy.matched-low-risk-class',
  correlationId: FIXTURE_IDS.correlation,
};

/** Core refused. Nothing is sent, and the reason is recorded. */
export const validApprovalDecisionRejected: ApprovalDecisionV1 = {
  decisionId: FIXTURE_IDS.decision,
  recommendationId: FIXTURE_IDS.recommendation,
  contractVersion: 1,
  issuer: 'quickfurno-core',
  decidedBy: { actorType: 'human', actor: APPROVER },
  decidedAt: FIXTURE_TIMES.decidedAt,
  outcome: 'rejected',
  actionDecisions: [{ actionId: FIXTURE_IDS.actionA, decision: 'rejected' }],
  reasonCode: 'recipient-opted-out',
  explanation: 'The recipient has opted out of this communication purpose.',
  correlationId: FIXTURE_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Issued by Core. Executed by n8n. At most once. Jarvis cannot build this object. */
export const validExecutionIntent: ExecutionIntentV1 = {
  executionIntentId: FIXTURE_IDS.intent,
  contractVersion: 1,
  recommendationId: FIXTURE_IDS.recommendation,
  approvalDecisionId: FIXTURE_IDS.decision,
  approvedActionId: FIXTURE_IDS.actionA,
  actionType: 'communication.send-whatsapp',
  actionContractVersion: 1,
  parameters: { templateId: 'client-followup-v2', channel: 'whatsapp' },
  issuer: 'quickfurno-core',
  executor: 'n8n',
  issuedAt: FIXTURE_TIMES.issuedAt,
  expiresAt: FIXTURE_TIMES.intentExpiresAt,
  idempotencyKey: 'idem-8daf5c6e-4071-4293',
  deliverySemantics: 'at-most-once',
  correlationId: FIXTURE_IDS.correlation,
};

/** It worked, and Core recorded that it worked. */
export const validExecutionResultSucceeded: ExecutionResultV1 = {
  executionResultId: FIXTURE_IDS.result,
  executionIntentId: FIXTURE_IDS.intent,
  contractVersion: 1,
  reportingSystem: 'n8n',
  recordedByCoreAt: FIXTURE_TIMES.recordedAt,
  providerOccurredAt: FIXTURE_TIMES.issuedAt,
  outcome: 'succeeded',
  providerReference: 'wamid.ABCD1234',
  correlationId: FIXTURE_IDS.correlation,
};

/** It failed, and the failure is machine-readable so it can be counted. */
export const validExecutionResultFailed: ExecutionResultV1 = {
  executionResultId: FIXTURE_IDS.result,
  executionIntentId: FIXTURE_IDS.intent,
  contractVersion: 1,
  reportingSystem: 'qf-communications-runtime',
  recordedByCoreAt: FIXTURE_TIMES.recordedAt,
  outcome: 'failed',
  failure: {
    failureCode: 'provider.rejected-template',
    failureCategory: 'permanent',
    retryClassification: 'not-retryable',
    description: 'The provider rejected the message template.',
  },
  correlationId: FIXTURE_IDS.correlation,
};

/**
 * **We do not know what happened.** The most important fixture in this file.
 *
 * The provider never came back. The call may have connected, or it may not have.
 * This is recorded as `indeterminate` and classified `requires-reconciliation` —
 * it is never a success, and it is never simply retried. Somebody has to go and
 * find out, because the alternative is dialling a real person to see whether their
 * phone rings twice.
 */
export const validExecutionResultIndeterminate: ExecutionResultV1 = {
  executionResultId: FIXTURE_IDS.result,
  executionIntentId: FIXTURE_IDS.intent,
  contractVersion: 1,
  reportingSystem: 'qf-communications-runtime',
  recordedByCoreAt: FIXTURE_TIMES.recordedAt,
  outcome: 'indeterminate',
  failure: {
    failureCode: 'provider.no-terminal-status',
    failureCategory: 'ambiguous',
    retryClassification: 'requires-reconciliation',
    description: 'The provider returned no terminal status before the timeout elapsed.',
  },
  correlationId: FIXTURE_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

/** A draft. Nothing has been asked of anyone, and nothing has been sent. */
export const validCommunicationDraft: CommunicationStateRecordV1 = {
  communicationId: FIXTURE_IDS.communication,
  contractVersion: 1,
  channel: 'whatsapp',
  state: 'draft',
  recordedAt: FIXTURE_TIMES.recordedAt,
  recipient: CLIENT_SUBJECT,
  purposeCode: 'client.requirement-follow-up',
  reasonCode: 'agent.draft-prepared',
  correlationId: FIXTURE_IDS.correlation,
};

/**
 * An opt-out, represented as Core refusing — not as a nineteenth state.
 *
 * The refusal is a decision Core recorded, so it carries the decision id, and the
 * reason is a stable machine code an auditor can count.
 */
export const validCommunicationRejectedOptOut: CommunicationStateRecordV1 = {
  communicationId: FIXTURE_IDS.communication,
  contractVersion: 1,
  channel: 'voice',
  state: 'rejected',
  recordedAt: FIXTURE_TIMES.recordedAt,
  recipient: VENDOR_SUBJECT,
  purposeCode: 'vendor.retention-conversation',
  previousState: 'authorization-requested',
  approvalDecisionId: FIXTURE_IDS.decision,
  reasonCode: 'recipient-opted-out',
  explanation: 'QuickFurno Core refused: the recipient is on do-not-contact.',
  correlationId: FIXTURE_IDS.correlation,
};

/** Delivered — and it may only say so because Core recorded an execution result. */
export const validCommunicationDelivered: CommunicationStateRecordV1 = {
  communicationId: FIXTURE_IDS.communication,
  contractVersion: 1,
  channel: 'whatsapp',
  state: 'delivered',
  recordedAt: FIXTURE_TIMES.recordedAt,
  recipient: CLIENT_SUBJECT,
  purposeCode: 'client.requirement-follow-up',
  previousState: 'provider-accepted',
  executionResultId: FIXTURE_IDS.result,
  reasonCode: 'provider.delivery-confirmed',
  correlationId: FIXTURE_IDS.correlation,
};

// ---------------------------------------------------------------------------
// Canonical events — one per registered type@version
// ---------------------------------------------------------------------------

const envelope = {
  eventId: FIXTURE_IDS.event,
  occurredAt: FIXTURE_TIMES.occurredAt,
  emittedAt: FIXTURE_TIMES.emittedAt,
  source: 'quickfurno-core',
  correlationId: FIXTURE_IDS.correlation,
} as const;

export const validRecommendationCreatedEvent: CanonicalEvent = {
  ...envelope,
  eventType: 'qf.recommendation.created',
  eventVersion: 2,
  subject: CLIENT_SUBJECT,
  payload: { recommendation: validActionableRecommendation },
};

export const validRecommendationLifecycleEvent: CanonicalEvent = {
  ...envelope,
  eventType: 'qf.recommendation.lifecycle-state-recorded',
  eventVersion: 2,
  subject: CLIENT_SUBJECT,
  causationEventId: FIXTURE_IDS.causationEvent,
  payload: { record: validLifecycleRecordApproved },
};

export const validApprovalDecisionEvent: CanonicalEvent = {
  ...envelope,
  eventType: 'qf.approval.decision-recorded',
  eventVersion: 2,
  subject: CLIENT_SUBJECT,
  payload: { decision: validApprovalDecisionByHuman },
};

export const validExecutionIntentEvent: CanonicalEvent = {
  ...envelope,
  eventType: 'qf.execution.intent-issued',
  eventVersion: 2,
  subject: CLIENT_SUBJECT,
  payload: { intent: validExecutionIntent },
};

export const validExecutionResultEvent: CanonicalEvent = {
  ...envelope,
  eventType: 'qf.execution.result-recorded',
  eventVersion: 2,
  subject: CLIENT_SUBJECT,
  payload: { result: validExecutionResultIndeterminate },
};

export const validCommunicationStateEvent: CanonicalEvent = {
  ...envelope,
  eventType: 'qf.communication.state-recorded',
  eventVersion: 2,
  subject: VENDOR_SUBJECT,
  payload: { record: validCommunicationRejectedOptOut },
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** Which parser a fixture belongs to. */
export type ContractName =
  // Phase 2, as originally implemented
  | 'RecommendationV1'
  | 'RecommendationLifecycleRecordV1'
  | 'ApprovalDecisionV1'
  | 'ExecutionIntentV1'
  | 'ExecutionResultV1'
  | 'CommunicationStateRecordV1'
  | 'CanonicalEvent'
  // Requests: Jarvis asking, never deciding
  | 'ApprovalRequestV1'
  | 'CommunicationRequestV1'
  | 'CommunicationResultV1'
  | 'CommunicationAuthorizationV1'
  | 'HumanHandoffRequestV1'
  | 'HumanHandoffRecordV1'
  // Assignment, reassignment, linked leads
  | 'ClientConfirmationV1'
  | 'AssignmentBatchV1'
  | 'ClientReassignmentRequestV1'
  | 'ClientReassignmentDecisionV1'
  | 'AdditionalServiceRequestV1'
  | 'LinkedLeadCreatedV1'
  // Learning, evaluation, memory
  | 'ModelReferenceV1'
  | 'PromptConfigurationReferenceV1'
  | 'AgentRunRecordV1'
  | 'AgentMemoryRecordV1'
  | 'MemoryInvalidationRequestV1'
  | 'HumanCorrectionV1'
  | 'RecommendationEvaluationV1'
  | 'OutcomeFeedbackV1'
  | 'DatasetExampleProvenanceV1'
  | 'TrainingEligibilityDecisionV1'
  // Privacy and policy
  | 'ErasureRequestV1'
  | 'ErasureRecordV1'
  | 'PolicyVersionChangeV1';

export interface ValidFixture {
  readonly name: string;
  readonly contract: ContractName;
  readonly value: unknown;
}

/** Every valid fixture, for table-driven tests. */
export const VALID_FIXTURES: readonly ValidFixture[] = [
  {
    name: 'recommendation: informational, no actions',
    contract: 'RecommendationV1',
    value: validInformationalRecommendation,
  },
  {
    name: 'recommendation: actionable, single specialist',
    contract: 'RecommendationV1',
    value: validActionableRecommendation,
  },
  {
    name: 'recommendation: composite with attributed contributors',
    contract: 'RecommendationV1',
    value: validCompositeRecommendation,
  },
  {
    name: 'lifecycle: recommended',
    contract: 'RecommendationLifecycleRecordV1',
    value: validLifecycleRecordRecommended,
  },
  {
    name: 'lifecycle: approved, with Core decision',
    contract: 'RecommendationLifecycleRecordV1',
    value: validLifecycleRecordApproved,
  },
  {
    name: 'lifecycle: expired',
    contract: 'RecommendationLifecycleRecordV1',
    value: validLifecycleRecordExpired,
  },
  {
    name: 'approval: approved by a human',
    contract: 'ApprovalDecisionV1',
    value: validApprovalDecisionByHuman,
  },
  {
    name: 'approval: partial approval',
    contract: 'ApprovalDecisionV1',
    value: validApprovalDecisionPartial,
  },
  {
    name: 'approval: approved by a versioned policy',
    contract: 'ApprovalDecisionV1',
    value: validApprovalDecisionByPolicy,
  },
  {
    name: 'approval: rejected',
    contract: 'ApprovalDecisionV1',
    value: validApprovalDecisionRejected,
  },
  {
    name: 'execution intent: Core-issued, n8n-executed, at-most-once',
    contract: 'ExecutionIntentV1',
    value: validExecutionIntent,
  },
  {
    name: 'execution result: succeeded',
    contract: 'ExecutionResultV1',
    value: validExecutionResultSucceeded,
  },
  {
    name: 'execution result: failed',
    contract: 'ExecutionResultV1',
    value: validExecutionResultFailed,
  },
  {
    name: 'execution result: indeterminate, requires reconciliation',
    contract: 'ExecutionResultV1',
    value: validExecutionResultIndeterminate,
  },
  {
    name: 'communication: draft',
    contract: 'CommunicationStateRecordV1',
    value: validCommunicationDraft,
  },
  {
    name: 'communication: rejected for opt-out',
    contract: 'CommunicationStateRecordV1',
    value: validCommunicationRejectedOptOut,
  },
  {
    name: 'communication: delivered, with Core-recorded result',
    contract: 'CommunicationStateRecordV1',
    value: validCommunicationDelivered,
  },
  {
    name: 'event: qf.recommendation.created v1',
    contract: 'CanonicalEvent',
    value: validRecommendationCreatedEvent,
  },
  {
    name: 'event: qf.recommendation.lifecycle-state-recorded v1',
    contract: 'CanonicalEvent',
    value: validRecommendationLifecycleEvent,
  },
  {
    name: 'event: qf.approval.decision-recorded v1',
    contract: 'CanonicalEvent',
    value: validApprovalDecisionEvent,
  },
  {
    name: 'event: qf.execution.intent-issued v1',
    contract: 'CanonicalEvent',
    value: validExecutionIntentEvent,
  },
  {
    name: 'event: qf.execution.result-recorded v1',
    contract: 'CanonicalEvent',
    value: validExecutionResultEvent,
  },
  {
    name: 'event: qf.communication.state-recorded v1',
    contract: 'CanonicalEvent',
    value: validCommunicationStateEvent,
  },

  // The revised contracts, and the target event catalogue. Held in target-valid.ts
  // for size; identical rules apply, and no real data appears there either.
  ...TARGET_VALID_FIXTURES,
  ...TARGET_VALID_EVENT_FIXTURES.map((event) => ({
    name: `event: ${event.eventType} v${String(event.eventVersion)}`,
    contract: 'CanonicalEvent' as const,
    value: event,
  })),
];

/** Every registered event fixture, keyed by `type@version`, for registry coverage. */
export const VALID_EVENT_FIXTURES: readonly CanonicalEvent[] = [
  validRecommendationCreatedEvent,
  validRecommendationLifecycleEvent,
  validApprovalDecisionEvent,
  validExecutionIntentEvent,
  validExecutionResultEvent,
  validCommunicationStateEvent,
  ...TARGET_VALID_EVENT_FIXTURES,
];
