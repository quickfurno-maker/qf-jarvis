/**
 * Invalid fixtures for the revised contracts.
 *
 * **This is the important table.** A valid fixture shows a contract can express a
 * legitimate fact. An invalid one shows it **cannot express an illegitimate one** — and
 * that is the property the architecture actually rests on.
 *
 * Every entry below is a sentence from an approved document that would be *false* if the
 * fixture parsed. Read the `because` field as the consequence of failure:
 *
 * - *Riya assigns vendors* — an agent chose who gets somebody's business.
 * - *A fourth vendor in a batch* — the cap is decoration.
 * - *A seventh vendor across two batches* — the lifetime cap is decoration.
 * - *A replacement with no client confirmation* — three vendors were contacted about a
 *   real person's home because a model inferred they were unhappy.
 * - *A linked lead reusing the parent's identity* — a kitchen lead inherited a wardrobe's
 *   consent and verification.
 * - *An approval request with an outcome* — Jarvis approved itself.
 * - *Memory marked authoritative* — a derived store became a second source of truth.
 * - *Training data with no decision* — client conversations became model training by
 *   default.
 *
 * None of those can be constructed. That is what these fixtures assert.
 */

import type { ContractName } from './valid.js';
import {
  INITIAL_VENDORS,
  REPLACEMENT_VENDORS,
  TARGET_IDS,
  validAdditionalServiceRequest,
  validAgentMemoryRiya,
  validAgentRunWithModel,
  validApprovalRequest,
  validClientConfirmation,
  validCommunicationAuthorization,
  validCommunicationRequest,
  validCommunicationResultDelivered,
  validDatasetExampleProvenance,
  validErasureRecordCompleted,
  validErasureRequest,
  validHumanCorrection,
  validHumanHandoffRecord,
  validHumanHandoffRequest,
  validInitialBatch,
  validLinkedLeadCreated,
  validModelReference,
  validOutcomeFeedbackPositive,
  validPolicyVersionChange,
  validPromptConfigurationReference,
  validReassignmentRequest,
  validRecommendationEvaluation,
  validReplacementBatch,
  validTrainingEligibilityApproved,
} from './target-valid.js';

