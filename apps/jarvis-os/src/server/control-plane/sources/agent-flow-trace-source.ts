import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
  parseAgentFlowTraceSnapshot,
  type AgentFlowTraceReadResult,
  type AgentFlowTraceSnapshot,
} from '@qf-jarvis/agent-flow-trace-contract';

const MAX_FILE_BYTES = 512 * 1024;
const LIVE_FRESHNESS_MS = 30_000;

export async function readAgentFlowTraceSnapshot(
  filePath: string | undefined,
): Promise<AgentFlowTraceReadResult> {
  if (filePath === undefined) {
    return Object.freeze({ available: false as const, reason: 'NOT_CONFIGURED' as const });
  }
  if (!isAbsolute(filePath)) {
    return Object.freeze({ available: false as const, reason: 'SOURCE_UNUSABLE' as const });
  }

  let raw: string;
  try {
    raw = await readFile(filePath, { encoding: 'utf8' });
  } catch {
    return Object.freeze({ available: false as const, reason: 'SOURCE_UNREACHABLE' as const });
  }
  if (raw.length < 2 || raw.length > MAX_FILE_BYTES) {
    return Object.freeze({ available: false as const, reason: 'SOURCE_UNUSABLE' as const });
  }

  let snapshot: AgentFlowTraceSnapshot;
  try {
    snapshot = parseAgentFlowTraceSnapshot(JSON.parse(raw));
  } catch {
    return Object.freeze({ available: false as const, reason: 'SOURCE_UNUSABLE' as const });
  }

  const emittedMs = Date.parse(snapshot.emittedAt);
  const nowMs = Date.now();
  if (!Number.isFinite(emittedMs) || emittedMs > nowMs + 1_000) {
    return Object.freeze({ available: false as const, reason: 'SOURCE_UNUSABLE' as const });
  }

  return Object.freeze({
    available: true as const,
    freshness: nowMs - emittedMs <= LIVE_FRESHNESS_MS ? ('LIVE' as const) : ('STALE' as const),
    snapshot,
  });
}
