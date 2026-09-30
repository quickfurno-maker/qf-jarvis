import type { AgentFlowActor } from '@qf-jarvis/agent-flow-registry';
import type {
  DurableJourneyCycleResultV1,
  DurableJourneyStartV1,
} from '@qf-jarvis/durable-orchestration-contracts';
import type {
  GovernedAgentHandoffDecision,
  GovernedPartyType,
} from '@qf-jarvis/governed-agent-handoff';
import type { JaoActionProposalAssessment } from '@qf-jarvis/jao-action-registry';

export const AGENT_FLOW_CONTROL_ACTORS = ['RIYA', 'ANISHA', 'AAROHI'] as const;
export type AgentFlowControlActor = (typeof AGENT_FLOW_CONTROL_ACTORS)[number];

export const AGENT_FLOW_CONDITION_OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'PRESENT',
  'TRUTHY',
] as const;
export type AgentFlowConditionOperator = (typeof AGENT_FLOW_CONDITION_OPERATORS)[number];
export type AgentFlowSignalValue = string | number | boolean | null;

export interface AgentFlowConditionDefinition {
  readonly conditionId: string;
  readonly signalRef: string;
  readonly operator: AgentFlowConditionOperator;
  readonly value?: AgentFlowSignalValue;
  readonly values?: readonly AgentFlowSignalValue[];
}

export interface AgentFlowRouteDefinition {
  readonly routeId: string;
  readonly fromNodeId: string;
  readonly conditionRef: string;
  readonly whenTrueNodeId: string;
  readonly whenFalseNodeId: string;
}

export interface AgentFlowWaitPolicy {
  readonly policyId: string;
  readonly waitMs: number;
  readonly resumeEventRef: string;
  readonly expiryFallbackNodeId: string;
}

export interface AgentFlowRetryPolicy {
  readonly policyId: string;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly fallbackNodeId: string;
  readonly requiresIdempotency: true;
}

export interface AgentFlowHumanHandoffPolicy {
  readonly policyId: string;
  readonly actionId: 'request_human_takeover';
  readonly actionVersion: 1;
  readonly fallbackNodeId: string;
}

export interface AgentFlowSoftOrchestrationProfile {
  readonly profileId: string;
  readonly version: number;
  readonly actor: AgentFlowControlActor;
  readonly flowId: string;
  readonly implementationVersionRef: string;
  readonly approvedActionNodeIds: readonly string[];
  readonly conditions: readonly AgentFlowConditionDefinition[];
  readonly routes: readonly AgentFlowRouteDefinition[];
  readonly waits: readonly AgentFlowWaitPolicy[];
  readonly retries: readonly AgentFlowRetryPolicy[];
  readonly humanHandoff: AgentFlowHumanHandoffPolicy;
}

export type AgentFlowRouteDecision =
  | {
      readonly decision: 'ROUTE';
      readonly routeId: string;
      readonly conditionRef: string;
      readonly matched: boolean;
      readonly nextNodeId: string;
    }
  | {
      readonly decision: 'ROUTE_UNKNOWN' | 'SIGNAL_MISSING';
      readonly routeId: string;
    };

export interface AgentFlowDurableWaitPlan {
  readonly authority: 'NONE';
  readonly canExecute: false;
  readonly start: DurableJourneyStartV1;
  readonly directive: DurableJourneyCycleResultV1;
  readonly resumeEventRef: string;
  readonly expiryFallbackNodeId: string;
}

export interface AgentFlowDurableRetryPlan {
  readonly authority: 'NONE';
  readonly canExecute: false;
  readonly policyId: string;
  readonly maxAttempts: number;
  readonly directive: DurableJourneyCycleResultV1;
  readonly fallbackNodeId: string;
}

export interface AgentFlowHumanHandoffAssessment {
  readonly authority: 'NONE';
  readonly canExecute: false;
  readonly policyId: string;
  readonly assessment: JaoActionProposalAssessment;
  readonly fallbackNodeId: string;
}

export interface AgentFlowCrossAgentHandoffPlan {
  readonly authority: 'NONE';
  readonly canExecute: false;
  readonly partyType: GovernedPartyType;
  readonly decision: GovernedAgentHandoffDecision;
}

export interface AgentFlowCrossAgentLink {
  readonly linkId: string;
  readonly fromAgent: AgentFlowControlActor;
  readonly toAgent: AgentFlowControlActor;
  readonly partyType: GovernedPartyType;
  readonly reason: string;
}

export interface AgentFlowAllViewDefinition {
  readonly viewId: string;
  readonly label: string;
  readonly actors: readonly AgentFlowControlActor[];
  readonly flowIds: readonly string[];
  readonly crossAgentLinks: readonly AgentFlowCrossAgentLink[];
  readonly businessAuthority: 'QUICKFURNO_CORE';
  readonly executionAuthority: 'NONE';
}

export type AgentFlowProfileValidationIssue =
  | 'PROFILE_ACTOR_MISMATCH'
  | 'PROFILE_FLOW_MISMATCH'
  | 'PROFILE_BASELINE_MISMATCH'
  | 'UNKNOWN_ACTION_NODE'
  | 'ACTION_NODE_NOT_GOVERNED'
  | 'DUPLICATE_ACTION_NODE'
  | 'UNKNOWN_ROUTE_NODE'
  | 'UNKNOWN_CONDITION_REF'
  | 'DUPLICATE_CONDITION'
  | 'DUPLICATE_ROUTE'
  | 'CONDITION_ROUTE_MISSING'
  | 'CONDITION_EDGE_MISSING'
  | 'ROUTE_EDGE_MISMATCH'
  | 'DUPLICATE_WAIT_POLICY'
  | 'DUPLICATE_RETRY_POLICY'
  | 'WAIT_OUT_OF_BOUNDS'
  | 'RETRY_OUT_OF_BOUNDS'
  | 'RESUME_EVENT_UNKNOWN'
  | 'RESUME_EVENT_ACTOR_MISMATCH'
  | 'FALLBACK_NODE_UNKNOWN'
  | 'FALLBACK_NODE_UNSAFE';

export interface AgentFlowProfileValidation {
  readonly valid: boolean;
  readonly issues: readonly AgentFlowProfileValidationIssue[];
  readonly actor: Exclude<AgentFlowActor, 'SHARED'>;
  readonly flowId: string;
}
