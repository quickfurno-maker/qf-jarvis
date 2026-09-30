import type {
  AgentFlowTraceEvent,
  AgentFlowTraceSnapshot,
} from '@qf-jarvis/agent-flow-trace-contract';

import type { AgentFlowReplayNodeSpan, AgentFlowReplayRun } from './contracts.js';

function durationMs(start: string | undefined, end: string | undefined): number | undefined {
  if (start === undefined || end === undefined) return undefined;
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function terminalNodeStatus(
  events: readonly AgentFlowTraceEvent[],
): AgentFlowReplayNodeSpan['terminalStatus'] {
  const last = events.at(-1);
  if (last === undefined) return 'RUNNING';
  if (last.status === 'FAILED') return 'FAILED';
  if (last.status === 'SUCCEEDED') return 'SUCCEEDED';
  if (last.status === 'OBSERVED') return 'OBSERVED';
  return 'RUNNING';
}

function nodeSpan(nodeId: string, events: readonly AgentFlowTraceEvent[]): AgentFlowReplayNodeSpan {
  const entered = events.find((event) => event.kind === 'NODE_ENTERED');
  const exited = [...events].reverse().find((event) => event.kind === 'NODE_EXITED');
  const observed = [...events].reverse().find((event) => event.kind === 'NODE_OBSERVED');
  const terminal = exited ?? observed ?? events.at(-1);
  const spanDuration = durationMs(entered?.at, exited?.at);
  const observations = events.flatMap((event) =>
    event.kind === 'NODE_OBSERVED' && event.resultCode !== undefined ? [event.resultCode] : [],
  );

  return Object.freeze({
    nodeId,
    ...(entered === undefined ? {} : { enteredAt: entered.at }),
    ...(exited === undefined ? {} : { exitedAt: exited.at }),
    ...(spanDuration === undefined ? {} : { durationMs: spanDuration }),
    terminalStatus: terminalNodeStatus(events),
    ...(terminal?.resultCode === undefined ? {} : { resultCode: terminal.resultCode }),
    observations: Object.freeze(observations),
  });
}
function replayRun(events: readonly AgentFlowTraceEvent[]): AgentFlowReplayRun {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const first = ordered[0];
  if (first === undefined) throw new TypeError('agent-flow-replay-empty-run');

  const started = ordered.find((event) => event.kind === 'RUN_STARTED');
  const completed = [...ordered].reverse().find((event) => event.kind === 'RUN_COMPLETED');
  const byNode = new Map<string, AgentFlowTraceEvent[]>();
  for (const event of ordered) {
    if (event.nodeId === undefined) continue;
    const bucket = byNode.get(event.nodeId) ?? [];
    bucket.push(event);
    byNode.set(event.nodeId, bucket);
  }

  const nodes = [...byNode.entries()]
    .map(([nodeId, nodeEvents]) => nodeSpan(nodeId, nodeEvents))
    .sort((left, right) => {
      const leftAt = left.enteredAt ?? left.exitedAt ?? '';
      const rightAt = right.enteredAt ?? right.exitedAt ?? '';
      return leftAt.localeCompare(rightAt);
    });
  const status =
    completed?.status === 'FAILED'
      ? ('FAILED' as const)
      : completed?.status === 'SUCCEEDED'
        ? ('SUCCEEDED' as const)
        : ('RUNNING' as const);
  const runDuration = durationMs(started?.at, completed?.at);

  return Object.freeze({
    traceId: first.traceId,
    flowId: first.flowId,
    flowVersion: first.flowVersion,
    actor: first.actor,
    conversationId: first.conversationId,
    inboundMessageId: first.inboundMessageId,
    ...(started === undefined ? {} : { startedAt: started.at }),
    ...(completed === undefined ? {} : { completedAt: completed.at }),
    ...(runDuration === undefined ? {} : { durationMs: runDuration }),
    ...(completed?.resultCode === undefined ? {} : { outcome: completed.resultCode }),
    status,
    nodes: Object.freeze(nodes),
    eventCount: ordered.length,
  });
}
export function buildAgentFlowReplayHistory(
  snapshot: AgentFlowTraceSnapshot,
): readonly AgentFlowReplayRun[] {
  const byTrace = new Map<string, AgentFlowTraceEvent[]>();
  for (const event of snapshot.events) {
    const bucket = byTrace.get(event.traceId) ?? [];
    bucket.push(event);
    byTrace.set(event.traceId, bucket);
  }
  const runs = [...byTrace.values()]
    .map((events) => replayRun(events))
    .sort((left, right) => {
      const leftAt = left.startedAt ?? left.completedAt ?? '';
      const rightAt = right.startedAt ?? right.completedAt ?? '';
      return rightAt.localeCompare(leftAt);
    });
  return Object.freeze(runs);
}

export function findReplayRun(
  snapshot: AgentFlowTraceSnapshot,
  traceId: string,
): AgentFlowReplayRun | undefined {
  return buildAgentFlowReplayHistory(snapshot).find((run) => run.traceId === traceId);
}
