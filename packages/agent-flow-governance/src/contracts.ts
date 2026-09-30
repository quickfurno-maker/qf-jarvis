import type { AgentFlowActor } from '@qf-jarvis/agent-flow-registry';

export const AGENT_FLOW_LIFECYCLE_STAGES = [
  'DRAFT',
  'SIMULATION',
  'TEST',
  'STAGING',
  'LIVE',
  'RETIRED',
] as const;
export type AgentFlowLifecycleStage = (typeof AGENT_FLOW_LIFECYCLE_STAGES)[number];

export const AGENT_FLOW_PROFILE_KINDS = [
  'CONTEXT',
  'PROMPT',
  'MODEL_ROUTING',
  'TOOLS',
  'WAIT',
  'RETRY',
  'HANDOFF',
] as const;
export type AgentFlowProfileKind = (typeof AGENT_FLOW_PROFILE_KINDS)[number];

export interface AgentFlowProfileDefinition {
  readonly profileId: string;
  readonly version: number;
  readonly kind: AgentFlowProfileKind;
  readonly actor: AgentFlowActor;
  readonly label: string;
  readonly implementationRefs: readonly string[];
  readonly configurableFields: readonly string[];
  readonly lockedFields: readonly string[];
  readonly productionEligible: boolean;
  readonly description: string;
}

export interface AgentFlowProfileSet {
  readonly contextProfileRef: string;
  readonly promptProfileRef: string;
  readonly modelRoutingProfileRef: string;
  readonly toolProfileRef: string;
  readonly waitPolicyRef?: string;
  readonly retryPolicyRef?: string;
  readonly handoffPolicyRef?: string;
}
export interface AgentFlowCertificationEvidence {
  readonly lintReportRef: string;
  readonly regressionReportRef: string;
  readonly passedScenarioCount: number;
  readonly failedScenarioCount: number;
  readonly certifiedAt: string;
  readonly certifiedBy: 'REPOSITORY_TESTS' | 'HUMAN_REVIEW';
  /** Exact immutable release identity this evidence certified. */
  readonly versionId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly registryBaselineRef: string;
  readonly configurationDigest: string;
  readonly sourceRevision: string;
  readonly profileSet: AgentFlowProfileSet;
}

export interface AgentFlowVersionManifest {
  readonly versionId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly actor: Exclude<AgentFlowActor, 'SHARED'>;
  readonly lifecycle: AgentFlowLifecycleStage;
  readonly registryBaselineRef: string;
  readonly profileSet: AgentFlowProfileSet;
  readonly configurationDigest: string;
  readonly sourceRevision: string;
  readonly createdAt: string;
  readonly certification?: AgentFlowCertificationEvidence;
  readonly rollbackTargetVersionId?: string;
  readonly notes: string;
}

export const AGENT_FLOW_LINT_SEVERITIES = ['ERROR', 'WARNING'] as const;
export type AgentFlowLintSeverity = (typeof AGENT_FLOW_LINT_SEVERITIES)[number];

export const AGENT_FLOW_LINT_CODES = [
  'FLOW_NOT_READ_ONLY_BASELINE',
  'EFFECTFUL_NODE_WITHOUT_GOVERNED_AUTHORITY',
  'ARBITRARY_IMPLEMENTATION_SURFACE',
  'UNSAFE_RETRY_CONFIG',
  'MISSING_TIMEOUT_CONFIG',
  'MISSING_HUMAN_ESCALATION',
  'UNKNOWN_PROFILE_REF',
  'PROFILE_ACTOR_MISMATCH',
  'PROFILE_NOT_PRODUCTION_ELIGIBLE',
  'LIVE_WITHOUT_CERTIFICATION',
  'LIVE_WITH_REGRESSION_FAILURE',
  'LIVE_WITHOUT_ROLLBACK_TARGET',
] as const;
export type AgentFlowLintCode = (typeof AGENT_FLOW_LINT_CODES)[number];
export interface AgentFlowLintIssue {
  readonly severity: AgentFlowLintSeverity;
  readonly code: AgentFlowLintCode;
  readonly subjectRef: string;
  readonly message: string;
}

export interface AgentFlowLintReport {
  readonly reportId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly errors: number;
  readonly warnings: number;
  readonly issues: readonly AgentFlowLintIssue[];
  readonly promotable: boolean;
}

export interface AgentFlowReplayNodeSpan {
  readonly nodeId: string;
  readonly enteredAt?: string;
  readonly exitedAt?: string;
  readonly durationMs?: number;
  readonly terminalStatus: 'SUCCEEDED' | 'FAILED' | 'OBSERVED' | 'RUNNING';
  readonly resultCode?: string;
  readonly observations: readonly string[];
}

export interface AgentFlowReplayRun {
  readonly traceId: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly actor: Exclude<AgentFlowActor, 'SHARED'>;
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly outcome?: string;
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly nodes: readonly AgentFlowReplayNodeSpan[];
  readonly eventCount: number;
}
export interface AgentFlowVersionDiff {
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly changed: boolean;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | number | undefined;
    readonly after: string | number | undefined;
  }[];
}

export interface AgentFlowPromotionDecision {
  readonly allowed: boolean;
  readonly from: AgentFlowLifecycleStage;
  readonly to: AgentFlowLifecycleStage;
  readonly reasons: readonly string[];
}

export interface AgentFlowRegressionScenarioDefinition {
  readonly scenarioId: string;
  readonly label: string;
  readonly category:
    | 'IDENTITY'
    | 'QUALIFICATION'
    | 'MATCHING'
    | 'VENDOR_JOURNEY'
    | 'RECOVERY'
    | 'CONTEXT_CORRECTION'
    | 'DEPENDENCY_FAILURE'
    | 'HUMAN_HANDOFF';
  readonly expectedDecision: string;
  readonly syntheticInput: Readonly<Record<string, string | number | boolean>>;
  readonly protectedAssertions: readonly string[];
}

export interface AgentFlowRegressionSummary {
  readonly reportId: string;
  readonly protocol: 'qfj.agent-flow-regression.v1';
  readonly candidateRef: string;
  readonly scenarioCount: number;
  readonly passed: number;
  readonly failed: number;
  readonly zeroEffectGuaranteed: boolean;
  readonly failedScenarioIds: readonly string[];
}
