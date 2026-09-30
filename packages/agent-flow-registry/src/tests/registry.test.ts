import { describe, expect, it } from 'vitest';

import {
  AGENT_FLOW_ACTION_CATALOG_V1,
  AGENT_FLOW_EVENT_CATALOG_V1,
  AGENT_FLOW_TRIGGER_CATALOG_V1,
  RIYA_WHATSAPP_CLIENT_FLOW_V1,
  createAgentFlowDefinition,
} from '../index.js';

describe('agent-flow-registry', () => {
  it('publishes the current Riya flow as read-only metadata', () => {
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.actor).toBe('RIYA');
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.nodes.length).toBeGreaterThanOrEqual(16);
    expect(RIYA_WHATSAPP_CLIENT_FLOW_V1.edges.length).toBeGreaterThanOrEqual(20);
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

  it('refuses effectful intelligence nodes', () => {
    expect(() =>
      createAgentFlowDefinition({
        flowId: 'test.invalid',
        flowVersion: 1,
        label: 'invalid',
        actor: 'RIYA',
        status: 'IMPLEMENTED',
        description: 'invalid',
        rootNodeId: 'test.node',
        groups: [
          {
            groupId: 'test.group',
            label: 'Test',
            actor: 'RIYA',
            description: 'Test',
            order: 1,
          },
        ],
        nodes: [
          {
            nodeId: 'test.node',
            nodeVersion: 1,
            label: 'Bad',
            actor: 'RIYA',
            kind: 'INTELLIGENCE',
            executionRole: 'STEP',
            stage: 'UNDERSTAND',
            authority: 'CORE_GOVERNED_ACTION',
            effect: 'GOVERNED_ACTION',
            status: 'IMPLEMENTED',
            implementationRef: 'test.bad',
            description: 'Bad',
            codeLocked: true,
            canvasEditable: [],
            groupId: 'test.group',
            tags: [],
          },
        ],
        edges: [],
      }),
    ).toThrow('agent-flow-intelligence-authority-invalid');
  });
});
