/**
 * The control-plane read model (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * ### These are DTOs, and that is the whole point
 *
 * Jarvis OS renders operator surfaces today from a local demo provider, and will later
 * render them from a governed control-plane API. A future React Native / Expo Android
 * client must reuse the same conceptual contracts through that API rather than growing a
 * second business-logic stack beside this one.
 *
 * So the shapes live here, in a boundary module, and **no business decision lives in a
 * React component**. A component receives a `SystemHealth` and paints it; it does not
 * decide what healthy means, which agent owns which vendor, or whether anything may be
 * sent. Swap the provider and every screen keeps working; port the provider to Android and
 * every screen's meaning travels with it.
 *
 * ### What these types deliberately CANNOT express
 *
 * There is no `canSend`, `canExecute`, `isAuthorized`, `approve()`, `dispatch()` or
 * `consentValid` anywhere in this file, and no field in which one could be smuggled. The
 * read model is a description of what the system reports; authority is QuickFurno Core's,
 * execution is n8n's, delivery is a provider's. A surface that could grant permission would
 * be a second source of business truth, which ADR-0001 forbids outright.
 */
import type { CapabilityId, CapabilityLifecycle, CapabilityTone } from '../capabilities/catalog';

/** A coarse operational reading. Always rendered with its label, never colour alone. */
export type HealthState =
  | 'HEALTHY'
  | 'CONNECTED'
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'SHADOW'
  | 'ROLLOUT_OFF'
  | 'PLANNED'
  | 'DISABLED'
  | 'NOT_CONNECTED';

export interface HealthPresentation {
  readonly label: string;
  readonly tone: CapabilityTone;
}

export const HEALTH_PRESENTATION: Readonly<Record<HealthState, HealthPresentation>> = Object.freeze(
  {
    HEALTHY: { label: 'Healthy', tone: 'healthy' },
    CONNECTED: { label: 'Connected', tone: 'healthy' },
    AVAILABLE: { label: 'Available', tone: 'healthy' },
    DEGRADED: { label: 'Degraded', tone: 'warning' },
    OFFLINE: { label: 'Offline', tone: 'critical' },
    SHADOW: { label: 'Shadow', tone: 'shadow' },
    ROLLOUT_OFF: { label: 'Rollout off', tone: 'warning' },
    PLANNED: { label: 'Planned', tone: 'planned' },
    DISABLED: { label: 'Disabled', tone: 'offline' },
    NOT_CONNECTED: { label: 'Not connected', tone: 'offline' },
  },
);

/** One entry on the top status strip. */
export interface SystemComponentHealth {
  readonly id: string;
  readonly label: string;
  readonly state: HealthState;
  /** One short clause an operator can act on. Never a stack trace, never an identifier. */
  readonly detail: string;
}

export interface SystemHealth {
  readonly components: readonly SystemComponentHealth[];
  /** Whole-plane rollout posture. Off in every environment this release runs in. */
  readonly rolloutEnabled: false;
  readonly environmentLabel: string;
}

/** A headline number, with the trend that gives it meaning. */
export interface MetricSummary {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly deltaLabel?: string;
  readonly deltaDirection?: 'up' | 'down' | 'flat';
  /** Whether "up" is good here. A rising escalation count is not an improvement. */
  readonly higherIsBetter?: boolean;
  readonly caption: string;
}

/** A point on a time series. `label` is what an axis shows. */
export interface SeriesPoint {
  readonly label: string;
  readonly value: number;
}

export interface NamedSeries {
  readonly id: string;
  readonly label: string;
  readonly tone: CapabilityTone;
  readonly points: readonly SeriesPoint[];
}

/** A categorical share — agent workload, approval outcome mix. */
export interface DistributionSlice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly tone: CapabilityTone;
}

/** One stage of a funnel preview. */
export interface FunnelStage {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly caption: string;
}

/** The four agents, as product surfaces. */
export type AgentId = 'jarvis' | 'riya' | 'aarohi' | 'anisha';

export interface AgentSummary {
  readonly id: AgentId;
  readonly name: string;
  /** The one-line scope. Aarohi and Anisha never share one. */
  readonly role: string;
  readonly capabilityId: CapabilityId;
  readonly lifecycle: CapabilityLifecycle;
  readonly state: HealthState;
  readonly metrics: readonly MetricSummary[];
  readonly notes: readonly string[];
}

