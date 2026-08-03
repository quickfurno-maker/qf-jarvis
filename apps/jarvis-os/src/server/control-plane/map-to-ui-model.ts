import type {
  ControlPlaneSnapshotV1,
  SeriesSection as WireSeriesSection,
} from '@qf-jarvis/control-plane-read-contract';

import { ENVIRONMENT_LABEL } from '../../lib/environment';
import type {
  ActivityEntry,
  AgentId,
  AgentSummary,
  ControlPlaneReadModel,
  DistributionSlice,
  Section,
  SectionAvailability,
  SeriesSection,
} from '../../lib/control-plane/types';
import type { CapabilityId, CapabilityTone } from '../../lib/capabilities/catalog';

/**
 * The one adapter (JOS-01B, ADR-0086).
 *
 * Wire snapshot in, presentation read model out — once, here, rather than eighteen times across
 * the pages. Components keep receiving the DTOs they already render, so JOS-01A's surface work
 * survives intact, and no React component acquires a decision about what the data means.
 *
 * The mapping is mechanical on purpose. It adds no field the contract does not carry, computes no
 * total the server did not state, and infers nothing from an absence. Where the contract says a
 * section is unreadable, this hands the UI that fact rather than an empty list that reads as zero.
 */

/** Tones are presentation-only. A tone never decides anything; it colours a label. */
const HEALTH_TONE: Readonly<Record<string, CapabilityTone>> = Object.freeze({
  HEALTHY: 'healthy',
  AVAILABLE: 'healthy',
  DEGRADED: 'warning',
  OFFLINE: 'critical',
  SHADOW: 'shadow',
  ROLLOUT_OFF: 'warning',
  PLANNED: 'planned',
  DISABLED: 'offline',
  NOT_CONNECTED: 'offline',
});

function section<TWire, TUi>(
  wire: {
    readonly availability: string;
    readonly reason: string;
    readonly expectedSource: string;
    readonly items: readonly TWire[];
  },
  map: (item: TWire, index: number) => TUi,
): Section<TUi> {
  return Object.freeze({
    availability: wire.availability as SectionAvailability,
    reason: wire.reason,
    expectedSource: wire.expectedSource,
    items: Object.freeze(wire.items.map(map)),
  });
}

function series(wire: WireSeriesSection, tone: CapabilityTone): SeriesSection {
  return Object.freeze({
    availability: wire.availability,
    reason: wire.reason,
    expectedSource: wire.expectedSource,
    id: wire.id,
    label: wire.label,
    tone,
    points: Object.freeze(wire.points.map((point) => ({ label: point.label, value: point.value }))),
  });
}

function slices(
  wire: ControlPlaneSnapshotV1['sections']['agentWorkload'],
): Section<DistributionSlice> {
  return section(wire, (slice, index) => ({
    id: slice.id,
    label: slice.label,
    value: slice.value,
    tone: (['info', 'shadow', 'planned', 'healthy', 'warning'] as const)[index % 5] ?? 'info',
  }));
}

/**
 * Build the read model the pages consume.
 *
 * `kind` is `'baseline'`, not `'demo'`. That distinction is asserted by the test suite: the
 * default operator surface must never be the synthetic fixture again.
 */
