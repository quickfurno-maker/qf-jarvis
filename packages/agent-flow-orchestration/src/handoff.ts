import {
  prepareGovernedAgentHandoff,
  type GovernedPartyType,
} from '@qf-jarvis/governed-agent-handoff';
import {
  JAO_ENGINEERING_REGISTRY_V1,
  assessJaoActionProposal,
  type JaoActionRegistry,
} from '@qf-jarvis/jao-action-registry';

import type {
  AgentFlowControlActor,
  AgentFlowCrossAgentHandoffPlan,
  AgentFlowHumanHandoffAssessment,
  AgentFlowSoftOrchestrationProfile,
} from './contracts.js';

export function assessAgentFlowHumanHandoff(input: {
  readonly profile: AgentFlowSoftOrchestrationProfile;
  readonly registry?: JaoActionRegistry;
  readonly maturityDecision:
    | 'KEEP_DEFAULT_OFF'
    | 'SHADOW_EVIDENCE_SUFFICIENT'
    | 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE';
  readonly authorityEvidenceRef?: string;
  readonly approvalEvidenceRef?: string;
}): AgentFlowHumanHandoffAssessment {
  const policy = input.profile.humanHandoff;
  const assessment = assessJaoActionProposal({
    registry: input.registry ?? JAO_ENGINEERING_REGISTRY_V1,
    actionId: policy.actionId,
    actionVersion: policy.actionVersion,
    agentScope: input.profile.actor,
    maturityDecision: input.maturityDecision,
    ...(input.authorityEvidenceRef === undefined
      ? {}
      : { authorityEvidenceRef: input.authorityEvidenceRef }),
    ...(input.approvalEvidenceRef === undefined
      ? {}
      : { approvalEvidenceRef: input.approvalEvidenceRef }),
  });

  return Object.freeze({
    authority: 'NONE' as const,
    canExecute: false as const,
    policyId: policy.policyId,
    assessment,
    fallbackNodeId: policy.fallbackNodeId,
  });
}

export function prepareAgentFlowCrossAgentHandoff(input: {
  readonly fromAgent: AgentFlowControlActor;
  readonly toAgent: AgentFlowControlActor;
  readonly partyType: GovernedPartyType;
  readonly conversationRef: string;
  readonly coreAssignmentEvidenceRef?: string;
  readonly reasonCode: string;
  readonly contextSummaryRef?: string;
}): AgentFlowCrossAgentHandoffPlan {
  const decision = prepareGovernedAgentHandoff({
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    partyType: input.partyType,
    conversationRef: input.conversationRef,
    ...(input.coreAssignmentEvidenceRef === undefined
      ? {}
      : { coreAssignmentEvidenceRef: input.coreAssignmentEvidenceRef }),
    reasonCode: input.reasonCode,
    ...(input.contextSummaryRef === undefined
      ? {}
      : { contextSummaryRef: input.contextSummaryRef }),
  });
  return Object.freeze({
    authority: 'NONE' as const,
    canExecute: false as const,
    partyType: input.partyType,
    decision,
  });
}