/** An item on the action-required rail. Nothing here is actionable in this release. */
export interface AttentionItem {
  readonly id: string;
  readonly kind: 'approval' | 'escalation' | 'warning' | 'worker' | 'blocked';
  readonly title: string;
  readonly context: string;
  readonly age: string;
  readonly severity: 'critical' | 'warning' | 'info';
}

/** One provenance-labelled activity entry. */
export interface ActivityEntry {
  readonly id: string;
  readonly source: 'CORE' | 'JARVIS' | 'RIYA' | 'ANISHA' | 'AAROHI' | 'SYSTEM';
  readonly at: string;
  readonly message: string;
  readonly tone: CapabilityTone;
}

/** One row of the approval desk. */
export interface ApprovalQueueRow {
  readonly id: string;
  readonly requestedAction: string;
  readonly risk:
    | 'informational'
    | 'low-risk-reversible'
    | 'client-or-vendor-facing'
    | 'money-related'
    | 'high-risk';
  readonly requestedAuthority: string;
  readonly sourceAgent: string;
  readonly subject: string;
  readonly age: string;
  readonly slaState: 'ok' | 'due' | 'breached';
  readonly state: 'awaiting-core' | 'awaiting-operator' | 'answered';
}

/** A conversation-control row for the operations centre. */
export interface ConversationControlRow {
  readonly id: string;
  readonly subject: string;
  readonly agent: string;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly lastOperatorAction: string;
  readonly revision: number;
}

/** A worker node. */
export interface WorkerNode {
  readonly id: string;
  readonly label: string;
  readonly kind: 'control-plane' | 'local-node' | 'gpu-node';
  readonly state: HealthState;
  readonly capacity: string;
  readonly detail: string;
}

/** A model/provider profile. */
export interface ModelProfile {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly state: HealthState;
  readonly dataClass: 'external-provider' | 'local-only';
  readonly latencyP95: string;
  readonly circuit: 'closed' | 'half-open' | 'open';
  readonly detail: string;
}

/** A governed knowledge namespace. */
export interface KnowledgeNamespace {
  readonly id: string;
  readonly label: string;
  readonly owner: string;
  readonly state: HealthState;
  readonly detail: string;
}

/** One evaluation dimension. */
export interface EvaluationDimension {
  readonly id: string;
  readonly label: string;
  readonly state: HealthState;
  readonly caseCount: number;
  readonly detail: string;
}

/** One ownership row on the Core-sync boundary table. */
export interface OwnershipRow {
  readonly id: string;
  readonly subject: string;
  readonly owner: 'QuickFurno Core' | 'QF Jarvis';
  readonly detail: string;
}

/** A roadmap marker on the governance surface. */
export interface RoadmapMarker {
  readonly id: string;
  readonly label: string;
  readonly state: 'merged' | 'next' | 'planned';
  readonly detail: string;
}

/**
 * The read model Jarvis OS renders.
 *
 * Every method is a READ. There is no writer on this interface and no place to add one
 * without changing this file, which is exactly the friction that should exist before a
 * surface acquires the ability to change anything.
 */
export interface ControlPlaneReadModel {
  readonly kind: 'demo' | 'api';
  systemHealth(): SystemHealth;
  headlineMetrics(): readonly MetricSummary[];
  activitySeries(): NamedSeries;
  latencySeries(): NamedSeries;
  agentWorkload(): readonly DistributionSlice[];
  approvalBreakdown(): readonly DistributionSlice[];
  vendorGrowthFunnel(): readonly FunnelStage[];
  attention(): readonly AttentionItem[];
  activity(): readonly ActivityEntry[];
  agents(): readonly AgentSummary[];
  agent(id: AgentId): AgentSummary | undefined;
  approvalQueue(): readonly ApprovalQueueRow[];
  conversationControl(): readonly ConversationControlRow[];
  workers(): readonly WorkerNode[];
  models(): readonly ModelProfile[];
  knowledge(): readonly KnowledgeNamespace[];
  evaluations(): readonly EvaluationDimension[];
  ownership(): readonly OwnershipRow[];
  roadmap(): readonly RoadmapMarker[];
}