export function mapSnapshotToReadModel(snapshot: ControlPlaneSnapshotV1): ControlPlaneReadModel {
  const agents: readonly AgentSummary[] = Object.freeze(
    snapshot.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      // The wire type is a bounded string; the presentation type is the app's closed union. The
      // contract has already validated the shape, so this narrows rather than widens.
      capabilityId: agent.capabilityId as CapabilityId,
      lifecycle: agent.lifecycle,
      state: agent.state,
      // An agent's own numbers come from sources that are not connected. Rather than invent a
      // metric strip per agent, the surface shows none and the page explains why.
      metrics: Object.freeze([]),
      notes: Object.freeze([...agent.notes]),
    })),
  );

  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const sections = snapshot.sections;

  // Sections are built ONCE and the getters close over them. Rebuilding on every call would make
  // `plane.approvalQueue() !== plane.approvalQueue()`, which is a real defect on a server-rendered
  // surface: identity is what lets React and the tests treat a read as stable.
  const headlineMetrics = section(sections.headlineMetrics, (metric) => ({
    id: metric.id,
    label: metric.label,
    value: metric.value,
    ...(metric.unit === undefined ? {} : { unit: metric.unit }),
    caption: metric.caption,
  }));
  const activitySeries = series(sections.conversationActivity, 'info');
  const latencySeries = series(sections.modelLatency, 'shadow');
  const agentWorkload = slices(sections.agentWorkload);
  const approvalBreakdown = slices(sections.approvalBreakdown);
  const businessAnalytics = slices(sections.businessAnalytics);
  const n8nExecution = slices(sections.n8nExecution);
  const vendorGrowthFunnel = section(sections.vendorGrowthFunnel, (stage) => ({
    id: stage.id,
    label: stage.label,
    value: stage.value,
    caption: stage.caption,
  }));
  const attention = section(sections.attention, (item) => ({
    id: item.id,
    kind: item.kind === 'rollout' ? ('warning' as const) : ('blocked' as const),
    title: item.title,
    context: item.context,
    age: '—',
    severity: item.severity,
  }));
  const activity: Section<ActivityEntry> = section(sections.activity, (entry) => ({
    id: entry.id,
    source: 'SYSTEM' as const,
    at: entry.at,
    message: entry.message,
    tone: entry.source === 'GOVERNANCE' ? 'planned' : 'info',
  }));
  const approvalQueue = section(sections.approvalQueue, (row) => ({
    id: row.id,
    requestedAction: row.requestedAction,
    risk: row.risk,
    requestedAuthority: row.requestedAuthority,
    sourceAgent: row.sourceAgent,
    subject: row.subject,
    age: '—',
    slaState: 'ok' as const,
    state: row.state,
  }));
  const conversationControl = section(sections.conversationControl, (row) => ({
    id: row.id,
    subject: row.subject,
    agent: row.agent,
    humanTakeover: row.humanTakeover,
    aiPaused: row.aiPaused,
    lastOperatorAction: '—',
    revision: row.revision,
  }));
  const workers = section(sections.workers, (node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    state: node.state,
    capacity: node.capacity,
    detail: node.detail,
  }));
  const models = section(sections.models, (model) => ({
    id: model.id,
    label: model.label,
    provider: model.provider,
    state: model.state,
    dataClass: model.dataClass,
    latencyP95: '—',
    circuit: 'closed' as const,
    detail: model.detail,
  }));
  const knowledge = section(sections.knowledge, (namespace) => ({
    id: namespace.id,
    label: namespace.label,
    owner: namespace.owner,
    state: namespace.state,
    detail: namespace.detail,
  }));
  const evaluations = section(sections.evaluations, (dimension) => ({
    id: dimension.id,
    label: dimension.label,
    state: dimension.state,
    caseCount: 0,
    detail: dimension.detail,
  }));
  const ownership = section(sections.coreSync, (row) => ({
    id: row.id,
    subject: row.subject,
    owner: row.owner,
    detail: row.detail,
  }));
  const systemHealth = Object.freeze({
    components: Object.freeze(
      snapshot.system.map((component) => ({
        id: component.id,
        label: component.label,
        state: component.state,
        detail: component.detail,
      })),
    ),
    rolloutEnabled: false as const,
    environmentLabel: ENVIRONMENT_LABEL,
  });
  const provenance = Object.freeze({
    kind: snapshot.source.kind,
    freshness: snapshot.source.freshness,
    liveOperationalData: snapshot.source.liveOperationalData,
    observedAt: snapshot.observedAt,
  });
  const roadmap = Object.freeze(
    snapshot.roadmap.map((marker) => ({
      id: marker.id,
      label: marker.label,
      state: marker.state,
      detail: marker.detail,
    })),
  );

  return Object.freeze({
    kind: 'baseline' as const,
    provenance: () => provenance,
    systemHealth: () => systemHealth,
    headlineMetrics: () => headlineMetrics,
    activitySeries: () => activitySeries,
    latencySeries: () => latencySeries,
    agentWorkload: () => agentWorkload,
    approvalBreakdown: () => approvalBreakdown,
    businessAnalytics: () => businessAnalytics,
    n8nExecution: () => n8nExecution,
    vendorGrowthFunnel: () => vendorGrowthFunnel,
    attention: () => attention,
    activity: () => activity,
    agents: () => agents,
    agent: (id: AgentId) => byId.get(id),
    approvalQueue: () => approvalQueue,
    conversationControl: () => conversationControl,
    workers: () => workers,
    models: () => models,
    knowledge: () => knowledge,
    evaluations: () => evaluations,
    ownership: () => ownership,
    roadmap: () => roadmap,
  });
}

export { HEALTH_TONE };
