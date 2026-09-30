import { describe, expect, it } from 'vitest';

import {
  AGENT_FLOW_TRACE_PROTOCOL,
  AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
  parseAgentFlowTraceEvent,
  parseAgentFlowTraceSnapshot,
} from '../index.js';

const event = {
  protocol: AGENT_FLOW_TRACE_PROTOCOL,
  traceId: '11111111-1111-4111-8111-111111111111',
  flowId: 'agent-flow.riya.whatsapp-client.v1',
  flowVersion: 1,
  actor: 'RIYA',
  conversationId: '22222222-2222-4222-8222-222222222222',
  inboundMessageId: '11111111-1111-4111-8111-111111111111',
  sequence: 1,
  kind: 'NODE_ENTERED',
  nodeId: 'riya.context.turn-material',
  status: 'RUNNING',
  at: '2026-09-30T10:00:00.000Z',
} as const;

describe('agent-flow-trace-contract', () => {
  it('accepts bounded content-free node execution metadata', () => {
    expect(parseAgentFlowTraceEvent(event)).toStrictEqual(event);
  });

  it('requires node ids only for node events', () => {
    expect(() =>
      parseAgentFlowTraceEvent({
        ...event,
        kind: 'NODE_ENTERED',
        nodeId: undefined,
      }),
    ).toThrow();

    expect(() =>
      parseAgentFlowTraceEvent({
        ...event,
        kind: 'RUN_STARTED',
        status: 'RUNNING',
      }),
    ).toThrow();
  });

  it('enforces event/status semantics', () => {
    expect(() =>
      parseAgentFlowTraceEvent({
        ...event,
        kind: 'NODE_OBSERVED',
        status: 'SUCCEEDED',
      }),
    ).toThrow();

    expect(() =>
      parseAgentFlowTraceEvent({
        ...event,
        kind: 'NODE_EXITED',
        status: 'OBSERVED',
      }),
    ).toThrow();
  });

  it('rejects payload, prompt and message-content fields', () => {
    expect(() =>
      parseAgentFlowTraceEvent({
        ...event,
        prompt: 'hidden prompt',
      }),
    ).toThrow();

    expect(() =>
      parseAgentFlowTraceEvent({
        ...event,
        messageText: 'customer content',
      }),
    ).toThrow();
  });

  it('parses a bounded immutable-shape snapshot envelope', () => {
    const parsed = parseAgentFlowTraceSnapshot({
      protocol: AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
      emittedAt: '2026-09-30T10:00:01.000Z',
      sourceRevision: '72fc4e3568edd71fca86a923544d9c29208fbde1',
      events: [event],
    });
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]?.nodeId).toBe('riya.context.turn-material');
  });

  it('refuses unbounded trace snapshots', () => {
    expect(() =>
      parseAgentFlowTraceSnapshot({
        protocol: AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
        emittedAt: '2026-09-30T10:00:01.000Z',
        sourceRevision: '72fc4e3568edd71fca86a923544d9c29208fbde1',
        events: Array.from({ length: 513 }, (_, index) => ({
          ...event,
          sequence: index,
        })),
      }),
    ).toThrow();
  });
});
