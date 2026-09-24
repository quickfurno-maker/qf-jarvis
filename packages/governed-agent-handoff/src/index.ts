const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export const GOVERNED_AGENTS = ['RIYA', 'ANISHA', 'AAROHI'] as const;
export type GovernedAgent = (typeof GOVERNED_AGENTS)[number];
export type GovernedPartyType = 'CLIENT' | 'VENDOR' | 'PROSPECT';

const TARGET_BY_PARTY: Readonly<Record<GovernedPartyType, GovernedAgent>> = Object.freeze({
  CLIENT: 'RIYA',
  VENDOR: 'ANISHA',
  PROSPECT: 'AAROHI',
});

export type GovernedAgentHandoffDecision =
  | {
      readonly decision: 'HANDOFF_PROPOSAL_READY';
      readonly proposal: {
        readonly protocol: 'qfj.governed-agent-handoff.v1';
        readonly fromAgent: GovernedAgent;
        readonly toAgent: GovernedAgent;
        readonly partyType: GovernedPartyType;
        readonly conversationRef: string;
        readonly coreAssignmentEvidenceRef: string;
        readonly reasonCode: string;
        readonly contextSummaryRef?: string;
        readonly businessEffect: false;
        readonly assignmentChanged: false;
        readonly workflowStarted: false;
      };
    }
  | {
      readonly decision: 'NO_HANDOFF_REQUIRED' | 'TARGET_MISMATCH' | 'AUTHORITY_EVIDENCE_MISSING';
    };

export function prepareGovernedAgentHandoff(input: {
  readonly fromAgent: GovernedAgent;
  readonly toAgent: GovernedAgent;
  readonly partyType: GovernedPartyType;
  readonly conversationRef: string;
  readonly coreAssignmentEvidenceRef?: string;
  readonly reasonCode: string;
  readonly contextSummaryRef?: string;
}): GovernedAgentHandoffDecision {
  if (
    !GOVERNED_AGENTS.includes(input.fromAgent) ||
    !GOVERNED_AGENTS.includes(input.toAgent) ||
    !REF.test(input.conversationRef) ||
    !REF.test(input.reasonCode) ||
    (input.contextSummaryRef !== undefined && !REF.test(input.contextSummaryRef))
  ) {
    throw new TypeError('governed-agent-handoff-input-invalid');
  }
  if (TARGET_BY_PARTY[input.partyType] !== input.toAgent) {
    return Object.freeze({ decision: 'TARGET_MISMATCH' as const });
  }
  if (input.fromAgent === input.toAgent) {
    return Object.freeze({ decision: 'NO_HANDOFF_REQUIRED' as const });
  }
  if (input.coreAssignmentEvidenceRef === undefined || !REF.test(input.coreAssignmentEvidenceRef)) {
    return Object.freeze({ decision: 'AUTHORITY_EVIDENCE_MISSING' as const });
  }
  return Object.freeze({
    decision: 'HANDOFF_PROPOSAL_READY' as const,
    proposal: Object.freeze({
      protocol: 'qfj.governed-agent-handoff.v1' as const,
      fromAgent: input.fromAgent,
      toAgent: input.toAgent,
      partyType: input.partyType,
      conversationRef: input.conversationRef,
      coreAssignmentEvidenceRef: input.coreAssignmentEvidenceRef,
      reasonCode: input.reasonCode,
      ...(input.contextSummaryRef === undefined
        ? {}
        : { contextSummaryRef: input.contextSummaryRef }),
      businessEffect: false as const,
      assignmentChanged: false as const,
      workflowStarted: false as const,
    }),
  });
}
