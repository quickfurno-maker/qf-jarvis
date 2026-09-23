import {
  JAO_ENGINEERING_REGISTRY_V1,
  assessJaoActionProposal,
  type JaoActionAgentScope,
  type JaoActionProposalAssessment,
  type JaoActionRegistry,
} from '@qf-jarvis/jao-action-registry';

import {
  jao6ProposalRequestSchema,
  proposeJao6BusinessAction,
  type Jao6ProposalResult,
} from './governed-business-action-proposals/index.js';

export type RegisteredJaoProposalResult =
  | { readonly outcome: 'REGISTRY_REFUSED'; readonly assessment: JaoActionProposalAssessment }
  | { readonly outcome: 'BINDING_UNSUPPORTED'; readonly assessment: JaoActionProposalAssessment }
  | { readonly outcome: 'BINDING_MISMATCH'; readonly assessment: JaoActionProposalAssessment }
  | {
      readonly outcome: 'PROPOSAL_PATH_ENTERED';
      readonly assessment: JaoActionProposalAssessment;
      readonly proposal: Jao6ProposalResult;
    };

export interface RegisteredJaoProposalInput {
  readonly actionId: string;
  readonly actionVersion: number;
  readonly agentScope: JaoActionAgentScope;
  readonly maturityDecision:
    'KEEP_DEFAULT_OFF' | 'SHADOW_EVIDENCE_SUFFICIENT' | 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE';
  readonly authorityEvidenceRef?: string;
  readonly approvalEvidenceRef?: string;
  readonly proposalRequest: unknown;
}

type Jao6Proposer = (request: unknown) => Jao6ProposalResult;

/**
 * Trusted internal seam for deterministic tests. Not exported from a barrel.
 *
 * The action registry gates entry; it does not authorize the business action. The only implemented
 * binding is the already-reviewed JAO-6 vendor-follow-up proposal lane, which itself stops after
 * producing a RecommendationV1 + powerless ApprovalRequestV1. No approval decision or execution
 * intent is constructed here.
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

  if (assessment.bindingRef !== 'jao6.vendor-follow-up.v1') {
    return Object.freeze({ outcome: 'BINDING_UNSUPPORTED' as const, assessment });
  }

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
