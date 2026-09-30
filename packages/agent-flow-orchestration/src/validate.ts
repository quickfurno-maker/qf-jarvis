import {
  AGENT_FLOW_EVENT_CATALOG_V1,
  type AgentFlowDefinition,
  type AgentFlowNodeDefinition,
} from '@qf-jarvis/agent-flow-registry';

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

function safeFallbackNode(node: AgentFlowNodeDefinition | undefined): boolean {
  return node !== undefined && (node.kind === 'HUMAN' || node.executionRole === 'TERMINAL');
}

export function validateAgentFlowSoftOrchestrationProfile(input: {
  readonly flow: AgentFlowDefinition;
  readonly profile: AgentFlowSoftOrchestrationProfile;
}): AgentFlowProfileValidation {
  const issues: AgentFlowProfileValidationIssue[] = [];
  const { flow, profile } = input;
  if (profile.actor !== flow.actor) pushUnique(issues, 'PROFILE_ACTOR_MISMATCH');
  if (profile.flowId !== flow.flowId) pushUnique(issues, 'PROFILE_FLOW_MISMATCH');
  if (profile.implementationVersionRef !== flow.implementationBaselineRef) {
    pushUnique(issues, 'PROFILE_BASELINE_MISMATCH');
  }

  const nodeById = new Map(flow.nodes.map((node) => [node.nodeId, node] as const));
  const actionIds = new Set<string>();
  for (const nodeId of profile.approvedActionNodeIds) {
    if (actionIds.has(nodeId)) pushUnique(issues, 'DUPLICATE_ACTION_NODE');
    actionIds.add(nodeId);
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

  const conditionalEdges = flow.edges.filter((edge) => edge.conditionRef !== undefined);
  const conditionalEdgesByRef = new Map<string, typeof conditionalEdges>();
  for (const edge of conditionalEdges) {
    const ref = edge.conditionRef;
    if (ref === undefined) continue;
    const bucket = conditionalEdgesByRef.get(ref) ?? [];
    bucket.push(edge);
    conditionalEdgesByRef.set(ref, bucket);
  }
  for (const conditionId of conditionIds) {
    if ((conditionalEdgesByRef.get(conditionId)?.length ?? 0) !== 1) {
      pushUnique(issues, 'CONDITION_EDGE_MISSING');
    }
  }

  const routeIds = new Set<string>();
  const routedConditions = new Set<string>();
  for (const route of profile.routes) {
    if (routeIds.has(route.routeId)) pushUnique(issues, 'DUPLICATE_ROUTE');
    routeIds.add(route.routeId);
    if (routedConditions.has(route.conditionRef)) pushUnique(issues, 'DUPLICATE_ROUTE');
    routedConditions.add(route.conditionRef);
    if (!conditionIds.has(route.conditionRef)) pushUnique(issues, 'UNKNOWN_CONDITION_REF');
    if (
      !nodeById.has(route.fromNodeId) ||
      !nodeById.has(route.whenTrueNodeId) ||
      !nodeById.has(route.whenFalseNodeId)
    ) {
      pushUnique(issues, 'UNKNOWN_ROUTE_NODE');
      continue;
    }
    const matchingEdge = conditionalEdgesByRef.get(route.conditionRef)?.[0];
    const outgoingTargets = new Set(
      flow.edges
        .filter((edge) => edge.sourceNodeId === route.fromNodeId)
        .map((edge) => edge.targetNodeId),
    );
    if (matchingEdge === undefined) {
      pushUnique(issues, 'ROUTE_EDGE_MISMATCH');
      continue;
    }
    if (
      matchingEdge.sourceNodeId !== route.fromNodeId ||
      matchingEdge.targetNodeId !== route.whenTrueNodeId ||
      !outgoingTargets.has(route.whenFalseNodeId)
    ) {
      pushUnique(issues, 'ROUTE_EDGE_MISMATCH');
    }
  }
  for (const conditionId of conditionIds) {
    if (!routedConditions.has(conditionId)) pushUnique(issues, 'CONDITION_ROUTE_MISSING');
  }

  const waitIds = new Set<string>();
  for (const wait of profile.waits) {
    if (waitIds.has(wait.policyId)) pushUnique(issues, 'DUPLICATE_WAIT_POLICY');
    waitIds.add(wait.policyId);
    if (wait.waitMs < 1_000 || wait.waitMs > MAX_WAIT_MS) {
      pushUnique(issues, 'WAIT_OUT_OF_BOUNDS');
    }
    const fallback = nodeById.get(wait.expiryFallbackNodeId);
    if (fallback === undefined) {
      pushUnique(issues, 'FALLBACK_NODE_UNKNOWN');
    } else if (!safeFallbackNode(fallback)) {
      pushUnique(issues, 'FALLBACK_NODE_UNSAFE');
    }
    const resumeEvent = AGENT_FLOW_EVENT_CATALOG_V1.find(
      (event) => event.eventId === wait.resumeEventRef,
    );
    if (resumeEvent === undefined) {
      pushUnique(issues, 'RESUME_EVENT_UNKNOWN');
    } else if (resumeEvent.actor !== profile.actor && resumeEvent.actor !== 'SHARED') {
      pushUnique(issues, 'RESUME_EVENT_ACTOR_MISMATCH');
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
    const fallback = nodeById.get(retry.fallbackNodeId);
    if (fallback === undefined) {
      pushUnique(issues, 'FALLBACK_NODE_UNKNOWN');
    } else if (!safeFallbackNode(fallback)) {
      pushUnique(issues, 'FALLBACK_NODE_UNSAFE');
    }
  }

  const handoffFallback = nodeById.get(profile.humanHandoff.fallbackNodeId);
  if (handoffFallback === undefined) {
    pushUnique(issues, 'FALLBACK_NODE_UNKNOWN');
  } else if (!safeFallbackNode(handoffFallback)) {
    pushUnique(issues, 'FALLBACK_NODE_UNSAFE');
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
    conditions: Object.freeze(
      profile.conditions.map((condition) => Object.freeze({ ...condition })),
    ),
    routes: Object.freeze(profile.routes.map((route) => Object.freeze({ ...route }))),
    waits: Object.freeze(profile.waits.map((wait) => Object.freeze({ ...wait }))),
    retries: Object.freeze(profile.retries.map((retry) => Object.freeze({ ...retry }))),
    humanHandoff: Object.freeze({ ...profile.humanHandoff }),
  });
}
