import {
  AGENT_FLOW_ACTORS,
  AGENT_FLOW_AUTHORITIES,
  AGENT_FLOW_CANVAS_CONFIG_KEYS,
  AGENT_FLOW_EDGE_KINDS,
  AGENT_FLOW_EFFECTS,
  AGENT_FLOW_EXECUTION_ROLES,
  AGENT_FLOW_NODE_KINDS,
  AGENT_FLOW_REGISTRY_SCHEMA_VERSION,
  AGENT_FLOW_STAGES,
  AGENT_FLOW_STATUSES,
  type AgentFlowDefinition,
  type AgentFlowNodeDefinition,
} from './contracts.js';

const REF = /^[A-Za-z0-9._:@/-]{1,200}$/u;
const VERIFIED_DATE = /^\d{4}-\d{2}-\d{2}$/u;

type AgentFlowDefinitionInput = Omit<AgentFlowDefinition, 'registrySchemaVersion' | 'readOnly'> & {
  readonly registrySchemaVersion: number;
  readonly readOnly: boolean;
};

function assertRef(value: string, reason: string): void {
  if (!REF.test(value)) throw new TypeError(reason);
}

function assertText(value: string, reason: string): void {
  if (value.trim().length === 0) throw new TypeError(reason);
}

function validateNode(node: AgentFlowNodeDefinition): void {
  assertRef(node.nodeId, 'agent-flow-node-id-invalid');
  assertRef(node.implementationRef, 'agent-flow-node-implementation-invalid');
  assertRef(node.implementationVersionRef, 'agent-flow-node-version-ref-invalid');
  assertRef(node.groupId, 'agent-flow-node-group-invalid');
  assertText(node.label, 'agent-flow-node-label-invalid');
  assertText(node.description, 'agent-flow-node-description-invalid');
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
  if (new Set(node.canvasEditable).size !== node.canvasEditable.length) {
    throw new TypeError('agent-flow-node-canvas-editable-duplicate');
  }
  if (new Set(node.tags).size !== node.tags.length) {
    throw new TypeError('agent-flow-node-tag-duplicate');
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

function assertReachable(
  input: Pick<AgentFlowDefinition, 'rootNodeId' | 'nodes' | 'edges'>,
): void {
  const adjacency = new Map<string, string[]>();
  for (const node of input.nodes) adjacency.set(node.nodeId, []);
  for (const edge of input.edges) adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);

  const visited = new Set<string>();
  const queue = [input.rootNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const target of adjacency.get(current) ?? []) {
      if (!visited.has(target)) queue.push(target);
    }
  }

  const orphan = input.nodes.find((node) => !visited.has(node.nodeId));
  if (orphan !== undefined) throw new TypeError('agent-flow-node-unreachable');
}

export function createAgentFlowDefinition(input: AgentFlowDefinitionInput): AgentFlowDefinition {
  if (input.registrySchemaVersion !== AGENT_FLOW_REGISTRY_SCHEMA_VERSION) {
    throw new TypeError('agent-flow-registry-schema-version-invalid');
  }
  if (!input.readOnly) throw new TypeError('agent-flow-read-only-contract-invalid');
  assertRef(input.flowId, 'agent-flow-id-invalid');
  assertRef(input.rootNodeId, 'agent-flow-root-invalid');
  assertRef(input.implementationBaselineRef, 'agent-flow-baseline-ref-invalid');
  assertText(input.label, 'agent-flow-label-invalid');
  assertText(input.description, 'agent-flow-description-invalid');
  if (!VERIFIED_DATE.test(input.verifiedAt)) throw new TypeError('agent-flow-verified-at-invalid');
  if (!Number.isInteger(input.flowVersion) || input.flowVersion < 1) {
    throw new TypeError('agent-flow-version-invalid');
  }
  if (!AGENT_FLOW_STATUSES.includes(input.status)) {
    throw new TypeError('agent-flow-status-invalid');
  }

  const groupIds = new Set<string>();
  const groupOrders = new Set<number>();
  for (const group of input.groups) {
    assertRef(group.groupId, 'agent-flow-group-id-invalid');
    assertText(group.label, 'agent-flow-group-label-invalid');
    assertText(group.description, 'agent-flow-group-description-invalid');
    if (!AGENT_FLOW_ACTORS.includes(group.actor)) throw new TypeError('agent-flow-group-actor-invalid');
    if (!Number.isInteger(group.order) || group.order < 0) {
      throw new TypeError('agent-flow-group-order-invalid');
    }
    if (groupIds.has(group.groupId)) throw new TypeError('agent-flow-group-duplicate');
    if (groupOrders.has(group.order)) throw new TypeError('agent-flow-group-order-duplicate');
    groupIds.add(group.groupId);
    groupOrders.add(group.order);
  }

  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    validateNode(node);
    if (nodeIds.has(node.nodeId)) throw new TypeError('agent-flow-node-duplicate');
    if (!groupIds.has(node.groupId)) throw new TypeError('agent-flow-node-group-unknown');
    nodeIds.add(node.nodeId);
  }
  if (!nodeIds.has(input.rootNodeId)) throw new TypeError('agent-flow-root-unknown');

  const root = input.nodes.find((node) => node.nodeId === input.rootNodeId);
  if (root?.kind !== 'TRIGGER') throw new TypeError('agent-flow-root-not-trigger');

  const edgeIds = new Set<string>();
  const edgeSignatures = new Set<string>();
  for (const edge of input.edges) {
    assertRef(edge.edgeId, 'agent-flow-edge-id-invalid');
    if (edge.conditionRef !== undefined) {
      assertRef(edge.conditionRef, 'agent-flow-edge-condition-invalid');
    }
    if (!AGENT_FLOW_EDGE_KINDS.includes(edge.kind)) {
      throw new TypeError('agent-flow-edge-kind-invalid');
    }
    if (edgeIds.has(edge.edgeId)) throw new TypeError('agent-flow-edge-duplicate');
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
      throw new TypeError('agent-flow-edge-node-unknown');
    }
    const signature = [edge.sourceNodeId, edge.targetNodeId, edge.kind, edge.conditionRef ?? ''].join('|');
    if (edgeSignatures.has(signature)) throw new TypeError('agent-flow-edge-semantic-duplicate');
    edgeIds.add(edge.edgeId);
    edgeSignatures.add(signature);
  }

  const terminalIds = new Set(
    input.nodes.filter((node) => node.executionRole === 'TERMINAL').map((node) => node.nodeId),
  );
  if (terminalIds.size === 0) throw new TypeError('agent-flow-terminal-missing');
  if (input.edges.some((edge) => terminalIds.has(edge.sourceNodeId))) {
    throw new TypeError('agent-flow-terminal-has-outgoing-edge');
  }

  assertReachable(input);

  return Object.freeze({
    ...input,
    registrySchemaVersion: AGENT_FLOW_REGISTRY_SCHEMA_VERSION,
    readOnly: true,
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
