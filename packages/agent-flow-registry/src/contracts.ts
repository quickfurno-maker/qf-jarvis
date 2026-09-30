export const AGENT_FLOW_ACTORS = ['RIYA', 'ANISHA', 'AAROHI', 'SHARED'] as const;
export type AgentFlowActor = (typeof AGENT_FLOW_ACTORS)[number];

export const AGENT_FLOW_NODE_KINDS = [
  'TRIGGER',
  'CONTEXT',
  'MEMORY',
  'INTELLIGENCE',
  'ORCHESTRATION',
  'CAPABILITY',
  'CHANNEL',
  'HUMAN',
  'SYSTEM',
] as const;
export type AgentFlowNodeKind = (typeof AGENT_FLOW_NODE_KINDS)[number];

export const AGENT_FLOW_EXECUTION_ROLES = [
  'STEP',
  'PROJECTION',
  'DECISION',
  'CAPABILITY',
  'CHANNEL',
  'TERMINAL',
] as const;
export type AgentFlowExecutionRole = (typeof AGENT_FLOW_EXECUTION_ROLES)[number];

export const AGENT_FLOW_AUTHORITIES = [
  'PRESENTATION_ONLY',
  'READ_ONLY',
  'AGENT_INTERPRET',
  'AGENT_PROPOSE',
  'ORCHESTRATION_CONTROL',
  'CORE_GOVERNED_ACTION',
  'HUMAN_CONTROL',
] as const;
export type AgentFlowAuthority = (typeof AGENT_FLOW_AUTHORITIES)[number];

export const AGENT_FLOW_EFFECTS = [
  'NONE',
  'READ_ONLY',
  'PROPOSAL_ONLY',
  'GOVERNED_ACTION',
  'CHANNEL_REQUEST',
] as const;
export type AgentFlowEffect = (typeof AGENT_FLOW_EFFECTS)[number];

export const AGENT_FLOW_STATUSES = [
  'IMPLEMENTED',
  'SHADOW',
  'DISABLED',
  'PLANNED',
  'NOT_CONNECTED',
] as const;
export type AgentFlowStatus = (typeof AGENT_FLOW_STATUSES)[number];

export const AGENT_FLOW_STAGES = [
  'TRIGGER',
  'IDENTIFY',
  'LOAD_CONTEXT',
  'UNDERSTAND',
  'DECIDE',
  'ACT_OR_RESPOND',
  'OBSERVE_RESULT',
  'REFRESH_CONTEXT',
  'WAIT_CONTINUE_CLOSE',
] as const;
export type AgentFlowStage = (typeof AGENT_FLOW_STAGES)[number];

export const AGENT_FLOW_EDGE_KINDS = ['CONTROL', 'DATA', 'COMMAND', 'RESULT', 'EVENT'] as const;
export type AgentFlowEdgeKind = (typeof AGENT_FLOW_EDGE_KINDS)[number];

export const AGENT_FLOW_CANVAS_CONFIG_KEYS = [
  'timeoutPolicyRef',
  'retryPolicyRef',
  'fallbackNodeId',
  'conditionRef',
  'waitPolicyRef',
  'contextProfileRef',
  'promptProfileRef',
  'modelRoutingProfileRef',
  'toolProfileRef',
] as const;
export type AgentFlowCanvasConfigKey = (typeof AGENT_FLOW_CANVAS_CONFIG_KEYS)[number];

export interface AgentFlowNodeDefinition {
  readonly nodeId: string;
  readonly nodeVersion: number;
  readonly label: string;
  readonly actor: AgentFlowActor;
  readonly kind: AgentFlowNodeKind;
  readonly executionRole: AgentFlowExecutionRole;
  readonly stage: AgentFlowStage;
  readonly authority: AgentFlowAuthority;
  readonly effect: AgentFlowEffect;
  readonly status: AgentFlowStatus;
  readonly implementationRef: string;
  readonly description: string;
  readonly codeLocked: boolean;
  readonly canvasEditable: readonly AgentFlowCanvasConfigKey[];
  readonly groupId: string;
  readonly tags: readonly string[];
}

export interface AgentFlowEdgeDefinition {
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly kind: AgentFlowEdgeKind;
  readonly label?: string;
  readonly conditionRef?: string;
}

export interface AgentFlowGroupDefinition {
  readonly groupId: string;
  readonly label: string;
  readonly actor: AgentFlowActor;
  readonly description: string;
  readonly order: number;
}

export interface AgentFlowDefinition {
  readonly flowId: string;
  readonly flowVersion: number;
  readonly label: string;
  readonly actor: Exclude<AgentFlowActor, 'SHARED'>;
  readonly status: AgentFlowStatus;
  readonly description: string;
  readonly rootNodeId: string;
  readonly groups: readonly AgentFlowGroupDefinition[];
  readonly nodes: readonly AgentFlowNodeDefinition[];
  readonly edges: readonly AgentFlowEdgeDefinition[];
}

export interface AgentFlowTriggerDefinition {
  readonly triggerId: string;
  readonly actor: AgentFlowActor;
  readonly label: string;
  readonly status: AgentFlowStatus;
  readonly implementationRef: string;
  readonly description: string;
}

export interface AgentFlowActionDefinition {
  readonly actionId: string;
  readonly actor: AgentFlowActor;
  readonly label: string;
  readonly status: AgentFlowStatus;
  readonly authority: AgentFlowAuthority;
  readonly effect: Extract<AgentFlowEffect, 'GOVERNED_ACTION' | 'CHANNEL_REQUEST'>;
  readonly implementationRef: string;
  readonly description: string;
}

export interface AgentFlowEventDefinition {
  readonly eventId: string;
  readonly actor: AgentFlowActor;
  readonly label: string;
  readonly status: AgentFlowStatus;
  readonly eventClass: 'FLOW_RESULT' | 'CORE_EVENT' | 'CHANNEL_EVENT';
  readonly sourceRef: string;
  readonly description: string;
}
