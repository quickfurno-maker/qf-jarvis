/**
 * The demo control-plane provider (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * A READ-ONLY adapter over a local fixture. It implements `ControlPlaneReadModel` and
 * nothing else — there is no writer, no fetch, no cache, no clock and no mutation path, and
 * `kind: 'demo'` is exposed so a surface can say plainly where its numbers came from.
 *
 * This is the seam. When JOS-01B adds a governed control-plane API, an `ApiControlPlane`
 * implements the same interface and every screen keeps working unchanged; when a React
 * Native client arrives, it consumes that same API rather than reaching into Next.js
 * internals. The contracts travel; the transport does not.
 */
import {
  ACTIVITY_LOG,
  ACTIVITY_SERIES,
  AGENTS,
  AGENT_WORKLOAD,
  APPROVAL_BREAKDOWN,
  APPROVAL_QUEUE,
  ATTENTION,
  CONVERSATION_CONTROL,
  EVALUATIONS,
  HEADLINE_METRICS,
  KNOWLEDGE,
  LATENCY_SERIES,
  MODELS,
  OWNERSHIP,
  ROADMAP,
  SYSTEM_HEALTH,
  VENDOR_GROWTH_FUNNEL,
  WORKERS,
} from '../demo-data/snapshot';
import type { AgentId, ControlPlaneReadModel } from './types';

/** Build the demo read model. Frozen, so a caller cannot substitute a method for a writer. */
export function createDemoControlPlane(): ControlPlaneReadModel {
  return Object.freeze({
    kind: 'demo' as const,
    systemHealth: () => SYSTEM_HEALTH,
    headlineMetrics: () => HEADLINE_METRICS,
    activitySeries: () => ACTIVITY_SERIES,
    latencySeries: () => LATENCY_SERIES,
    agentWorkload: () => AGENT_WORKLOAD,
    approvalBreakdown: () => APPROVAL_BREAKDOWN,
    vendorGrowthFunnel: () => VENDOR_GROWTH_FUNNEL,
    attention: () => ATTENTION,
    activity: () => ACTIVITY_LOG,
    agents: () => AGENTS,
    agent: (id: AgentId) => AGENTS.find((entry) => entry.id === id),
    approvalQueue: () => APPROVAL_QUEUE,
    conversationControl: () => CONVERSATION_CONTROL,
    workers: () => WORKERS,
    models: () => MODELS,
    knowledge: () => KNOWLEDGE,
    evaluations: () => EVALUATIONS,
    ownership: () => OWNERSHIP,
    roadmap: () => ROADMAP,
  });
}
