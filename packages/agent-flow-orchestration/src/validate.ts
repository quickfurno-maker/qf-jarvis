import type { AgentFlowDefinition } from '@qf-jarvis/agent-flow-registry';

import {
  AGENT_FLOW_CONDITION_OPERATORS,
  type AgentFlowConditionDefinition,
  type AgentFlowProfileValidation,
  type AgentFlowProfileValidationIssue,
  type AgentFlowSoftOrchestrationProfile,
} from './contracts.js';

const MAX_WAIT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETRY_BACKOFF_MS = 60 * 60 * 1000;
const REF = /^[A-Za-z0-9._:@/-]{1,200}$/u;

function pushUnique(
  issues: AgentFlowProfileValidationIssue[],
  value: AgentFlowProfileValidationIssue,
): void {
  if (!issues.includes(value)) issues.push(value);
}

function conditionShapeValid(condition: AgentFlowConditionDefinition): boolean {
  if (
    !REF.test(condition.conditionId) ||
    !REF.test(condition.signalRef) ||
    !AGENT_FLOW_CONDITION_OPERATORS.includes(condition.operator)
  ) {
    return false;
  }
  if (condition.operator === 'IN') return (condition.values?.length ?? 0) > 0;
  if (condition.operator === 'EQUALS' || condition.operator === 'NOT_EQUALS') {
    return condition.value !== undefined;
  }
  return condition.value === undefined && condition.values === undefined;
}

export function validateAgentFlowSoftOrchestrationProfile(input: {
  readonly flow: AgentFlowDefinition;
  readonly profile: AgentFlowSoftOrchestrationProfile;
}): AgentFlowProfileValidation {
  const issues: AgentFlowProfileValidationIssue[] = [];
  const { flow, profile } = input;
  if (profile.actor !== flow.actor) pushUnique(issues, 'PROFILE_ACTOR_MISMATCH');
  if (profile.flowId !== flow.flowId) pushUnique(issues, 'PROFILE_FLOW_MISMATCH');

  const nodeById = new Map(flow.nodes.map((node) => [node.nodeId, node] as const));
  for (const nodeId of profile.approvedActionNodeIds) {
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      pushUnique(issues, 'UNKNOWN_ACTION_NODE');
      continue;
    }
    const governed =
      node.codeLocked &&
      node.authority === 'CORE_GOVERNED_ACTION' &&
      (node.effect === 'GOVERNED_ACTION' || node.effect === 'CHANNEL_REQUEST');
    if (!governed) pushUnique(issues, 'ACTION_NODE_NOT_GOVERNED');
  }

  const conditionIds = new Set<string>();
  for (const condition of profile.conditions) {
    if (conditionIds.has(condition.conditionId)) pushUnique(issues, 'DUPLICATE_CONDITION');
    conditionIds.add(condition.conditionId);
    if (!conditionShapeValid(condition)) pushUnique(issues, 'UNKNOWN_CONDITION_REF');
  }

  const routeIds = new Set<string>();
  for (const route of profile.routes) {
    if (routeIds.has(route.routeId)) pushUnique(issues, 'DUPLICATE_ROUTE');
    routeIds.add(route.routeId);
    if (!conditionIds.has(route.conditionRef)) pushUnique(issues, 'UNKNOWN_CONDITION_REF');
    if (
      !nodeById.has(route.fromNodeId) ||
      !nodeById.has(route.whenTrueNodeId) ||
      !nodeById.has(route.whenFalseNodeId)
    ) {
      pushUnique(issues, 'UNKNOWN_ROUTE_NODE');
    }
  }

  const waitIds = new Set<string>();
  for (const wait of profile.waits) {
    if (waitIds.has(wait.policyId)) pushUnique(issues, 'DUPLICATE_WAIT_POLICY');
    waitIds.add(wait.policyId);
    if (wait.waitMs < 1_000 || wait.waitMs > MAX_WAIT_MS) {
      pushUnique(issues, 'WAIT_OUT_OF_BOUNDS');
    }
    if (!nodeById.has(wait.expiryFallbackNodeId)) {
      pushUnique(issues, 'FALLBACK_NODE_UNKNOWN');
    }
  }

  const retryIds = new Set<string>();
  for (const retry of profile.retries) {
    if (retryIds.has(retry.policyId)) pushUnique(issues, 'DUPLICATE_RETRY_POLICY');
    retryIds.add(retry.policyId);
    if (
      retry.maxAttempts < 1 ||
      retry.maxAttempts > 5 ||
      retry.backoffMs < 1_000 ||
      retry.backoffMs > MAX_RETRY_BACKOFF_MS
    ) {
      pushUnique(issues, 'RETRY_OUT_OF_BOUNDS');
    }
    if (!nodeById.has(retry.fallbackNodeId)) {
      pushUnique(issues, 'FALLBACK_NODE_UNKNOWN');
    }
  }

  if (!nodeById.has(profile.humanHandoff.fallbackNodeId)) {
    pushUnique(issues, 'FALLBACK_NODE_UNKNOWN');
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    actor: flow.actor,
    flowId: flow.flowId,
  });
}

export function createAgentFlowSoftOrchestrationProfile(input: {
  readonly flow: AgentFlowDefinition;
  readonly profile: AgentFlowSoftOrchestrationProfile;
}): AgentFlowSoftOrchestrationProfile {
  const validation = validateAgentFlowSoftOrchestrationProfile(input);
  if (!validation.valid) throw new TypeError('agent-flow-soft-orchestration-profile-invalid');
  const profile = input.profile;
  return Object.freeze({
    ...profile,
    approvedActionNodeIds: Object.freeze([...profile.approvedActionNodeIds]),
    conditions: Object.freeze(profile.conditions.map((condition) => Object.freeze({ ...condition }))),
    routes: Object.freeze(profile.routes.map((route) => Object.freeze({ ...route }))),
    waits: Object.freeze(profile.waits.map((wait) => Object.freeze({ ...wait }))),
    retries: Object.freeze(profile.retries.map((retry) => Object.freeze({ ...retry }))),
    humanHandoff: Object.freeze({ ...profile.humanHandoff }),
  });
}
