import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  let hydrated = false;

  const retainNewest = (): void => {
    if (events.length > MAX_TRACE_EVENTS) {
      events.splice(0, events.length - MAX_TRACE_EVENTS);
    }
  };

  const hydrateExisting = async (): Promise<void> => {
    if (hydrated) return;
    hydrated = true;
    try {
      const existing = parseAgentFlowTraceSnapshot(
        JSON.parse(await readFile(config.filePath, { encoding: 'utf8' })),
      );
      if (existing.sourceRevision !== config.sourceRevision) return;
      events.unshift(...existing.events.map((event) => Object.freeze({ ...event })));
      retainNewest();
    } catch {
      // Missing, stale or malformed history is visibility-only; never fail customer work.
    }
  };

  return Object.freeze({
    record(event: AgentFlowTraceEvent): void {
      events.push(Object.freeze({ ...event }));
      retainNewest();
    },

    async write(emittedAt: string): Promise<void> {
      await hydrateExisting();
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
