import {
  AGENT_FLOW_ACTORS,
  AGENT_FLOW_AUTHORITIES,
  AGENT_FLOW_CANVAS_CONFIG_KEYS,
  AGENT_FLOW_EDGE_KINDS,
  AGENT_FLOW_EFFECTS,
  AGENT_FLOW_EXECUTION_ROLES,
  AGENT_FLOW_NODE_KINDS,
  AGENT_FLOW_STAGES,
  AGENT_FLOW_STATUSES,
  type AgentFlowDefinition,
  type AgentFlowNodeDefinition,
} from './contracts.js';

const REF = /^[A-Za-z0-9._:-]{1,160}$/u;

function assertRef(value: string, reason: string): void {
  if (!REF.test(value)) throw new TypeError(reason);
}

function validateNode(node: AgentFlowNodeDefinition): void {
  assertRef(node.nodeId, 'agent-flow-node-id-invalid');
  assertRef(node.implementationRef, 'agent-flow-node-implementation-invalid');
  assertRef(node.groupId, 'agent-flow-node-group-invalid');
  if (!Number.isInteger(node.nodeVersion) || node.nodeVersion < 1) {
    throw new TypeError('agent-flow-node-version-invalid');
  }
  if (
    !AGENT_FLOW_ACTORS.includes(node.actor) ||
    !AGENT_FLOW_NODE_KINDS.includes(node.kind) ||
    !AGENT_FLOW_EXECUTION_ROLES.includes(node.executionRole) ||
    !AGENT_FLOW_STAGES.includes(node.stage) ||
    !AGENT_FLOW_AUTHORITIES.includes(node.authority) ||
    !AGENT_FLOW_EFFECTS.includes(node.effect) ||
    !AGENT_FLOW_STATUSES.includes(node.status) ||
    node.canvasEditable.some((key) => !AGENT_FLOW_CANVAS_CONFIG_KEYS.includes(key))
  ) {
    throw new TypeError('agent-flow-node-vocabulary-invalid');
  }
  if (
    (node.effect === 'GOVERNED_ACTION' || node.effect === 'CHANNEL_REQUEST') &&
    (!node.codeLocked ||
      (node.authority !== 'CORE_GOVERNED_ACTION' && node.authority !== 'ORCHESTRATION_CONTROL'))
  ) {
    throw new TypeError('agent-flow-effectful-node-not-guarded');
  }
  if (
    node.kind === 'INTELLIGENCE' &&
    (node.authority === 'CORE_GOVERNED_ACTION' || node.effect === 'GOVERNED_ACTION')
  ) {
    throw new TypeError('agent-flow-intelligence-authority-invalid');
  }
}

export function createAgentFlowDefinition(input: AgentFlowDefinition): AgentFlowDefinition {
  assertRef(input.flowId, 'agent-flow-id-invalid');
  assertRef(input.rootNodeId, 'agent-flow-root-invalid');
  if (!Number.isInteger(input.flowVersion) || input.flowVersion < 1) {
    throw new TypeError('agent-flow-version-invalid');
  }
  if (!AGENT_FLOW_STATUSES.includes(input.status)) {
    throw new TypeError('agent-flow-status-invalid');
  }

  const groupIds = new Set<string>();
  for (const group of input.groups) {
    assertRef(group.groupId, 'agent-flow-group-id-invalid');
    if (groupIds.has(group.groupId)) throw new TypeError('agent-flow-group-duplicate');
    groupIds.add(group.groupId);
  }

  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    validateNode(node);
    if (nodeIds.has(node.nodeId)) throw new TypeError('agent-flow-node-duplicate');
    if (!groupIds.has(node.groupId)) throw new TypeError('agent-flow-node-group-unknown');
    nodeIds.add(node.nodeId);
  }
  if (!nodeIds.has(input.rootNodeId)) throw new TypeError('agent-flow-root-unknown');

  const edgeIds = new Set<string>();
  for (const edge of input.edges) {
    assertRef(edge.edgeId, 'agent-flow-edge-id-invalid');
    if (!AGENT_FLOW_EDGE_KINDS.includes(edge.kind)) {
      throw new TypeError('agent-flow-edge-kind-invalid');
    }
    if (edgeIds.has(edge.edgeId)) throw new TypeError('agent-flow-edge-duplicate');
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      throw new TypeError('agent-flow-edge-node-unknown');
    }
    edgeIds.add(edge.edgeId);
  }

  return Object.freeze({
    ...input,
    groups: Object.freeze(input.groups.map((group) => Object.freeze({ ...group }))),
    nodes: Object.freeze(
      input.nodes.map((node) =>
        Object.freeze({
          ...node,
          canvasEditable: Object.freeze([...node.canvasEditable]),
          tags: Object.freeze([...node.tags]),
        }),
      ),
    ),
    edges: Object.freeze(input.edges.map((edge) => Object.freeze({ ...edge }))),
  });
}