interface TargetInvalidFixture {
  readonly name: string;
  readonly contract: ContractName;
  readonly value: unknown;
  readonly because: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build a variant of a fixture. Deep-copies first, so the original is never touched — a
 * mutated fixture is a test that passes for the wrong reason.
 */
function variantOf(fixture: object, mutate: (draft: Record<string, unknown>) => void): unknown {
  const draft: unknown = structuredClone(fixture);
  if (!isRecord(draft)) {
    throw new Error('Expected a JSON object fixture');
  }
  mutate(draft);
  return draft;
}

const A_FOURTH_VENDOR = { entityType: 'vendor', entityId: 'CORE-VENDOR-00009' };
const A_SEVENTH_VENDOR = { entityType: 'vendor', entityId: 'CORE-VENDOR-00007' };

export const TARGET_INVALID_FIXTURES: readonly TargetInvalidFixture[] = [
  // -------------------------------------------------------------------------
  // ApprovalRequestV1 — Jarvis asking, and unable to answer
  // -------------------------------------------------------------------------
  {
    name: 'approval request: claims an outcome',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['outcome'] = 'approved';
    }),
    because: 'If this parsed, Jarvis could approve its own recommendation by adding a field.',
  },
  {
    name: 'approval request: names a decider',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['decidedBy'] = { actorType: 'human', actor: { entityType: 'user', entityId: 'U1' } };
    }),
    because: 'A request that names who decided it has decided itself.',
  },
  {
    name: 'approval request: issued by QuickFurno Core',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['producingSystem'] = 'quickfurno-core';
    }),
    because:
      'Only Jarvis asks. Core decides — and a Core-issued request is a decision in disguise.',
  },
  {
    name: 'approval request: no expiry',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      delete draft['expiresAt'];
    }),
    because: 'An approval request that never expires is one that waits forever to be approved.',
  },
  {
    name: 'approval request: expires before it was created',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['expiresAt'] = '2026-07-11T08:00:00Z';
    }),
    because: 'A request that expired before it existed asks for nothing.',
  },
  {
    name: 'approval request: requests no authority',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['requestedAuthority'] = 'none';
    }),
    because: '"No approval needed" is not an approval path — it is a way around one.',
  },
  {
    name: 'approval request: money-related, but asks only a delegated approver',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['risk'] = 'money-related';
      draft['requestedAuthority'] = 'delegated-approver';
    }),
    because:
      'Money escalates. Under-asking is how an approval reaches someone who should not see it.',
  },
  {
    name: 'approval request: outbound voice, but asks only a team human',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['risk'] = 'outbound-voice-call';
      draft['requestedAuthority'] = 'authorized-team-human';
    }),
    because: 'Production outbound voice requires explicit human approval on every call.',
  },
  {
    name: 'approval request: a recipient phone number',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['recipientPhone'] = '+919876543210';
    }),
    because: 'There is no field for contact details, and an unknown key is refused.',
  },
  {
    name: 'approval request: malformed action fingerprint',
    contract: 'ApprovalRequestV1',
    value: variantOf(validApprovalRequest, (draft) => {
      draft['actionFingerprint'] = 'not-a-digest';
    }),
    because: 'An unbound approval is an approval for whatever the action later becomes.',
  },

  // -------------------------------------------------------------------------
  // CommunicationRequestV1 — asks, cannot send, cannot consent
  // -------------------------------------------------------------------------
  {
    name: 'communication request: carries a consent flag',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['hasConsent'] = true;
    }),
    because:
      'A copied consent flag is a stale permission. Core enforces consent, and unknown or stale consent is not permission.',
  },
  {
    name: 'communication request: claims delivery',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['delivered'] = true;
    }),
    because:
      'A request is not a delivery. If this parsed, a founder could be shown a tick for a message never sent.',
  },
  {
    name: 'communication request: a destination phone number',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['recipient'] = { entityType: 'client', entityId: '+919876543210' };
    }),
    because: 'The entity-id charset excludes "+". A recipient is a Core reference, never a number.',
  },
  {
    name: 'communication request: a raw message body',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['body'] = 'Hi, are you still interested?';
    }),
    because: 'Content is a template reference. A free-text body is text nobody approved.',
  },
  {
    name: 'communication request: message body smuggled into template variables',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['content'] = {
        contentType: 'template',
        templateId: 'client.follow-up',
        templateVersion: 2,
        variables: { body: 'Hi, are you still interested?' },
      };
    }),
    because: 'A body smuggled in as a variable is still a body. The governed scan refuses it.',
  },
  {
    name: 'communication request: contact detail in template variables',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['content'] = {
        contentType: 'template',
        templateId: 'client.follow-up',
        templateVersion: 2,
        variables: { phone: '+919876543210' },
      };
    }),
    because: 'Core substitutes contact details from its own records, at execution time.',
  },
  {
    name: 'communication request: requires no approval',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['requiredApproval'] = 'none';
    }),
    because:
      'A communication reaches a real person. There is no such thing as one needing no approval.',
  },
  {
    name: 'communication request: voice without explicit human approval',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['proposedChannel'] = 'voice';
      draft['requiredApproval'] = 'delegated-approver';
      draft['content'] = {
        contentType: 'script',
        templateId: 'client.callback',
        templateVersion: 1,
      };
    }),
    because:
      'Unrestricted autonomous calling remains prohibited. Every production call needs a named human.',
  },
  {
    name: 'communication request: voice reading a message template',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['proposedChannel'] = 'voice';
      draft['requiredApproval'] = 'founder';
    }),
    because: 'A call is spoken from an approved script. The thing said must be the thing reviewed.',
  },
  {
    name: 'communication request: scheduled after it expires',
    contract: 'CommunicationRequestV1',
    value: variantOf(validCommunicationRequest, (draft) => {
      draft['requestedTiming'] = { timingType: 'scheduled', requestedAt: '2026-07-12T09:00:00Z' };
    }),
    because:
      'A message scheduled past its own expiry is a message that is either never sent, or sent unapproved.',
  },

  // -------------------------------------------------------------------------
  // CommunicationResultV1 — Core's truth, and the collapses it refuses
  // -------------------------------------------------------------------------
  {
    name: 'communication result: provider-accepted recorded as succeeded',
    contract: 'CommunicationResultV1',
    value: variantOf(validCommunicationResultDelivered, (draft) => {
      draft['lifecycleState'] = 'provider-accepted';
    }),
    because:
      'Provider accepted is not delivered. If this parsed, a founder would be told a message arrived when only a provider had taken it.',
  },
  {
    name: 'communication result: execution-submitted recorded as succeeded',
    contract: 'CommunicationResultV1',
    value: variantOf(validCommunicationResultDelivered, (draft) => {
      draft['lifecycleState'] = 'execution-submitted';
    }),
    because: 'Dispatching an intent is not delivering a message.',
  },
  {
    name: 'communication result: indeterminate claimed as delivered',
    contract: 'CommunicationResultV1',
    value: variantOf(validCommunicationResultDelivered, (draft) => {
      draft['outcome'] = 'indeterminate';
      draft['failure'] = {
        failureCode: 'timeout',
        failureCategory: 'ambiguous',
        retryClassification: 'requires-reconciliation',
      };
    }),
    because: 'If we do not know, we do not claim it arrived.',
  },
  {
    name: 'communication result: indeterminate marked retryable',
    contract: 'CommunicationResultV1',
    value: variantOf(validCommunicationResultDelivered, (draft) => {
      draft['lifecycleState'] = 'failed';
      draft['outcome'] = 'indeterminate';
      draft['failure'] = {
        failureCode: 'timeout',
        failureCategory: 'ambiguous',
        retryClassification: 'retryable',
      };
    }),
    because:
      'An ambiguous outcome is reconciled, never retried. A retry here dials a real person twice.',
  },
  {
    name: 'communication result: issued by n8n',
    contract: 'CommunicationResultV1',
    value: variantOf(validCommunicationResultDelivered, (draft) => {
      draft['issuer'] = 'n8n';
    }),
    because: 'Reporting is not authority. A result becomes true when Core records it.',
  },
  {
    name: 'communication result: carries a transcript',
    contract: 'CommunicationResultV1',
    value: variantOf(validCommunicationResultDelivered, (draft) => {
      draft['transcript'] = 'Hello, is this a good time?';
    }),
    because: 'No transcripts, no recordings, no raw provider payloads — ever.',
  },

  // -------------------------------------------------------------------------
  // CommunicationAuthorizationV1 — the consent boundary
  // -------------------------------------------------------------------------
  {
    name: 'communication authorization: authorized with no approval decision',
    contract: 'CommunicationAuthorizationV1',
    value: variantOf(validCommunicationAuthorization, (draft) => {
      delete draft['approvalDecisionId'];
    }),
    because: 'Eligibility is not approval. Both are required, and this one names neither.',
  },
  {
    name: 'communication authorization: rejected, yet names an approval it rested on',
    contract: 'CommunicationAuthorizationV1',
    value: variantOf(validCommunicationAuthorization, (draft) => {
      draft['outcome'] = 'rejected';
      delete draft['authorizedChannel'];
    }),
    because:
      'A refusal rests on nothing. Core refused it — whether or not a human had approved it, which is exactly the opt-out case.',
  },
  {
    name: 'communication authorization: issued by Jarvis',
    contract: 'CommunicationAuthorizationV1',
    value: variantOf(validCommunicationAuthorization, (draft) => {
      draft['issuer'] = 'qf-jarvis';
    }),
    because:
      'If this parsed, Jarvis could grant itself permission to contact a client who had opted out.',
  },

  // -------------------------------------------------------------------------
  // AssignmentBatchV1 — every limit in the reassignment policy
  // -------------------------------------------------------------------------
  {
    name: 'assignment batch: created by Riya',
    contract: 'AssignmentBatchV1',
    value: variantOf(validInitialBatch, (draft) => {
      draft['issuer'] = 'qf-jarvis';
    }),
    because:
      'Riya never assigns. If this parsed, an agent could choose who receives somebody’s business.',
  },
  {
    name: 'assignment batch: four vendors in the initial batch',
    contract: 'AssignmentBatchV1',
    value: variantOf(validInitialBatch, (draft) => {
      draft['vendors'] = [...INITIAL_VENDORS, A_FOURTH_VENDOR];
    }),
    because: 'The maximum is three. A fourth means the cap is decoration.',
  },
  {
    name: 'assignment batch: four vendors in the replacement batch',
    contract: 'AssignmentBatchV1',
    value: variantOf(validReplacementBatch, (draft) => {
      draft['vendors'] = [...REPLACEMENT_VENDORS, A_FOURTH_VENDOR];
    }),
    because: 'A replacement batch is capped at three, exactly as the initial one is.',
  },
  {
    name: 'assignment batch: batch number three',
    contract: 'AssignmentBatchV1',
    value: variantOf(validReplacementBatch, (draft) => {
      draft['batchNumber'] = 3;
    }),
    because: 'There is one replacement batch, and there is no third. A third batch has no shape.',
  },
  {
    name: 'assignment batch: batch number zero',
    contract: 'AssignmentBatchV1',
    value: variantOf(validInitialBatch, (draft) => {
      draft['batchNumber'] = 0;
    }),
    because: 'Batches are numbered one and two. Nothing else parses.',
  },
  {
    name: 'assignment batch: the same vendor twice in one batch',
    contract: 'AssignmentBatchV1',
    value: variantOf(validInitialBatch, (draft) => {
      draft['vendors'] = [INITIAL_VENDORS[0], INITIAL_VENDORS[0], INITIAL_VENDORS[1]];
    }),
    because:
      'Three entries and two vendors is a batch pretending to offer more choice than it does.',
  },
  {
    name: 'assignment batch: a vendor appears in both batches',
    contract: 'AssignmentBatchV1',
    value: variantOf(validReplacementBatch, (draft) => {
      draft['vendors'] = [INITIAL_VENDORS[0], REPLACEMENT_VENDORS[0], REPLACEMENT_VENDORS[1]];
    }),
    because:
      'A "replacement" that re-offers a vendor the client just rejected is not a replacement.',
  },
  {
    name: 'assignment batch: seven unique vendors across the lifetime',
    contract: 'AssignmentBatchV1',
    value: variantOf(validReplacementBatch, (draft) => {
      draft['previousBatchVendors'] = [...INITIAL_VENDORS, A_SEVENTH_VENDOR];
    }),
    because:
      'Six unique vendors per lead-category, for all time. A seventh means the lifetime cap is decoration.',
  },
  {
    name: 'assignment batch: replacement with no client confirmation',
    contract: 'AssignmentBatchV1',
    value: variantOf(validReplacementBatch, (draft) => {
      delete draft['clientConfirmationId'];
    }),
    because:
      'The worst outcome this contract prevents: three new vendors contacted about a real person’s home because an agent inferred dissatisfaction.',
  },
  {
    name: 'assignment batch: replacement with no Core authorization',
    contract: 'AssignmentBatchV1',
    value: variantOf(validReplacementBatch, (draft) => {
      delete draft['reassignmentDecisionId'];
    }),
    because: 'A replacement batch exists only because Core authorized a reassignment.',
  },
  {
    name: 'assignment batch: replacement that does not say what it replaces',
    contract: 'AssignmentBatchV1',
    value: variantOf(validReplacementBatch, (draft) => {
      delete draft['previousBatchVendors'];
    }),
    because:
      'Without the previous vendors, the overlap rule and the lifetime cap cannot be checked at all.',
  },
  {
    name: 'assignment batch: an initial batch wearing a replacement’s clothes',
    contract: 'AssignmentBatchV1',
    value: variantOf(validInitialBatch, (draft) => {
      draft['clientConfirmationId'] = TARGET_IDS.clientConfirmation;
      draft['reassignmentDecisionId'] = TARGET_IDS.reassignmentDecision;
    }),
    because:
      'A batch-one record carrying replacement fields defeats the lifetime cap by relabelling.',
  },
  {
    name: 'assignment batch: vendor contact details attached',
    contract: 'AssignmentBatchV1',
    value: variantOf(validInitialBatch, (draft) => {
      draft['vendorPhones'] = ['+919876543210'];
    }),
    because: 'Vendor contact data never appears in a contract. Core resolves it.',
  },

  // -------------------------------------------------------------------------
  // Reassignment — Riya asks, and cannot choose
  // -------------------------------------------------------------------------
  {
    name: 'reassignment request: no client confirmation',
    contract: 'ClientReassignmentRequestV1',
    value: variantOf(validReassignmentRequest, (draft) => {
      delete draft['clientConfirmation'];
    }),
    because: 'Dissatisfaction is never inferred, and silence is never a request.',
  },
  {
    name: 'reassignment request: Riya names the replacement vendors',
    contract: 'ClientReassignmentRequestV1',
    value: variantOf(validReassignmentRequest, (draft) => {
      draft['proposedVendors'] = REPLACEMENT_VENDORS;
    }),
    because: 'There is no field in which Riya could name a vendor. Choosing vendors is Core’s.',
  },
  {
    name: 'reassignment request: confirmed by somebody who is not the client',
    contract: 'ClientReassignmentRequestV1',
    value: variantOf(validReassignmentRequest, (draft) => {
      draft['clientConfirmation'] = {
        ...validClientConfirmation,
        confirmedBy: { entityType: 'client', entityId: 'CORE-CLIENT-99999' },
      };
    }),
    because: 'A confirmation from somebody else is not a confirmation.',
  },
  {
    name: 'reassignment request: no evidence of dissatisfaction',
    contract: 'ClientReassignmentRequestV1',
    value: variantOf(validReassignmentRequest, (draft) => {
      draft['dissatisfaction'] = {
        reasonCode: 'vendors-unresponsive',
        severity: 'moderate',
        evidence: [],
      };
    }),
    because: 'A recommendation without evidence is a defect — and this one moves real vendors.',
  },
  {
    name: 'reassignment decision: authorized, but no batch was created',
    contract: 'ClientReassignmentDecisionV1',
    value: variantOf(
      {
        reassignmentDecisionId: TARGET_IDS.reassignmentDecision,
        contractVersion: 1,
        reassignmentRequestId: TARGET_IDS.reassignmentRequest,
        issuer: 'quickfurno-core',
        decidedBy: {
          actorType: 'human',
          actor: { entityType: 'user', entityId: 'CORE-USER-00007' },
        },
        decidedAt: '2026-07-11T09:30:00Z',
        outcome: 'authorized',
        authorizedBatchId: TARGET_IDS.replacementBatch,
        reasonCode: 'dissatisfaction-confirmed',
        policy: { policyId: 'qf.governance', policyVersion: 3 },
        correlationId: TARGET_IDS.correlation,
      },
      (draft) => {
        delete draft['authorizedBatchId'];
      },
    ),
    because: 'An authorization that produced no batch authorized nothing.',
  },
  {
    name: 'reassignment decision: decided by an agent',
    contract: 'ClientReassignmentDecisionV1',
    value: variantOf(
      {
        reassignmentDecisionId: TARGET_IDS.reassignmentDecision,
        contractVersion: 1,
        reassignmentRequestId: TARGET_IDS.reassignmentRequest,
        issuer: 'quickfurno-core',
        decidedBy: {
          actorType: 'human',
          actor: { entityType: 'user', entityId: 'CORE-USER-00007' },
        },
        decidedAt: '2026-07-11T09:30:00Z',
        outcome: 'authorized',
        authorizedBatchId: TARGET_IDS.replacementBatch,
        reasonCode: 'dissatisfaction-confirmed',
        policy: { policyId: 'qf.governance', policyVersion: 3 },
        correlationId: TARGET_IDS.correlation,
      },
      (draft) => {
        draft['decidedBy'] = { actorType: 'agent', agent: 'riya' };
      },
    ),
    because: 'There is no agent actor variant. Agent self-authorization has no shape.',
  },

  // -------------------------------------------------------------------------
  // Cross-category: additional services and linked leads
  // -------------------------------------------------------------------------
  {
    name: 'additional service: the same category as the originating lead',
    contract: 'AdditionalServiceRequestV1',
    value: variantOf(validAdditionalServiceRequest, (draft) => {
      draft['proposedCategory'] = { entityType: 'category', entityId: 'CORE-CAT-WARDROBE' };
    }),
    because:
      'A same-category need belongs to the existing lead. Minting a second lead for it would mint a second batch of three vendors.',
  },
  {
    name: 'linked lead: reuses the originating lead’s identity',
    contract: 'LinkedLeadCreatedV1',
    value: variantOf(validLinkedLeadCreated, (draft) => {
      draft['newLead'] = { entityType: 'lead', entityId: 'CORE-LEAD-00042' };
    }),
    because:
      'A linked lead that is the same lead has inherited the parent’s consent, verification and scoring — which is exactly what separation prevents.',
  },
  {
    name: 'linked lead: same category',
    contract: 'LinkedLeadCreatedV1',
    value: variantOf(validLinkedLeadCreated, (draft) => {
      draft['newCategory'] = { entityType: 'category', entityId: 'CORE-CAT-WARDROBE' };
    }),
    because: 'A linked lead in the same category is a duplicate of the lead we already have.',
  },
  {
    name: 'linked lead: created by Jarvis',
    contract: 'LinkedLeadCreatedV1',
    value: variantOf(validLinkedLeadCreated, (draft) => {
      draft['issuer'] = 'qf-jarvis';
    }),
    because: 'Only Core creates a lead. Jarvis asked.',
  },
  {
    name: 'linked lead: no client confirmation',
    contract: 'LinkedLeadCreatedV1',
    value: variantOf(validLinkedLeadCreated, (draft) => {
      delete draft['clientConfirmation'];
    }),
    because:
      'A second lead means three more vendors see a real person’s project. They must have asked.',
  },
  {
    name: 'linked lead: inherits the parent’s consent',
    contract: 'LinkedLeadCreatedV1',
    value: variantOf(validLinkedLeadCreated, (draft) => {
      draft['independence'] = {
        independentConsent: false,
        independentVerification: true,
        independentScoring: true,
        independentMatching: true,
      };
    }),
    because:
      'A kitchen lead reaching vendors on a wardrobe’s consent is the precise failure the four literals exist to make unrepresentable.',
  },

  // -------------------------------------------------------------------------
  // Agent memory — derived, isolated, never authoritative
  // -------------------------------------------------------------------------
  {
    name: 'agent memory: claims to be authoritative',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['authoritative'] = true;
    }),
    because:
      'If this parsed, a derived store would have become a second source of truth. Core wins, always.',
  },
  {
    name: 'agent memory: claims not to be rebuildable',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['rebuildable'] = false;
    }),
    because:
      'Memory that cannot be rebuilt must be preserved — and a memory that must be preserved is a database of record.',
  },
  {
    name: 'agent memory: derived from no events at all',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['sourceEventIds'] = [];
    }),
    because:
      'A memory that cannot name its sources was not derived. It was invented — about a real client.',
  },
  {
    name: 'agent memory: Anisha remembering a client',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['ownerAgent'] = 'anisha';
    }),
    because:
      'Anisha is the vendor specialist. Cross-domain memory is how a bounded specialist stops being bounded.',
  },
  {
    name: 'agent memory: Kabir remembering a vendor',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['ownerAgent'] = 'kabir';
      draft['subjectReferences'] = [{ entityType: 'vendor', entityId: 'CORE-VENDOR-00088' }];
    }),
    because: 'Kabir reasons about lead quality. A vendor is not his to remember.',
  },
  {
    name: 'agent memory: Jitin remembering an individual client',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['ownerAgent'] = 'jitin';
    }),
    because:
      'Marketing intelligence works in aggregate. It does not require remembering individual people, so it may not.',
  },
  {
    name: 'agent memory: Jarvis remembering a client directly',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['ownerAgent'] = 'jarvis';
    }),
    because:
      'Jarvis owns the connecting, never the concluding. An agent that remembers domain facts is concluding.',
  },
  {
    name: 'agent memory: carries chain-of-thought',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['derivedSignals'] = { chainOfThought: 'First I considered...' };
    }),
    because: 'Chain-of-thought is never stored, anywhere, at any time.',
  },
  {
    name: 'agent memory: carries a prompt',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['derivedSignals'] = { prompt: 'You are Riya...' };
    }),
    because: 'Prompts are refused by the governed scan, by key.',
  },
  {
    name: 'agent memory: carries a contact detail',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      draft['derivedSignals'] = { preferredContact: 'client@example.com' };
    }),
    because: 'The governed scan refuses contact-shaped values, not just contact-named keys.',
  },
  {
    name: 'agent memory: no erasure state',
    contract: 'AgentMemoryRecordV1',
    value: variantOf(validAgentMemoryRiya, (draft) => {
      delete draft['erasureState'];
    }),
    because:
      'Without it, a memory record about an erased client is invisibly stale rather than detectably so.',
  },

  // -------------------------------------------------------------------------
  // Memory invalidation
  // -------------------------------------------------------------------------
  {
    name: 'memory invalidation: subject scope, but no subject named',
    contract: 'MemoryInvalidationRequestV1',
    value: variantOf(
      {
        memoryInvalidationRequestId: TARGET_IDS.memoryInvalidation,
        contractVersion: 1,
        scope: 'subject',
        ownerAgent: 'riya',
        subjectReference: { entityType: 'client', entityId: 'CORE-CLIENT-00311' },
        requestedBy: {
          actorType: 'human',
          actor: { entityType: 'user', entityId: 'CORE-USER-00007' },
        },
        requestedAt: '2026-07-11T09:35:00Z',
        reasonCode: 'erasure-requested',
        policy: { policyId: 'qf.governance', policyVersion: 3 },
        correlationId: TARGET_IDS.correlation,
      },
      (draft) => {
        delete draft['subjectReference'];
      },
    ),
    because: 'This is the shape a deletion request takes. An unnamed subject deletes nothing.',
  },

  // -------------------------------------------------------------------------
  // Learning: provenance, and the refusal to train by default
  // -------------------------------------------------------------------------
  {
    name: 'agent run: model invoked, no prompt provenance',
    contract: 'AgentRunRecordV1',
    value: variantOf(validAgentRunWithModel, (draft) => {
      delete draft['promptConfiguration'];
    }),
    because:
      'Model provenance without prompt provenance is not provenance. The run cannot be reproduced or explained.',
  },
  {
    name: 'agent run: carries raw model output',
    contract: 'AgentRunRecordV1',
    value: variantOf(validAgentRunWithModel, (draft) => {
      draft['modelResponse'] = 'The lead looks fraudulent because...';
    }),
    because: 'Raw model output is never stored. An unknown key is refused.',
  },
  {
    name: 'prompt configuration: carries the prompt text',
    contract: 'AgentRunRecordV1',
    value: variantOf(validAgentRunWithModel, (draft) => {
      draft['promptConfiguration'] = {
        contractVersion: 1,
        promptId: 'kabir.fraud-synthesis',
        promptVersion: 5,
        configurationId: 'kabir.default',
        configurationVersion: 3,
        promptText: 'You are Kabir, a lead intelligence agent...',
      };
    }),
    because:
      'An assembled prompt holds the context the agent was given — drawn from real clients. It would be the largest concentration of personal data in the system.',
  },
  {
    name: 'model reference: carries an API key',
    contract: 'AgentRunRecordV1',
    value: variantOf(validAgentRunWithModel, (draft) => {
      draft['model'] = {
        contractVersion: 1,
        provider: 'anthropic',
        modelId: 'claude-opus',
        modelVersion: '4-8',
        invocationConfigurationVersion: 2,
        apiKey: 'sk-ant-SYNTHETIC',
      };
    }),
    because: 'Jarvis holds no credential. A contract carrying one is either a bug or a breach.',
  },
  {
    name: 'training eligibility: eligible, but the data was never minimised',
    contract: 'TrainingEligibilityDecisionV1',
    value: variantOf(validTrainingEligibilityApproved, (draft) => {
      draft['minimisationStatus'] = 'not-minimised';
    }),
    because: 'Minimisation is a precondition, not a follow-up task.',
  },
  {
    name: 'training eligibility: eligible, but provenance is incomplete',
    contract: 'TrainingEligibilityDecisionV1',
    value: variantOf(validTrainingEligibilityApproved, (draft) => {
      draft['provenanceComplete'] = false;
    }),
    because: 'If we cannot say where it came from, we cannot honour a deletion request against it.',
  },
  {
    name: 'training eligibility: sensitive personal data approved for training',
    contract: 'TrainingEligibilityDecisionV1',
    value: variantOf(validTrainingEligibilityApproved, (draft) => {
      draft['dataClassification'] = 'sensitive-personal';
    }),
    because:
      'There is no careful way to do this, and a field that permitted it would eventually be used.',
  },
  {
    name: 'training eligibility: refused, with no reason',
    contract: 'TrainingEligibilityDecisionV1',
    value: variantOf(validTrainingEligibilityApproved, (draft) => {
      draft['eligible'] = false;
    }),
    because: 'A refusal that does not say why cannot be reviewed, counted, or appealed.',
  },
  {
    name: 'dataset provenance: no sources at all',
    contract: 'DatasetExampleProvenanceV1',
    value: variantOf(validDatasetExampleProvenance, (draft) => {
      draft['sourceReferences'] = [];
    }),
    because: 'An example that cannot name its sources is not low-quality. It is ungovernable.',
  },
  {
    name: 'dataset provenance: no erasure state',
    contract: 'DatasetExampleProvenanceV1',
    value: variantOf(validDatasetExampleProvenance, (draft) => {
      delete draft['erasureState'];
    }),
    because:
      'A dataset example is the easiest place for an erasure to silently miss — it has already been extracted, transformed, and filed somewhere nobody thinks of as personal data. Without the field, a missed deletion survives forever inside a training set.',
  },

  // -------------------------------------------------------------------------
  // Evaluation
  // -------------------------------------------------------------------------
  {
    name: 'outcome feedback: a known outcome that never says whether the prediction held',
    contract: 'OutcomeFeedbackV1',
    value: variantOf(validOutcomeFeedbackPositive, (draft) => {
      delete draft['movedInExpectedDirection'];
    }),
    because:
      'Outcome data that cannot be compared with the prediction would inflate a gate’s denominator while contributing nothing to its numerator.',
  },
  {
    name: 'outcome feedback: a known outcome with no evidence',
    contract: 'OutcomeFeedbackV1',
    value: variantOf(validOutcomeFeedbackPositive, (draft) => {
      draft['evidence'] = [];
    }),
    because:
      'Claiming to know the outcome while pointing at nothing is an unfalsifiable assertion.',
  },
  {
    name: 'outcome feedback: unknown, yet certain the metric moved as predicted',
    contract: 'OutcomeFeedbackV1',
    value: variantOf(validOutcomeFeedbackPositive, (draft) => {
      draft['outcomeClass'] = 'unknown';
      draft['evidence'] = [];
    }),
    because: 'If we know the metric moved as predicted, the outcome is not unknown.',
  },

  // -------------------------------------------------------------------------
  // Privacy and policy
  // -------------------------------------------------------------------------
  {
    name: 'erasure record: completed, with scopes still outstanding',
    contract: 'ErasureRecordV1',
    value: variantOf(validErasureRecordCompleted, (draft) => {
      draft['scopesOutstanding'] = ['agent-memory'];
    }),
    because:
      'The single most dangerous record here: it closes a legal obligation while the data is still sitting in an agent’s memory.',
  },
  {
    name: 'erasure record: completed, having reached nowhere',
    contract: 'ErasureRecordV1',
    value: variantOf(validErasureRecordCompleted, (draft) => {
      draft['scopesCompleted'] = [];
    }),
    because: 'An erasure that erased nothing, nowhere, is not a completed erasure.',
  },
  {
    name: 'erasure record: erases the audit trail',
    contract: 'ErasureRecordV1',
    value: variantOf(validErasureRecordCompleted, (draft) => {
      draft['scopesCompleted'] = ['audit-trail'];
    }),
    because:
      'The personal data goes; the fact that a governed action occurred stays. Erasing the audit trail destroys the accountability it exists to provide.',
  },
  {
    name: 'policy version: goes backwards',
    contract: 'PolicyVersionChangeV1',
    value: variantOf(validPolicyVersionChange, (draft) => {
      draft['newVersion'] = 1;
    }),
    because:
      'Two rule sets sharing a version number make "which policy was in force?" unanswerable.',
  },

  // -------------------------------------------------------------------------
  // ClientConfirmationV1 — the evidence that gates a reassignment
  // -------------------------------------------------------------------------
  {
    name: 'client confirmation: no contract version',
    contract: 'ClientConfirmationV1',
    value: variantOf(validClientConfirmation, (draft) => {
      delete draft['contractVersion'];
    }),
    because:
      'An unversioned confirmation cannot be evolved: the day its shape changes, a consumer holding the old one has no way to tell which it is holding. The version is never defaulted.',
  },
  {
    name: 'client confirmation: unknown future version',
    contract: 'ClientConfirmationV1',
    value: variantOf(validClientConfirmation, (draft) => {
      draft['contractVersion'] = 2;
    }),
    because: 'An unknown version is rejected, never guessed at.',
  },
  {
    name: 'client confirmation: no evidence event',
    contract: 'ClientConfirmationV1',
    value: variantOf(validClientConfirmation, (draft) => {
      delete draft['evidenceEventId'];
    }),
    because:
      'Without the event Core recorded it in, a confirmation is a thing Jarvis asserts rather than a thing an auditor can read. "Prove it" must be a lookup, not an argument.',
  },
  {
    name: 'client confirmation: carries what the client said',
    contract: 'ClientConfirmationV1',
    value: variantOf(validClientConfirmation, (draft) => {
      draft['transcript'] = 'Yeah fine, send me someone else.';
    }),
    because:
      'A verbatim quote is personal data, and it invites a transcript to be pasted in. What the system needs is which confirmation, captured how, evidenced where.',
  },
  {
    name: 'client confirmation: confirmed by a phone number',
    contract: 'ClientConfirmationV1',
    value: variantOf(validClientConfirmation, (draft) => {
      draft['confirmedBy'] = { entityType: 'client', entityId: '+919876543210' };
    }),
    because: 'The confirming party is an opaque Core reference, never a contact detail.',
  },

  // -------------------------------------------------------------------------
  // ModelReferenceV1 — a citation of a model, never a channel to one
  // -------------------------------------------------------------------------
  {
    name: 'model reference: carries an API key',
    contract: 'ModelReferenceV1',
    value: variantOf(validModelReference, (draft) => {
      draft['apiKey'] = 'sk-ant-SYNTHETIC';
    }),
    because: 'Jarvis holds no credential. A contract carrying one is either a bug or a breach.',
  },
  {
    name: 'model reference: carries the raw model response',
    contract: 'ModelReferenceV1',
    value: variantOf(validModelReference, (draft) => {
      draft['modelResponse'] = 'The lead looks fraudulent because...';
    }),
    because: 'A model reference names a model. It is not a place to record what the model said.',
  },
  {
    name: 'model reference: an unreviewed provider',
    contract: 'ModelReferenceV1',
    value: variantOf(validModelReference, (draft) => {
      draft['provider'] = 'some-other-llm-vendor';
    }),
    because:
      'The provider set is closed. Adding a party we send reasoning to must be a diff a human reviews, not a string a caller invents.',
  },
  {
    name: 'model reference: no model version',
    contract: 'ModelReferenceV1',
    value: variantOf(validModelReference, (draft) => {
      delete draft['modelVersion'];
    }),
    because:
      '"Which model" without "which version" is not provenance, and cannot explain a regression.',
  },
  {
    name: 'model reference: no contract version',
    contract: 'ModelReferenceV1',
    value: variantOf(validModelReference, (draft) => {
      delete draft['contractVersion'];
    }),
    because: 'Every contract states its version. It is never defaulted.',
  },

  // -------------------------------------------------------------------------
  // PromptConfigurationReferenceV1 — references and versions only
  // -------------------------------------------------------------------------
  {
    name: 'prompt configuration: carries the prompt text',
    contract: 'PromptConfigurationReferenceV1',
    value: variantOf(validPromptConfigurationReference, (draft) => {
      draft['promptText'] = 'You are Kabir, a lead intelligence agent...';
    }),
    because:
      'An assembled prompt holds the context the agent was given — drawn from real clients. It would be the largest concentration of personal data in the system, in a table nobody thinks of as sensitive.',
  },
  {
    name: 'prompt configuration: carries chain-of-thought',
    contract: 'PromptConfigurationReferenceV1',
    value: variantOf(validPromptConfigurationReference, (draft) => {
      draft['chainOfThought'] = 'First I considered the budget...';
    }),
    because: 'Chain-of-thought is never stored, anywhere, at any time.',
  },
  {
    name: 'prompt configuration: malformed digest',
    contract: 'PromptConfigurationReferenceV1',
    value: variantOf(validPromptConfigurationReference, (draft) => {
      draft['promptDigest'] = 'not-a-sha256';
    }),
    because: 'A digest that is not a digest proves nothing about which prompt ran.',
  },
  {
    name: 'prompt configuration: no prompt version',
    contract: 'PromptConfigurationReferenceV1',
    value: variantOf(validPromptConfigurationReference, (draft) => {
      delete draft['promptVersion'];
    }),
    because: 'A prompt with no version cannot be reproduced, regression-tested, or explained.',
  },

  // -------------------------------------------------------------------------
  // Human handoff — asking for a person is not having one
  // -------------------------------------------------------------------------
  {
    name: 'human handoff request: produced by QuickFurno Core',
    contract: 'HumanHandoffRequestV1',
    value: variantOf(validHumanHandoffRequest, (draft) => {
      draft['producingSystem'] = 'quickfurno-core';
    }),
    because: 'Jarvis asks for a human. It does not appoint one, and Core does not ask itself.',
  },
  {
    name: 'human handoff request: claims a human already took it',
    contract: 'HumanHandoffRequestV1',
    value: variantOf(validHumanHandoffRequest, (draft) => {
      draft['handledBy'] = { actorType: 'human', actor: { entityType: 'user', entityId: 'U1' } };
    }),
    because:
      'A request is not a handoff. If this parsed, a UI could render "somebody is handling it" while nobody was — the same disease as rendering delivered on provider-accepted.',
  },
  {
    name: 'human handoff record: issued by Jarvis',
    contract: 'HumanHandoffRecordV1',
    value: variantOf(validHumanHandoffRecord, (draft) => {
      draft['issuer'] = 'qf-jarvis';
    }),
    because: 'Core records that a human took it. Recording is what makes it true.',
  },
  {
    name: 'human handoff record: handled by a policy, not a person',
    contract: 'HumanHandoffRecordV1',
    value: variantOf(validHumanHandoffRecord, (draft) => {
      draft['handledBy'] = { actorType: 'policy', policyId: 'auto.handoff', policyVersion: 1 };
    }),
    because:
      'The entire point of a handoff was to get a person. A policy picking it up is not a handoff.',
  },

  // -------------------------------------------------------------------------
  // RecommendationEvaluationV1 — acceptance, and only acceptance
  // -------------------------------------------------------------------------
  {
    name: 'recommendation evaluation: evaluated by an agent',
    contract: 'RecommendationEvaluationV1',
    value: variantOf(validRecommendationEvaluation, (draft) => {
      draft['evaluator'] = { actorType: 'agent', agent: 'jarvis' };
    }),
    because:
      'There is no agent actor variant. An agent grading an agent is a feedback loop with no ground truth in it.',
  },
  {
    name: 'recommendation evaluation: confidence outside 0..1',
    contract: 'RecommendationEvaluationV1',
    value: variantOf(validRecommendationEvaluation, (draft) => {
      draft['statedConfidence'] = 1.4;
    }),
    because: 'A confidence above 1 is not a confidence, and calibration against it is meaningless.',
  },
  {
    name: 'recommendation evaluation: also claims the business outcome',
    contract: 'RecommendationEvaluationV1',
    value: variantOf(validRecommendationEvaluation, (draft) => {
      draft['movedInExpectedDirection'] = true;
    }),
    because:
      'Acceptance and outcome are separate contracts on purpose. Merging them would make "we have evaluation data" true of a system that never checked whether anything got better.',
  },
  {
    name: 'recommendation evaluation: an invented acceptance outcome',
    contract: 'RecommendationEvaluationV1',
    value: variantOf(validRecommendationEvaluation, (draft) => {
      draft['acceptanceOutcome'] = 'sort-of-accepted';
    }),
    because: 'Acceptance outcomes are a closed, countable set. An invented one cannot be counted.',
  },

  // -------------------------------------------------------------------------
  // HumanCorrectionV1 — a new record, never an edit
  // -------------------------------------------------------------------------
  {
    name: 'human correction: made by a policy',
    contract: 'HumanCorrectionV1',
    value: variantOf(validHumanCorrection, (draft) => {
      draft['correctedBy'] = { actorType: 'policy', policyId: 'auto.correct', policyVersion: 1 };
    }),
    because:
      'A correction is a judgment that the rule or the model got it wrong. There is no coherent sense in which a policy makes that judgment about itself.',
  },
  {
    name: 'human correction: edits the recommendation in place',
    contract: 'HumanCorrectionV1',
    value: variantOf(validHumanCorrection, (draft) => {
      draft['correctedRecommendation'] = { summary: 'the fixed version' };
    }),
    because:
      'Corrections are new records, never edits. A system that edits the original loses "how often were we wrong, and about what?" permanently — and loses it silently.',
  },
  {
    name: 'human correction: an invented correction type',
    contract: 'HumanCorrectionV1',
    value: variantOf(validHumanCorrection, (draft) => {
      draft['correctionType'] = 'just-wrong';
    }),
    because:
      'Correction types are bands so that "what does this agent get wrong?" is countable. An evidence problem and a model problem need different fixes.',
  },

  // -------------------------------------------------------------------------
  // ErasureRequestV1 — the obligation starts here
  // -------------------------------------------------------------------------
  {
    name: 'erasure request: issued by Jarvis',
    contract: 'ErasureRequestV1',
    value: variantOf(validErasureRequest, (draft) => {
      draft['issuer'] = 'qf-jarvis';
    }),
    because: 'Only Core originates an erasure. It owns the identity being erased.',
  },
  {
    name: 'erasure request: reaches nowhere',
    contract: 'ErasureRequestV1',
    value: variantOf(validErasureRequest, (draft) => {
      draft['scopes'] = [];
    }),
    because:
      'An erasure that names no scope erases nothing, while appearing to have started an obligation.',
  },
  {
    name: 'erasure request: erases the audit trail',
    contract: 'ErasureRequestV1',
    value: variantOf(validErasureRequest, (draft) => {
      draft['scopes'] = ['audit-trail'];
    }),
    because:
      'The personal data goes; the fact that a governed action occurred stays. Erasing the audit trail destroys the accountability it exists to provide.',
  },
  {
    name: 'erasure request: an invented erasure type',
    contract: 'ErasureRequestV1',
    value: variantOf(validErasureRequest, (draft) => {
      draft['erasureType'] = 'partial-redaction';
    }),
    because:
      'Deletion and anonymisation are different obligations with different outcomes. Collapsing them is how an "anonymised" record turns out to be re-identifiable.',
  },
];
