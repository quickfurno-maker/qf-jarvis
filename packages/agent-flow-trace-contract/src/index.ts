import { z } from 'zod';

export const AGENT_FLOW_TRACE_PROTOCOL = 'qfj.agent-flow-trace.event.v1' as const;
export const AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL = 'qfj.agent-flow-trace.snapshot.v1' as const;

export const AGENT_FLOW_TRACE_EVENT_KINDS = [
  'RUN_STARTED',
  'NODE_ENTERED',
  'NODE_EXITED',
  'NODE_OBSERVED',
  'RUN_COMPLETED',
] as const;
export type AgentFlowTraceEventKind = (typeof AGENT_FLOW_TRACE_EVENT_KINDS)[number];

export const AGENT_FLOW_TRACE_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'OBSERVED'] as const;
export type AgentFlowTraceStatus = (typeof AGENT_FLOW_TRACE_STATUSES)[number];

export const AGENT_FLOW_TRACE_ACTORS = ['RIYA', 'ANISHA', 'AAROHI'] as const;
export type AgentFlowTraceActor = (typeof AGENT_FLOW_TRACE_ACTORS)[number];

const canonicalInstant = z.iso.datetime({ offset: false });
const opaqueRef = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:@/-]+$/u);
const resultCode = z
  .string()
  .min(1)
  .max(320)
  .regex(/^[A-Za-z0-9._:@/-]+$/u);

export const agentFlowTraceEventSchema = z
  .object({
    protocol: z.literal(AGENT_FLOW_TRACE_PROTOCOL),
    traceId: opaqueRef,
    flowId: opaqueRef,
    flowVersion: z.number().int().positive().max(1_000_000),
    actor: z.enum(AGENT_FLOW_TRACE_ACTORS),
    conversationId: opaqueRef,
    inboundMessageId: opaqueRef,
    sequence: z.number().int().nonnegative().max(10_000),
    kind: z.enum(AGENT_FLOW_TRACE_EVENT_KINDS),
    nodeId: opaqueRef.optional(),
    status: z.enum(AGENT_FLOW_TRACE_STATUSES),
    at: canonicalInstant,
    resultCode: resultCode.optional(),
  })
  .strict()
  .superRefine((event, context) => {
    const nodeEvent =
      event.kind === 'NODE_ENTERED' ||
      event.kind === 'NODE_EXITED' ||
      event.kind === 'NODE_OBSERVED';
    if (nodeEvent && event.nodeId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['nodeId'],
        message: 'node-event-requires-node-id',
      });
    }
    if (!nodeEvent && event.nodeId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['nodeId'],
        message: 'run-event-forbids-node-id',
      });
    }
    if (event.kind === 'RUN_STARTED' && event.status !== 'RUNNING') {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'run-started-status-invalid',
      });
    }
    if (event.kind === 'NODE_ENTERED' && event.status !== 'RUNNING') {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'node-entered-status-invalid',
      });
    }
    if (event.kind === 'NODE_OBSERVED' && event.status !== 'OBSERVED') {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'node-observed-status-invalid',
      });
    }
    if (
      (event.kind === 'NODE_EXITED' || event.kind === 'RUN_COMPLETED') &&
      event.status !== 'SUCCEEDED' &&
      event.status !== 'FAILED'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'completion-status-invalid',
      });
    }
  });

export type AgentFlowTraceEvent = z.infer<typeof agentFlowTraceEventSchema>;

export const agentFlowTraceSnapshotSchema = z
  .object({
    protocol: z.literal(AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL),
    emittedAt: canonicalInstant,
    sourceRevision: z.string().regex(/^[0-9a-f]{40}$/u),
    events: z.array(agentFlowTraceEventSchema).max(512),
  })
  .strict();

export type AgentFlowTraceSnapshot = z.infer<typeof agentFlowTraceSnapshotSchema>;

export const AGENT_FLOW_TRACE_READ_REASONS = [
  'NOT_CONFIGURED',
  'SOURCE_UNREACHABLE',
  'SOURCE_UNUSABLE',
] as const;

export const agentFlowTraceReadResultSchema = z.discriminatedUnion('available', [
  z
    .object({
      available: z.literal(false),
      reason: z.enum(AGENT_FLOW_TRACE_READ_REASONS),
    })
    .strict(),
  z
    .object({
      available: z.literal(true),
      freshness: z.enum(['LIVE', 'STALE']),
      snapshot: agentFlowTraceSnapshotSchema,
    })
    .strict(),
]);

export type AgentFlowTraceReadResult = z.infer<typeof agentFlowTraceReadResultSchema>;

export interface AgentFlowTraceSink {
  record(event: AgentFlowTraceEvent): void;
}

export function parseAgentFlowTraceEvent(value: unknown): AgentFlowTraceEvent {
  return agentFlowTraceEventSchema.parse(value);
}

export function parseAgentFlowTraceSnapshot(value: unknown): AgentFlowTraceSnapshot {
  return agentFlowTraceSnapshotSchema.parse(value);
}

export function parseAgentFlowTraceReadResult(value: unknown): AgentFlowTraceReadResult {
  return agentFlowTraceReadResultSchema.parse(value);
}
