import {
  durableJourneyStartV1Schema,
  durableJourneyWakeV1Schema,
  type DurableJourneyStartV1,
  type DurableJourneyWakeV1,
} from '@qf-jarvis/durable-orchestration-contracts';
import {
  JAO_ENGINEERING_REGISTRY_V1,
  assessJaoActionProposal,
  type JaoActionAgentScope,
  type JaoActionProposalAssessment,
  type JaoActionRegistry,
} from '@qf-jarvis/jao-action-registry';
import { z } from 'zod';

import {
  jao6ProposalRequestSchema,
  proposeJao6BusinessAction,
  type Jao6ProposalResult,
} from './governed-business-action-proposals/index.js';

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const REASON = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

const humanTakeoverProposalRequestSchema = z.strictObject({
  conversationId: z.string().regex(REF),
  reasonCode: z.string().regex(REASON),
});

const temporalFollowupProposalRequestSchema = z.strictObject({
  journey: durableJourneyStartV1Schema,
  wake: durableJourneyWakeV1Schema,
});

export interface HumanTakeoverProposalV1 {
  readonly protocol: 'qfj.jao.human-takeover-proposal.v1';
  readonly conversationId: string;
  readonly requestedAction: 'TAKE_OWNERSHIP';
  readonly reasonCode: string;
  readonly businessEffect: false;
  readonly controlCommandCreated: false;
}

export interface TemporalFollowupRequestV1 {
  readonly protocol: 'qfj.jao.temporal-followup-request.v1';
  readonly journey: DurableJourneyStartV1;
  readonly wake: DurableJourneyWakeV1;
  readonly businessEffect: false;
  readonly workflowStarted: false;
}

export type RegisteredJaoProposalResult =
  | { readonly outcome: 'REGISTRY_REFUSED'; readonly assessment: JaoActionProposalAssessment }
  | { readonly outcome: 'BINDING_UNSUPPORTED'; readonly assessment: JaoActionProposalAssessment }
  | { readonly outcome: 'BINDING_MISMATCH'; readonly assessment: JaoActionProposalAssessment }
  | {
      readonly outcome: 'PROPOSAL_PATH_ENTERED';
      readonly assessment: JaoActionProposalAssessment;
      readonly proposal: Jao6ProposalResult;
    }
  | {
      readonly outcome: 'HUMAN_TAKEOVER_PROPOSAL_READY';
      readonly assessment: JaoActionProposalAssessment;
      readonly proposal: HumanTakeoverProposalV1;
    }
  | {
      readonly outcome: 'TEMPORAL_REQUEST_READY';
      readonly assessment: JaoActionProposalAssessment;
      readonly request: TemporalFollowupRequestV1;
    };

export interface RegisteredJaoProposalInput {
  readonly actionId: string;
  readonly actionVersion: number;
  readonly agentScope: JaoActionAgentScope;
  readonly maturityDecision:
    | 'KEEP_DEFAULT_OFF'
    | 'SHADOW_EVIDENCE_SUFFICIENT'
    | 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE';
  readonly authorityEvidenceRef?: string;
  readonly approvalEvidenceRef?: string;
  readonly proposalRequest: unknown;
}

type Jao6Proposer = (request: unknown) => Jao6ProposalResult;

/**
 * Trusted internal seam for deterministic tests. Not exported from a barrel.
 *
 * Every binding stops before authority or execution:
 * - JAO-6 returns RecommendationV1 + powerless ApprovalRequestV1 only.
 * - human takeover returns a request that cannot be a ConversationControlCommand because it contains
 *   no operatorRef, expectedRevision, commandId or issuedAt.
 * - Temporal follow-up returns validated content-minimized workflow input but never calls a Temporal
 *   client from the worker.
 */
export function proposeRegisteredJaoActionInternal(
  input: RegisteredJaoProposalInput,
  registry: JaoActionRegistry,
  proposer: Jao6Proposer,
): RegisteredJaoProposalResult {
  const assessment = assessJaoActionProposal({
    registry,
    actionId: input.actionId,
    actionVersion: input.actionVersion,
    agentScope: input.agentScope,
    maturityDecision: input.maturityDecision,
    ...(input.authorityEvidenceRef === undefined
      ? {}
      : { authorityEvidenceRef: input.authorityEvidenceRef }),
    ...(input.approvalEvidenceRef === undefined
      ? {}
      : { approvalEvidenceRef: input.approvalEvidenceRef }),
  });

  if (assessment.decision !== 'ELIGIBLE_FOR_PROPOSAL') {
    return Object.freeze({ outcome: 'REGISTRY_REFUSED' as const, assessment });
  }

  if (assessment.bindingRef === 'jao6.vendor-follow-up.v1') {
    const parsed = jao6ProposalRequestSchema.safeParse(input.proposalRequest);
    if (
      !parsed.success ||
      parsed.data.proposalPolicyId !== 'jao6.vendor-follow-up' ||
      parsed.data.proposalPolicyVersion !== 1
    ) {
      return Object.freeze({ outcome: 'BINDING_MISMATCH' as const, assessment });
    }

    return Object.freeze({
      outcome: 'PROPOSAL_PATH_ENTERED' as const,
      assessment,
      proposal: proposer(parsed.data),
    });
  }

  if (assessment.bindingRef === 'conversation.human-takeover.v1') {
    const parsed = humanTakeoverProposalRequestSchema.safeParse(input.proposalRequest);
    if (!parsed.success) {
      return Object.freeze({ outcome: 'BINDING_MISMATCH' as const, assessment });
    }
    const proposal: HumanTakeoverProposalV1 = Object.freeze({
      protocol: 'qfj.jao.human-takeover-proposal.v1',
      conversationId: parsed.data.conversationId,
      requestedAction: 'TAKE_OWNERSHIP',
      reasonCode: parsed.data.reasonCode,
      businessEffect: false,
      controlCommandCreated: false,
    });
    return Object.freeze({
      outcome: 'HUMAN_TAKEOVER_PROPOSAL_READY' as const,
      assessment,
      proposal,
    });
  }

  if (assessment.bindingRef === 'temporal.governed-followup.v1') {
    const parsed = temporalFollowupProposalRequestSchema.safeParse(input.proposalRequest);
    if (!parsed.success) {
      return Object.freeze({ outcome: 'BINDING_MISMATCH' as const, assessment });
    }
    const request: TemporalFollowupRequestV1 = Object.freeze({
      protocol: 'qfj.jao.temporal-followup-request.v1',
      journey: parsed.data.journey,
      wake: parsed.data.wake,
      businessEffect: false,
      workflowStarted: false,
    });
    return Object.freeze({
      outcome: 'TEMPORAL_REQUEST_READY' as const,
      assessment,
      request,
    });
  }

  return Object.freeze({ outcome: 'BINDING_UNSUPPORTED' as const, assessment });
}

/**
 * Canonical runtime entry. The engineering registry currently ships every action disabled, so this
 * function is fail-closed today. Future enablement requires a reviewed registry code change plus the
 * existing JAO maturity evidence/owner-review gate; callers cannot supply or mutate the registry.
 */
export function proposeRegisteredJaoAction(
  input: RegisteredJaoProposalInput,
): RegisteredJaoProposalResult {
  return proposeRegisteredJaoActionInternal(
    input,
    JAO_ENGINEERING_REGISTRY_V1,
    proposeJao6BusinessAction,
  );
}
