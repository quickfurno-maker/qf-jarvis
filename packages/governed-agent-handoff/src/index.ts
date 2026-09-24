const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const REASON = /^[a-z0-9][a-z0-9._-]{0,95}$/u;

export const HANDOFF_AGENTS = ['JARVIS', 'RIYA', 'ANISHA', 'AAROHI', 'HUMAN'] as const;
export type HandoffAgent = (typeof HANDOFF_AGENTS)[number];

export interface HandoffContextReference {
  readonly ref: string;
  readonly classification: 'PUBLIC' | 'INTERNAL' | 'PERSONAL';
  readonly allowedAgents: readonly HandoffAgent[];
}

export interface AgentHandoffRequest {
  readonly handoffId: string;
  readonly conversationRef: string;
  readonly stateRevision: number;
  readonly sourceAgent: HandoffAgent;
  readonly targetAgent: HandoffAgent;
  readonly authoritativeActor: HandoffAgent;
  readonly humanTakeover: boolean;
  readonly reasonCode: string;
  readonly contextRefs: readonly HandoffContextReference[];
}

export type AgentHandoffAssessment =
  | { readonly decision: 'INVALID' }
  | { readonly decision: 'NO_HANDOFF_REQUIRED' }
  | { readonly decision: 'BLOCKED_AUTHORITY_MISMATCH' }
  | { readonly decision: 'BLOCKED_CONTEXT_SCOPE'; readonly blockedRefs: readonly string[] }
  | {
      readonly decision: 'ELIGIBLE_FOR_HANDOFF_PROPOSAL';
      readonly proposal: {
        readonly protocol: 'qfj.agent-handoff-proposal.v1';
        readonly handoffId: string;
        readonly conversationRef: string;
        readonly stateRevision: number;
        readonly sourceAgent: HandoffAgent;
        readonly targetAgent: HandoffAgent;
        readonly reasonCode: string;
        readonly contextRefs: readonly string[];
        readonly businessEffect: false;
        readonly controlTransitionCreated: false;
      };
    };

function validAgent(value: string): value is HandoffAgent {
  return (HANDOFF_AGENTS as readonly string[]).includes(value);
}

export function assessAgentHandoff(input: AgentHandoffRequest): AgentHandoffAssessment {
  if (
    !REF.test(input.handoffId) ||
    !REF.test(input.conversationRef) ||
    !Number.isInteger(input.stateRevision) ||
    input.stateRevision < 0 ||
    !validAgent(input.sourceAgent) ||
    !validAgent(input.targetAgent) ||
    !validAgent(input.authoritativeActor) ||
    !REASON.test(input.reasonCode) ||
    input.contextRefs.length > 16
  ) {
    return Object.freeze({ decision: 'INVALID' });
  }
  const expectedTarget = input.humanTakeover ? 'HUMAN' : input.authoritativeActor;
  if (input.targetAgent !== expectedTarget)
    return Object.freeze({ decision: 'BLOCKED_AUTHORITY_MISMATCH' });
  if (input.sourceAgent === input.targetAgent)
    return Object.freeze({ decision: 'NO_HANDOFF_REQUIRED' });

  const seen = new Set<string>();
  const blocked: string[] = [];
  for (const context of input.contextRefs) {
    if (
      !REF.test(context.ref) ||
      seen.has(context.ref) ||
      context.allowedAgents.length === 0 ||
      context.allowedAgents.some((agent) => !validAgent(agent))
    ) {
      return Object.freeze({ decision: 'INVALID' });
    }
    seen.add(context.ref);
    if (!context.allowedAgents.includes(input.targetAgent)) blocked.push(context.ref);
  }
  if (blocked.length > 0) {
    return Object.freeze({
      decision: 'BLOCKED_CONTEXT_SCOPE',
      blockedRefs: Object.freeze(blocked.sort()),
    });
  }
  return Object.freeze({
    decision: 'ELIGIBLE_FOR_HANDOFF_PROPOSAL',
    proposal: Object.freeze({
      protocol: 'qfj.agent-handoff-proposal.v1',
      handoffId: input.handoffId,
      conversationRef: input.conversationRef,
      stateRevision: input.stateRevision,
      sourceAgent: input.sourceAgent,
      targetAgent: input.targetAgent,
      reasonCode: input.reasonCode,
      contextRefs: Object.freeze(input.contextRefs.map((context) => context.ref)),
      businessEffect: false,
      controlTransitionCreated: false,
    }),
  });
}
