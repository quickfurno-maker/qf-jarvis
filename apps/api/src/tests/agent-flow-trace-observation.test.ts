import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_FLOW_TRACE_PROTOCOL,
  parseAgentFlowTraceSnapshot,
  type AgentFlowTraceEvent,
} from '@qf-jarvis/agent-flow-trace-contract';
import { afterEach, describe, expect, it } from 'vitest';

import { createAgentFlowTraceObservationWriter } from '../quickfurno-whatsapp/agent-flow-trace-observation.js';

const roots: string[] = [];

function traceEvent(sequence: number): AgentFlowTraceEvent {
  return Object.freeze({
    protocol: AGENT_FLOW_TRACE_PROTOCOL,
    traceId: '33333333-3333-4333-8333-333333333333',
    flowId: 'agent-flow.riya.whatsapp-client.v1',
    flowVersion: 1,
    actor: 'RIYA',
    conversationId: '22222222-2222-4222-8222-222222222222',
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    sequence,
    kind: 'NODE_OBSERVED',
    nodeId: 'riya.queue.claim-turn',
    status: 'OBSERVED',
    at: '2026-09-30T10:00:00.000Z',
    resultCode: 'claimed',
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('agent-flow trace observation writer', () => {
  it('writes a content-free snapshot atomically at the configured path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qfj-flow-trace-'));
    roots.push(root);
    const filePath = join(root, 'trace', 'riya.json');
    const writer = createAgentFlowTraceObservationWriter({
      filePath,
      sourceRevision: '72fc4e3568edd71fca86a923544d9c29208fbde1',
    });

    writer.record(traceEvent(0));
    await writer.write('2026-09-30T10:00:01.000Z');

    const snapshot = parseAgentFlowTraceSnapshot(
      JSON.parse(await readFile(filePath, { encoding: 'utf8' })),
    );
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.nodeId).toBe('riya.queue.claim-turn');
  });

  it('rehydrates same-revision trace history across writer restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qfj-flow-trace-'));
    roots.push(root);
    const filePath = join(root, 'trace.json');
    const config = {
      filePath,
      sourceRevision: '72fc4e3568edd71fca86a923544d9c29208fbde1',
    };

    const first = createAgentFlowTraceObservationWriter(config);
    first.record(traceEvent(0));
    await first.write('2026-09-30T10:00:01.000Z');

    const second = createAgentFlowTraceObservationWriter(config);
    second.record({ ...traceEvent(1), traceId: '44444444-4444-4444-8444-444444444444' });
    await second.write('2026-09-30T10:00:02.000Z');

    const snapshot = parseAgentFlowTraceSnapshot(
      JSON.parse(await readFile(filePath, { encoding: 'utf8' })),
    );
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.map((event) => event.traceId)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]);
  });

  it('does not misattribute history from a different source revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qfj-flow-trace-'));
    roots.push(root);
    const filePath = join(root, 'trace.json');

    const first = createAgentFlowTraceObservationWriter({
      filePath,
      sourceRevision: '1111111111111111111111111111111111111111',
    });
    first.record(traceEvent(0));
    await first.write('2026-09-30T10:00:01.000Z');

    const second = createAgentFlowTraceObservationWriter({
      filePath,
      sourceRevision: '2222222222222222222222222222222222222222',
    });
    second.record({ ...traceEvent(1), traceId: '44444444-4444-4444-8444-444444444444' });
    await second.write('2026-09-30T10:00:02.000Z');

    const snapshot = parseAgentFlowTraceSnapshot(
      JSON.parse(await readFile(filePath, { encoding: 'utf8' })),
    );
    expect(snapshot.sourceRevision).toBe('2222222222222222222222222222222222222222');
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.traceId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('retains only the newest 512 events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qfj-flow-trace-'));
    roots.push(root);
    const filePath = join(root, 'trace.json');
    const writer = createAgentFlowTraceObservationWriter({
      filePath,
      sourceRevision: '72fc4e3568edd71fca86a923544d9c29208fbde1',
    });

    for (let sequence = 0; sequence < 513; sequence += 1) writer.record(traceEvent(sequence));
    await writer.write('2026-09-30T10:00:01.000Z');

    const snapshot = parseAgentFlowTraceSnapshot(
      JSON.parse(await readFile(filePath, { encoding: 'utf8' })),
    );
    expect(snapshot.events).toHaveLength(512);
    expect(snapshot.events[0]?.sequence).toBe(1);
    expect(snapshot.events.at(-1)?.sequence).toBe(512);
  });
});
