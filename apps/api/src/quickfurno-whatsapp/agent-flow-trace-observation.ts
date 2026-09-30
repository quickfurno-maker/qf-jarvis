import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
  parseAgentFlowTraceSnapshot,
  type AgentFlowTraceEvent,
  type AgentFlowTraceSink,
} from '@qf-jarvis/agent-flow-trace-contract';

const MAX_TRACE_EVENTS = 512;

export interface AgentFlowTraceObservationWriter extends AgentFlowTraceSink {
  write(emittedAt: string): Promise<void>;
}

export interface AgentFlowTraceObservationWriterConfig {
  readonly filePath: string;
  readonly sourceRevision: string;
}

export function createAgentFlowTraceObservationWriter(
  config: AgentFlowTraceObservationWriterConfig,
): AgentFlowTraceObservationWriter {
  const events: AgentFlowTraceEvent[] = [];

  return Object.freeze({
    record(event: AgentFlowTraceEvent): void {
      events.push(Object.freeze({ ...event }));
      if (events.length > MAX_TRACE_EVENTS) {
        events.splice(0, events.length - MAX_TRACE_EVENTS);
      }
    },

    async write(emittedAt: string): Promise<void> {
      const snapshot = parseAgentFlowTraceSnapshot({
        protocol: AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
        emittedAt,
        sourceRevision: config.sourceRevision,
        events: [...events],
      });
      const directory = dirname(config.filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = config.filePath + '.tmp';
      await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, config.filePath);
    },
  });
}
