import { describe, expect, it } from 'vitest';

import {
  AGENT_FLOW_ACTION_CATALOG_V1,
  AGENT_FLOW_EVENT_CATALOG_V1,
  AGENT_FLOW_REGISTRY_SCHEMA_VERSION,
  AGENT_FLOW_TRIGGER_CATALOG_V1,
  AAROHI_ACQUISITION_FLOW_V1,
  ANISHA_VENDOR_FLOW_V1,
  RIYA_PHASE3_CONTROLLED_FLOW_V2,
  RIYA_WHATSAPP_CLIENT_FLOW_V1,
  createAgentFlowDefinition,
  type AgentFlowDefinition,
} from '../index.js';

function minimalFlow(): AgentFlowDefinition {
  return {
    registrySchemaVersion: AGENT_FLOW_REGISTRY_SCHEMA_VERSION,
    implementationBaselineRef: 'qf-jarvis@test',
    verifiedAt: '2026-09-30',
    readOnly: true,
    flowId: 'test.flow',
    flowVersion: 1,
    label: 'Test flow',
    actor: 'RIYA',
    status: 'IMPLEMENTED',
    description: 'A minimal read-only registry fixture.',
    rootNodeId: 'test.trigger',
    groups: [
      {
        groupId: 'test.group',
        label: 'Test',
        actor: 'RIYA',
        description: 'Test group',
        order: 1,
      },
    ],
    nodes: [
      {
        nodeId: 'test.trigger',
        nodeVersion: 1,
        label: 'Trigger',
        actor: 'RIYA',
        kind: 'TRIGGER',
        executionRole: 'STEP',
        stage: 'TRIGGER',
        authority: 'ORCHESTRATION_CONTROL',
        effect: 'NONE',
        status: 'IMPLEMENTED',
        implementationRef: 'test.trigger',
        implementationVersionRef: 'qf-jarvis@test',
        description: 'Fixture trigger',
        codeLocked: true,
        canvasEditable: [],
        groupId: 'test.group',
        tags: ['fixture'],
      },
      {
        nodeId: 'test.terminal',
        nodeVersion: 1,
        label: 'Terminal',
        actor: 'RIYA',
        kind: 'SYSTEM',
        executionRole: 'TERMINAL',
        stage: 'WAIT_CONTINUE_CLOSE',
        authority: 'ORCHESTRATION_CONTROL',
        effect: 'NONE',
        status: 'IMPLEMENTED',
        implementationRef: 'test.terminal',
        implementationVersionRef: 'qf-jarvis@test',
        description: 'Fixture terminal',
        codeLocked: true,
        canvasEditable: [],
        groupId: 'test.group',
        tags: ['fixture', 'terminal'],
      },
    ],
    edges: [
      {
        edgeId: 'test.edge',
        sourceNodeId: 'test.trigger',
        targetNodeId: 'test.terminal',
        kind: 'CONTROL',
      },
    ],
  };
}

