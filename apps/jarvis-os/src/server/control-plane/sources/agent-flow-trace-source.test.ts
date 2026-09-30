import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_FLOW_TRACE_PROTOCOL,
  AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
} from '@qf-jarvis/agent-flow-trace-contract';
import { afterEach, describe, expect, it } from 'vitest';

import { readAgentFlowTraceSnapshot } from './agent-flow-trace-source';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('agent flow trace read source', () => {
  it('reports optional configuration absence without throwing', async () => {
    await expect(readAgentFlowTraceSnapshot(undefined)).resolves.toStrictEqual({
      available: false,
      reason: 'NOT_CONFIGURED',
    });
  });

  it('parses the bounded content-free snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qfj-jos-flow-trace-'));
    roots.push(root);
    const filePath = join(root, 'trace.json');
    const emittedAt = new Date().toISOString();
    await writeFile(
      filePath,
      JSON.stringify({
        protocol: AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
        emittedAt,
        sourceRevision: '72fc4e3568edd71fca86a923544d9c29208fbde1',
        events: [
          {
            protocol: AGENT_FLOW_TRACE_PROTOCOL,
            traceId: '33333333-3333-4333-8333-333333333333',
            flowId: 'agent-flow.riya.whatsapp-client.v1',
            flowVersion: 1,
            actor: 'RIYA',
            conversationId: '22222222-2222-4222-8222-222222222222',
            inboundMessageId: '33333333-3333-4333-8333-333333333333',
            sequence: 0,
            kind: 'NODE_OBSERVED',
            nodeId: 'riya.queue.claim-turn',
            status: 'OBSERVED',
            at: emittedAt,
            resultCode: 'claimed',
          },
        ],
      }),
      'utf8',
    );

    const result = await readAgentFlowTraceSnapshot(filePath);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.freshness).toBe('LIVE');
      expect(result.snapshot.events[0]?.nodeId).toBe('riya.queue.claim-turn');
    }
  });

  it('rejects malformed or content-bearing snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qfj-jos-flow-trace-'));
    roots.push(root);
    const filePath = join(root, 'trace.json');
    await writeFile(filePath, JSON.stringify({ messageText: 'must never be accepted' }), 'utf8');

    await expect(readAgentFlowTraceSnapshot(filePath)).resolves.toStrictEqual({
      available: false,
      reason: 'SOURCE_UNUSABLE',
    });
  });
});