describe('agent-flow-registry', () => {
  it('publishes the current Riya flow as a versioned read-only projection', () => {
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.actor).toBe('RIYA');
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.readOnly).toBe(true);
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.registrySchemaVersion).toBe(
      AGENT_FLOW_REGISTRY_SCHEMA_VERSION,
    );
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.implementationBaselineRef).toBe('qf-jarvis@2423e3d5');
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.verifiedAt).toBe('2026-09-30');
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.nodes).toHaveLength(18);
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.edges).toHaveLength(24);
  });

  it('binds every Riya node to implementation and implementation-version metadata', () => {
    for (const node of RIYA_WHATSAPP_CLIENT_FLOW_V1.nodes) {
      expect(node.implementationRef.length).toBeGreaterThan(0);
      expect(node.implementationVersionRef).toBe('qf-jarvis@2423e3d5');
      expect(node.nodeVersion).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps effectful production capabilities code locked and Core governed', () => {
    const effectful = RIYA_WHATSAPP_CLIENT_FLOW_V1.nodes.filter(
      (node) => node.effect === 'GOVERNED_ACTION' || node.effect === 'CHANNEL_REQUEST',
    );
    expect(effectful.length).toBeGreaterThan(0);
    for (const node of effectful) {
      expect(node.codeLocked).toBe(true);
      expect(['CORE_GOVERNED_ACTION', 'ORCHESTRATION_CONTROL']).toContain(node.authority);
    }
  });

  it('distinguishes projection nodes from executable runtime steps', () => {
    const lifetime = RIYA_WHATSAPP_CLIENT_FLOW_V1.nodes.find(
      (node) => node.nodeId === 'riya.memory.lifetime',
    );
    expect(lifetime?.executionRole).toBe('PROJECTION');
    expect(lifetime?.effect).toBe('READ_ONLY');
  });

  it('publishes unique ordered visual groups for the current Riya journey', () => {
    const ids = RIYA_WHATSAPP_CLIENT_FLOW_V1.groups.map((group) => group.groupId);
    const orders = RIYA_WHATSAPP_CLIENT_FLOW_V1.groups.map((group) => group.order);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(ids).toEqual([
      'riya.inbound',
      'riya.context',
      'riya.pre-agent-actions',
      'riya.intelligence',
      'riya.response',
    ]);
  });

  it('publishes the Phase 3 Riya graph with controlled orchestration still shadowed', () => {
    expect(RIYA_PHASE3_CONTROLLED_FLOW_V2.actor).toBe('RIYA');
    expect(RIYA_PHASE3_CONTROLLED_FLOW_V2.status).toBe('SHADOW');
    expect(RIYA_PHASE3_CONTROLLED_FLOW_V2.nodes).toHaveLength(22);
    expect(RIYA_PHASE3_CONTROLLED_FLOW_V2.groups.map((group) => group.groupId)).toContain(
      'riya.orchestration',
    );
    expect(
      RIYA_PHASE3_CONTROLLED_FLOW_V2.nodes
        .filter((node) => node.groupId === 'riya.orchestration')
        .map((node) => node.status),
    ).toEqual(['SHADOW', 'SHADOW', 'SHADOW', 'DISABLED']);
  });

  it.each([
    ['ANISHA', ANISHA_VENDOR_FLOW_V1],
    ['AAROHI', AAROHI_ACQUISITION_FLOW_V1],
  ] as const)('publishes a code-backed %s Phase 3 graph', (actor, flow) => {
    expect(flow.actor).toBe(actor);
    expect(flow.status).toBe('SHADOW');
    expect(flow.nodes).toHaveLength(13);
    expect(flow.edges).toHaveLength(15);
    expect(flow.groups).toHaveLength(5);
    for (const node of flow.nodes) {
      expect(node.implementationRef.length).toBeGreaterThan(0);
      expect(node.implementationVersionRef).toBe(
        'qf-jarvis@f663d9b7df64ebc916ce260a8ac00c99ada757f6',
      );
    }
  });

  it('keeps all Phase 3 effectful nodes code locked behind Core governance', () => {
    for (const flow of [
      RIYA_PHASE3_CONTROLLED_FLOW_V2,
      ANISHA_VENDOR_FLOW_V1,
      AAROHI_ACQUISITION_FLOW_V1,
    ]) {
      for (const node of flow.nodes.filter(
        (candidate) =>
          candidate.effect === 'GOVERNED_ACTION' || candidate.effect === 'CHANNEL_REQUEST',
      )) {
        expect(node.codeLocked).toBe(true);
        expect(node.authority).toBe('CORE_GOVERNED_ACTION');
      }
    }
  });

  it('does not expose arbitrary code, SQL or HTTP nodes in the approved catalogs', () => {
    const serialized = JSON.stringify({
      triggers: AGENT_FLOW_TRIGGER_CATALOG_V1,
      actions: AGENT_FLOW_ACTION_CATALOG_V1,
      events: AGENT_FLOW_EVENT_CATALOG_V1,
    }).toLowerCase();
    expect(serialized).not.toContain('arbitrary javascript');
    expect(serialized).not.toContain('arbitrary sql');
    expect(serialized).not.toContain('unrestricted http');
  });

  it('version-binds trigger, action and event catalog entries', () => {
    for (const trigger of AGENT_FLOW_TRIGGER_CATALOG_V1) {
      expect(trigger.implementationVersionRef).toBe('qf-jarvis@2423e3d5');
    }
    for (const action of AGENT_FLOW_ACTION_CATALOG_V1) {
      expect(action.implementationVersionRef).toBe('qf-jarvis@2423e3d5');
    }
    for (const event of AGENT_FLOW_EVENT_CATALOG_V1) {
      expect(event.sourceVersionRef).toBe('qf-jarvis@2423e3d5');
    }
  });

  it('refuses effectful intelligence nodes', () => {
    const fixture = minimalFlow();
    const trigger = fixture.nodes.find((node) => node.nodeId === 'test.trigger');
    const terminal = fixture.nodes.find((node) => node.nodeId === 'test.terminal');
    if (trigger === undefined || terminal === undefined) throw new Error('fixture-invalid');
    const badNode = {
      ...trigger,
      nodeId: 'test.bad',
      label: 'Bad',
      kind: 'INTELLIGENCE' as const,
      stage: 'UNDERSTAND' as const,
      authority: 'CORE_GOVERNED_ACTION' as const,
      effect: 'GOVERNED_ACTION' as const,
      implementationRef: 'test.bad',
    };

    expect(() =>
      createAgentFlowDefinition({
        ...fixture,
        rootNodeId: 'test.bad',
        nodes: [badNode, terminal],
        edges: [
          {
            edgeId: 'test.bad-edge',
            sourceNodeId: 'test.bad',
            targetNodeId: 'test.terminal',
            kind: 'CONTROL',
          },
        ],
      }),
    ).toThrow('agent-flow-intelligence-authority-invalid');
  });

  it('refuses orphaned nodes', () => {
    const fixture = minimalFlow();
    const terminal = fixture.nodes.find((node) => node.nodeId === 'test.terminal');
    if (terminal === undefined) throw new Error('fixture-invalid');
    expect(() =>
      createAgentFlowDefinition({
        ...fixture,
        nodes: [
          ...fixture.nodes,
          {
            ...terminal,
            nodeId: 'test.orphan',
            implementationRef: 'test.orphan',
          },
        ],
      }),
    ).toThrow('agent-flow-node-unreachable');
  });

  it('refuses outgoing edges from terminal nodes', () => {
    const fixture = minimalFlow();
    expect(() =>
      createAgentFlowDefinition({
        ...fixture,
        edges: [
          ...fixture.edges,
          {
            edgeId: 'test.terminal-out',
            sourceNodeId: 'test.terminal',
            targetNodeId: 'test.trigger',
            kind: 'CONTROL',
          },
        ],
      }),
    ).toThrow('agent-flow-terminal-has-outgoing-edge');
  });
});
